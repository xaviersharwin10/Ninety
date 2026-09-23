// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { AgentVault } from "../src/AgentVault.sol";
import { Agent } from "../src/interfaces/IAgentRegistry.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

contract AgentRegistryTest is Test {
    MockUSD internal usd;
    AgentRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal other = makeAddr("other");
    address internal router = makeAddr("router");

    address internal signerA = makeAddr("signerA");
    address internal signerB = makeAddr("signerB");

    bytes internal constant BLOB = hex"deadbeefcafe";

    function setUp() public {
        usd = new MockUSD();
        registry = new AgentRegistry(IERC20(address(usd)), owner, 2000, 3000, 0);
    }

    function _register() internal returns (uint32 agentId, address vault) {
        vm.prank(operator);
        return registry.register(signerA, BLOB, "ipfs://agent-1");
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------

    function test_register_deploysVaultAndRecordsAgent() public {
        (uint32 agentId, address vault) = _register();

        assertEq(agentId, 1, "ids start at 1 so zero can mean 'unknown'");
        assertTrue(vault != address(0));

        Agent memory a = registry.getAgent(agentId);
        assertEq(a.operator, operator);
        assertEq(a.quoteSigner, signerA);
        assertEq(a.vault, vault);
        assertTrue(a.enabled, "agents start enabled");
        assertEq(a.strategyCommit, keccak256(BLOB));
        assertEq(a.metadataURI, "ipfs://agent-1");

        AgentVault v = AgentVault(vault);
        assertEq(v.operator(), operator);
        assertEq(v.agentId(), agentId);
        assertEq(v.asset(), address(usd));
        assertEq(v.performanceFeeBps(), 2000);
    }

    function test_register_incrementsIds() public {
        _register();
        vm.prank(other);
        (uint32 id2,) = registry.register(signerB, BLOB, "ipfs://agent-2");
        assertEq(id2, 2);
        assertEq(registry.agentCount(), 2);
    }

    function test_register_rejectsZeroSigner() public {
        vm.prank(operator);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.register(address(0), BLOB, "");
    }

    function test_register_rejectsEmptyBlob() public {
        vm.prank(operator);
        vm.expectRevert(AgentRegistry.EmptyStrategyBlob.selector);
        registry.register(signerA, "", "");
    }

    function test_register_rejectsOversizedBlob() public {
        bytes memory big = new bytes(8193);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.StrategyBlobTooLarge.selector, 8193, 8192));
        registry.register(signerA, big, "");
    }

    /// @dev A signer shared between two agents would let one signed quote be replayed against a
    ///      second vault, so the registry refuses it outright.
    function test_register_rejectsReusedSigner() public {
        _register();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.SignerAlreadyUsed.selector, signerA, uint32(1)));
        registry.register(signerA, BLOB, "");
    }

    // ------------------------------------------------------------------
    // One Passkey, Many Keys: strategy blob recovery
    // ------------------------------------------------------------------

    /// @dev The property the cross-device demo rests on. A client holding only the passkey must be
    ///      able to recover the agent's encrypted strategy and memory with a single view call,
    ///      with no local storage and no indexer. Monad's public RPC caps `eth_getLogs` at a
    ///      100-block range, so a log-only design would be unrecoverable from a plain node.
    function test_strategyBlob_isRecoverableFromStorageAlone() public {
        (uint32 agentId,) = _register();

        bytes memory recovered = registry.strategyBlobOf(agentId);

        assertEq(recovered, BLOB, "ciphertext recoverable without any local state");
        assertEq(
            keccak256(recovered),
            registry.getAgent(agentId).strategyCommit,
            "stored commitment must describe the stored bytes"
        );
    }

    function test_setStrategy_rotatesBlobAndCommitTogether() public {
        (uint32 agentId,) = _register();
        bytes memory updated = hex"0badc0de";

        vm.prank(operator);
        registry.setStrategy(agentId, updated);

        assertEq(registry.strategyBlobOf(agentId), updated);
        assertEq(registry.getAgent(agentId).strategyCommit, keccak256(updated));
    }

    function test_setStrategy_onlyOperator() public {
        (uint32 agentId,) = _register();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotOperator.selector, agentId, other));
        registry.setStrategy(agentId, hex"01");
    }

    /// @dev The commitment is derived on chain rather than supplied, so an operator cannot publish
    ///      one blob while committing to different bytes.
    function testFuzz_commitAlwaysMatchesStoredBlob(
        bytes calldata blob
    ) public {
        vm.assume(blob.length > 0 && blob.length <= 8192);

        vm.prank(operator);
        (uint32 agentId,) = registry.register(signerA, blob, "");

        assertEq(registry.getAgent(agentId).strategyCommit, keccak256(registry.strategyBlobOf(agentId)));
    }

    // ------------------------------------------------------------------
    // Signer rotation and enablement
    // ------------------------------------------------------------------

    function test_isQuotable_trueOnlyForTheCurrentSigner() public {
        (uint32 agentId,) = _register();
        assertTrue(registry.isQuotable(agentId, signerA));
        assertFalse(registry.isQuotable(agentId, signerB));
        assertFalse(registry.isQuotable(agentId, address(0)));
        assertFalse(registry.isQuotable(99, signerA), "unknown agent is not quotable");
    }

    function test_setQuoteSigner_invalidatesTheOldKeyImmediately() public {
        (uint32 agentId,) = _register();

        vm.prank(operator);
        registry.setQuoteSigner(agentId, signerB);

        assertFalse(registry.isQuotable(agentId, signerA), "rotated-out key stops being accepted");
        assertTrue(registry.isQuotable(agentId, signerB));
        assertEq(registry.agentIdOfSigner(signerA), 0, "old signer freed");
        assertEq(registry.agentIdOfSigner(signerB), agentId);
    }

    function test_setQuoteSigner_onlyOperator() public {
        (uint32 agentId,) = _register();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotOperator.selector, agentId, other));
        registry.setQuoteSigner(agentId, signerB);
    }

    function test_setEnabled_byOperator() public {
        (uint32 agentId,) = _register();
        vm.prank(operator);
        registry.setEnabled(agentId, false);
        assertFalse(registry.isQuotable(agentId, signerA));
    }

    /// @dev The owner's kill switch stops new quotes. It must not reach vault assets.
    function test_setEnabled_byOwnerIsACircuitBreakerNotCustody() public {
        (uint32 agentId, address vault) = _register();

        usd.mint(address(this), 100e6);
        usd.approve(vault, 100e6);
        AgentVault(vault).deposit(100e6, address(this));

        vm.prank(owner);
        registry.setEnabled(agentId, false);

        assertFalse(registry.isQuotable(agentId, signerA), "quoting stopped");
        assertEq(AgentVault(vault).totalAssets(), 100e6, "assets untouched");
        assertEq(AgentVault(vault).maxWithdraw(address(this)), 100e6, "backer can still exit");
    }

    function test_setEnabled_rejectsStrangers() public {
        (uint32 agentId,) = _register();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.NotOperator.selector, agentId, other));
        registry.setEnabled(agentId, true);
    }

    function test_getAgent_revertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.UnknownAgent.selector, uint32(7)));
        registry.getAgent(7);
    }

    // ------------------------------------------------------------------
    // Router wiring
    // ------------------------------------------------------------------

    /// @dev Write-once. A mutable router would let the owner point every vault at a contract that
    ///      drains it, so the power to do that is removed permanently after the first call.
    function test_setBetRouter_isWriteOnce() public {
        vm.prank(owner);
        registry.setBetRouter(router);
        assertEq(registry.betRouter(), router);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.BetRouterAlreadySet.selector, router));
        registry.setBetRouter(other);
    }

    function test_setBetRouter_onlyOwner() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        registry.setBetRouter(router);
    }

    function test_setBetRouter_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(AgentRegistry.ZeroAddress.selector);
        registry.setBetRouter(address(0));
    }

    /// @dev Until the router is wired, no one can lock liabilities, including address(0) callers.
    function test_vaultRejectsLocksBeforeRouterIsSet() public {
        (, address vault) = _register();
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OnlyRouter.selector, address(this), address(0)));
        AgentVault(vault).lockLiability(1, 1, 1);
    }
}
