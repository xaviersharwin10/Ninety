/**
 * Sealing, storing and loading an agent's memory (the memory itself, and how it learns, is
 * `packages/core/src/agent-memory.ts`): what it has learned, carried from one device to another.
 *
 * Privacy and survival follow the same pattern as the strategy (see `strategy-vault.ts`): the JSON
 * is sealed into a Mera secret vault under the operator's passkey (AES-256-GCM, its own random PRF
 * salt), and only that ciphertext leaves the browser, into `AgentMemory.save` on chain. Any device
 * with the same passkey can fetch it back through the indexer, check it against the on-chain
 * commitment, and decrypt it. Nobody else can read it -- not us, not the indexer, not other agents.
 */
import {
  createSecretVaultWithExistingPasskey,
  decryptSecretVaultWithPasskey,
  parseSecretVault,
} from "@category-labs/mera";
import { type AgentMemory, type SettledBet, TEMPLATE_NAME_BY_ID } from "@ninety/core";
import { bytesToHex, type Hex, hexToBytes, keccak256 } from "viem";
import { publicClient } from "./chain";
import { AGENT_MEMORY, AgentMemoryAbi } from "./contracts";
import { queryIndexer } from "./indexer";

interface IndexedAgentBet {
  id: string;
  status: string;
  stake: string;
  payout: string;
  market: { templateId: string };
}

/** Every settled bet this agent has priced, from the indexer, from its own side of the table. */
export async function fetchSettledBets(agentId: number): Promise<SettledBet[]> {
  const { Bet } = await queryIndexer<{ Bet: IndexedAgentBet[] }>(
    `query($a: String!) {
      Bet(where: { agent_id: { _eq: $a }, status: { _in: ["Won", "Lost", "Voided"] } }) {
        id status stake payout market { templateId }
      }
    }`,
    { a: String(agentId) },
  );
  return Bet.flatMap((b) => {
    const template = TEMPLATE_NAME_BY_ID[b.market.templateId];
    if (!template) return [];
    // Bet.status is the bettor's result: a bet the bettor Won is one the agent paid out on.
    const agentPnl =
      b.status === "Lost"
        ? BigInt(b.stake)
        : b.status === "Won"
          ? BigInt(b.stake) - BigInt(b.payout)
          : 0n;
    return [{ id: Number(b.id), template, agentPnl }];
  });
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Seals memory under the operator's passkey. Prompts once. */
export async function encryptMemory(rpId: string, memory: AgentMemory): Promise<Hex> {
  const secret = textEncoder.encode(JSON.stringify(memory));
  const vault = await createSecretVaultWithExistingPasskey({ rpId, secret });
  return bytesToHex(textEncoder.encode(JSON.stringify(vault)));
}

export interface StoredMemory {
  version: number;
  blob: Hex;
  /** The blob the indexer served matches `AgentMemory.memoryCommit` on chain. */
  commitOk: boolean;
}

export interface MemoryStatus {
  /** Saves recorded on chain -- the source of truth for whether memory exists. */
  chainVersion: number;
  /** The latest save the indexer can serve; null if it has none yet. */
  stored: StoredMemory | null;
}

/**
 * Where the agent's memory stands: how many saves the chain has recorded, and the latest one the
 * indexer can hand back. The two can disagree for up to ~45s after a save (the indexer's free-tier
 * lag), and a page that asked only the indexer showed "none saved yet" for memory that was sitting
 * right there on chain -- so callers compare the two and wait while `stored` is behind.
 */
export async function fetchMemoryStatus(agentId: number): Promise<MemoryStatus> {
  const [chainVersion, stored] = await Promise.all([
    publicClient.readContract({
      address: AGENT_MEMORY,
      abi: AgentMemoryAbi,
      functionName: "memoryVersion",
      args: [agentId],
    }) as Promise<bigint>,
    fetchStoredMemory(agentId),
  ]);
  return { chainVersion: Number(chainVersion), stored };
}

/**
 * The agent's latest sealed memory the indexer can serve, or null if it has none. The indexer
 * supplies the ciphertext (it lives only in an event); the chain vouches for it.
 */
export async function fetchStoredMemory(agentId: number): Promise<StoredMemory | null> {
  const { AgentMemory } = await queryIndexer<{
    AgentMemory: { version: string; blob: Hex }[];
  }>(`query($a: String!) { AgentMemory(where: { id: { _eq: $a } }) { version blob } }`, {
    a: String(agentId),
  });
  const latest = AgentMemory[0];
  if (!latest) return null;
  const onChain = (await publicClient.readContract({
    address: AGENT_MEMORY,
    abi: AgentMemoryAbi,
    functionName: "memoryCommit",
    args: [agentId],
  })) as Hex;
  return {
    version: Number(latest.version),
    blob: latest.blob,
    commitOk: keccak256(latest.blob).toLowerCase() === onChain.toLowerCase(),
  };
}

/** Opens sealed memory. Prompts once, for the exact passkey that sealed it. */
export async function decryptMemory(rpId: string, blob: Hex): Promise<AgentMemory> {
  const vault = parseSecretVault(textDecoder.decode(hexToBytes(blob)));
  const plaintext = await decryptSecretVaultWithPasskey({ rpId, vault });
  return JSON.parse(textDecoder.decode(plaintext)) as AgentMemory;
}
