// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";
import { SettlementReceiver } from "../src/SettlementReceiver.sol";
import { MockUSD } from "../test/mocks/MockUSD.sol";

/// @notice Test-only deployment for a plain local Anvil chain (not a fork of Monad testnet):
///         deploys a MockUSD instead of pointing at the real AUSD proxy, and uses throwaway
///         forwarder addresses since nothing in the TypeScript test suite exercises settlement.
/// @dev Never used for a real deployment -- that's `Deploy.s.sol`, which this otherwise mirrors.
contract TestDeploy is Script {
    uint16 internal constant PERFORMANCE_FEE_BPS = 2000;
    uint16 internal constant MAX_MARKET_EXPOSURE_BPS = 3000;

    bytes32 internal constant SHOT_ON_TARGET_NEXT_N = keccak256("SHOT_ON_TARGET_NEXT_N");
    bytes32 internal constant CORNER_NEXT_N = keccak256("CORNER_NEXT_N");
    bytes32 internal constant CARD_NEXT_N = keccak256("CARD_NEXT_N");
    bytes32 internal constant GOAL_NEXT_N = keccak256("GOAL_NEXT_N");

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        MockUSD usd = new MockUSD();
        AgentRegistry registry =
            new AgentRegistry(usd, deployer, PERFORMANCE_FEE_BPS, MAX_MARKET_EXPOSURE_BPS);
        MarketManager markets = new MarketManager(deployer);
        BetRouter router = new BetRouter(usd, registry, markets);
        SettlementReceiver receiver = new SettlementReceiver(
            deployer,
            markets,
            address(0xF834400000000000000000000000000000dEaD),
            address(0xB9F7400000000000000000000000000000dEaD)
        );

        registry.setBetRouter(address(router));
        markets.grantRole(markets.SETTLER_ROLE(), address(receiver));
        markets.grantRole(markets.SCHEDULER_ROLE(), deployer);

        markets.setTemplate(SHOT_ON_TARGET_NEXT_N, true);
        markets.setTemplate(CORNER_NEXT_N, true);
        markets.setTemplate(CARD_NEXT_N, true);
        markets.setTemplate(GOAL_NEXT_N, true);

        vm.stopBroadcast();

        console2.log("TestUSD           ", address(usd));
        console2.log("AgentRegistry     ", address(registry));
        console2.log("MarketManager     ", address(markets));
        console2.log("BetRouter         ", address(router));
        console2.log("SettlementReceiver", address(receiver));
    }
}
