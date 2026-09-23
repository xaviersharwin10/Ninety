// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import { IMarketManager, Outcome } from "./interfaces/IMarketManager.sol";
import { ISettlementReceiver, MarketReport, SettlementReport } from "./interfaces/ISettlementReceiver.sol";

/// @title SettlementReceiver
/// @notice Chainlink CRE consumer. Resolves markets from a settlement workflow's report.
///
/// @dev Implements `IReceiver.onReport`, called by a Chainlink forwarder after it has verified the
///      report's DON signatures. This contract then only has to check which forwarder called it.
///
///      That check is not uniform across the two forwarders this project uses, and the difference
///      is documented in full, with reproduction steps, in `docs/cre-forwarder-trust-model.md`.
///      Summary: measured directly against Monad testnet, the production `KeystoneForwarder`
///      rejects a report without `f + 1` valid DON signatures, but the `MockKeystoneForwarder`
///      used by `cre workflow simulate --broadcast` has no signer set at all — `report()` with
///      zero signatures from an arbitrary EOA succeeds, and the 64-byte metadata block this
///      contract receives (workflowId, workflowName, workflowOwner) is entirely attacker-chosen.
///      Validating that metadata is therefore real defence on the production path and no defence
///      at all on the simulation path.
///
///      So the simulation forwarder gets independent authentication: it is allowlisted only while
///      `simEnabled` is on (default off), and while it is on, the ABI-encoded payload must carry an
///      ECDSA signature from `simAttestor` — a key the workflow holds locally during simulation —
///      over a hash that binds the chain, this contract, a per-match nonce, and the report itself.
///      `lockProduction` permanently drops the simulation path and the attestor once real deploy
///      access is available, so the judged deployment does not have to carry this trust assumption
///      at all.
contract SettlementReceiver is ISettlementReceiver, IERC165, Ownable2Step, ReentrancyGuard {
    /// @notice The real Chainlink forwarder for `monad-testnet`. Verified to hold 17,182 bytes of
    ///         code and to reject zero-signature reports; see the trust-model doc. Immutable: once
    ///         set at construction it can never be changed or removed.
    address public immutable PRODUCTION_FORWARDER;
    /// @inheritdoc ISettlementReceiver
    address public immutable SIMULATION_FORWARDER;

    IMarketManager public immutable MARKETS;

    bool public simEnabled;
    address public simAttestor;
    /// @inheritdoc ISettlementReceiver
    bool public productionLocked;

    bytes32 public expectedWorkflowId;
    bytes10 public expectedWorkflowName;
    address public expectedWorkflowOwner;

    /// @inheritdoc ISettlementReceiver
    mapping(uint64 matchId => uint64) public lastProducedAt;
    /// @notice Replay counter for the simulation attestor signature, per match.
    mapping(uint64 matchId => uint256) public simNonce;

    error NotAllowedForwarder(address caller);
    error ProductionForwarderCannotBeDisabled();
    error ProductionIsLocked();
    error MetadataTooShort(uint256 length);
    error WorkflowMismatch(bytes32 workflowId, bytes10 workflowName, address workflowOwner);
    error StaleReport(uint64 matchId, uint64 producedAt, uint64 lastAccepted);
    error InvalidSimSignature();
    error EmptyReport();

    constructor(
        address admin,
        IMarketManager markets_,
        address productionForwarder_,
        address simulationForwarder_
    ) Ownable(admin) {
        PRODUCTION_FORWARDER = productionForwarder_;
        SIMULATION_FORWARDER = simulationForwarder_;
        MARKETS = markets_;
    }

    // ------------------------------------------------------------------
    // Owner controls
    // ------------------------------------------------------------------

    /// @inheritdoc ISettlementReceiver
    /// @dev The production forwarder is always allowed and cannot be turned off through here —
    ///      that guarantee is what makes `PRODUCTION_FORWARDER` meaningfully immutable rather than
    ///      immutable in address only. This function only ever toggles the simulation forwarder.
    function setForwarder(address forwarder, bool allowed) external onlyOwner {
        if (forwarder == PRODUCTION_FORWARDER) revert ProductionForwarderCannotBeDisabled();
        if (forwarder != SIMULATION_FORWARDER) revert NotAllowedForwarder(forwarder);
        if (productionLocked) revert ProductionIsLocked();

        simEnabled = allowed;
        emit ForwarderAllowed(forwarder, allowed);
    }

    /// @inheritdoc ISettlementReceiver
    function setSimAttestor(
        address attestor
    ) external onlyOwner {
        if (productionLocked) revert ProductionIsLocked();
        simAttestor = attestor;
        emit SimAttestorSet(attestor);
    }

    /// @inheritdoc ISettlementReceiver
    /// @dev One-way. Once real CRE deploy access lands, this permanently drops the simulation
    ///      forwarder and the attestor key, so the judged deployment carries none of the trust
    ///      assumptions the demo path needed.
    function lockProduction() external onlyOwner {
        simEnabled = false;
        simAttestor = address(0);
        productionLocked = true;
        emit ProductionLocked();
    }

    /// @inheritdoc ISettlementReceiver
    /// @dev Optional even on the production path — it is real defence there, since the DON
    ///      signatures make the metadata authentic, but it is not required to operate.
    function setExpectedWorkflow(
        bytes32 workflowId,
        bytes10 workflowName,
        address workflowOwner
    ) external onlyOwner {
        expectedWorkflowId = workflowId;
        expectedWorkflowName = workflowName;
        expectedWorkflowOwner = workflowOwner;
        emit ExpectedWorkflowSet(workflowId, workflowName, workflowOwner);
    }

    // ------------------------------------------------------------------
    // IReceiver
    // ------------------------------------------------------------------

    /// @inheritdoc ISettlementReceiver
    function onReport(bytes calldata metadata, bytes calldata reportPayload) external nonReentrant {
        if (!isAllowedForwarder(msg.sender)) revert NotAllowedForwarder(msg.sender);

        (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

        if (expectedWorkflowId != bytes32(0)) {
            bool matches = workflowId == expectedWorkflowId && workflowName == expectedWorkflowName
                && workflowOwner == expectedWorkflowOwner;
            if (!matches) revert WorkflowMismatch(workflowId, workflowName, workflowOwner);
        }

        (SettlementReport memory rpt, bytes memory simSig) =
            abi.decode(reportPayload, (SettlementReport, bytes));

        // The forwarder-agnostic checks above are real defence on the production path and no
        // defence on the simulation path (see the contract-level note). This is the mitigation
        // that actually covers the simulation path: an independent signature the mock forwarder
        // never sees or authenticates.
        if (msg.sender == SIMULATION_FORWARDER) {
            _requireValidSimSignature(rpt, simSig);
        }

        if (rpt.markets.length == 0) revert EmptyReport();

        uint64 lastAccepted = lastProducedAt[rpt.matchId];
        if (rpt.producedAt <= lastAccepted) {
            revert StaleReport(rpt.matchId, rpt.producedAt, lastAccepted);
        }
        lastProducedAt[rpt.matchId] = rpt.producedAt;

        emit ReportAccepted(
            msg.sender,
            workflowId,
            workflowName,
            workflowOwner,
            rpt.matchId,
            rpt.markets.length,
            rpt.producedAt
        );

        for (uint256 i = 0; i < rpt.markets.length; ++i) {
            _applyMarketReport(rpt.markets[i]);
        }
    }

    /// @dev One bad market must never block the rest of the match's report. Every failure mode —
    ///      an invalid outcome byte, or MarketManager refusing the call because the market is in
    ///      the wrong state or already settled — is recorded and skipped rather than reverting the
    ///      whole batch.
    function _applyMarketReport(
        MarketReport memory mr
    ) private {
        if (mr.outcome == 1 || mr.outcome == 2) {
            Outcome outcome_ = mr.outcome == 1 ? Outcome.Yes : Outcome.No;
            try MARKETS.resolve(mr.marketId, outcome_, mr.qualifyingEventTs) {
                emit MarketSettledFromReport(mr.marketId, mr.outcome, mr.qualifyingEventTs, mr.evidenceHash);
            } catch {
                emit ReportRejected(mr.marketId, "RESOLVE_FAILED");
            }
        } else if (mr.outcome == 3) {
            try MARKETS.voidMarket(mr.marketId, mr.evidenceHash) {
                emit MarketSettledFromReport(mr.marketId, mr.outcome, 0, mr.evidenceHash);
            } catch {
                emit ReportRejected(mr.marketId, "VOID_FAILED");
            }
        } else {
            emit ReportRejected(mr.marketId, "INVALID_OUTCOME_BYTE");
        }
    }

    /// @dev Binds the chain, this contract, a per-match nonce, and the full report to one digest,
    ///      so a captured signature cannot be replayed against another chain, another deployment,
    ///      a different match, or a later report for the same match.
    /// @dev `simEnabled` is not re-checked here: `onReport`'s `isAllowedForwarder` gate already
    ///      requires it before this is ever reached, so a second check here would be dead code.
    function _requireValidSimSignature(SettlementReport memory rpt, bytes memory simSig) private {
        bytes32 digest = keccak256(
            abi.encode(block.chainid, address(this), simNonce[rpt.matchId], keccak256(abi.encode(rpt)))
        );
        address recovered = ECDSA.recover(digest, simSig);
        if (recovered != simAttestor || simAttestor == address(0)) revert InvalidSimSignature();

        simNonce[rpt.matchId]++;
    }

    /// @dev Layout matches the CRE `IReceiver` metadata block: 32 bytes workflowId, 10 bytes
    ///      workflowName, 20 bytes workflowOwner, 2 bytes reportId (unused here). Reproduced from
    ///      the pattern in `docs/cre-forwarder-trust-model.md`.
    function _decodeMetadata(
        bytes calldata metadata
    ) private pure returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner) {
        if (metadata.length < 64) revert MetadataTooShort(metadata.length);
        assembly {
            workflowId := calldataload(metadata.offset)
            workflowName := calldataload(add(metadata.offset, 32))
            workflowOwner := shr(96, calldataload(add(metadata.offset, 42)))
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc ISettlementReceiver
    function isAllowedForwarder(
        address forwarder
    ) public view returns (bool) {
        if (forwarder == PRODUCTION_FORWARDER) return true;
        return !productionLocked && simEnabled && forwarder == SIMULATION_FORWARDER;
    }

    /// @inheritdoc ISettlementReceiver
    function supportsInterface(
        bytes4 interfaceId
    ) public pure override(IERC165, ISettlementReceiver) returns (bool) {
        // IReceiver's own interface ID, plus plain ERC165 introspection of itself.
        return interfaceId == type(IERC165).interfaceId || interfaceId == 0x85572ffb;
    }
}
