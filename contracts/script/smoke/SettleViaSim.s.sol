// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { MarketReport, SettlementReport } from "../../src/interfaces/ISettlementReceiver.sol";
import { Script, console2 } from "forge-std/Script.sol";

interface IMockForwarder {
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata reportContext,
        bytes[] calldata signatures
    ) external;
}

interface ISettlementReceiverView {
    function simNonce(
        uint64 matchId
    ) external view returns (uint256);
}

/// @notice Smoke test: builds a real SettlementReport, signs it with the sim attestor key, and
///         delivers it through a MockKeystoneForwarder exactly as `cre workflow simulate
///         --broadcast` would.
contract SettleViaSimSmoke is Script {
    function run() external {
        address receiver = vm.envAddress("RECEIVER");
        bytes memory rawReport = _buildRawReport(receiver);

        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        IMockForwarder(vm.envAddress("SIM_FORWARDER")).report(receiver, rawReport, "", new bytes[](0));
        vm.stopBroadcast();

        console2.log("settlement report delivered via simulation forwarder");
    }

    function _buildRawReport(
        address receiver
    ) internal returns (bytes memory) {
        SettlementReport memory rpt = _buildReport();
        bytes memory simSig = _signReport(receiver, rpt);
        bytes memory payload = abi.encode(rpt, simSig);

        return abi.encodePacked(
            bytes1(0x01),
            bytes32(uint256(0xde)),
            bytes4(0),
            bytes4(0),
            bytes4(0),
            keccak256("ninety-settlement"), // workflow_cid
            bytes10("settlement"), // workflow_name
            address(0x00000000000000000000000000000000C0FFEE), // workflow_owner
            bytes2(0x0001), // report_id
            payload
        );
    }

    function _buildReport() internal view returns (SettlementReport memory rpt) {
        // Defaults preserve this script's original standalone smoke-test behaviour (a synthetic
        // Yes a fixed 40s in the past); an integrated rehearsal instead passes the real values
        // resolveMarket actually produced against the replayed match, so the signed report
        // reflects observed match reality rather than a fabricated one.
        uint8 outcome = uint8(_envUintOr("OUTCOME", 1));
        uint64 qualifyingEventTs = uint64(_envUintOr("QUALIFYING_EVENT_TS", block.timestamp - 40));

        MarketReport[] memory markets = new MarketReport[](1);
        markets[0] = MarketReport({
            marketId: vm.envUint("MARKET_ID"),
            outcome: outcome,
            qualifyingEventTs: qualifyingEventTs,
            evidenceHash: keccak256("wyscout:1694390:event:shot:34:12")
        });

        rpt = SettlementReport({
            matchId: uint64(vm.envUint("MATCH_ID")),
            asOfMatchClock: 720,
            producedAt: uint64(block.timestamp),
            markets: markets
        });
    }

    function _signReport(address receiver, SettlementReport memory rpt) internal returns (bytes memory) {
        uint256 nonce = ISettlementReceiverView(receiver).simNonce(rpt.matchId);
        bytes32 digest = keccak256(abi.encode(block.chainid, receiver, nonce, keccak256(abi.encode(rpt))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(vm.envUint("ATTESTOR_PK"), digest);
        return abi.encodePacked(r, s, v);
    }

    function _envUintOr(string memory key, uint256 fallback_) internal view returns (uint256) {
        try vm.envUint(key) returns (uint256 v) {
            return v;
        } catch {
            return fallback_;
        }
    }
}
