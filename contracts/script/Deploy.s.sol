// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Script, console2 } from "forge-std/Script.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { BetRouter } from "../src/BetRouter.sol";
import { MarketManager } from "../src/MarketManager.sol";
import { NinetyUSD } from "../src/NinetyUSD.sol";
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
    // Markets resolve every 1-5 minutes; 15 minutes forces a timed deposit to also sit exposed to
    // several other, unrelated settlements before it can exit. See the doc comment on
    // IAgentVault.withdrawalCooldownSeconds for the attack this defends against.
    uint32 internal constant WITHDRAWAL_COOLDOWN_SECONDS = 15 minutes;

    bytes32 internal constant SHOT_ON_TARGET_NEXT_N = keccak256("SHOT_ON_TARGET_NEXT_N");
    bytes32 internal constant CORNER_NEXT_N = keccak256("CORNER_NEXT_N");
    bytes32 internal constant CARD_NEXT_N = keccak256("CARD_NEXT_N");
    bytes32 internal constant GOAL_NEXT_N = keccak256("GOAL_NEXT_N");

    /// @dev What each house agent's vault is seeded with. nUSD has no value, so this is sized for
    ///      the product, not a budget: at a 30% per-market exposure cap it backs every quote the
    ///      three strategies can post without any of them running out of free capital.
    uint256 internal constant HOUSE_VAULT_SEED = 10_000e6;

    struct HouseAgent {
        string envKey;
        string metadataURI;
        string strategyJson;
    }

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        address productionForwarder = vm.envAddress("CRE_PRODUCTION_FORWARDER");
        address simulationForwarder = vm.envAddress("CRE_SIMULATION_FORWARDER");

        // Falls back to the deployer if a dedicated scheduler key isn't set yet, so a solo
        // testnet deploy doesn't need a second funded key just to get started.
        address scheduler = _envAddressOr("SCHEDULER_ADDRESS", deployer);

        console2.log("Deployer          ", deployer);
        console2.log("Production fwd    ", productionForwarder);
        console2.log("Simulation fwd    ", simulationForwarder);
        console2.log("Scheduler         ", scheduler);

        vm.startBroadcast(deployerPk);

        NinetyUSD nusd = new NinetyUSD(deployer);
        AgentRegistry registry = new AgentRegistry(
            IERC20(address(nusd)),
            deployer,
            PERFORMANCE_FEE_BPS,
            MAX_MARKET_EXPOSURE_BPS,
            WITHDRAWAL_COOLDOWN_SECONDS
        );
        MarketManager markets = new MarketManager(deployer);
        BetRouter router = new BetRouter(IERC20(address(nusd)), registry, markets);
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

        _registerHouseAgents(registry, nusd, deployer);

        vm.stopBroadcast();

        console2.log("");
        console2.log("NinetyUSD         ", address(nusd));
        console2.log("AgentRegistry     ", address(registry));
        console2.log("MarketManager     ", address(markets));
        console2.log("BetRouter         ", address(router));
        console2.log("SettlementReceiver", address(receiver));
    }

    /// @dev Registers Steady, Tempo and Pulse (in that order, so they get agentIds 1-3, which is
    ///      what packages/agents/src/main.ts maps its keys to) and seeds each vault. The operator
    ///      is the deployer, a plain .env key rather than a passkey account, so there is no
    ///      passkey to encrypt the strategy under: the blob is the strategy's public parameters in
    ///      plaintext. Passkey-encrypted strategies are what web/app/dev registers.
    function _registerHouseAgents(AgentRegistry registry, NinetyUSD nusd, address deployer) internal {
        HouseAgent[3] memory agents = [
            HouseAgent(
                "AGENT_STEADY_PRIVATE_KEY",
                "Steady \u2014 conservative house agent",
                '{"agent":"Steady","style":"Conservative, base rates only","marginBps":300,"maxStakePerQuote":"25000000","encrypted":false}'
            ),
            HouseAgent(
                "AGENT_TEMPO_PRIVATE_KEY",
                "Tempo \u2014 model-driven house agent",
                '{"agent":"Tempo","style":"Model-driven, live pressure adjusted","marginBps":250,"maxStakePerQuote":"30000000","encrypted":false}'
            ),
            HouseAgent(
                "AGENT_PULSE_PRIVATE_KEY",
                "Pulse \u2014 aggressive house agent",
                '{"agent":"Pulse","style":"Aggressive, tightest legal margin","marginBps":200,"maxStakePerQuote":"50000000","encrypted":false}'
            )
        ];

        nusd.mint(deployer, HOUSE_VAULT_SEED * agents.length);
        for (uint256 i = 0; i < agents.length; i++) {
            address quoteSigner = vm.addr(vm.envUint(agents[i].envKey));
            (uint32 agentId, address vault) =
                registry.register(quoteSigner, bytes(agents[i].strategyJson), agents[i].metadataURI);
            nusd.approve(vault, HOUSE_VAULT_SEED);
            IERC4626(vault).deposit(HOUSE_VAULT_SEED, deployer);
            console2.log("House agent", agentId, vault);
        }
    }

    function _envAddressOr(string memory key, address fallback_) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return fallback_;
        }
    }
}
