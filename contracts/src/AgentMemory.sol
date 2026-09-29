// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IAgentRegistry } from "./interfaces/IAgentRegistry.sol";

/// @title AgentMemory
/// @notice Where an agent's memory lives: what it has learned from the markets it priced, encrypted
///         to its operator's passkey (a Mera secret vault, AES-256-GCM) before it ever leaves the
///         browser. This contract never sees plaintext and holds no key; it only records who wrote
///         which ciphertext, and when.
///
/// @dev The ciphertext is emitted, not stored. Memory is rewritten every time the agent runs, and
///      a kilobyte in storage costs ~40x what the same bytes cost in an event. Only its hash is
///      kept in storage, as `memoryCommit`: the Envio indexer serves the latest blob from the event,
///      and any client can check that blob against this commitment with a single `eth_call`, so the
///      indexer is trusted for availability only, never for content. (It's in the path at all
///      because Monad's public RPC serves just the last 100 blocks of logs.)
///
///      Together with the chain, this is what lets an agent's memory survive any device: nothing
///      but the operator's passkey is needed to read it back, and nobody without it can.
contract AgentMemory {
    /// @notice Same cap as `AgentRegistry.MAX_STRATEGY_BLOB_BYTES`: memory is a compact summary,
    ///         not a log, and an unbounded blob would only be an unbounded gas bill.
    uint256 public constant MAX_MEMORY_BYTES = 8192;

    IAgentRegistry public immutable REGISTRY;

    /// @notice keccak256 of the agent's latest memory blob; zero if it has never saved one.
    mapping(uint32 agentId => bytes32) public memoryCommit;
    /// @notice How many times the agent has saved memory. The latest save is `memoryVersion`.
    mapping(uint32 agentId => uint64) public memoryVersion;

    event MemorySaved(uint32 indexed agentId, uint64 indexed version, bytes32 commit, bytes blob);

    error NotOperator(uint32 agentId, address caller);
    error EmptyMemory();
    error MemoryTooLarge(uint256 size, uint256 max);

    constructor(
        IAgentRegistry registry
    ) {
        REGISTRY = registry;
    }

    /// @notice Records a new encrypted memory for `agentId`. Operator only: an agent's memory is
    ///         its operator's to write, exactly like its strategy.
    function save(uint32 agentId, bytes calldata blob) external {
        if (REGISTRY.operatorOf(agentId) != msg.sender) revert NotOperator(agentId, msg.sender);
        if (blob.length == 0) revert EmptyMemory();
        if (blob.length > MAX_MEMORY_BYTES) revert MemoryTooLarge(blob.length, MAX_MEMORY_BYTES);

        bytes32 commit = keccak256(blob);
        uint64 version = ++memoryVersion[agentId];
        memoryCommit[agentId] = commit;
        emit MemorySaved(agentId, version, commit, blob);
    }
}
