// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script, console2 } from "forge-std/Script.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";
import { SettlementReceiver } from "../src/SettlementReceiver.sol";

import { MockKeystoneForwarder } from "../test/mocks/MockKeystoneForwarder.sol";
import { MockUSD } from "../test/mocks/MockUSD.sol";

/// @notice Test-only deployment for a plain local Anvil chain (not a fork of Monad testnet):
///         deploys a MockUSD instead of pointing at the real AUSD proxy. The production forwarder
///         is a throwaway placeholder address (nothing exercises that path off a plain chain),
///         but the simulation forwarder is a real, deployed `MockKeystoneForwarder` -- the same
///         metadata-passthrough, no-signature-check test double the SettlementReceiver test suite
///         uses -- so an integrated rehearsal can genuinely exercise the CRE-simulation settlement
///         path end to end, not just point at a dead address.
/// @dev Never used for a real deployment -- that's `Deploy.s.sol`, which this otherwise mirrors.
contract TestDeploy is Script {
    uint16 internal constant PERFORMANCE_FEE_BPS = 2000;
    uint16 internal constant MAX_MARKET_EXPOSURE_BPS = 3000;
    uint32 internal constant WITHDRAWAL_COOLDOWN_SECONDS = 15 minutes;

    bytes32 internal constant SHOT_ON_TARGET_NEXT_N = keccak256("SHOT_ON_TARGET_NEXT_N");
    bytes32 internal constant CORNER_NEXT_N = keccak256("CORNER_NEXT_N");
    bytes32 internal constant CARD_NEXT_N = keccak256("CARD_NEXT_N");
    bytes32 internal constant GOAL_NEXT_N = keccak256("GOAL_NEXT_N");

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        MockUSD usd = new MockUSD();
        AgentRegistry registry = new AgentRegistry(
            usd, deployer, PERFORMANCE_FEE_BPS, MAX_MARKET_EXPOSURE_BPS, WITHDRAWAL_COOLDOWN_SECONDS
        );
        MarketManager markets = new MarketManager(deployer);
        BetRouter router = new BetRouter(usd, registry, markets);
        MockKeystoneForwarder simForwarder = new MockKeystoneForwarder();
        SettlementReceiver receiver = new SettlementReceiver(
            deployer, markets, address(0xF834400000000000000000000000000000dEaD), address(simForwarder)
        );

        registry.setBetRouter(address(router));
        markets.grantRole(markets.SETTLER_ROLE(), address(receiver));
        markets.grantRole(markets.SCHEDULER_ROLE(), deployer);
        receiver.setForwarder(address(simForwarder), true);

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
        console2.log("SimForwarder      ", address(simForwarder));
    }
}
