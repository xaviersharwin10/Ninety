// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Script, console2 } from "forge-std/Script.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";
import { SettlementReceiver } from "../src/SettlementReceiver.sol";

/// @notice Deploys and wires the full contract set.
///
/// @dev Order matters and is dictated by circular dependencies that can't be broken with
///      constructor arguments alone:
///      - `AgentRegistry` deploys each `AgentVault`, so it must exist before agents register, but
///        a vault cannot enforce "only the router may lock liability" until the router exists.
///        `AgentRegistry.setBetRouter` is therefore write-once and called after `BetRouter`
///        deploys — see the comment on that function for why it is one-way rather than owner-
///        swappable.
///      - `SettlementReceiver` needs `MarketManager`'s address at construction (to call
///        `resolve`/`voidMarket`), but `MarketManager` needs to grant it `SETTLER_ROLE`
///        afterwards, since roles can only be granted to an address that already exists.
///
///      Run with `--broadcast` to send transactions; without it, this only simulates and prints
///      what would happen.
contract Deploy is Script {
    /// @dev Basis points, matching OddsMath.BPS.
    uint16 internal constant PERFORMANCE_FEE_BPS = 2000; // 20%, matching the design notes
    uint16 internal constant MAX_MARKET_EXPOSURE_BPS = 3000; // 30% of a vault per market

    bytes32 internal constant SHOT_ON_TARGET_NEXT_N = keccak256("SHOT_ON_TARGET_NEXT_N");
    bytes32 internal constant CORNER_NEXT_N = keccak256("CORNER_NEXT_N");
    bytes32 internal constant CARD_NEXT_N = keccak256("CARD_NEXT_N");
    bytes32 internal constant GOAL_NEXT_N = keccak256("GOAL_NEXT_N");

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        address ausd = vm.envAddress("AUSD_ADDRESS");
        address productionForwarder = vm.envAddress("CRE_PRODUCTION_FORWARDER");
        address simulationForwarder = vm.envAddress("CRE_SIMULATION_FORWARDER");

        // Falls back to the deployer if a dedicated scheduler key isn't set yet, so a solo
        // testnet deploy doesn't need a second funded key just to get started.
        address scheduler = _envAddressOr("SCHEDULER_ADDRESS", deployer);

        console2.log("Deployer          ", deployer);
        console2.log("AUSD              ", ausd);
        console2.log("Production fwd    ", productionForwarder);
        console2.log("Simulation fwd    ", simulationForwarder);
        console2.log("Scheduler         ", scheduler);

        vm.startBroadcast(deployerPk);

        AgentRegistry registry =
            new AgentRegistry(IERC20(ausd), deployer, PERFORMANCE_FEE_BPS, MAX_MARKET_EXPOSURE_BPS);
        MarketManager markets = new MarketManager(deployer);
        BetRouter router = new BetRouter(IERC20(ausd), registry, markets);
        SettlementReceiver receiver =
            new SettlementReceiver(deployer, markets, productionForwarder, simulationForwarder);

        // Wire the pieces that had to be deployed before they could reference each other.
        registry.setBetRouter(address(router));
        markets.grantRole(markets.SETTLER_ROLE(), address(receiver));
        markets.grantRole(markets.SCHEDULER_ROLE(), scheduler);

        // CORE market templates from the product spec. NEXT_CORNER_TEAM is deliberately excluded
        // from CORE — see the architecture notes on why binary-only markets are the whole of v1.
        markets.setTemplate(SHOT_ON_TARGET_NEXT_N, true);
        markets.setTemplate(CORNER_NEXT_N, true);
        markets.setTemplate(CARD_NEXT_N, true);
        markets.setTemplate(GOAL_NEXT_N, true);

        // The simulation forwarder stays allowlisted-but-off until setForwarder(sim, true) is
        // called deliberately for a recorded demo. See docs/cre-forwarder-trust-model.md.

        vm.stopBroadcast();

        console2.log("");
        console2.log("AgentRegistry     ", address(registry));
        console2.log("MarketManager     ", address(markets));
        console2.log("BetRouter         ", address(router));
        console2.log("SettlementReceiver", address(receiver));
    }

    function _envAddressOr(string memory key, address fallback_) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return fallback_;
        }
    }
}
