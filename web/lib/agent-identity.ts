/**
 * Derives an agent's quote-signing identity from the operator's own passkey -- a second, distinct
 * key from the same PRF primitive that derives the account in `lib/mera.ts`, under its own
 * namespaced salt. This key never signs a blockchain transaction: `BetRouter` only ever
 * `ecrecover`s it inside a contract call to check an EIP-712 quote's signature. It is registered
 * as `AgentRegistry.Agent.quoteSigner`, not an EOA anyone sends funds to or from.
 *
 * Deterministic and salt-namespaced like the account derivation, so the same passkey reproduces
 * the same quote-signer address on any device -- an operator does not need to export or back up
 * this key separately from the passkey that already protects their account and strategy vault.
 */
import {
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { Address, LocalAccount } from "viem";

async function namespaceSalt(namespace: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespace));
  return new Uint8Array(digest);
}

/** `agentSlug` only needs to be unique per operator -- it namespaces the salt, nothing else. */
export async function deriveAgentQuoteSigner(rpId: string, agentSlug: string): Promise<Address> {
  const signer = await openAgentSigner(rpId, agentSlug);
  try {
    return signer.address;
  } finally {
    signer.end();
  }
}

export interface AgentSigner {
  address: Address;
  /** Signs EIP-712 quotes without prompting, until `end()`. */
  account: LocalAccount;
  /** Zeroes the key. */
  end: () => void;
}

/**
 * Opens the agent's quote-signing key as a Mera signing session: one passkey prompt, then every
 * quote signs silently until `end()` zeroes it. This is how an operator runs their agent live from
 * the browser -- the key exists only in this tab's memory for as long as it's running, and is
 * never written anywhere. Same slug, same passkey, same address, on any device.
 */
export async function openAgentSigner(rpId: string, agentSlug: string): Promise<AgentSigner> {
  const prfSalt = await namespaceSalt(`ninety.agent.${agentSlug}`);
  const { prfOutput } = await getPasskeyPrfOutput({ rpId, prfSalt });
  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  return {
    address: getEvmAddress(session.publicKey),
    account: toViemAccount(session),
    end: () => session.end(),
  };
}
