// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable, Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";

import { AgentVault } from "./AgentVault.sol";
import { Agent, IAgentRegistry } from "./interfaces/IAgentRegistry.sol";

/// @title AgentRegistry
/// @notice Directory of market-making agents. Registering an agent deploys its vault.
///
/// @dev Each agent carries an encrypted strategy blob. The plaintext holds the agent's pricing
///      parameters and its accumulated memory — rolling event-rate calibration, per-competition
///      priors, what it learned from being picked off. It is encrypted client-side with an
///      AES-256-GCM key derived from the operator's passkey under a per-agent PRF salt, so the
///      operator is the only party who can read it.
///
///      The ciphertext is kept in contract **storage**, not just in an event. Log-based retrieval
///      would work through an indexer, but Monad's public RPC caps `eth_getLogs` at a 100-block
///      range, so a plain node cannot fetch an old blob. Storage makes recovery a single `eth_call`
///      with no indexer in the path: a fresh browser profile with no local state can reconstruct
///      the agent's identity and memory from the passkey plus this contract, which is exactly the
///      property the design needs to demonstrate. The event is emitted as well, for indexing.
contract AgentRegistry is IAgentRegistry, Ownable2Step {
    /// @notice Largest accepted strategy ciphertext. Generous for encrypted JSON, small enough
    ///         that registering cannot be used to bloat state.
    uint256 public constant MAX_STRATEGY_BLOB_BYTES = 8192;

    /// @notice AUSD on Monad testnet. Every vault is denominated in it.
    IERC20 public immutable ASSET;
    /// @notice Performance fee applied to every vault this registry deploys, in basis points.
    uint16 public immutable DEFAULT_PERFORMANCE_FEE_BPS;
    /// @notice Single-market exposure cap applied to every vault, in basis points.
    uint16 public immutable DEFAULT_MAX_MARKET_EXPOSURE_BPS;

    /// @inheritdoc IAgentRegistry
    address public betRouter;

    uint32 private _agentCount;
    mapping(uint32 agentId => Agent) private _agents;
    mapping(uint32 agentId => bytes) private _strategyBlobs;
    /// @notice Reverse lookup so `BetRouter` can reject a signer reused across agents.
    mapping(address signer => uint32 agentId) public agentIdOfSigner;

    error UnknownAgent(uint32 agentId);
    error NotOperator(uint32 agentId, address caller);
    error ZeroAddress();
    error SignerAlreadyUsed(address signer, uint32 existingAgentId);
    error StrategyBlobTooLarge(uint256 size, uint256 max);
    error EmptyStrategyBlob();
    error BetRouterAlreadySet(address current);

    modifier onlyOperator(
        uint32 agentId
    ) {
        address op = _agents[agentId].operator;
        if (op == address(0)) revert UnknownAgent(agentId);
        if (msg.sender != op) revert NotOperator(agentId, msg.sender);
        _;
    }

    constructor(
        IERC20 asset_,
        address owner_,
        uint16 performanceFeeBps_,
        uint16 maxMarketExposureBps_
    ) Ownable(owner_) {
        if (address(asset_) == address(0)) revert ZeroAddress();
        ASSET = asset_;
        DEFAULT_PERFORMANCE_FEE_BPS = performanceFeeBps_;
        DEFAULT_MAX_MARKET_EXPOSURE_BPS = maxMarketExposureBps_;
    }

    /// @notice Point every vault at the router allowed to lock and settle liabilities.
    /// @dev Write-once. The router is deployed after the registry, so it cannot be a constructor
    ///      argument, but leaving it mutable would let the owner swap in a contract that drains
    ///      every vault. One-way assignment removes that power permanently.
    function setBetRouter(
        address betRouter_
    ) external onlyOwner {
        if (betRouter != address(0)) revert BetRouterAlreadySet(betRouter);
        if (betRouter_ == address(0)) revert ZeroAddress();
        betRouter = betRouter_;
        emit BetRouterSet(betRouter_);
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentRegistry
    function register(
        address quoteSigner,
        bytes calldata strategyBlob,
        string calldata metadataURI
    ) external returns (uint32 agentId, address vault) {
        if (quoteSigner == address(0)) revert ZeroAddress();
        _requireUnusedSigner(quoteSigner);
        _checkBlob(strategyBlob);

        agentId = ++_agentCount;

        AgentVault deployed = new AgentVault(
            ASSET,
            IAgentRegistry(address(this)),
            agentId,
            msg.sender,
            DEFAULT_PERFORMANCE_FEE_BPS,
            DEFAULT_MAX_MARKET_EXPOSURE_BPS,
            string.concat("Ninety Agent Vault ", Strings.toString(agentId)),
            string.concat("nv", Strings.toString(agentId))
        );
        vault = address(deployed);

        bytes32 commit = keccak256(strategyBlob);

        _agents[agentId] = Agent({
            operator: msg.sender,
            quoteSigner: quoteSigner,
            vault: vault,
            enabled: true,
            strategyCommit: commit,
            metadataURI: metadataURI
        });
        _strategyBlobs[agentId] = strategyBlob;
        agentIdOfSigner[quoteSigner] = agentId;

        emit AgentRegistered(agentId, msg.sender, vault, quoteSigner, commit, metadataURI);
        emit StrategyUpdated(agentId, bytes32(0), commit, strategyBlob);
        emit AgentEnabledSet(agentId, true);
    }

    // ------------------------------------------------------------------
    // Operator controls
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentRegistry
    /// @dev Rotating the signer takes effect immediately. Quotes already signed by the old key
    ///      stop being accepted, which is the intended behaviour if a key is suspected lost.
    function setQuoteSigner(uint32 agentId, address newSigner) external onlyOperator(agentId) {
        if (newSigner == address(0)) revert ZeroAddress();
        _requireUnusedSigner(newSigner);

        address old = _agents[agentId].quoteSigner;
        delete agentIdOfSigner[old];

        _agents[agentId].quoteSigner = newSigner;
        agentIdOfSigner[newSigner] = agentId;

        emit QuoteSignerUpdated(agentId, old, newSigner);
    }

    /// @inheritdoc IAgentRegistry
    /// @dev The commitment is derived from the blob rather than supplied alongside it, so the
    ///      stored hash always describes the bytes that are actually on chain.
    function setStrategy(uint32 agentId, bytes calldata strategyBlob) external onlyOperator(agentId) {
        _checkBlob(strategyBlob);

        bytes32 old = _agents[agentId].strategyCommit;
        bytes32 commit = keccak256(strategyBlob);

        _agents[agentId].strategyCommit = commit;
        _strategyBlobs[agentId] = strategyBlob;

        emit StrategyUpdated(agentId, old, commit, strategyBlob);
    }

    /// @inheritdoc IAgentRegistry
    /// @dev Either the operator or the registry owner can disable an agent. The owner's ability
    ///      to disable is a circuit breaker, not custody: it stops new quotes being accepted and
    ///      cannot touch vault assets or backer shares.
    function setEnabled(uint32 agentId, bool enabled) external {
        address op = _agents[agentId].operator;
        if (op == address(0)) revert UnknownAgent(agentId);
        if (msg.sender != op && msg.sender != owner()) revert NotOperator(agentId, msg.sender);

        _agents[agentId].enabled = enabled;
        emit AgentEnabledSet(agentId, enabled);
    }

    /// @inheritdoc IAgentRegistry
    function setMetadataURI(uint32 agentId, string calldata metadataURI) external onlyOperator(agentId) {
        _agents[agentId].metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @inheritdoc IAgentRegistry
    function getAgent(
        uint32 agentId
    ) external view returns (Agent memory) {
        Agent memory a = _agents[agentId];
        if (a.operator == address(0)) revert UnknownAgent(agentId);
        return a;
    }

    /// @inheritdoc IAgentRegistry
    /// @dev The whole point of on-chain storage: one call, no indexer, no block-range limit.
    function strategyBlobOf(
        uint32 agentId
    ) external view returns (bytes memory) {
        if (_agents[agentId].operator == address(0)) revert UnknownAgent(agentId);
        return _strategyBlobs[agentId];
    }

    /// @inheritdoc IAgentRegistry
    function vaultOf(
        uint32 agentId
    ) external view returns (address) {
        return _agents[agentId].vault;
    }

    /// @inheritdoc IAgentRegistry
    function operatorOf(
        uint32 agentId
    ) external view returns (address) {
        return _agents[agentId].operator;
    }

    /// @inheritdoc IAgentRegistry
    /// @dev What `BetRouter` calls per fill. Returns false rather than reverting for unknown
    ///      agents so the router can produce its own error.
    function isQuotable(uint32 agentId, address signer) external view returns (bool) {
        Agent storage a = _agents[agentId];
        return a.enabled && signer != address(0) && a.quoteSigner == signer;
    }

    /// @inheritdoc IAgentRegistry
    function agentCount() external view returns (uint32) {
        return _agentCount;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev One signer may only ever back one agent. Sharing a key across agents would let a
    ///      single quote be replayed against several vaults.
    function _requireUnusedSigner(
        address signer
    ) private view {
        uint32 existing = agentIdOfSigner[signer];
        if (existing != 0) revert SignerAlreadyUsed(signer, existing);
    }

    function _checkBlob(
        bytes calldata blob
    ) private pure {
        if (blob.length == 0) revert EmptyStrategyBlob();
        if (blob.length > MAX_STRATEGY_BLOB_BYTES) {
            revert StrategyBlobTooLarge(blob.length, MAX_STRATEGY_BLOB_BYTES);
        }
    }
}
