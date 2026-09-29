# One Passkey, Many Keys — how Ninety uses PRF-derived key material

CLAUDE.md §7.2 names the bounty text: *"the most creative use of that primitive for anything that
is NOT signing blockchain transactions from a wallet account,"* judged on novelty, correct use of
the primitives, and a live cross-device test. This records what Ninety actually does with it and
why, alongside the account derivation already covered in `web/lib/mera.ts`'s own doc comment.

## Four keys, one passkey, four distinct namespaces

| Salt namespace | Primitive | What it protects | Non-account? |
|---|---|---|---|
| `sha256("ninety.account.v1")` | derivation → BIP-39/32 → secp256k1 EOA | The signed-in user's Monad account (`web/lib/mera.ts`) | account — the baseline, not the bounty's target |
| `sha256("ninety.agent." + slug)` | derivation → secp256k1, direct (no BIP-39) | An agent's **quote-signing identity** (`web/lib/agent-identity.ts`) | ✅ — never signs a transaction; `BetRouter` only `ecrecover`s it inside a contract call to check an EIP-712 quote |
| Mera's own per-call random salt, itself protected by the passkey | encryption → AES-256-GCM via a `PasskeySecretVault` (`web/lib/strategy-vault.ts`) | An agent's **strategy parameters** (margin, max stake, quote expiry, private notes, and the slug its signing key derives under) | ✅ — arbitrary opaque bytes, nothing wallet-shaped about it |
| A second, independent `PasskeySecretVault` (its own random salt) | encryption → AES-256-GCM (`web/lib/agent-memory.ts`) | An agent's **memory**: what it learned from the bets it priced, per market type, and the margin adjustments that follow (`packages/core/src/agent-memory.ts`) | ✅ — the bounty's own suggested idea #02, "AI agent memory encrypted to the user's passkey", built into a running agent rather than beside it |

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

## Live cross-device verification (24 Sep 2026)

Tested end to end on real hardware, not simulated: a fresh passkey created on one phone (Android
Chrome, Google Password Manager), used to register agent id 6 (`AgentRegistry` at
`0xdbE23698776e12A7e1bf5FFBe5054d6919BcA8df`, operator `0x9182bcCeb3b399577d2c951858b69843516B1B58`,
vault `0x354ab34B958baaeE9B197ecd621a05a8c034D316`, `metadataURI = "Xavi 1 — momentum-driven"`,
confirmed directly via `getAgent(6)`). A second device, signed in against the same Google account so
the *same* synced passkey was available to pick, opened the app fresh, selected that passkey, and
`decryptSecretVaultWithPasskey` reconstructed the identical strategy JSON with the commitment check
passing — no local state shared between the two devices except the passkey itself.

One real finding from getting here: the first several test accounts this session created were all
named identically ("Ninety Account"), because `signUp()` originally hardcoded that string as the
WebAuthn `user.name`/`displayName`. Google Password Manager syncs by *account*, not device, so both
phones saw the same full list of saved passkeys — and with several entries showing the identical
label, there was no way to tell which one was "the right one" when signing in on the second device.
The actual attempt landed on the wrong passkey (a different derived address, owning no agent) before
this was diagnosed. Fixed by stamping a creation timestamp into the name (`web/lib/mera.ts`), so
every *new* passkey is distinguishable in the OS picker; existing ambiguous ones from before the fix
can't be renamed after the fact (WebAuthn has no rename operation), which is why the verification
above used a freshly created account rather than one of the earlier ones.

## Agent memory, and running an agent live (29 Sep 2026)

The strategy vault protects what an operator *tells* their agent. The memory protects what the
agent *learns*. When an operator stops a live run, the agent folds every bet settled since its last
save into a per-market-type record (bets, P&L) and adjusts its margin from that session's result: a
market type it lost money on gets +100bps next time, one it won on −25bps (capped at +500/−100).
The adjustment is incremental, so it can't be recomputed from public bet history: it is the agent's
own edge, and it's sealed accordingly.

**Where it lives.** `contracts/src/AgentMemory.sol` (`0xB07D8e5B822F0d885BcDEebE3Dceb2166FF5D85c`,
Sourcify-verified). `save(agentId, blob)` is operator-only (checked against `AgentRegistry`), and it
*emits* the ciphertext rather than storing it -- memory is rewritten every session, and event bytes
cost a fraction of storage bytes. Only `keccak256(blob)` goes to storage, as `memoryCommit`. The
Envio indexer serves the latest blob (`AgentMemory` entity); the client re-checks it against
`memoryCommit` with one `eth_call` before decrypting, so the indexer is trusted for availability,
never for content. The page also reads `memoryVersion` from the chain directly and waits
("syncing…") while the indexer is behind, rather than reporting memory that exists as missing.

**Running live.** Registration now seals the agent's slug inside its strategy, so the quote-signing
key re-derives on any device. "Run live from this tab" on the Dev page opens that key as a Mera
signing session (one passkey prompt), then prices every open market from the operator's strategy
plus the memory's learned adjustments, signs quotes silently, and pulls them around big moments
exactly as the house agents do (`web/lib/browser-agent.ts`). Stopping ends the session, which zeroes
the key. The agent quotes only while its operator keeps the tab open: the right trade-off for a key
that must never exist anywhere but the passkey holder's own browser.

So one passkey, four keys, used end to end in one session: the account signs the transactions, the
agent identity signs price quotes, the strategy vault opens the pricing parameters, and the memory
vault opens -- and later reseals -- what the agent has learned.

## Honesty about scope

- An operator-run agent quotes only while its tab is open (see above). The house agents' signing
  keys remain plain `.env` keys because they run unattended.
- Agents registered before 29 Sep 2026 have no slug sealed in their strategy, so their signing key
  can't be re-derived; the Dev page says so and suggests registering a new one.
- Headless verification can't reproduce a *second* device: Chrome's virtual authenticator exports a
  credential without its PRF secret, so an imported copy can't derive keys. The automated check
  instead wipes every byte of browser storage for the origin and reconstructs from the passkey alone
  (the Mera "stateless test"); the two-phone test above covers the cross-device case.
