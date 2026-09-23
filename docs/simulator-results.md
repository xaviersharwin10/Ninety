# Simulator results

Monad DevRel's explicit ask (CLAUDE.md §5.2) was to spend most of the project's effort pressure-testing
whether house agents can actually make money, before spending any time on a dev marketplace. This is that
pressure test: `packages/simulator` replays the three vendored Wyscout fixtures
(`packages/match-data/fixtures/`, CC BY 4.0, see `docs/wyscout-fixtures.md`) through the exact same pricing
code (`@ninety/core`'s `pricing.ts`/`oddsMath.ts`) and vault state machine (`AgentVault.sol`, mirrored
exactly in `packages/simulator/src/vault.ts`) the live system uses, against three bettor populations, and
reports what actually happens -- not what we'd like to happen.

Run it yourself: `pnpm simulate`. Every number below is pasted from that command's
output, unedited.

## Setup

- **Agents:** Steady (300bps margin, base-rate-only), Tempo (250bps, 5-minute pressure lookback), Pulse
  (200bps -- `BetRouter.MIN_MARGIN_BPS`, the legal floor -- 90-second lookback). Each starts every match
  with its own fresh 5,000 AUSD vault, `maxMarketExposureBps=3000` (30% per market), matching `Deploy.s.sol`.
- **Markets:** the platform-side scheduler (`scheduler.ts`) opens a market every 120 match-seconds, up to 4
  concurrent, rotating through all four CORE templates -- ~46 markets per 90-minute match.
- **Casual + Sharp scenarios run across 20 RNG seeds** and report the mean, because a single ~80-bet match
  has real variance; citing one lucky or unlucky seed would be misleading. Sniper scenarios are
  deterministic (see the note in `cli.ts`) and don't need seeds.
- **A real, stated limitation:** quotes are priced once per market at open, not continuously re-quoted the
  way `AgentRunner` does live (see the doc comment on `priceMarket` in `engine.ts`). This keeps the engine's
  timeline simple enough to audit; it also means a house agent here never reacts to something happening
  mid-window the way a live agent re-quoting every ~3 seconds would. Treat these numbers as a lower bound on
  how well-defended the live system is, not an exact prediction of it.

## Casual bettors only

Mean total P&L across all 3 matches, averaged over 20 seeds:

| Agent | Mean P&L (AUSD) | Mean ROI | Positive seeds | Min | Max |
|---|---:|---:|---:|---:|---:|
| Steady | 90.39 | 0.60% | 20/20 | 3.06 | 194.52 |
| Tempo | 92.51 | 0.62% | 20/20 | 13.92 | 255.54 |
| Pulse | 106.49 | 0.71% | 17/20 | -60.44 | 381.12 |

Against ordinary retail-shaped flow (small stakes, a slight bias toward whichever side the market currently
models as more likely), all three agents are profitable in the large majority of seeds. This is the case
CLAUDE.md's rough unit-economics estimate (§6.6) was gesturing at, now actually measured rather than
sketched: margin does turn into real, positive vault P&L, most of the time, under ordinary flow.

## Casual + Sharp bettors

| Agent | Mean P&L (AUSD) | Mean ROI | Positive seeds | Min | Max |
|---|---:|---:|---:|---:|---:|
| Steady | -70.74 | -0.47% | 4/20 | -195.08 | 141.80 |
| Tempo | -64.47 | -0.43% | 4/20 | -229.12 | 196.02 |
| Pulse | -173.54 | -1.16% | 2/20 | -521.63 | 35.06 |

Adding a sharp population -- a bettor with a faster-reacting pressure model than any house agent, plus the
ability to notice when a qualifying event has already happened earlier in a window a stale quote hasn't
repriced for (both public information, not inside knowledge; see `bettors.ts`'s doc comment for exactly what
"sharp" is allowed to know), **reverses the sign for all three agents.** This is not a bug: it is exactly the
dynamic CLAUDE.md's own integrity model anticipates in §6.7 -- *"Sharp bettors picking off bad prices ...
badly priced agents lose and drop out; good agents survive"* -- now actually demonstrated rather than
asserted, and quantified. Two findings worth being explicit about:

1. **The agents in this build don't yet do the "survive" half of that sentence.** Nothing here currently
   widens an agent's margin or shrinks its size in response to losing to sharp flow -- CLAUDE.md flags this
   as intended agent behaviour, not yet implemented. This is the single most concrete, evidence-backed item
   for what a house agent should do next.
2. **Pulse -- the "aggressive" agent, quoting at the legal margin floor -- is hit hardest**, both in mean P&L
   and in how rarely it stays positive (2/20 vs Steady and Tempo's 4/20). A tight margin has the least
   buffer to absorb being picked off, which is exactly the tradeoff "aggressive" is supposed to name; the
   simulator turns that from a design intention into a measured cost.

The honest reading: **agents make money against retail flow, and currently lose it back to informed flow,
in this specific parameter regime** (a 4%-edge-threshold sharp model, base rates that are deliberately
order-of-magnitude estimates rather than fit to these specific matches -- see `pricing.ts`'s own doc comment
on why fitting to the exact fixtures used for testing would be circular). That is a real, checkable claim
with a real, checkable number behind it, not a headline chosen to look good.

## Sniper: caught by the delay rule vs. evasive

| | Bets | Voided | Won (paid out) | Bettor net P&L (AUSD) |
|---|---:|---:|---:|---:|
| Caught (3s lead, inside `DELAY_SECONDS=8`) | 84 | 84 | 0 | 0.00 |
| Evasive (15s lead, outside `DELAY_SECONDS=8`) | 84 | 6 | 78 | 12,208.43 |

This is the delay rule's whole justification, made concrete. A sniper who reacts within the 8-second window
`BetRouter.DELAY_SECONDS` defends is voided on every single one of 84 attempted bets across all three
matches -- net effect exactly zero, for either side. The same sniper given a few more seconds of lead time
evades the rule almost entirely (6 of 84 still land inside it, by chance) and extracts **12,208 AUSD** from
the vaults with zero risk. `DELAY_SECONDS=8` is a judgment call, not a proof; this number is what's actually
at stake in that judgment call, not a guess at it.

## What this doesn't prove

- **Small sample.** Three matches, 20 seeds for the seeded scenarios. Real variance is visible in the
  min/max columns above; a production launch would want this run against far more matches before trusting
  the point estimates.
- **Fixed pricing per market**, not the live system's continuous re-quoting (stated above, repeated here
  because it's the simplification most likely to matter if these numbers are cited elsewhere).
- **No performance fee, no backer share accounting, no withdrawal cooldown** -- `SimVault` deliberately
  mirrors only the liability/settlement half of `AgentVault.sol`, since that's the half that determines
  whether an agent makes money at all. A backer's realised return would need the ERC-4626 share layer this
  simulator doesn't model; see the doc comment on `SimVault` for what's out of scope and why.
- **Sharp and Sniper are both parameterised choices**, not measured facts about real bettors. Change
  `SHARP_EDGE_THRESHOLD`, the lookback constants, or the sniper's `leadSec` and these numbers move. They are
  stated in full at the bottom of every `cli.ts` run specifically so a reader can judge the sensitivity
  themselves rather than take "sharp bettors are dangerous" on faith.
