import { AgentRegistryAbi, AgentVaultAbi, BetRouterAbi, MarketManagerAbi } from "@ninety/core";
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
  "0x7471F624898C78470f30a45e3F238B36A3dAAecb",
);
export const MARKET_MANAGER = addressEnv(
  "NEXT_PUBLIC_MARKET_MANAGER",
  "0x22D999156f35Ba81dC865AF6EA042fC185a13347",
);
export const BET_ROUTER = addressEnv(
  "NEXT_PUBLIC_BET_ROUTER",
  "0xcFbb27e07cFEa107DF25fd56101fC713B7A6eCBe",
);
export const AUSD_ADDRESS = addressEnv(
  "NEXT_PUBLIC_AUSD_ADDRESS",
  "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
);

export { AgentRegistryAbi, AgentVaultAbi, BetRouterAbi, MarketManagerAbi };

/** Just the two AUSD functions this app calls -- it's Agora's token, not ours, so no full ABI. */
export const Erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
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
] as const;

export const AUSD_FAUCET_ADDRESS = addressEnv(
  "NEXT_PUBLIC_AUSD_FAUCET_ADDRESS",
  "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
);

export const AusdFaucetAbi = [
  {
    type: "function",
    name: "requestFunds",
    stateMutability: "nonpayable",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [],
  },
  // Declared so viem can decode it instead of surfacing a raw, unrecognized selector -- this is
  // Agora's own faucet, not ours, and it has been reverting with this for every recipient tried
  // since the shared testnet faucet ran dry (see deployments/10143.json).
  { type: "error", name: "InsufficientFunds", inputs: [] },
] as const;

export const AUSD_DECIMALS = 6;
