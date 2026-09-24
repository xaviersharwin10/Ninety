/**
 * Mera is the entire account layer -- no seed phrase, no extension, no custody backend. A single
 * passkey derives (via a namespaced PRF salt, then BIP-39/32) the EOA this app signs bets with.
 *
 * The salt namespace is deliberately named ("ninety.account.v1") rather than left at Mera's own
 * default: the "One Passkey, Many Keys" bounty story is one dev passkey producing several
 * *distinct*, namespace-isolated keys (this account, an agent's quote-signing identity, an
 * agent's encrypted memory, ...) -- see docs/ for the full design once those other namespaces
 * exist. Every namespace here must stay stable forever: changing a salt changes every address it
 * produces.
 */
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type MeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import type { Address, LocalAccount } from "viem";

export type { MeraError };
export { isMeraError };

const ACCOUNT_DERIVATION_PATH = "m/44'/60'/0'/0/0";

async function namespaceSalt(namespace: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespace));
  return new Uint8Array(digest);
}

export interface NinetySession {
  address: Address;
  account: LocalAccount<"mera">;
  /** Zeroes the underlying key. Call on sign-out; never call twice. */
  end: () => void;
}

function deriveSession(prfOutput: Uint8Array): NinetySession {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(ACCOUNT_DERIVATION_PATH);
  if (!node.privateKey) throw new Error("key derivation produced no private key");

  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  const account = toViemAccount(session);
  return { address: account.address, account, end: () => session.end() };
}

/** First-time sign-up: creates a new discoverable passkey and derives this app's account from it. */
export async function signUp(rpId: string): Promise<NinetySession> {
  const prfSalt = await namespaceSalt("ninety.account.v1");
  // A fixed name/displayName here means every passkey this app ever creates looks identical in
  // the OS/browser's own picker -- fine with exactly one, but sign up more than once (testing,
  // an accidental tap of "Create account" instead of "I already have an account") and there is no
  // way to tell them apart when signing back in. A creation timestamp, shown by the platform
  // alongside the passkey, is enough to pick the right one without needing any server-side state.
  const label = `Ninety — ${new Date().toLocaleString()}`;
  const { prfOutput } = await createPasskeyWithPrfOutput({
    rp: { id: rpId, name: "Ninety" },
    user: { name: label, displayName: label },
    prfSalt,
  });
  return deriveSession(prfOutput);
}

/**
 * Returning-user sign-in: asks for *any* discoverable passkey for this relying party -- no stored
 * credential ID, no local session, no server. This is what makes the app pass a "clear storage,
 * fresh device" test: identity is reconstructed from the passkey plus this one deterministic
 * derivation, every time.
 */
export async function signIn(rpId: string): Promise<NinetySession> {
  const prfSalt = await namespaceSalt("ninety.account.v1");
  const { prfOutput } = await getPasskeyPrfOutput({ rpId, prfSalt });
  return deriveSession(prfOutput);
}
