// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Script, console2 } from "forge-std/Script.sol";

import { OddsLock } from "../src/OddsLock.sol";
import { IAgentRegistry } from "../src/interfaces/IAgentRegistry.sol";
import { IMarketManager } from "../src/interfaces/IMarketManager.sol";

/// @notice Adds OddsLock to an existing deployment. It only reads the registry and market manager
///         and pays fees into vaults, so it deploys on its own, without touching the rest.
contract DeployOddsLock is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address asset = vm.envAddress("NEXT_PUBLIC_NUSD_ADDRESS");
        address registry = vm.envAddress("NEXT_PUBLIC_AGENT_REGISTRY");
        address markets = vm.envAddress("NEXT_PUBLIC_MARKET_MANAGER");

        vm.startBroadcast(deployerPk);
        OddsLock locks = new OddsLock(IERC20(asset), IAgentRegistry(registry), IMarketManager(markets));
        vm.stopBroadcast();

        console2.log("OddsLock", address(locks));
    }
}
