import {
  AgentMemoryAbi,
  AgentRegistryAbi,
  AgentVaultAbi,
  BetRouterAbi,
  MarketManagerAbi,
} from "@ninety/core";
import type { Address } from "viem";

// These are all public, non-secret deployment addresses -- already checked into
// deployments/10143.json and .env.example -- so a sensible default here (the current live
// deployment) is safe, and keeps a CI build working without needing .env wired in as secrets.
// A real redeploy overrides these via the matching NEXT_PUBLIC_* env var, same as always.
function addressEnv(name: string, fallback: Address): Address {
  const value = process.env[name];
  return (value || fallback) as Address;
}

export const AGENT_REGISTRY = addressEnv(
  "NEXT_PUBLIC_AGENT_REGISTRY",
  "0xdbE23698776e12A7e1bf5FFBe5054d6919BcA8df",
);
export const MARKET_MANAGER = addressEnv(
  "NEXT_PUBLIC_MARKET_MANAGER",
  "0x7CB80d9De72273db78e013Fdb2180023A9152b88",
);
export const BET_ROUTER = addressEnv(
  "NEXT_PUBLIC_BET_ROUTER",
  "0xd368165544A427d1d42FCF53846fA84c37cBB387",
);
export const AGENT_MEMORY = addressEnv(
  "NEXT_PUBLIC_AGENT_MEMORY",
  "0xB07D8e5B822F0d885BcDEebE3Dceb2166FF5D85c",
);
export const NUSD_ADDRESS = addressEnv(
  "NEXT_PUBLIC_NUSD_ADDRESS",
  "0x85fe9D32c8B5c02639767399D7DCA585042ea57b",
);

export { AgentMemoryAbi, AgentRegistryAbi, AgentVaultAbi, BetRouterAbi, MarketManagerAbi };

/**
 * The slice of NinetyUSD (contracts/src/NinetyUSD.sol) this app calls: the ERC-20 basics plus its
 * built-in faucet. The faucet is the token itself -- `claim()` mints -- so it can't run dry.
 */
export const NusdAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "nextClaimAt",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  { type: "error", name: "ClaimTooSoon", inputs: [{ name: "availableAt", type: "uint256" }] },
] as const;

/** What one faucet `claim()` mints, in base units -- mirrors NinetyUSD.CLAIM_AMOUNT. */
export const NUSD_CLAIM_AMOUNT = 1_000_000_000n;

export const NUSD_DECIMALS = 6;
