/**
 * Encrypts and decrypts an agent's strategy parameters with Mera's passkey secret vault: AES-256-GCM,
 * keyed by an HKDF derivation of the operator's own passkey PRF output. The plaintext never leaves
 * the browser -- not to our backend, not to the chain.
 *
 * The ciphertext (the whole `PasskeySecretVault` JSON, not just the raw AES output) is what gets
 * stored on chain via `AgentRegistry.register`/`setStrategy`, not in localStorage or on our own
 * server. `PasskeySecretVault` already carries everything decryption needs -- which credential,
 * which PRF salt, the nonce -- so a strategy set on one device reads back correctly from any other
 * device or fresh browser profile with the same passkey, the same cross-device guarantee the
 * account itself has (see `lib/mera.ts`).
 */
import {
  createSecretVaultWithExistingPasskey,
  decryptSecretVaultWithPasskey,
  parseSecretVault,
} from "@category-labs/mera";
import { bytesToHex, type Hex, hexToBytes, keccak256 } from "viem";

/** Public-facing pricing parameters an operator sets for their agent. Kept small and JSON-plain --
 *  this is descriptive metadata for registration/audit, not the live pricing code (that's the
 *  hand-written `PricingStrategy` implementations in `packages/agents/src/strategies`). */
export interface AgentStrategy {
  name: string;
  style: string;
  marginBps: number;
  /** AUSD base units (6dp) as a decimal string -- JSON has no bigint. */
  maxStakePerQuote: string;
  quoteExpirySec: number;
  notes?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Encrypts a strategy under the caller's own passkey. Prompts once. */
export async function encryptStrategy(rpId: string, strategy: AgentStrategy): Promise<Hex> {
  const secret = textEncoder.encode(JSON.stringify(strategy));
  const vault = await createSecretVaultWithExistingPasskey({ rpId, secret });
  return bytesToHex(textEncoder.encode(JSON.stringify(vault)));
}

/**
 * Decrypts an on-chain strategy blob. Prompts once, restricted to the exact credential the vault
 * names (`decryptSecretVaultWithPasskey` reads `vault.credential`), not just any passkey for rpId.
 */
export async function decryptStrategy(rpId: string, blob: Hex): Promise<AgentStrategy> {
  const vaultJson = textDecoder.decode(hexToBytes(blob));
  const vault = parseSecretVault(vaultJson);
  const plaintext = await decryptSecretVaultWithPasskey({ rpId, vault });
  return JSON.parse(textDecoder.decode(plaintext)) as AgentStrategy;
}

/** `AgentRegistry` stores `keccak256(strategyBlob)` alongside the blob -- cheap to re-check
 *  client-side so a tampered or corrupted blob is caught before it's shown as trustworthy. */
export function verifyStrategyCommit(blob: Hex, commit: Hex): boolean {
  return keccak256(blob).toLowerCase() === commit.toLowerCase();
}
