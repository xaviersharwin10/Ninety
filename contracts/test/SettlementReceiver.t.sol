// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Test } from "forge-std/Test.sol";

import { MarketManager } from "../src/MarketManager.sol";

import { SettlementReceiver } from "../src/SettlementReceiver.sol";
import { Market, MarketState, Outcome } from "../src/interfaces/IMarketManager.sol";
import { ISettlementReceiver } from "../src/interfaces/ISettlementReceiver.sol";
import { MarketReport, SettlementReport } from "../src/interfaces/ISettlementReceiver.sol";
import { MockKeystoneForwarder } from "./mocks/MockKeystoneForwarder.sol";

contract SettlementReceiverTest is Test {
    bytes32 internal constant SHOT = keccak256("SHOT_ON_TARGET_NEXT_N");

    MarketManager internal mm;
    SettlementReceiver internal receiver;
    MockKeystoneForwarder internal prodMock; // stand-in for the real, signature-checked forwarder
    MockKeystoneForwarder internal simMock; // reproduces the real MockKeystoneForwarder's behaviour

    address internal admin = makeAddr("admin");
    address internal scheduler = makeAddr("scheduler");
    address internal stranger = makeAddr("stranger");

    uint256 internal attestorPk = 0xA77E5704;
    address internal attestor;

    uint64 internal matchId;
    uint64 internal closesAt;

    function setUp() public {
        vm.warp(1_700_000_000);
        attestor = vm.addr(attestorPk);

        mm = new MarketManager(admin);
        prodMock = new MockKeystoneForwarder();
        simMock = new MockKeystoneForwarder();

        receiver = new SettlementReceiver(admin, mm, address(prodMock), address(simMock));

        vm.startPrank(admin);
        mm.grantRole(mm.SCHEDULER_ROLE(), scheduler);
        mm.grantRole(mm.SETTLER_ROLE(), address(receiver));
        mm.setTemplate(SHOT, true);
        vm.stopPrank();

        vm.prank(scheduler);
        matchId = mm.createMatch(keccak256("wyscout:1694390"), uint64(block.timestamp), "");
        closesAt = uint64(block.timestamp + 60);
    }

    function _openMarket() internal returns (uint256 marketId) {
        vm.prank(scheduler);
        marketId = mm.openMarket(matchId, SHOT, 600, 720, closesAt, 0);
    }

    // ------------------------------------------------------------------
    // Report construction helpers
    // ------------------------------------------------------------------

    struct Workflow {
        bytes32 workflowCid;
        bytes10 workflowName;
        address workflowOwner;
        bytes2 reportId;
    }

    function _rawReport(Workflow memory wf, bytes memory payload) internal pure returns (bytes memory) {
        return abi.encodePacked(
            bytes1(0x01), // version
            bytes32(uint256(0xde)), // workflow_execution_id (filler)
            bytes4(0), // timestamp
            bytes4(0), // don_id
            bytes4(0), // don_config_version
            wf.workflowCid,
            wf.workflowName,
            wf.workflowOwner,
            wf.reportId,
            payload
        );
    }

    function _defaultWorkflow() internal pure returns (Workflow memory) {
        return Workflow({
            workflowCid: keccak256("ninety-settlement"),
            workflowName: bytes10("settlement"),
            workflowOwner: address(0x00000000000000000000000000000000C0FFEE),
            reportId: 0x0001
        });
    }

    function _payload(
        SettlementReport memory rpt,
        bytes memory simSig
    ) internal pure returns (bytes memory) {
        return abi.encode(rpt, simSig);
    }

    function _singleMarketReport(
        uint256 marketId,
        uint8 outcome,
        uint64 eventTs,
        uint64 producedAt
    ) internal view returns (SettlementReport memory rpt) {
        MarketReport[] memory markets = new MarketReport[](1);
        markets[0] = MarketReport({
            marketId: marketId,
            outcome: outcome,
            qualifyingEventTs: eventTs,
            evidenceHash: keccak256("evidence")
        });
        rpt = SettlementReport({
            matchId: matchId,
            asOfMatchClock: 720,
            producedAt: producedAt,
            markets: markets
        });
    }

    function _signSim(
        SettlementReport memory rpt
    ) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encode(
                block.chainid, address(receiver), receiver.simNonce(rpt.matchId), keccak256(abi.encode(rpt))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------
    // Mock forwarder self-test
    //
    // The mock's metadata decode had an off-by-4-byte header bug during development (it read
    // don_config_version instead of workflow_cid) that no assertion on SettlementReceiver itself
    // would have caught, because SettlementReceiver just trusts whatever 64-byte metadata block
    // it is handed. This pins the mock's decoding directly against known input bytes.
    // ------------------------------------------------------------------

    function test_mockForwarder_decodesMetadataAtTheCorrectOffsets() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        Workflow memory wf = Workflow({
            workflowCid: bytes32(uint256(0xAAAA)),
            workflowName: bytes10("check-me"),
            workflowOwner: address(0xBEEF),
            reportId: 0x0042
        });

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(wf, _payload(rpt, ""));

        vm.expectEmit(true, true, true, true, address(receiver));
        emit ISettlementReceiver.ReportAccepted(
            address(prodMock),
            wf.workflowCid,
            wf.workflowName,
            wf.workflowOwner,
            matchId,
            1,
            uint64(block.timestamp)
        );
        prodMock.report(address(receiver), raw, "", new bytes[](0));
    }

    // ------------------------------------------------------------------
    // Forwarder gating
    // ------------------------------------------------------------------

    function test_onReport_rejectsCallFromArbitraryAddress() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));

        // Strip the forwarder framing: call onReport directly as a stranger with a well-formed
        // metadata + payload pair, exactly what a non-forwarder attempt would look like.
        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SettlementReceiver.NotAllowedForwarder.selector, stranger));
        receiver.onReport(metadata, payload);
    }

    function test_onReport_productionForwarderNeedsNoAttestorSignature() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, "")); // empty sig

        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Resolved));
    }

    /// @dev The finding this whole design responds to: the simulation forwarder authenticates
    ///      nothing, so by default it must not be allowed to settle anything at all.
    function test_onReport_simulationForwarderDisabledByDefault() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, _signSim(rpt)));

        (bytes memory metadata, bytes memory payload) = _split(raw);
        // simEnabled defaults to false, so isAllowedForwarder rejects simMock before onReport
        // ever reaches the attestor-signature check.
        vm.prank(address(simMock));
        vm.expectRevert(
            abi.encodeWithSelector(SettlementReceiver.NotAllowedForwarder.selector, address(simMock))
        );
        receiver.onReport(metadata, payload);
    }

    function test_onReport_simulationForwarderRejectsWrongSignature() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        vm.prank(admin);
        receiver.setForwarder(address(simMock), true);
        vm.prank(admin);
        receiver.setSimAttestor(attestor);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        // Signed by the wrong key.
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, keccak256("wrong"));
        bytes memory badSig = abi.encodePacked(r, s, v);
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, badSig));

        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(simMock));
        vm.expectRevert(SettlementReceiver.InvalidSimSignature.selector);
        receiver.onReport(metadata, payload);
    }

    /// @dev With the attestor signature in place, the simulation path settles exactly like the
    ///      production path, which is the whole point: the demo behaves identically either way.
    function test_onReport_simulationForwarderAcceptsValidAttestorSignature() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        vm.startPrank(admin);
        receiver.setForwarder(address(simMock), true);
        receiver.setSimAttestor(attestor);
        vm.stopPrank();

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, _signSim(rpt)));

        simMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Resolved));
    }

    /// @dev Forging the metadata is exactly the attack demonstrated against the real mock
    ///      forwarder: it costs the attacker nothing to claim any workflowOwner they like. The
    ///      attestor signature must still gate settlement regardless of what the metadata claims.
    function test_onReport_forgedMetadataStillRequiresAttestorSignature() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        vm.prank(admin);
        receiver.setForwarder(address(simMock), true);
        vm.prank(admin);
        receiver.setSimAttestor(attestor);
        // Deliberately no expected-workflow pin, mirroring an unpinned deployment.

        Workflow memory forged = Workflow({
            workflowCid: keccak256("totally-not-ninety"),
            workflowName: bytes10("evil"),
            workflowOwner: stranger,
            reportId: 0x0000
        });

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        // Well-formed but from the wrong key: this isolates "wrong signer" from ECDSA's own
        // malformed-input checks, which would fail first on truly empty bytes.
        (uint8 v, bytes32 r, bytes32 s2) = vm.sign(0xBAD, keccak256("forged"));
        bytes memory wrongSig = abi.encodePacked(r, s2, v);
        bytes memory raw = _rawReport(forged, _payload(rpt, wrongSig));

        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(simMock));
        vm.expectRevert(SettlementReceiver.InvalidSimSignature.selector);
        receiver.onReport(metadata, payload);
    }

    function test_onReport_emptySimSignatureFailsClosed() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        vm.prank(admin);
        receiver.setForwarder(address(simMock), true);
        vm.prank(admin);
        receiver.setSimAttestor(attestor);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, "")); // malformed, not just wrong

        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(simMock));
        vm.expectRevert(); // ECDSA's own length check fires first; either way, it must not settle
        receiver.onReport(metadata, payload);

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Open), "not settled");
    }

    function test_setExpectedWorkflow_rejectsMismatch() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        Workflow memory wf = _defaultWorkflow();
        vm.prank(admin);
        receiver.setExpectedWorkflow(wf.workflowCid, wf.workflowName, wf.workflowOwner);

        Workflow memory wrong = wf;
        wrong.workflowOwner = stranger;

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(wrong, _payload(rpt, ""));

        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(prodMock));
        vm.expectRevert(
            abi.encodeWithSelector(
                SettlementReceiver.WorkflowMismatch.selector, wrong.workflowCid, wrong.workflowName, stranger
            )
        );
        receiver.onReport(metadata, payload);
    }

    // ------------------------------------------------------------------
    // Admin controls
    // ------------------------------------------------------------------

    function test_setForwarder_cannotDisableProduction() public {
        vm.prank(admin);
        vm.expectRevert(SettlementReceiver.ProductionForwarderCannotBeDisabled.selector);
        receiver.setForwarder(address(prodMock), false);
    }

    function test_setForwarder_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        receiver.setForwarder(address(simMock), true);
    }

    function test_lockProduction_disablesSimPathPermanently() public {
        vm.startPrank(admin);
        receiver.setForwarder(address(simMock), true);
        receiver.setSimAttestor(attestor);
        receiver.lockProduction();
        vm.stopPrank();

        assertTrue(receiver.productionLocked());
        assertFalse(receiver.isAllowedForwarder(address(simMock)));
        assertEq(receiver.simAttestor(), address(0), "attestor key dropped");

        vm.prank(admin);
        vm.expectRevert(SettlementReceiver.ProductionIsLocked.selector);
        receiver.setForwarder(address(simMock), true);

        vm.prank(admin);
        vm.expectRevert(SettlementReceiver.ProductionIsLocked.selector);
        receiver.setSimAttestor(attestor);
    }

    function test_lockProduction_leavesProductionForwarderWorking() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        vm.prank(admin);
        receiver.lockProduction();

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Resolved));
    }

    // ------------------------------------------------------------------
    // Report semantics
    // ------------------------------------------------------------------

    function test_onReport_resolvesYesAndNo() public {
        uint256 idYes = _openMarket();
        uint256 idNo = _openMarket();
        vm.warp(closesAt);

        MarketReport[] memory markets = new MarketReport[](2);
        markets[0] = MarketReport(idYes, 1, uint64(block.timestamp - 20), keccak256("a"));
        markets[1] = MarketReport(idNo, 2, 0, keccak256("b"));
        SettlementReport memory rpt = SettlementReport(matchId, 720, uint64(block.timestamp), markets);

        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(idYes).outcome), uint8(Outcome.Yes));
        assertEq(mm.getMarket(idYes).qualifyingEventTs, uint64(block.timestamp - 20));
        assertEq(uint8(mm.getMarket(idNo).outcome), uint8(Outcome.No));
    }

    function test_onReport_voidsAMarket() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        SettlementReport memory rpt = _singleMarketReport(id, 3, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(id).state), uint8(MarketState.Voided));
        assertEq(uint8(mm.getMarket(id).outcome), uint8(Outcome.Void));
    }

    function test_onReport_rejectsInvalidOutcomeByteWithoutRevertingBatch() public {
        uint256 idBad = _openMarket();
        uint256 idGood = _openMarket();
        vm.warp(closesAt);

        MarketReport[] memory markets = new MarketReport[](2);
        markets[0] = MarketReport(idBad, 7, 0, keccak256("bad")); // invalid outcome byte
        markets[1] = MarketReport(idGood, 1, 0, keccak256("good"));
        SettlementReport memory rpt = SettlementReport(matchId, 720, uint64(block.timestamp), markets);

        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));

        vm.expectEmit(true, false, false, true, address(receiver));
        emit ISettlementReceiver.ReportRejected(idBad, "INVALID_OUTCOME_BYTE");
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(idBad).state), uint8(MarketState.Open), "untouched");
        assertEq(uint8(mm.getMarket(idGood).state), uint8(MarketState.Resolved), "still settled");
    }

    /// @dev A market still in its betting window cannot be resolved. That must not sink the rest
    ///      of the match's report.
    function test_onReport_oneMarketStillOpenDoesNotBlockOthers() public {
        uint256 idNotClosed = _openMarket();
        uint256 idReady = _openMarket();
        vm.warp(closesAt); // idReady's window has passed; a fresh one has not

        vm.prank(scheduler);
        uint256 idFresh = mm.openMarket(matchId, SHOT, 800, 900, uint64(block.timestamp + 300), 0);

        MarketReport[] memory markets = new MarketReport[](2);
        markets[0] = MarketReport(idFresh, 1, 0, keccak256("early"));
        markets[1] = MarketReport(idReady, 1, 0, keccak256("ready"));
        SettlementReport memory rpt = SettlementReport(matchId, 720, uint64(block.timestamp), markets);

        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));

        vm.expectEmit(true, false, false, true, address(receiver));
        emit ISettlementReceiver.ReportRejected(idFresh, "RESOLVE_FAILED");
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        assertEq(uint8(mm.getMarket(idFresh).state), uint8(MarketState.Open), "still open");
        assertEq(uint8(mm.getMarket(idReady).state), uint8(MarketState.Resolved));
        idNotClosed; // silence unused warning; kept for readability of the scenario
    }

    // ------------------------------------------------------------------
    // Replay protection
    // ------------------------------------------------------------------

    function test_onReport_rejectsStaleOrReplayedProducedAt() public {
        uint256 id = _openMarket();
        vm.warp(closesAt);

        SettlementReport memory rpt = _singleMarketReport(id, 1, 0, uint64(block.timestamp));
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));
        prodMock.report(address(receiver), raw, "", new bytes[](0));

        // Re-submitting the exact same report (same producedAt) must be rejected outright, not
        // silently no-op through MarketManager's own "already resolved" guard.
        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(prodMock));
        vm.expectRevert(
            abi.encodeWithSelector(
                SettlementReceiver.StaleReport.selector, matchId, rpt.producedAt, rpt.producedAt
            )
        );
        receiver.onReport(metadata, payload);
    }

    function test_onReport_simSignatureCannotBeReplayedAcrossReports() public {
        uint256 id1 = _openMarket();
        uint256 id2 = _openMarket();
        vm.warp(closesAt);

        vm.startPrank(admin);
        receiver.setForwarder(address(simMock), true);
        receiver.setSimAttestor(attestor);
        vm.stopPrank();

        SettlementReport memory rpt1 = _singleMarketReport(id1, 1, 0, uint64(block.timestamp));
        bytes memory sig1 = _signSim(rpt1);
        simMock.report(
            address(receiver), _rawReport(_defaultWorkflow(), _payload(rpt1, sig1)), "", new bytes[](0)
        );

        // The same signature, replayed against a different report for a later producedAt, must
        // fail: it was computed over rpt1's content and nonce 0, not this one.
        SettlementReport memory rpt2 = _singleMarketReport(id2, 1, 0, uint64(block.timestamp + 1));
        bytes memory raw2 = _rawReport(_defaultWorkflow(), _payload(rpt2, sig1));

        (bytes memory metadata, bytes memory payload) = _split(raw2);
        vm.prank(address(simMock));
        vm.expectRevert(SettlementReceiver.InvalidSimSignature.selector);
        receiver.onReport(metadata, payload);
    }

    function test_onReport_rejectsEmptyReport() public {
        vm.warp(closesAt);
        MarketReport[] memory empty = new MarketReport[](0);
        SettlementReport memory rpt = SettlementReport(matchId, 720, uint64(block.timestamp), empty);
        bytes memory raw = _rawReport(_defaultWorkflow(), _payload(rpt, ""));

        (bytes memory metadata, bytes memory payload) = _split(raw);
        vm.prank(address(prodMock));
        vm.expectRevert(SettlementReceiver.EmptyReport.selector);
        receiver.onReport(metadata, payload);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /// @dev Splits a raw 109-byte-header report the same way the real forwarder does, for tests
    ///      that call `onReport` directly rather than through a mock forwarder.
    function _split(
        bytes memory raw
    ) internal pure returns (bytes memory metadata, bytes memory payload) {
        bytes32 workflowCid;
        bytes10 workflowName;
        address workflowOwner;
        bytes2 reportId;
        assembly {
            let base := add(raw, 32) // skip the length word
            base := add(base, 45)
            workflowCid := mload(base)
            workflowName := mload(add(base, 32))
            workflowOwner := shr(96, mload(add(base, 42)))
            reportId := mload(add(base, 62))
        }
        metadata = new bytes(64);
        assembly {
            mstore(add(metadata, 32), workflowCid)
            mstore(add(metadata, 64), workflowName)
        }
        for (uint256 i = 0; i < 20; ++i) {
            metadata[42 + i] = bytes1(uint8(uint160(workflowOwner) >> (8 * (19 - i))));
        }
        metadata[62] = reportId[0];
        metadata[63] = reportId[1];

        uint256 payloadLen = raw.length - 109;
        payload = new bytes(payloadLen);
        for (uint256 i = 0; i < payloadLen; ++i) {
            payload[i] = raw[109 + i];
        }
    }
}
