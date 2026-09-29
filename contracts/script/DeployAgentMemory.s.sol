// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";

import { AgentMemory } from "../src/AgentMemory.sol";
import { IAgentRegistry } from "../src/interfaces/IAgentRegistry.sol";

/// @notice Adds AgentMemory to an existing deployment. It only reads the registry (to check who
///         operates an agent), so it deploys on its own, without touching the rest of the stack.
contract DeployAgentMemory is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registry = vm.envAddress("NEXT_PUBLIC_AGENT_REGISTRY");

        vm.startBroadcast(deployerPk);
        AgentMemory agentMemory = new AgentMemory(IAgentRegistry(registry));
        vm.stopBroadcast();

        console2.log("AgentRegistry", registry);
        console2.log("AgentMemory  ", address(agentMemory));
    }
}
