// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Test } from "forge-std/Test.sol";

import { AgentMemory } from "../src/AgentMemory.sol";
import { AgentRegistry } from "../src/AgentRegistry.sol";
import { IAgentRegistry } from "../src/interfaces/IAgentRegistry.sol";
import { MockUSD } from "./mocks/MockUSD.sol";

contract AgentMemoryTest is Test {
    AgentRegistry internal registry;
    AgentMemory internal agentMemory;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    uint32 internal agentId;

    function setUp() public {
        MockUSD usd = new MockUSD();
        registry = new AgentRegistry(IERC20(address(usd)), address(this), 2000, 3000, 0);
        agentMemory = new AgentMemory(IAgentRegistry(address(registry)));
        vm.prank(operator);
        (agentId,) = registry.register(makeAddr("signer"), hex"cafe", "agent");
    }

    function test_save_recordsCommitAndVersion_andEmitsTheBlob() public {
        bytes memory blob = hex"deadbeef";
        vm.expectEmit(true, true, false, true, address(agentMemory));
        emit AgentMemory.MemorySaved(agentId, 1, keccak256(blob), blob);
        vm.prank(operator);
        agentMemory.save(agentId, blob);

        assertEq(agentMemory.memoryCommit(agentId), keccak256(blob));
        assertEq(agentMemory.memoryVersion(agentId), 1);
    }

    function test_save_latestOverwritesCommit_andVersionsIncrease() public {
        vm.startPrank(operator);
        agentMemory.save(agentId, hex"01");
        agentMemory.save(agentId, hex"0202");
        vm.stopPrank();

        assertEq(agentMemory.memoryCommit(agentId), keccak256(hex"0202"));
        assertEq(agentMemory.memoryVersion(agentId), 2);
    }

    function test_save_revertsForAnyoneButTheOperator() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AgentMemory.NotOperator.selector, agentId, stranger));
        agentMemory.save(agentId, hex"01");
    }

    function test_save_revertsForAnUnknownAgent() public {
        vm.prank(operator);
        vm.expectRevert();
        agentMemory.save(999, hex"01");
    }

    function test_save_revertsOnEmptyOrOversizedBlob() public {
        vm.startPrank(operator);
        vm.expectRevert(AgentMemory.EmptyMemory.selector);
        agentMemory.save(agentId, "");

        uint256 max = agentMemory.MAX_MEMORY_BYTES();
        vm.expectRevert(abi.encodeWithSelector(AgentMemory.MemoryTooLarge.selector, max + 1, max));
        agentMemory.save(agentId, new bytes(max + 1));
        vm.stopPrank();
    }
}
