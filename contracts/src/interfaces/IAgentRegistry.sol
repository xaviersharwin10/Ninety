// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Record of one market-making agent.
/// @param operator Owns the agent and receives its vault's performance fee.
/// @param quoteSigner Address that signs the agent's EIP-712 price quotes. Derived from the
///        operator's passkey under a per-agent PRF salt, so it is an identity rather than a
///        wallet: it never holds funds and never signs a transaction.
/// @param vault The agent's AgentVault, deployed by `register`.
/// @param enabled Whether the agent may currently be quoted against.
/// @param strategyCommit keccak256 of the agent's encrypted strategy blob.
struct Agent {
    address operator;
    address quoteSigner;
    address vault;
    bool enabled;
    bytes32 strategyCommit;
    string metadataURI;
}

interface IAgentRegistry {
    event AgentRegistered(
        uint32 indexed agentId,
        address indexed operator,
        address vault,
        address quoteSigner,
        bytes32 strategyCommit,
        string metadataURI
    );
    event QuoteSignerUpdated(uint32 indexed agentId, address oldSigner, address newSigner);
    event StrategyUpdated(uint32 indexed agentId, bytes32 oldCommit, bytes32 newCommit, bytes blob);
    event AgentEnabledSet(uint32 indexed agentId, bool enabled);
    event MetadataUpdated(uint32 indexed agentId, string metadataURI);
    event BetRouterSet(address betRouter);

    function register(
        address quoteSigner,
        bytes calldata strategyBlob,
        string calldata metadataURI
    ) external returns (uint32 agentId, address vault);

    function setQuoteSigner(uint32 agentId, address newSigner) external;
    function setStrategy(uint32 agentId, bytes calldata strategyBlob) external;
    function setEnabled(uint32 agentId, bool enabled) external;
    function setMetadataURI(uint32 agentId, string calldata metadataURI) external;

    function getAgent(
        uint32 agentId
    ) external view returns (Agent memory);
    function strategyBlobOf(
        uint32 agentId
    ) external view returns (bytes memory);
    function vaultOf(
        uint32 agentId
    ) external view returns (address);
    function operatorOf(
        uint32 agentId
    ) external view returns (address);
    function isQuotable(uint32 agentId, address signer) external view returns (bool);
    function agentCount() external view returns (uint32);
    function betRouter() external view returns (address);
}
