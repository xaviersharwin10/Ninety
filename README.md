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
| Best Mera-Powered UX on Monad | Monad Foundation | <!-- TODO --> |
| Mera: One Passkey, Many Keys | Monad Foundation | <!-- TODO --> |
| Best workflow with CRE | Chainlink | <!-- TODO --> |
| Best Use of Envio | Envio | <!-- TODO --> |

## Architecture

<!-- TODO: diagram + component walkthrough -->

| Component | Path | Role |
|---|---|---|
| Contracts | `contracts/` | `AgentRegistry`, `AgentVault`, `MarketManager`, `BetRouter`, `SettlementReceiver` |
| Match data | `packages/match-data/` | Replays a historical match on a clock; REST + WebSocket |
| Agents | `packages/agents/` | Three house agents quoting signed EIP-712 prices |
| Quote relay | `packages/quote-relay/` | Stateless aggregation of the best quotes (untrusted; the contract re-verifies) |
| Simulator | `packages/simulator/` | Offline pressure test with casual / sharp / sniper bettors |
| CRE workflow | `cre/` | Chainlink settlement workflow writing reports onchain |
| Indexer | `indexer/` | Envio HyperIndex powering the leaderboard, vault stats and bet history |
| Web app | `web/` | Next.js, phone-first, Mera passkey as the entire account layer |

## Why Monad

<!-- TODO: expand before submission -->

- Markets open and settle every couple of minutes with many small bets each, so the product needs **fast
  finality and cheap transactions** to feel live rather than laggy.
- Every bet verifies up to three EIP-712 agent signatures and locks liability across three separate vaults
  in one transaction. That per-bet onchain work is impractical on most L1s.
- Monad raises the **contract size limit to 128 KB** (from 24 KB), so the market logic stays in readable,
  auditable contracts instead of being split across proxies and libraries.
- Fully onchain settlement means the odds are not a black box: anyone can replay how each market was priced.

## Deployed addresses

Monad testnet (chain ID **10143**). Deployed at block
[64,950,468](https://testnet.monadexplorer.com/block/64950468) via `contracts/script/Deploy.s.sol`
for a total cost of **1.283 MON**. The full record, including every transaction hash and the
verified on-chain wiring, is in [`deployments/10143.json`](deployments/10143.json).

| Contract | Address | Explorer |
|---|---|---|
| `AgentRegistry` | [`0xB7Acd19edDB49f38e3671F93c5D3549D2506aA63`](https://testnet.monadexplorer.com/address/0xB7Acd19edDB49f38e3671F93c5D3549D2506aA63) | |
| `MarketManager` | [`0x762b6DeB99e5f665D252e7666b2473f072636985`](https://testnet.monadexplorer.com/address/0x762b6DeB99e5f665D252e7666b2473f072636985) | |
| `BetRouter` | [`0x93cEA386bC4C65563fBa9AC2e7D2dd3602D06A77`](https://testnet.monadexplorer.com/address/0x93cEA386bC4C65563fBa9AC2e7D2dd3602D06A77) | |
| `SettlementReceiver` | [`0xB21D5bcF36e1380d88A4c087AC4F58c67f34B068`](https://testnet.monadexplorer.com/address/0xB21D5bcF36e1380d88A4c087AC4F58c67f34B068) | |

Verified directly against the live network after deploy: `AgentRegistry.betRouter()` points at
`BetRouter`; `MarketManager` has granted `SETTLER_ROLE` to `SettlementReceiver`;
`SettlementReceiver.PRODUCTION_FORWARDER()` is the real Chainlink forwarder and is allowed; the
simulation forwarder is allowlisted but **disabled** (`simEnabled == false`), matching the
off-by-default design in [`docs/cre-forwarder-trust-model.md`](docs/cre-forwarder-trust-model.md);
and all four CORE market templates are enabled.

Agent vaults are deployed at runtime by `AgentRegistry.register`, one per agent, so their
addresses aren't fixed at deploy time; the three house agents' vault addresses will be added here
once they're registered.

External contracts used:

| Contract | Address | Notes |
|---|---|---|
| AUSD (Agora) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 6 decimals. Verified on-chain. |
| AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` | `requestFunds(address)` |
| Chainlink `KeystoneForwarder` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | Production CRE forwarder |

Sample transactions (contract creation, this deployment):

| Contract | Tx hash |
|---|---|
| `AgentRegistry` | [`0xe5cd7a1c…d24275`](https://testnet.monadexplorer.com/tx/0xe5cd7a1c8b82c43404f8fa647e84a89b16c9502c95a8b908e9b1270830d24275) |
| `MarketManager` | [`0x961ded6e…8d83960`](https://testnet.monadexplorer.com/tx/0x961ded6e5f89e18bfc4223e1a97de55c32ea96483313de1891bccf2168d83960) |
| `BetRouter` | [`0xd47970ee…984f7`](https://testnet.monadexplorer.com/tx/0xd47970ee0cb3b3beb02444c39197ef80fd7a0c9bec405d2120dc3281392984f7) |
| `SettlementReceiver` | [`0x1beae65a…faadd08d`](https://testnet.monadexplorer.com/tx/0x1beae65ae9dfd7f771cd17f753744a42221eb77a2bf644d38c5f799ffaadd08d) |

All eleven transactions from the deploy (4 creations + 7 role/template wiring calls) are listed
with exact gas figures in [`deployments/10143.json`](deployments/10143.json).

## Running locally

<!-- TODO: fill in as each package lands -->

```bash
cp .env.example .env     # then fill in the blanks
pnpm install
cd contracts && forge test
```

## Simulator results

<!-- TODO: results table + charts. Report the numbers the simulator actually produces,
     including the assumed sharp-bettor edge, and the cases where agents lose money. -->

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
