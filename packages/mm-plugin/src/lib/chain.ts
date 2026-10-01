import type { PluginCommandContext, PublicClient } from "@metamask/agent-wallet/plugin";
import { AgentRegistryAbi, AgentVaultAbi } from "@ninety/core";
import { type Abi, type Address, createPublicClient, erc20Abi, http } from "viem";
import { CHAIN_ID, CONTRACTS, rpcUrl } from "./config.js";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

/** NinetyUSD's faucet: the token mints test nUSD itself, once per cooldown. */
export const NusdFaucetAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "nextClaimAt",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

let client: PublicClient | undefined;

/**
 * A read-only client for Monad testnet. Not `ctx.publicClient`: the Agent Wallet's RPC gateway
 * answers "Invalid chainId" for 10143 (it broadcasts there, but doesn't serve reads), so reads go
 * to Monad's own RPC. Only reads: every transaction still goes through the Agent Wallet. Takes the
 * context so commands that read stay declared as `wallet-read` alongside the wallet address.
 */
export function monad(_ctx: PluginCommandContext): PublicClient {
  client ??= createPublicClient({
    chain: {
      id: CHAIN_ID,
      name: "Monad Testnet",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl()] } },
      contracts: { multicall3: { address: MULTICALL3 } },
    },
    transport: http(rpcUrl(), { retryCount: 3 }),
  }) as PublicClient;
  return client;
}

export async function nusdBalance(client: PublicClient, owner: Address): Promise<bigint> {
  return client.readContract({
    address: CONTRACTS.nusd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function nusdAllowance(
  client: PublicClient,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  return client.readContract({
    address: CONTRACTS.nusd,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}

export interface MarketMaker {
  agentId: number;
  name: string;
  enabled: boolean;
  vault: Address;
  totalAssets: bigint;
  freeCapital: bigint;
  /** Return since the vault opened, in basis points. */
  returnBps: number;
  performanceFeeBps: number;
  cooldownSec: number;
  /** What the given wallet's shares are worth, and the most it can withdraw right now. */
  yours: bigint;
  withdrawable: bigint;
  yourShares: bigint;
  withdrawableShares: bigint;
  lastDepositAt: number;
}

/** A vault's price per share when it opens (1e18 / 1e6: 6-decimal asset, 6-decimal share offset). */
const GENESIS_PPS = 10n ** 12n;

/** Agent names are the first part of their registration label ("Steady — conservative ..."). */
function displayName(metadataURI: string): string {
  return metadataURI.split(" — ")[0] || metadataURI;
}

/** Every market maker, with its vault's numbers and `owner`'s position, read in two multicalls. */
export async function marketMakers(client: PublicClient, owner: Address): Promise<MarketMaker[]> {
  const count = Number(
    await client.readContract({
      address: CONTRACTS.agentRegistry,
      abi: AgentRegistryAbi as Abi,
      functionName: "agentCount",
    }),
  );
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  if (ids.length === 0) return [];
  const agents = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: false,
    contracts: ids.map((id) => ({
      address: CONTRACTS.agentRegistry,
      abi: AgentRegistryAbi as Abi,
      functionName: "getAgent",
      args: [id],
    })),
  });
  const fields = [
    ["totalAssets"],
    ["freeCapital"],
    ["pricePerShare"],
    ["performanceFeeBps"],
    ["withdrawalCooldownSeconds"],
    ["balanceOf", owner],
    ["maxWithdraw", owner],
    ["maxRedeem", owner],
    ["lastDepositAt", owner],
  ] as const;
  const vaults = (agents as { vault: Address }[]).map((a) => a.vault);
  const reads = (await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: false,
    contracts: vaults.flatMap((vault) =>
      fields.map(([functionName, ...args]) => ({
        address: vault,
        abi: AgentVaultAbi as Abi,
        functionName,
        args,
      })),
    ),
  })) as (bigint | number)[];
  const shareValues = await client.multicall({
    multicallAddress: MULTICALL3,
    allowFailure: false,
    contracts: vaults.map((vault, i) => ({
      address: vault,
      abi: AgentVaultAbi as Abi,
      functionName: "convertToAssets",
      args: [reads[i * fields.length + 5]],
    })),
  });

  return (agents as { metadataURI: string; enabled: boolean; vault: Address }[]).map((a, i) => {
    const r = (k: number) => BigInt(reads[i * fields.length + k]!);
    const pps = r(2);
    return {
      agentId: ids[i]!,
      name: displayName(a.metadataURI),
      enabled: a.enabled,
      vault: a.vault,
      totalAssets: r(0),
      freeCapital: r(1),
      returnBps: pps > GENESIS_PPS ? Number(((pps - GENESIS_PPS) * 10_000n) / GENESIS_PPS) : 0,
      performanceFeeBps: Number(r(3)),
      cooldownSec: Number(r(4)),
      yourShares: r(5),
      yours: BigInt(shareValues[i] as bigint),
      withdrawable: r(6),
      withdrawableShares: r(7),
      lastDepositAt: Number(r(8)),
    };
  });
}

/** The market maker named (case-insensitive, by name or id), or null. */
export function findMarketMaker(all: MarketMaker[], query: string): MarketMaker | null {
  const q = query.trim().toLowerCase();
  return all.find((m) => String(m.agentId) === q || m.name.toLowerCase() === q) ?? null;
}
