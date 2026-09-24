# One Passkey, Many Keys — how Ninety uses PRF-derived key material

CLAUDE.md §7.2 names the bounty text: *"the most creative use of that primitive for anything that
is NOT signing blockchain transactions from a wallet account,"* judged on novelty, correct use of
the primitives, and a live cross-device test. This records what Ninety actually does with it and
why, alongside the account derivation already covered in `web/lib/mera.ts`'s own doc comment.

## Three keys, one passkey, three distinct namespaces

| Salt namespace | Primitive | What it protects | Non-account? |
|---|---|---|---|
| `sha256("ninety.account.v1")` | derivation → BIP-39/32 → secp256k1 EOA | The signed-in user's Monad account (`web/lib/mera.ts`) | account — the baseline, not the bounty's target |
| `sha256("ninety.agent." + slug)` | derivation → secp256k1, direct (no BIP-39) | An agent's **quote-signing identity** (`web/lib/agent-identity.ts`) | ✅ — never signs a transaction; `BetRouter` only `ecrecover`s it inside a contract call to check an EIP-712 quote |
| Mera's own per-call random salt, itself protected by the passkey | encryption → AES-256-GCM via a `PasskeySecretVault` (`web/lib/strategy-vault.ts`) | An agent's **strategy parameters** (margin, max stake, quote expiry, private notes) | ✅ — arbitrary opaque bytes, nothing wallet-shaped about it |

The account and the agent-identity namespaces both use the same deterministic pattern: SHA-256 of a
fixed string names the PRF salt, `getPasskeyPrfOutput({ rpId, prfSalt })` returns 32 bytes, and
those bytes seed a key. The two are still cryptographically independent — HKDF/BIP-39 on disjoint
salts, not the same key reused — so an agent's quote-signing key reveals nothing about the
operator's own account key, and vice versa.

The strategy vault deliberately does *not* reuse that hand-rolled pattern. Mera ships a purpose-built
primitive for exactly this shape of secret (`createSecretVaultWithExistingPasskey` /
`decryptSecretVaultWithPasskey`, `@category-labs/mera`'s `secret.ts`): it generates its own random
PRF salt per call, derives an AES-256-GCM key from the PRF output via HKDF with a fixed info string
that keeps it distinct from any other key derived from the same output, and returns a JSON-safe
`PasskeySecretVault` — credential metadata, salt, nonce, ciphertext, all self-describing. Using the
library's own vault primitive instead of reimplementing AES-GCM by hand is the "correct use of the
primitives" half of the judging criteria, not just the novelty half.

## Where the ciphertext lives

`AgentRegistry` stores the whole `PasskeySecretVault` JSON (UTF-8 bytes) in contract **storage**,
keyed by agent id, not just in event logs and not in `localStorage`. The doc comment on
`AgentRegistry.sol` explains why: Monad's public RPC caps `eth_getLogs` at a 100-block range, so
log-only retrieval would need the indexer in the path. Storage makes `strategyBlobOf(agentId)` a
single `eth_call` with no indexer dependency — the same "reconstructs from nothing but the passkey
plus the chain" property `lib/mera.ts` already gives the account itself. `AgentRegistry` also keeps
`keccak256(strategyBlob)` as `Agent.strategyCommit`; `verifyStrategyCommit` re-checks it client-side
before showing a decrypted result, so a corrupted or tampered blob is caught rather than trusted.

## The flow (`web/app/dev/page.tsx`)

1. **Register.** The signed-in operator names an agent and its pricing parameters. The client
   derives a fresh quote-signing address (`ninety.agent.<slug>`, one passkey prompt), encrypts the
   strategy JSON into a vault (`createSecretVaultWithExistingPasskey`, a second prompt), and calls
   `AgentRegistry.register(quoteSigner, blob, metadataURI)`.
2. **Reveal.** For any agent the connected account operates, `strategyBlobOf(agentId)` is read
   straight from the contract, the commitment is checked, and `decryptSecretVaultWithPasskey`
   (restricted to the exact credential the vault names, not just any passkey for this site) decrypts
   it back to the original JSON — on this device, a different device, or a fresh browser profile
   with no local state, identically.
3. **Re-seal.** `setStrategy` re-encrypts and overwrites the on-chain blob, rotating to a fresh
   random salt and nonce, so audit access (reveal) and normal secrecy (a rotated ciphertext at rest)
   are not in tension.

## Honesty about scope

Registering an agent through this flow creates a real `AgentRegistry` entry and a real
`AgentVault` — but, unlike the three house agents, no runner process quotes on its behalf. Wiring a
PRF-derived signer into a live, unattended quoting process is future work: the signer only exists in
the browser for the moment it's derived, which is the right tradeoff for a key that must never leave
the passkey holder's control, but it does mean an operator has to be present to run their agent live.
The house agents' quote-signing keys remain plain `.env` keys for that reason — swapping them for
PRF-derived ones would need a signing-session hand-off design (sketched, not built) rather than a
one-file change.
