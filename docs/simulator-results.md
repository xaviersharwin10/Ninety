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
  with its own fresh 5,000 nUSD vault, `maxMarketExposureBps=3000` (30% per market), matching `Deploy.s.sol`.
- **Markets:** the platform-side scheduler (`scheduler.ts`) opens a market every 120 match-seconds, up to 4
  concurrent, rotating through all four CORE templates -- ~46 markets per 90-minute match.
- **Agents behave as they do live** (`AgentRunner`, and an operator's in-browser agent):
  - every bet meets the book **as it stands when the bettor arrives**, priced over **what's left of the
    window**, from pressure observed up to that moment -- the live agents re-quote every 3-4s;
  - a market is **not quoted once its window is decided** (a qualifying event has already happened);
  - quotes are **pulled from 14s before to 3s after** an event that would decide the market (match-data's
    danger signal, the stand-in for a live feed's dangerous-attack state; read off the fixture here);
  - each quote's `maxStake` is **sized so its liability fits the vault's budget** at the quoted odds;
  - every 10 match-minutes each agent **learns from its settled bets** with `learn` (`@ninety/core`'s
    agent-memory, the same rule an operator's agent uses): a market type it lost on widens its margin by
    100bps (up to +500), one it won on tightens by 25bps. What it learns carries from match to match.
- **Casual + Sharp scenarios run across 20 RNG seeds** and report the mean, because a single ~80-bet match
  has real variance; citing one lucky or unlucky seed would be misleading. Sniper scenarios are
  deterministic (see the note in `cli.ts`) and don't need seeds.

## Casual bettors only

| Agent | Mean P&L (nUSD) | Mean ROI | Positive seeds | Min | Max |
|---|---:|---:|---:|---:|---:|
| Steady | 84.12 | 0.56% | 16/20 | -44.58 | 203.39 |
| Tempo | 66.50 | 0.44% | 14/20 | -111.97 | 302.82 |
| Pulse | -27.58 | -0.18% | 12/20 | -463.22 | 327.48 |

Steady and Tempo make money off ordinary retail-shaped flow (small stakes, a slight favourite bias) in most
seeds -- thinly, at under 1% per match. Pulse, quoting at the legal margin floor, roughly breaks even with a
slight loss on average and the widest spread of outcomes: at 200bps there is almost no buffer between its
model's errors and a loss.

## Casual + Sharp bettors

| Agent | Mean P&L (nUSD) | Mean ROI | Positive seeds | Min | Max |
|---|---:|---:|---:|---:|---:|
| Steady | 75.65 | 0.50% | 17/20 | -26.28 | 209.22 |
| Tempo | 25.57 | 0.17% | 11/20 | -142.10 | 154.59 |
| Pulse | -27.79 | -0.19% | 10/20 | -299.80 | 220.95 |

A sharp population -- a faster-reacting pressure model than any house agent, betting only above a 4-point
edge (see `bettors.ts` for exactly what it is allowed to know) -- no longer turns the agents' results
negative. Steady keeps almost all of its casual-flow profit and stays positive in 17 of 20 seeds; Tempo keeps
about 40% of it; Pulse is roughly where it was without sharps.

### What changed, and what each part did

An earlier version of this simulator, and of the live agents, priced every market once over its whole
window. Against the same sharp population that lost money for all three:

| Casual + Sharp, mean P&L | Priced once, whole window | Now |
|---|---:|---:|
| Steady | -85.18 (3/20 positive) | **+75.65 (17/20)** |
| Tempo | -97.89 (3/20) | **+25.57 (11/20)** |
| Pulse | -206.01 (1/20) | **-27.79 (10/20)** |

- **Pricing what's left of the window** did most of it. A whole-window price late in a window hands out a
  cheap NO (and an overpriced YES); sharp flow was mostly taking exactly that. This was a real bug in the live
  agents too, fixed in the same change: they priced the full window on every re-quote.
- **Not quoting a decided market** stops fans betting into a result that's already in: a NO after the corner
  has happened is a certain loss, a YES is voided by the delay rule.
- **Learning** moved each agent's margin on the market types it was losing on; its effect is smaller than the
  pricing fix but consistent, and it's what lets Pulse recover towards break-even over three matches rather
  than bleed.
- **Liability-sized quotes** don't move these numbers (normal-sized bets rarely hit the limit), but they
  close a live failure: `quotableBudget` is a liability budget, and offering it as a stake let a long-odds
  fill exceed the vault's per-market cap -- the bet reverted on chain, at the fan's gas cost.

## Sniper: how far ahead of the feed it has to be

| | Bets | Voided | Won (paid out) | Bettor net P&L (nUSD) |
|---|---:|---:|---:|---:|
| 3s ahead: inside the pause and DELAY_SECONDS=8 | 0 | 0 | 0 | 0.00 |
| 12s ahead: past the delay rule, inside the 14s pause | 0 | 0 | 0 | 0.00 |
| 15s ahead: past both | 87 | 0 | 87 | 27097.57 |

A sniper is a bettor who sees an event before the feed does. Two defences stack:

- **The bet-delay rule** (`BetRouter.DELAY_SECONDS=8`) voids any bet struck within 8s before the event that
  decided its market.
- **The pause** pulls every quote on a market from 14s before an event that would decide it. With no signed
  quote there is nothing to bet against, so a sniper 12s ahead -- past the delay rule on its own -- gets no bet
  at all. It costs no gas: it is simply the absence of a quote.

A sniper a full 15s ahead of the feed gets past both and extracts **27,098 nUSD** risk-free. That is the
honest boundary of the design: it assumes no bettor's information is more than ~14s fresher than the feed
the agents see. Widening the pause widens that assumption at the cost of more paused time for everyone;
the number above is what the current setting leaves on the table if the assumption is wrong.

## What this doesn't prove

- **Small sample.** Three matches, 20 seeds for the seeded scenarios. Real variance is visible in the
  min/max columns above; a production launch would want this run against far more matches before trusting
  the point estimates.
- **The pause is read off the fixture.** Live, match-data raises it from the feed as events approach; here
  the simulator knows exactly when each event lands, which a real dangerous-attack signal only approximates.
  The sniper rows are therefore the best case for the pause, not a measurement of a real feed.
- **No performance fee, no backer share accounting, no withdrawal cooldown** -- `SimVault` deliberately
  mirrors only the liability/settlement half of `AgentVault.sol`, since that's the half that determines
  whether an agent makes money at all. A backer's realised return would need the ERC-4626 share layer this
  simulator doesn't model; see the doc comment on `SimVault` for what's out of scope and why.
- **Sharp and Sniper are both parameterised choices**, not measured facts about real bettors. Change
  `SHARP_EDGE_THRESHOLD`, the lookback constants, or the sniper's `leadSec` and these numbers move. They are
  stated in full at the bottom of every `cli.ts` run specifically so a reader can judge the sensitivity
  themselves rather than take "sharp bettors are dangerous" on faith.
