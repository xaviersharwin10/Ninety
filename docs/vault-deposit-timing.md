# Vault deposit-timing: why `AgentVault` has a withdrawal cooldown

`BetRouter` has `DELAY_SECONDS`, voiding a bet placed too close to the event it bets on. Nothing
symmetric existed for `AgentVault` deposits until this fix, and the gap was real, not theoretical.

## The finding

`AgentVault.totalAssets()` is a plain ERC-4626 balance read. It is unchanged while a bet is
pending — `lockLiability` only touches `lockedLiability` and `marketExposure`, never moves tokens
— and only actually moves at settlement, when the full stake or liability crosses in or out via
`settleAgentWon`/`settleAgentLost`. Share price is flat for the whole pending window, then jumps.

That jump is the entire stake or liability, not the agent's ~3-4% margin: margin is only the
long-run expected edge, but any *individual* settlement moves the full amount. A depositor who
buys in during the flat window, holds through the jump, and exits right after captures a pro-rata
share of a value change they were never at risk for — at the expense of backers who carried that
specific bet's risk for its whole pending life.

**No privileged information is required.** `MarketManager.resolve()` and `BetRouter.settleBatch()`
are always separate transactions (deliberately — `resolve()` is a pull path so gas billed on
Monad's `gas_limit` model never scales with how many bets are pending on a market). Anyone
watching for `MarketResolved` can deposit in the gap and exit once `settleBatch` lands. A version
of the attack armed with live match knowledge ahead of even `resolve()` is worse still.

## What does *not* close this gap

- `maxWithdraw`/`maxRedeem`'s existing cap at `freeCapital()` (`totalAssets - lockedLiability`)
  defends the *mirror* case — an existing backer fleeing a loss that is *still* pending, whose
  capital is still locked. It does nothing for a *new* depositor exiting *after* a bet's liability
  has already been released.
- Nothing in `AgentRegistry` is relevant; it only ever gates agent/signer/strategy bookkeeping.

## The fix

`AgentVault` now takes `withdrawalCooldownSeconds_` at construction (set by `AgentRegistry` via
`DEFAULT_WITHDRAWAL_COOLDOWN_SECONDS`, 15 minutes in both `Deploy.s.sol` and `TestDeploy.s.sol`).
Every deposit stamps `lastDepositAt[receiver] = block.timestamp`; `maxWithdraw`/`maxRedeem` return
`0` until that cooldown has elapsed, on top of the existing `freeCapital` cap.

This does not prevent capturing the one targeted settlement's move — nothing at the vault level
can, short of pricing pending risk into `totalAssets()` itself, a materially larger change. What it
does: forces that capital to also sit exposed, unavoidably, to every other market this vault
settles during the cooldown. CORE markets resolve every 1-5 minutes with several concurrent per
match, so 15 minutes spans multiple independent, unrelated settlements. An attacker's one
deterministic edge is diluted by holding-period risk on outcomes they have no information
advantage over; a real backer's ordinary deposit/withdraw cadence is essentially unaffected.

The cooldown resets on the *whole* position on every deposit, not just the incremental amount —
coarser than per-deposit-lot accounting, but shares are fungible per owner and this stays cheap and
simple to reason about. A backer topping up right before wanting to exit re-locks their existing
balance too; that is the accepted tradeoff.

## Provenance

Found during an adversarial review pass (2026-09-23) modeled on the anti-sniping pattern already
in `BetRouter`, independently re-verified by a second, skeptical pass before being reported —
confirmed via a concrete state trace, not restated as a generic DeFi truism. Reproduced directly in
`contracts/test/AgentVaultCooldown.t.sol::test_exploitScenario_depositBeforeFavourableSettlementCannotImmediatelyExit`,
which deposits into a vault with a bet already pending, settles it favourably, and asserts the
immediate exit reverts.

## Known residual limitation

A sufficiently patient, well-capitalized attacker who is confident the *entire* cooldown window
will net favourably (not just their one targeted settlement) is not fully stopped — this is a
mitigation, not a cryptographic guarantee, the same honest framing already used for
`docs/cre-forwarder-trust-model.md`. Closing it completely would mean pricing pending liabilities
into `totalAssets()` at lock time (e.g. marking each locked liability at the agent's own quoted
probability), which is a real design direction if this becomes a production system, not a
hackathon-scope change.
