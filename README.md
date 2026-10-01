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
- [Odds Lock: agents sell price holds](#odds-lock-agents-sell-price-holds)
- [Trading from MetaMask Agent Wallet](#trading-from-metamask-agent-wallet)
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
| **Agent dev** | Writes and runs an agent | Performance fee on vault profits: 20% of profit above the vault's previous peak, paid automatically as vault shares (the settlement watcher calls the permissionless `AgentVault.harvest()` every five minutes) |
| **Backer** | Deposits nUSD into an agent's vault | Share of vault profits after the fee |

A bet is split across the **three best quotes** rather than going entirely to the best one, so multiple
agents stay profitable and nobody is driven to zero margin. Every quote, bet, and settlement is onchain
and verifiable.

Agents have a **second way to earn: Odds Lock.** A fan who isn't sure yet can pay a small fee to hold a
price for a moment of the match and bet it whenever they like in that time. The agent prices the fee,
it goes straight into the agent's vault, and the agent honours the hold. It is an option on the odds,
sold by an agent, onchain -- see [§Odds Lock](#odds-lock-agents-sell-price-holds).

<!-- TODO: screenshots / demo video link before submission -->

## Track and bounties

**Primary track: 01 — Onchain Finance & Trading.**

| Bounty | Sponsor | How Ninety addresses it |
|---|---|---|
| Best Mera-Powered UX on Monad | Monad Foundation | Mera passkeys are the *entire* account layer — no other wallet connector anywhere in the app, no custodial backend. Betting uses a Mera signing session so only one biometric prompt is needed per match, not one per bet. The app keeps nothing in browser storage, so it passes the stateless test: verified 29 Sep 2026 by wiping every byte of storage for the origin mid-session, signing back in with the passkey alone, and getting back the same account, its registered agent and its sealed memory. |
| Mera: One Passkey, Many Keys | Monad Foundation | One passkey, four independent keys, all used in one session: the user's account; an agent's quote-signing identity (opened as a signing session to run the agent live from the browser -- it signs price quotes, never a transaction); an AES-256-GCM vault sealing the agent's strategy; and a second vault sealing the agent's **memory** -- what it learned from the bets it priced, which changes how it prices next time (the bounty's suggested idea #02). Memory ciphertext lives on Monad (`AgentMemory`, hash-committed) and reconstructs from nothing but the passkey. Strategy verified across two physical devices; memory verified surviving a full browser-storage wipe. See [`docs/many-keys.md`](docs/many-keys.md) and `web/app/dev/page.tsx`. |
| Best workflow with CRE | Chainlink | A CRE workflow (`cre/ninety-settlement`) is the orchestration layer for settlement: it triggers off a live `MarketClosed` event, fetches the match outcome over the DON's HTTP capability, and writes a signed report onchain via `SettlementReceiver`. Verified end to end with real transactions, not a dry run — see [§CRE settlement workflow](#cre-settlement-workflow) below and [`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md#live-end-to-end-verification-24-sep-2026). |
| Best Use of Envio | Envio | HyperIndex powers a real core feature, not decoration: the "My Bets" screen reads `Bet(where: {bettor})` straight from the indexer (`web/hooks/useMyBets.ts`), which is what lets a bettor's history reconstruct correctly from a fresh device — Monad's public RPC caps `eth_getLogs` at 100 blocks, so this is the only way that screen can exist past a bettor's most recent few bets. See [§Indexer](#indexer) below. |
| Best Projects using Alchemy | Alchemy | Alchemy's Monad testnet RPC is the first provider for every server-side service -- the three house agents, the market scheduler, the gas sponsor and the settlement watcher -- ahead of Tenderly's keyless gateway and the public RPC, with automatic failover down that chain (`serverRpcUrls` in `packages/core/src/transport.ts`). That keeps the servers off the public RPC's 15 req/s cap, which fans' browsers depend on. Log reads skip it, since the free tier serves `eth_getLogs` over 10 blocks; history comes from the Envio indexer anyway. |
| Best Agent Wallet Plugin | MetaMask | [`packages/mm-plugin`](packages/mm-plugin): an installable plugin that adds a `ninety` topic to MetaMask Agent Wallet's `mm` CLI. Its commands read the live markets, quote a bet exactly, place it, collect winnings, and back or withdraw from the market makers' vaults. Every write goes through `ctx.walletExecutor`, so MetaMask simulates, scans, policy-checks and signs it; the plugin holds no keys. It ships a [`SKILL.md`](packages/mm-plugin/skills/ninety/SKILL.md) for agents. Run end to end on Monad testnet from a Guard Mode server wallet: faucet, bet, win, collect, back, withdraw ([transactions](packages/mm-plugin/README.md#a-real-run-on-monad-testnet)). |

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
| Web app | `web/` | Next.js, responsive (phone bottom-tab layout, full-width desktop layout), Mera passkey as the entire account layer |

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

## Odds Lock: agents sell price holds

**What the fan sees.** Under *Confirm bet*, one quiet line: *"Not sure yet? Hold 1.26x for 30s · 0.43
nUSD."* One tap and the price is theirs for the moment: the slip counts it down, and if they close it to
keep watching, the market card says *"You're holding NO at 1.26x · 0:22 · Bet"*. One more tap bets the
held stake at the held price, whatever the market has done since. The word "option" never appears.

**How it works** (`contracts/src/OddsLock.sol`, `packages/core/src/odds-lock.ts`):

1. Alongside every quote, each agent signs an EIP-712 **lock offer** for each side: the price, a fee, the
   hold length and the most it will hold. The relay serves the best one with the prices.
2. The fan calls `OddsLock.buy`. It checks the agent's signature against `AgentRegistry`, caps the fee at
   what the fan saw, records the hold (`LockBought`), and sends the fee **straight into the agent's vault**
   -- backers earn it, and the indexer books it as the agent's income (*Hold fees* on the leaderboard).
3. The agent honours the hold with an ordinary signed quote at the held price -- the held side at the held
   price, the other at the 98% ceiling so it's useless for anything else -- sized to the stake still held,
   re-signed every few seconds, one at a time, and handed by the relay **only to the fan who bought it**
   (they prove it by signing for it). The bet goes through `BetRouter` unchanged, with every check it
   makes on any bet. `BetRouter` was not redeployed.

**Why it can't be gamed.** A hold pauses during big moments, exactly as betting does: the agent stops
signing its honouring quote while an event that would decide the market is coming, the same way it pulls
its quotes. Without that, a hold would be a free ticket to bet on what the fan can see is about to happen,
and its fair fee would be ~19% for 30 seconds. With it, what's left is what *waiting* is worth, and the fee
prices exactly that: nothing for YES, whose price only improves by waiting (so the 1% floor), and for NO
the time it lets the fan skip -- `pNo/q − e^(−λ·hold)`, plus a 25% markup and a 1% floor. In the
simulator, against fans who use every hold as well as anyone could, **every house agent nets +1.0% to
+2.6% of the stake held** ([details](docs/simulator-results.md#odds-lock-what-holding-a-price-costs-the-agent)).

**Replays run at 5x,** so a hold lasts 10 real seconds -- 50 seconds of match -- and is priced as 50.
Agents read the replay speed from match-data; live football at 1x gets the full 30 seconds.

**Trust model.** The contract guarantees the part the fan pays for: the agent really offered these terms,
the fee went to its vault and nowhere else, and there is a public record of the hold. It cannot force the
agent to hand over the honouring quote -- that is a promise kept off chain. Every hold and every bet is
onchain, so a hold that was paid for and never honoured is visible to anyone.

Verified live on Monad testnet, 1 Oct 2026: a fan bought a hold on NO at 1.26x, closed the slip, saw the
hold on the market card, and bet the held price from it while the market had moved to 1.13x.

## Trading from MetaMask Agent Wallet

Fans bet from the web app with a passkey. Trading agents get the same market from the terminal:
[`packages/mm-plugin`](packages/mm-plugin) is a plugin for MetaMask Agent Wallet's `mm` CLI.

```text
mm ninety markets            # what's open, best odds, seconds left
mm ninety quote 96 no 2      # exact odds and payout for that stake
mm ninety bet 96 no 2        # placed through the Agent Wallet
mm ninety collect            # winnings back to the wallet
mm ninety back Tempo 5       # or earn the market makers' margin
```

Every write is calldata handed to the Agent Wallet's executor. MetaMask simulates it, scans it,
applies the wallet's Guard Mode policy (allowlists, outflow limit, 2FA) and signs it; the plugin
never touches a key. Bets carry their exact payout as the contract's minimum, so they land at the
price shown or not at all. Getting it running on Monad testnet took working around two gaps in
Agent Wallet 7.0 there: its default RPC gateway rejects chain 10143, and its jobs stop at
`BROADCASTED`. The [plugin's README](packages/mm-plugin/README.md) explains both, and lists the
transactions from a full run.

## Deployed addresses

Monad testnet (chain ID **10143**). Deployed at block
[66,448,317](https://testnet.monadexplorer.com/block/66448317) via `contracts/script/Deploy.s.sol`, which in one run deploys
the token and the four core contracts, wires them together, and registers and seeds the three house
agents, for a total cost of **2.353 MON**. This deployment moved the app onto **nUSD**, our own
test stablecoin (see Known limitations for why); the earlier AUSD-based addresses are superseded
and listed in [`deployments/10143.json`](deployments/10143.json), which also holds every
transaction hash and the verified on-chain wiring.

| Contract | Address |
|---|---|
| `NinetyUSD` | [`0x85fe9D32c8B5c02639767399D7DCA585042ea57b`](https://testnet.monadexplorer.com/address/0x85fe9D32c8B5c02639767399D7DCA585042ea57b) |
| `AgentRegistry` | [`0xdbE23698776e12A7e1bf5FFBe5054d6919BcA8df`](https://testnet.monadexplorer.com/address/0xdbE23698776e12A7e1bf5FFBe5054d6919BcA8df) |
| `MarketManager` | [`0x7CB80d9De72273db78e013Fdb2180023A9152b88`](https://testnet.monadexplorer.com/address/0x7CB80d9De72273db78e013Fdb2180023A9152b88) |
| `BetRouter` | [`0xd368165544A427d1d42FCF53846fA84c37cBB387`](https://testnet.monadexplorer.com/address/0xd368165544A427d1d42FCF53846fA84c37cBB387) |
| `SettlementReceiver` | [`0xc00496c616EaA9f4B7fC59F68D0B461AFF16D5d9`](https://testnet.monadexplorer.com/address/0xc00496c616EaA9f4B7fC59F68D0B461AFF16D5d9) |
| `AgentMemory` | [`0xB07D8e5B822F0d885BcDEebE3Dceb2166FF5D85c`](https://testnet.monadexplorer.com/address/0xB07D8e5B822F0d885BcDEebE3Dceb2166FF5D85c) (added 29 Sep, `DeployAgentMemory.s.sol`) |
| `OddsLock` | [`0xee2F9187af4266190C0F44CDbf8BA67650A2b072`](https://testnet.monadexplorer.com/address/0xee2F9187af4266190C0F44CDbf8BA67650A2b072) (added 1 Oct, `DeployOddsLock.s.sol`, 0.159 MON) |

All seven contracts above, plus all three house-agent `AgentVault`s, are **source-verified** via
Monad's Sourcify-compatible verifier (`forge verify-contract --verifier sourcify --verifier-url
https://sourcify-api-monad.blockvision.org/verify`, `partial` match status — full match isn't
attainable since `foundry.toml` strips the metadata hash via `bytecode_hash = "none"`). Confirmed
directly: each submission returned `HTTP 200` with `"status":"partial"`, and the source is
retrievable back from the verifier at
`https://sourcify-api-monad.blockvision.org/files/any/10143/<address>`.

House agents, registered and seeded with **10,000 nUSD each** by the same deploy script:

| Agent | Vault |
|---|---|
| Steady (agent 1) | [`0xd17f402Ee0133F291b5D5473dC534f0416A639D2`](https://testnet.monadexplorer.com/address/0xd17f402Ee0133F291b5D5473dC534f0416A639D2) |
| Tempo (agent 2) | [`0xfEB5c0199EaA87fC8350F56795445D4888c97379`](https://testnet.monadexplorer.com/address/0xfEB5c0199EaA87fC8350F56795445D4888c97379) |
| Pulse (agent 3) | [`0xB83718bcDf63E781CDBb1d73F9Df943aF8C1E304`](https://testnet.monadexplorer.com/address/0xB83718bcDf63E781CDBb1d73F9Df943aF8C1E304) |

Each house agent's `strategyBlob` is plaintext JSON of its public parameters (margin, max stake per
quote): the operator for all three is a plain `.env` deployer key, not a passkey-derived account, so
there's no passkey to encrypt it under. The Many Keys encryption path itself is built and verified
live (see [`docs/many-keys.md`](docs/many-keys.md)) via `web/app/dev/page.tsx`, which any
passkey-signed-in operator can use to register their *own* agent with an encrypted strategy.

External contracts used:

| Contract | Address | Notes |
|---|---|---|
| Chainlink `KeystoneForwarder` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | Production CRE forwarder |

Sample transactions (contract creation, this deployment):

| Contract | Tx hash |
|---|---|
| `NinetyUSD` | [`0x9e3ea9e6…0f89ec`](https://testnet.monadexplorer.com/tx/0x9e3ea9e656ec9faad9b44772c3c7729c2ae02e6822ef4cf39b7f4a98e10f89ec) |
| `AgentRegistry` | [`0xec28062f…e7ef17`](https://testnet.monadexplorer.com/tx/0xec28062faf29415f2007dd7a830cebf0a7826e0e15f9e79afc0cb5c898e7ef17) |
| `MarketManager` | [`0x67b7deb6…26f64a`](https://testnet.monadexplorer.com/tx/0x67b7deb6892c75f6108cd8bbe6da07bcd1c67a131ba16c48694cb9d17226f64a) |
| `BetRouter` | [`0x098d5a53…19283b`](https://testnet.monadexplorer.com/tx/0x098d5a532cd3d2fdfc97db06e33342a17da4a0a242b06a6d8bcd7032c819283b) |
| `SettlementReceiver` | [`0xf4d621f8…ddaa24`](https://testnet.monadexplorer.com/tx/0xf4d621f88b0562364d7127c2eb52c89ccb8fee056399b85414d272a7d9ddaa24) |

All 23 transactions from the deploy (5 creations, 7 role/template wiring calls, and the mint,
3 registrations, 3 approvals and 3 seed deposits for the house agents) are listed in
[`deployments/10143.json`](deployments/10143.json).

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

**Settlement runs on its own.** Until Chainlink grants deploy access, `simulate` is one-shot (one
tx hash per run), so [`cre/watcher/settlement-watcher.ts`](cre/watcher/settlement-watcher.ts)
stands in for the deployed workflow's log trigger. It watches for `MarketClosed`, runs the workflow
for each close, and then calls `BetRouter.settleBatch` for that market's bets. That last step is
what makes payouts claimable and moves each agent's vault P&L; `settleBatch` is permissionless and
pull-based by design, so something has to call it. The watcher never decides an outcome: every
resolution still comes from the workflow's own fetch, consensus and signed report. Verified live
on 28 Sep 2026: market 1 closed, resolved `No` via CRE, and its three bets settled `Lost`, moving
+5 / +3 / +2 nUSD into the Pulse / Tempo / Steady vaults and releasing their locked liability.
A market nobody bet on (zero exposure across every vault) is closed but deliberately never
resolved: it holds no money and no bets, so a CRE run for it would only spend gas. Such markets
stay `Closed` for good and appear nowhere in the app.

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
satisfy.

The **agent leaderboard** (`web/app/agents/page.tsx`, `web/hooks/useAgentStats.ts`) is the other
core consumer, and the one that carries the "agents make money" proof: agents are ranked by
realised P&L, and each card shows volume priced, share of volume kept after paying winners, win
rate, max drawdown and a cumulative-P&L curve. All of it comes from `Agent` counters and
`VaultSnapshot` history -- none of it is reconstructible from the chain directly, since the public
RPC only serves the last 100 blocks of logs. The browser reaches the indexer through the app's own
read-only `/api/indexer` proxy (queries only; mutations are rejected), so these screens work from a
phone or any other device, not just the machine running the indexer.

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
pnpm --filter @ninety/match-data dev   # replay service: REST + WS on :8082 (not :8080 -- that's
                                        # taken by the indexer's Hasura container if it's running)
pnpm --filter @ninety/quote-relay dev  # quote aggregation: WS on :8081
pnpm --filter @ninety/agents dev       # Steady, Tempo, Pulse quoting live
cd web && pnpm dev                     # the app itself, on :3000
cd cre/watcher && bun install && bun run start   # settles closed markets via CRE, then their bets
```

My Bets, the Agents leaderboard's track records and the settlement watcher additionally need the
indexer running (see [§Indexer](#indexer) for the one-time `envio local docker up` setup) with
`NEXT_PUBLIC_INDEXER_URL` pointed at it (the web server proxies to it, so only the server needs to
reach it); every other screen (match, bet slip, vault deposit/withdraw, Dev) reads straight from the
chain and works without it, and the leaderboard falls back to on-chain TVL ranking. WebAuthn
needs a secure context, so testing sign-in from a phone means the app has to be served over HTTPS
or `localhost` exactly -- a plain LAN IP over HTTP will not show a passkey prompt at all.

## Simulator results

Full writeup, including what the numbers don't prove, is in
[`docs/simulator-results.md`](docs/simulator-results.md). Run it yourself with `pnpm simulate`
(`packages/simulator`) -- every number below is pasted from that command's own output.

The agents in the simulator behave as they do live: every bet meets the price as it stands when it
arrives, over **what's left of the market's window**; a market isn't quoted once decided; quotes pause
around big moments; and every 10 match-minutes each agent **learns from its settled bets** (the same
rule an operator's agent uses), widening its margin on market types it's losing on.

**Against casual and sharp bettors together** (20-seed mean, 3 matches), where sharp bettors have a
faster-reacting model than any house agent: Steady **+75.65 nUSD** (positive in 17/20 seeds), Tempo
**+25.57** (11/20), Pulse -27.79 (10/20). The first version of the agents, which priced every market
once over its whole window, lost to the same sharps across the board: -85.18 / -97.89 / -206.01. Pricing
only the time left was a real bug fix in the live agents too. Pulse, quoting at the legal margin floor,
is the one that still roughly breaks even rather than profits: "aggressive" has a measured cost.

**Snipers** (bettors who see an event before the feed): the 8s bet-delay rule voids bets struck just
before the event, and the pause pulls every quote from 14s before one that would decide a market, so a
sniper 12s ahead -- past the delay rule on its own -- gets no bet at all, at no gas cost. One a full 15s
ahead gets past both and takes **27,098 nUSD**: the design assumes no bettor is more than ~14s ahead of
the feed, and this is what that assumption is worth.

**Odds Lock** (agents selling price holds): against fans who use every hold as well as anyone could,
every agent nets **+1.0% to +2.6%** of the stake held, at both the live (30s) and replay (50s) hold
lengths. The fee prices what the hold gives away; the agent keeps the rest.

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
- **Test stablecoin, not a real one.** Fans bet and vaults hold **nUSD** (`NinetyUSD`), our own
  6-decimal test token with a built-in faucet (`claim()` mints 1,000 nUSD per address per hour).
  We started on Agora's testnet AUSD, but its shared faucet ran dry mid-hackathon
  (`InsufficientFunds()` for every address, its own balance at ~0 by 26 Sep), and Circle's testnet
  USDC is only claimable through a captcha-gated web page, 20 at a time -- either way a fan or judge
  could open the app and have nothing to bet with. Nothing in the contracts is specific to nUSD: the
  vaults and router take the asset as a constructor argument, so production would point them at USDC
  or AUSD with no code change.

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
