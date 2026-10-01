---
name: ninety
description: Bet on live football micro-markets ("Corner in the next 3 min?") on Monad with the MetaMask Agent Wallet, collect winnings, and back the AI market makers that price them. Use when the user wants to bet on a live match, see live in-play odds, check or collect Ninety bets, or earn by backing a Ninety market maker. Requires the ninety-mm-plugin for the mm CLI.
---

# Ninety: live football micro-markets from the Agent Wallet

Ninety turns every couple of minutes of a football match into a quick YES/NO market, such as
"Shot on target in the next 2 min?". Competing AI market makers price each market. Bets settle
onchain on Monad testnet within minutes of the window closing. Stakes are in **nUSD**, Ninety's
test stablecoin, which is free from the faucet.

Every transaction goes through the Agent Wallet (`ctx.walletExecutor`), so MetaMask simulates it,
scans it and applies the wallet's policy. This skill never handles keys.

## When to use it

- "Bet 5 on a corner in the next few minutes", "what are the odds on a goal right now?"
- "How are my bets doing?", "collect my winnings"
- "Put 100 behind the best Ninety market maker", "take my money out of Tempo"

## Before the first bet

1. `mm doctor` must show `authenticated: true` and `initialized: true` (otherwise `mm login`,
   then `mm init`).
2. Once per machine, run
   `node ~/.local/share/mm/node_modules/ninety-mm-plugin/scripts/add-monad-testnet.mjs`. Agent
   Wallet's default RPC gateway rejects Monad testnet (`Invalid chainId`), and this points it at
   Monad's RPC. Signing and policy are unchanged.
3. `mm ninety faucet` gives free nUSD, plus a little testnet MON for gas if the wallet is low.
4. Server wallet in **Guard Mode**: allowlist Monad testnet (chain `10143`) and Ninety's contracts
   in the wallet policy (`mm wallet policy get` / `mm wallet policy set`):
   - bet router `0xd368165544A427d1d42FCF53846fA84c37cBB387`
   - nUSD `0x85fe9D32c8B5c02639767399D7DCA585042ea57b`
   - each market-maker vault you back (the `vault` from `mm ninety agents --json`)

   Otherwise each bet waits for 2FA, and the prices it was sent at, which live about 5 seconds,
   expire first.

## Commands

| Command | Does |
| --- | --- |
| `mm ninety matches` | Matches on offer, and which is live |
| `mm ninety markets [--match <id>]` | Open markets with the best YES/NO odds and seconds left. With `--match` it starts that match |
| `mm ninety quote <marketId> <yes\|no> <nUSD>` | The exact odds and payout for that stake, without betting |
| `mm ninety bet <marketId> <yes\|no> <nUSD> [--min-odds <x>]` | Places a bet split across the best three prices; it lands at the shown payout or not at all |
| `mm ninety bets` | Balance, recent bets, and winnings waiting to be collected |
| `mm ninety collect` | Collects settled winnings and refunds in one transaction |
| `mm ninety faucet` | Free test nUSD (and gas) |
| `mm ninety agents` | Market makers: vault size, return to backers, your stake |
| `mm ninety back <name> <nUSD>` | Deposits into a market maker's vault, to earn its margin |
| `mm ninety withdraw <name> <nUSD\|all>` | Withdraws from a vault |

Add `--json` for machine-readable output.

## How to use it well

- **Always run `mm ninety markets` right before betting.** Markets last 20 to 60 seconds of real
  time, and the ids change as new ones open. Don't bet on a market with `closesInSec` under about 8.
- **Confirm with the user before `bet`, `back` and `withdraw`.** For a bet, run `quote` first and
  tell the user the market, the side, the stake, the odds and the payout. `markets` shows the best
  single price, but a bet is split across the top three, so its odds come out a little lower.
  Pass the quoted odds, rounded down a little, as `--min-odds`, so the bet never fills worse than
  what the user agreed to. After betting, report the odds and payout that `bet` returns.
- **"pricing…"** (a null `yes`/`no` in JSON) means the market just opened or is paused around a big
  moment. Wait a few seconds and run `markets` again; don't bet.
- **YES** means the event happens in the window; **NO** means it doesn't. Odds are decimal: 2.10x
  on 5 nUSD pays 10.50 nUSD back, stake included.
- **Bets settle a minute or two after their market closes.** Then run `mm ninety collect`.
  `mm ninety bets` shows what's waiting.
- **Backing has a cooldown.** A deposit locks the whole stake in that vault for its cooldown (shown
  after `back`). A vault can also be fully committed to open bets for a few minutes.

## Errors

| Code | Meaning, and what to do |
| --- | --- |
| `NINETY_NO_LIVE_MATCH` | Nothing is playing. `mm ninety markets --match <id>` starts one |
| `NINETY_NO_PRICES` | The market closed, or is paused. Re-run `markets` |
| `NINETY_STAKE_TOO_BIG` | The market makers can't take that much right now. Bet less |
| `NINETY_ODDS_TOO_LOW` | The best price is below `--min-odds` |
| `NINETY_INSUFFICIENT_NUSD` | Run `mm ninety faucet` |
| `NINETY_TX_FAILED` | The wallet refused, or the transaction reverted. Nothing was charged for a bet that didn't land. Re-run `markets` and try again |
| `NINETY_UNREACHABLE` | Set `NINETY_URL` to the Ninety app's address |
| `NINETY_WITHDRAW_LOCKED` | Cooldown, or capital tied up in open bets. Try later |

An `AWAITING_MFA` status means the wallet wants the owner's approval (email or MetaMask Mobile).
Tell the user, and suggest the Guard Mode allowlist above.
