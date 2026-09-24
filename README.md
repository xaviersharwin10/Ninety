# Ninety

**Every minute of a live football match becomes a market — priced by competing AI agents, settled onchain on Monad.**

Fans get a new quick Yes/No market every couple of minutes (*"Shot on target in the next 2 minutes?"*,
*"Corner in the next 3 minutes?"*), each resolving in 1–3 minutes. Behind the scenes, independent AI agents
compete to price every market and back their quotes with real capital. Fans never need to know the agents
exist — they just see a match and a price.

> Status: **in development** for the Monad Metropolis hackathon (1 Sep – 13 Oct 2026). Monad testnet only.

---

## Table of contents

- [What this is](#what-this-is)
- [Track and bounties](#track-and-bounties)
- [Architecture](#architecture)
- [Why Monad](#why-monad)
- [Deployed addresses](#deployed-addresses)
- [Indexer](#indexer)
- [Running locally](#running-locally)
- [Simulator results](#simulator-results)
- [Data attribution](#data-attribution)
- [Known limitations](#known-limitations)
- [AI tool disclosure](#ai-tool-disclosure)
- [License](#license)

---

## What this is

Micro-betting is a proven product — DraftKings acquired Simplebet for a reported $195M — but every
implementation is a single closed model producing black-box odds. Ninety turns it into an open market:

| Actor | What they do | How they earn |
|---|---|---|
| **Fan** | Bets small amounts on quick Yes/No micro-markets | Winning bets |
| **Agent** | Reads the live match feed, quotes Yes/No odds, backs quotes with vault capital | The margin on every bet it takes |
| **Agent dev** | Writes and runs an agent | Performance fee on vault profits |
| **Backer** | Deposits AUSD into an agent's vault | Share of vault profits after the fee |

A bet is split across the **three best quotes** rather than going entirely to the best one, so multiple
agents stay profitable and nobody is driven to zero margin. Every quote, bet, and settlement is onchain
and verifiable.

<!-- TODO: screenshots / demo video link before submission -->

## Track and bounties

**Primary track: 01 — Onchain Finance & Trading.**

| Bounty | Sponsor | How Ninety addresses it |
|---|---|---|
| Best Mera-Powered UX on Monad | Monad Foundation | Mera passkeys are the *entire* account layer — no other wallet connector anywhere in the app, no custodial backend. Betting uses a Mera signing session so only one biometric prompt is needed per match, not one per bet. |
| Mera: One Passkey, Many Keys | Monad Foundation | One passkey derives three cryptographically independent keys under distinct PRF salt namespaces: the user's own account, an agent's quote-signing identity (never signs a transaction), and an AES-256-GCM vault encrypting an agent's strategy parameters. Verified live across two physical devices — register on one, decrypt identically on the other. See [`docs/many-keys.md`](docs/many-keys.md#live-cross-device-verification-24-sep-2026) and `web/app/dev/page.tsx`. |
| Best workflow with CRE | Chainlink | A CRE workflow (`cre/ninety-settlement`) is the orchestration layer for settlement: it triggers off a live `MarketClosed` event, fetches the match outcome over the DON's HTTP capability, and writes a signed report onchain via `SettlementReceiver`. Verified end to end with real transactions, not a dry run — see [§CRE settlement workflow](#cre-settlement-workflow) below and [`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md#live-end-to-end-verification-24-sep-2026). |
| Best Use of Envio | Envio | HyperIndex powers a real core feature, not decoration: the "My Bets" screen reads `Bet(where: {bettor})` straight from the indexer (`web/hooks/useMyBets.ts`), which is what lets a bettor's history reconstruct correctly from a fresh device — Monad's public RPC caps `eth_getLogs` at 100 blocks, so this is the only way that screen can exist past a bettor's most recent few bets. See [§Indexer](#indexer) below. |

## Architecture

```
   Fan / dev (phone, Mera passkey)
        │
        ▼
   web/ (Next.js) ──reads quotes───▶ quote-relay/ ◀──signed EIP-712 quotes── agents/ (Steady, Tempo, Pulse)
        │  reads bet history               ▲                                        ▲
        │  (GraphQL)                       │ subscribes                             │ subscribes
        ▼                                  │                                        │
   indexer/ (Envio HyperIndex) ◀── events ─┴────────────────────────────────────────┘
        ▲                                                                            │
        │ HyperSync                                                                  ▼
        │                                                                   match-data/ (replay clock)
   Monad testnet contracts:                                                          ▲
   AgentRegistry · AgentVault(s) · MarketManager · BetRouter · SettlementReceiver     │
        ▲                                                                            │
        │ writeReport() via forwarder                                                │
        │                                                                            │
   cre/ninety-settlement ── on MarketClosed ── fetches outcome ──────────────────────┘
```

`web/` writes bets, deposits and agent registrations directly to the contracts (via a Mera-derived
account, never a custodial key). It reads most live state (agent list, vault balances, market quotes)
straight from the chain — batched through Multicall3 so it stays at one or two RPC requests
regardless of how many agents or markets exist — and reads a bettor's own history from the indexer
specifically, since that needs to survive a fresh device with no local state (see
[§Indexer](#indexer)). `agents/` and `simulator/` share the same pricing library
(`packages/core/src/pricing.ts`) so a strategy behaves identically whether it's quoting live or being
pressure-tested offline.

| Component | Path | Role |
|---|---|---|
| Contracts | `contracts/` | `AgentRegistry`, `AgentVault`, `MarketManager`, `BetRouter`, `SettlementReceiver` |
| Match data | `packages/match-data/` | Replays a historical match on a clock; REST + WebSocket |
| Agents | `packages/agents/` | Three house agents quoting signed EIP-712 prices |
| Quote relay | `packages/quote-relay/` | Stateless aggregation of the best quotes (untrusted; the contract re-verifies) |
| Simulator | `packages/simulator/` | Offline pressure test with casual / sharp / sniper bettors |
| CRE workflow | `cre/` | Chainlink settlement workflow writing reports onchain |
| Indexer | `indexer/` | Envio HyperIndex powering bet history (`web/hooks/useMyBets.ts`) |
| Web app | `web/` | Next.js, phone-first, Mera passkey as the entire account layer |

## Why Monad

- Markets open and settle every couple of minutes with many small bets each, so the product needs **fast
  finality and cheap transactions** to feel live rather than laggy.
- Every bet verifies up to three EIP-712 agent signatures and locks liability across three separate vaults
  in one transaction. That per-bet onchain work is impractical on most L1s.
- Monad raises the **contract size limit to 128 KB** (from 24 KB), so the market logic stays in readable,
  auditable contracts instead of being split across proxies and libraries.
- Fully onchain settlement means the odds are not a black box: anyone can replay how each market was priced.
- Monad's **secp256r1 precompile for WebAuthn verification** is a talking point we don't strictly depend
  on — Mera derives plain secp256k1 EOAs from a passkey rather than verifying WebAuthn signatures onchain
  — but it's the kind of chain-level bet on passkey-native UX that this product is also betting on.
- One thing we learned the hard way, not from the docs: Monad bills gas on a transaction's **`gas_limit`,
  not gas actually used**. A wallet needs `gas_limit × maxFeePerGas` available *before* a transaction
  lands, not just its real cost — confirmed directly when `AgentRegistry.register()` (which deploys a new
  `AgentVault`) reserved ~0.39 MON on a fresh account that had only been funded 0.02 MON, even though it
  spent far less. Sized the app's own gas-drip relayer (`web/app/api/gas-drip`) around this once measured.

## Deployed addresses

Monad testnet (chain ID **10143**). Deployed at block
[64,991,351](https://testnet.monadexplorer.com/block/64991351) via `contracts/script/Deploy.s.sol`
for a total cost of **1.295 MON**. This is a redeploy of an earlier 2026-09-23 deployment, done to
pick up `AgentVault.withdrawalCooldownSeconds` (see
[`docs/vault-deposit-timing.md`](docs/vault-deposit-timing.md)); the prior addresses ran bytecode
without that fix and are superseded. The full record, including every transaction hash and the
verified on-chain wiring, is in [`deployments/10143.json`](deployments/10143.json).

| Contract | Address |
|---|---|
| `AgentRegistry` | [`0x7471F624898C78470f30a45e3F238B36A3dAAecb`](https://testnet.monadexplorer.com/address/0x7471F624898C78470f30a45e3F238B36A3dAAecb) |
| `MarketManager` | [`0x22D999156f35Ba81dC865AF6EA042fC185a13347`](https://testnet.monadexplorer.com/address/0x22D999156f35Ba81dC865AF6EA042fC185a13347) |
| `BetRouter` | [`0xcFbb27e07cFEa107DF25fd56101fC713B7A6eCBe`](https://testnet.monadexplorer.com/address/0xcFbb27e07cFEa107DF25fd56101fC713B7A6eCBe) |
| `SettlementReceiver` | [`0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8`](https://testnet.monadexplorer.com/address/0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8) |

All five contracts above, plus all three house-agent `AgentVault`s, are **source-verified** via
Monad's Sourcify-compatible verifier (`forge verify-contract --verifier sourcify --verifier-url
https://sourcify-api-monad.blockvision.org/verify`, `partial` match status — full match isn't
attainable since `foundry.toml` strips the metadata hash via `bytecode_hash = "none"`). Confirmed
directly: each submission returned `HTTP 200` with `"status":"partial"`, and the source is
retrievable back from the verifier at
`https://sourcify-api-monad.blockvision.org/files/any/10143/<address>`.

Verified directly against the live network after deploy: `AgentRegistry.betRouter()` points at
`BetRouter`; `MarketManager` has granted `SETTLER_ROLE` to `SettlementReceiver`;
`SettlementReceiver.PRODUCTION_FORWARDER()` is the real Chainlink forwarder and is allowed; the
simulation forwarder is allowlisted but **disabled** (`simEnabled == false`), matching the
off-by-default design in [`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md);
`AgentRegistry.DEFAULT_WITHDRAWAL_COOLDOWN_SECONDS()` is `900` (15 minutes); and all four CORE
market templates are enabled.

Agent vaults are deployed at runtime by `AgentRegistry.register`, one per agent, so their
addresses aren't fixed at deploy time. The three house agents are registered as of 24 Sep 2026 (see
[`deployments/10143.json`](deployments/10143.json) for registration tx hashes):

| Agent | Vault |
|---|---|
| Steady (agent 1) | [`0xe823eeaB4575b010e9339245Bb476320262Ab4C8`](https://testnet.monadexplorer.com/address/0xe823eeaB4575b010e9339245Bb476320262Ab4C8) |
| Tempo (agent 2) | [`0xe19933CcddA5a71DC77CE3D4480F40dd722b68eb`](https://testnet.monadexplorer.com/address/0xe19933CcddA5a71DC77CE3D4480F40dd722b68eb) |
| Pulse (agent 3) | [`0x21adD039F20e3c192AE618818E4FC3B8c8873E23`](https://testnet.monadexplorer.com/address/0x21adD039F20e3c192AE618818E4FC3B8c8873E23) |

Each house agent's `strategyBlob` is plaintext JSON of its public parameters (margin, max stake per
quote) — the operator for all three is a plain `.env` deployer key, not a passkey-derived account,
so there's no passkey to encrypt it under. The Many Keys encryption path itself is built and verified
live (see [§Mera: One Passkey, Many Keys](#track-and-bounties) above and
[`docs/many-keys.md`](docs/many-keys.md)) via `web/app/dev/page.tsx`, which any passkey-signed-in
operator can use to register their *own* agent with an encrypted strategy — as of this write-up,
`AgentRegistry.agentCount()` is higher than 3 because of exactly that: agents registered live during
testing, on top of the three house agents above. Vaults are unfunded as of registration: the shared
Agora testnet AUSD faucet was returning `InsufficientFunds()` for every address tried, deployer and
a fresh one alike (see Known limitations).

External contracts used:

| Contract | Address | Notes |
|---|---|---|
| AUSD (Agora) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 6 decimals. Verified on-chain. |
| AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` | `requestFunds(address)` |
| Chainlink `KeystoneForwarder` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | Production CRE forwarder |

Sample transactions (contract creation, this deployment):

| Contract | Tx hash |
|---|---|
| `AgentRegistry` | [`0x40fccc04…63b421`](https://testnet.monadexplorer.com/tx/0x40fccc041849026d61881d50f2370a1c934746219d1fb28333c06ca1a863b421) |
| `MarketManager` | [`0x7863e298…e71b05`](https://testnet.monadexplorer.com/tx/0x7863e2989692ce249a9e8708a6773dbfcb24b4fa747bd2a3c31ebc6cc1e71b05) |
| `BetRouter` | [`0x0a7d8a27…514363`](https://testnet.monadexplorer.com/tx/0x0a7d8a278096276aaa8b93f561f8bab7226c688c5871c78894108270be514363) |
| `SettlementReceiver` | [`0x77433697…9ae9a8`](https://testnet.monadexplorer.com/tx/0x7743369789b9bd0b1d8002c6c2abb24f0dc9fca8eb803769ce72e827669ae9a8) |

All eleven transactions from the deploy (4 creations + 7 role/template wiring calls) are listed
with exact gas figures in [`deployments/10143.json`](deployments/10143.json).

## CRE settlement workflow

`cre/ninety-settlement` is a Chainlink CRE workflow: **EVM log trigger → HTTP fetch (BFT consensus
across DON nodes) → signed report write onchain**, replacing a trusted backend for settlement.
It triggers on `MarketManager`'s own `MarketClosed` event, reads the market's template and window,
fetches the outcome from the match-data replay service, and writes a `SettlementReport` to
`SettlementReceiver` — no contract changes were needed to wire it in. Full architecture, the
report format, and why the report carries a second signature (a stand-in for the missing
production-forwarder DON signatures while Chainlink deploy access is pending) are in
[`cre/README.md`](cre/README.md).

Verified end-to-end against the live deployment, not just a dry run: `cre workflow simulate
--broadcast` triggered off a real `MarketClosed` transaction, fetched market 3's outcome, and
submitted a signed report that `SettlementReceiver`/`MarketManager` accepted — `getMarket(3)`
confirms `state = Resolved`, `outcome = Yes`, matching exactly what the workflow computed. Details
and both transaction hashes are in
[`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md#live-end-to-end-verification-24-sep-2026).

## Indexer

`indexer/` is an Envio HyperIndex project. It's a real dependency, not decoration: Monad's public
RPC caps `eth_getLogs` at a 100-block range (confirmed directly against it), so a leaderboard, a
vault's history, or "my bets" cannot be built by querying the chain directly once more than ~100
blocks have passed — HyperSync is how those features exist at all.

It indexes `AgentRegistry` and `MarketManager` (fixed addresses) and `BetRouter`, plus every
`AgentVault` (one per agent, discovered dynamically from `AgentRegistered` rather than fixed in
config — see `indexer/config.yaml`'s comment on it), into seven entities: `Agent`, `Vault`,
`VaultPosition`, `VaultSnapshot`, `Match`, `Market`, `Bet`. `Vault`'s `totalAssets`/`lockedLiability`
are running balances mirrored exactly from `AgentVault`'s own events, not approximated — see the
doc comment on `Vault` in `indexer/schema.graphql` for why that's exact rather than estimated.

The web app's "My Bets" screen (`web/hooks/useMyBets.ts`) reads straight from `Bet(where: {bettor})`
— no client-tracked bet ids, no localStorage. That's a deliberate fix, not just a data-source
swap: `claimableAmount` is derived client-side from the indexed `status`/`payout`/`stake`/`claimedAt`
fields (mirroring `BetRouter._owed` exactly), so a bettor's history reconstructs correctly from a
fresh device or browser profile — the same statelessness the Mera passkey account itself has to
satisfy. The leaderboard and vault deposit/withdraw history are the remaining consumers to wire up.

```bash
cd indexer
cp .env.example .env      # needs a real ENVIO_API_TOKEN from envio.dev/app/api-tokens to run live
pnpm codegen               # regenerates generated/ from config.yaml + schema.graphql + handlers
pnpm test                  # 22 handler tests against Envio's own MockDb, no live chain needed
npx envio local docker up  # first time only: brings up the local Postgres + Hasura containers
pnpm dev                   # runs the indexer against Monad testnet, with a local GraphQL playground
```

Verified live on 24 Sep 2026: with a real `ENVIO_API_TOKEN`, `pnpm start` synced Monad testnet from
the deploy block and `Agent { id metadataURI vault { id } }` against the local GraphQL endpoint
returned all three house agents with their correct vault addresses, matching
`deployments/10143.json` exactly.

## Running locally

```bash
cp .env.example .env     # then fill in the blanks
pnpm install

cd contracts && forge test        # contracts: unit + fuzz suite
cd .. && pnpm test                # every TS package's unit tests
pnpm rehearse                     # the full live pipeline, one scenario at a time, nothing mocked
pnpm simulate                     # the offline pressure test -- see below
```

**To run the actual web app against the already-deployed contracts** (no redeploy needed --
`web/.env.local` symlinks to the root `.env`, so `NEXT_PUBLIC_*` addresses already point at
`deployments/10143.json`), start each service in its own terminal:

```bash
pnpm --filter @ninety/match-data dev   # replay service: REST + WS on :8080
pnpm --filter @ninety/quote-relay dev  # quote aggregation: WS on :8081
pnpm --filter @ninety/agents dev       # Steady, Tempo, Pulse quoting live
cd web && pnpm dev                     # the app itself, on :3000
```

My Bets additionally needs the indexer running (see [§Indexer](#indexer) for the one-time
`envio local docker up` setup) with `NEXT_PUBLIC_INDEXER_URL` pointed at it; every other screen
(match, bet slip, Agents/Earn, Dev) reads straight from the chain and works without it. WebAuthn
needs a secure context, so testing sign-in from a phone means the app has to be served over HTTPS
or `localhost` exactly -- a plain LAN IP over HTTP will not show a passkey prompt at all.

## Simulator results

Full writeup, including what the numbers don't prove, is in
[`docs/simulator-results.md`](docs/simulator-results.md). Run it yourself with `pnpm simulate`
(`packages/simulator`) -- every number below is pasted from that command's own output.

**Casual bettors only** (20-seed mean, 3 matches): Steady +90.39 AUSD (0.60% ROI, 20/20 seeds
positive), Tempo +92.51 AUSD (0.62%, 20/20), Pulse +106.49 AUSD (0.71%, 17/20).

**Adding Sharp bettors** (a faster-reacting pricing model plus noticing stale quotes -- see the
doc for exactly what it's allowed to know) **reverses the sign for all three**: Steady -70.74 AUSD,
Tempo -64.47 AUSD, Pulse -173.54 AUSD (worst of the three, and the least often positive at 2/20 --
the "aggressive, tight margin" agent has the least buffer to absorb being picked off). This is not
a bug: it's the exact dynamic the anti-exploit design anticipates (badly priced agents lose;
nothing here yet does the "widen spreads / cut size" half of surviving it, which is the clearest
next step the simulator points at) -- see the doc for the full honest read.

**The bet-delay rule, quantified:** a sniper caught inside `BetRouter.DELAY_SECONDS=8` is voided on
all 84 attempted bets across the 3 fixtures -- net effect zero. The same sniper given a few more
seconds of lead evades the rule almost entirely and extracts **12,208 AUSD** risk-free. That gap is
what `DELAY_SECONDS` is actually buying.

## Data attribution

Historical match event data comes from the **Soccer match event dataset**:

> Pappalardo, Luca; Massucco, Emanuele (2019). *Soccer match event dataset.* figshare. Collection.
> <https://doi.org/10.6084/m9.figshare.c.4415000.v5>

Licensed under [**CC BY 4.0**](https://creativecommons.org/licenses/by/4.0/). The data was collected by
Wyscout. Ninety uses it unmodified as a replay source; any derived data in this repository remains under
CC BY 4.0. This attribution is also shown in the app on every replayed match.

## Known limitations

- **Testnet only, no real money.** Real-money sports betting is heavily regulated, and India's 2025 online
  gaming law bans real-money online games. Licensing and compliance are out of scope here and are an
  acknowledged go-to-market question rather than a solved one.
- **Replayed matches, not live ones.** Live in-play data requires a licensed sports data feed. Ninety
  replays historical matches through the same interface a live feed would use.
- **Data provenance.** Chainlink CRE decentralises *execution* of settlement, not the *source* of the match
  data — in this build that source is our own replay service. In production it would be a licensed provider.
- **CRE simulation forwarder.** The `MockKeystoneForwarder` that `cre workflow simulate --broadcast`
  targets performs no signature verification — measured directly against Monad testnet — so it is
  allowlisted in `SettlementReceiver` but **off by default**. It is guarded independently by a
  sim-attestor signature when enabled, and a one-way `lockProduction()` permanently removes it once
  real CRE deploy access is available. Full detail, measurements and reproduction steps in
  [`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md).
- **Top-3 selection.** The contract enforces that each fill prices at its own signed quote, that fills are
  ordered best-price-first, that agents are distinct, and that the 50/30/20 allocation ladder holds. It
  cannot verify that these were the best three quotes *in existence*, because it never saw the others —
  that selection comes from the relay.
- **Shared testnet AUSD faucet exhaustion.** As of 24 Sep 2026, Agora's testnet AUSD faucet
  (`0xd236c18D…ee6C`) returns `InsufficientFunds()` for every address tried, including a brand-new
  one that had never claimed — despite the faucet contract itself still holding 10,000 AUSD. This
  looks like ecosystem-wide exhaustion (likely from other Metropolis teams drawing on the same
  faucet) rather than anything specific to this project, but it blocks both seeding the house
  agents' vaults and the app's own "claim testnet AUSD" button until it recovers or an alternate
  AUSD source is used.

## AI tool disclosure

*Required by the Metropolis hackathon rules (§4.1.4).*

This project was built with the assistance of AI coding tools.

| Tool | Model | What it was used for |
|---|---|---|
| Claude Code | Anthropic Claude | Research and verification of sponsor integrations; architecture and interface design; drafting and reviewing Solidity, TypeScript and tests; documentation |

<!-- TODO: keep this table current. Add any other AI tool used (including LLMs called at runtime by the
     agents) before submission. -->

All design decisions, scope, and final code review are the author's. Every external claim in this README
was verified against live endpoints or primary documentation rather than accepted from a model.

## License

[MIT](./LICENSE) © 2026 Sharwin Xavier
