# Ninety Settlement Workflow

A Chainlink CRE workflow that settles Ninety's live in-match micro-markets on Monad testnet. It
replaces a trusted backend with a DON-executed pipeline: **EVM log trigger → HTTP fetch (BFT
consensus) → signed report write onchain**, driven by `MarketManager` and `SettlementReceiver`
(see `contracts/` at the repo root for the full Solidity source — this project only holds the
workflow and its generated TypeScript bindings to those already-deployed contracts).

Scaffolded from Chainlink's `sports-resolution-ts` template (same architecture: log trigger → HTTP
→ consensus → signed write), then adapted end-to-end for Ninety's own contracts, market templates,
and match-data service rather than the template's own `SportsMarket.sol` example contract, which
this project does not use or deploy.

## Architecture

```
MarketManager.close(marketId) on Monad testnet
                    │
                    ▼ EVM Log Trigger (MarketClosed)
        ┌────────────────────────────────────┐
        │        CRE Workflow (WASM)          │
        │                                     │
        │  1. getMarket(marketId) — guard:    │
        │     skip unless state == Closed     │
        │                                     │
        │  2. GET match-data /settlement      │  ← BFT-verified: every DON node fetches the
        │     ?template&windowStart&windowEnd │    same URL; ConsensusAggregationByFields
        │                                     │    requires an identical response before the
        │                                     │    callback ever sees it
        │                                     │
        │  3. Build SettlementReport, sign    │
        │     it for the simulation forwarder │
        │     path (see the trust-model doc)  │
        │                                     │
        │  4. runtime.report() + writeReport  │  ← DON-signed report; forwarder verifies before
        │     → SettlementReceiver.onReport   │    calling onReport
        └────────────────────────────────────┘
                    │
                    ▼
     MarketManager.resolve(marketId, outcome, qualifyingEventTs)
```

Unlike the upstream template (which resolves a market on a single `requestSettlement` call with
2-3 third-party sports APIs), this workflow:

- Triggers on `MarketManager`'s own `MarketClosed(marketId)` event, not a purpose-built "please
  settle me" event — no contract changes were needed to wire CRE in.
- Fetches from **our own match-data replay service**, not third-party APIs. CRE's BFT consensus
  still protects against a single tampered DON response, but not against the service itself being
  wrong — an honest, documented limitation (see `resolveMarket`'s doc comment in
  `packages/core/src/resolution.ts`), and one that applies equally to a licensed provider standing
  in for it later.
- Writes a `SettlementReport` shaped for `SettlementReceiver.onReport`, not a two-field
  `(gameId, outcome)` tuple — see `contracts/src/interfaces/ISettlementReceiver.sol` at the repo
  root.

## Why the report carries a second signature

While Chainlink deploy access for the production `WorkflowRegistry` (on Ethereum mainnet) is
pending, this workflow writes through the **simulation forwarder** —
`cre workflow simulate --broadcast`'s `MockKeystoneForwarder`, which performs *no* signature
verification of its own. `SettlementReceiver` compensates by requiring an independent ECDSA
signature over the report from a key it trusts (`simAttestor`) whenever a report arrives through
that specific forwarder; the production forwarder path ignores this signature entirely. Full
reasoning, measurements against both forwarders on Monad testnet, and the one-way
`lockProduction()` escape hatch are in `docs/cre-forwarder-trust-model.md` at the repo root.

That second signature is the one thing this workflow needs beyond what the upstream template
required: `workflow.ts` signs the report locally (via `@noble/curves`, synchronously — see the
comment on `signDigest`) with a private key read through CRE's own secrets mechanism
(`runtime.getSecret`), declared in `../secrets.yaml` and backed locally by `CRE_SECRET_SIM_ATTESTOR_PRIVATE_KEY`
in `.env` (gitignored). Nothing about this is CRE-specific config trivia to reproduce blindly —
it's the direct consequence of the trust-model tradeoff above.

## Project structure

```
cre/
├── project.yaml              # RPCs (monad-testnet + template defaults)
├── secrets.yaml              # Declares SIM_ATTESTOR_PRIVATE_KEY, backed by a local env var
├── .env                      # gitignored: CRE_ETH_PRIVATE_KEY, CRE_SECRET_SIM_ATTESTOR_PRIVATE_KEY
├── contracts/
│   ├── abi/index.ts          # re-exports the generated MarketManager/SettlementReceiver bindings
│   └── evm/ts/generated/     # `cre generate-bindings evm` output against the repo's Foundry ABIs
└── ninety-settlement/        # the workflow itself
    ├── main.ts                # Runner entrypoint (unchanged from the template)
    ├── workflow.ts             # trigger → guard read → fetch → sign → write
    ├── workflow.{config,fetch,settlement}.test.ts, workflow.test.ts
    ├── workflow.yaml           # staging/production target settings
    ├── config.staging.json     # points at the live Monad testnet deployment + match-data service
    └── config.production.json
```

## Prerequisites

- [Bun](https://bun.sh/) ≥ 1.2.21
- [CRE CLI](https://docs.chain.link/cre), logged in (`cre login`)
- The repo root's `contracts/` deployed to Monad testnet (see `deployments/10143.json`) and
  `packages/match-data`'s replay service running locally (or wherever `matchDataBaseUrl` points)

## Configure

`ninety-settlement/config.staging.json`:

```json
{
  "evms": [{
    "chainSelectorName": "monad-testnet",
    "marketManagerAddress": "0x22D999156f35Ba81dC865AF6EA042fC185a13347",
    "settlementReceiverAddress": "0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8",
    "gasLimit": "800000"
  }],
  "matchDataBaseUrl": "http://localhost:8082",
  "matchDatasetIds": { "2": "1694390" }
}
```

`matchDatasetIds` maps an **on-chain** `matchId` (as a JSON string key) to the match-data
service's own match id — the two are deliberately decoupled (see the match-data server's
`/settlement` route comment), so this is the one place that ties a running match back to its
on-chain identity. Add an entry here for every match you create via `MarketManager.createMatch`
before its markets can settle.

## Test

```bash
cd contracts && bun install && cd ..
cd ninety-settlement && bun install && bun test && bun run typecheck && cd ..
```

## Simulate

Call `MarketManager.close(marketId)` on Monad testnet (directly, or let it happen naturally once a
market's `closesAt` passes and the scheduler calls it) to get a real `MarketClosed` transaction,
then:

```bash
cre workflow simulate ninety-settlement --target staging-settings \
  --non-interactive --trigger-index 0 \
  --evm-tx-hash 0xTX_THAT_EMITTED_MARKETCLOSED \
  --evm-event-index 0
```

Add `--broadcast` to actually submit the signed report through the simulation forwarder and
resolve the market on Monad testnet. This has been run end-to-end against the live deployment:
market 3 (`SHOT_ON_TARGET_NEXT_N`, match 2) was resolved to `Yes` with the correct
`qualifyingEventTs`, verified afterward via `getMarket`.

## Deploy

Once Chainlink grants deploy access (`cre account access`), the same workflow runs against the
production `KeystoneForwarder` with no code changes — `evms[0]` already points at the live
contracts, and `SettlementReceiver`'s production-forwarder path ignores the simulation signature
entirely. `lockProduction()` then permanently retires the simulation path and the attestor key.

## What's not included

- **No third-party sports API integration.** The upstream template's ESPN/SportsDataIO/Sportradar
  examples don't apply — this workflow's one data source is the repo's own match-data service.
- **No market-scheduling logic.** Opening markets on a cadence is the scheduler's job (see
  `web/lib/server/scheduler.ts` at the repo root), not this workflow's.
