# Ninety for MetaMask Agent Wallet

**Bet on live football micro-markets, and back the AI market makers that price them, from `mm`.**

[Ninety](https://github.com/xaviersharwin10/Ninety) turns every couple of minutes of a football match into a quick YES/NO
market, such as "Corner in the next 3 min?". Competing AI market makers price each market, and
bets settle onchain on Monad. This plugin gives the MetaMask Agent Wallet that market as a
trading superpower. An agent can:

- read the live markets;
- price a bet exactly;
- place the bet in one command;
- collect what it wins;
- move capital into the market makers' vaults to earn their margin.

```text
$ mm ninety markets
Switzerland vs Albania, 6'
#96  Card shown in the next 5 min?  YES 8.19x  NO 1.14x  (closes in ~45s)

$ mm ninety quote 96 no 2
2 nUSD on NO in #96: 1.04x, pays 2.08 nUSD if it wins.

$ mm ninety bet 96 no 2
Intent: Bet 2 nUSD on NO in Ninety market #96 at 1.04x; pays 2.08 nUSD if it wins
Bet placed: 2 nUSD on NO at 1.04x, pays 2.08 nUSD if it wins.
```

## Every transaction goes through the Agent Wallet

The plugin never sees a key or a token, and has no way to sign. Each write is built as plain
calldata and handed to `ctx.walletExecutor`, the host's executor for the `wallet-submit`
capability. MetaMask then does what it does for any transaction:

- simulates it;
- scans it for threats;
- applies the wallet's policy: network and address allowlists, the outflow limit, and 2FA for
  anything outside them;
- signs it in the server wallet;
- broadcasts it.

Each request carries a plain-English intent ("Bet 2 nUSD on NO in Ninety market #96 at 1.04x;
pays 2.08 nUSD if it wins") so whoever reviews it sees what it does.

The plugin adds three checks of its own:

- **Exact payout or nothing.** A bet is built from the market makers' signed prices and carries
  that exact payout as its minimum (`minPayout`). It lands at the payout shown, or the contract
  reverts it.
- **No doomed transactions.** Every transaction's gas is estimated first. One that would revert
  is never sent: on Monad a reverted transaction is billed its whole gas limit.
- **Least privilege.** Each command declares only the capabilities it uses (see `package.json#mm`).
  Read-only commands declare none. Approvals are for the exact amount, never unlimited.

## Install

Requires Node 22.18+ and `@metamask/agent-wallet` 6.2 or later. The plugin is published on npm as
[`ninety-mm-plugin`](https://www.npmjs.com/package/ninety-mm-plugin).

```bash
npm install -g @metamask/agent-wallet
mm login && mm init --wallet server-wallet --mode guard
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true

# Fetch the published package from npm and install it into mm:
mm plugins install "file:$PWD/$(npm pack ninety-mm-plugin --silent)" --accept-permissions

# One-time Monad testnet setup (see below), from the installed package
# (on macOS the directory is ~/Library/Application Support/mm):
node ~/.local/share/mm/node_modules/ninety-mm-plugin/scripts/add-monad-testnet.mjs
```

Why not `mm plugins install ninety-mm-plugin`? On Agent Wallet 6.2.1 and 7.0.0 that command
installs the package and then removes it again, for every plugin installed by npm name, without
an error. The CLI's post-install consent check looks the new plugin up on a different oclif
config object from the one the installer registered it on. It finds no `oclif.manifest.json`, so
it uninstalls the plugin. Installing the same npm tarball as a file goes through the CLI's other
install path, which works. You still get the same consent screen for its commands and
capabilities, and the same integrity record.

To build from source instead: `pnpm install && ./install-local.sh` in this directory.
`install-local.sh` installs a packed tarball, not the directory. mm resolves a plugin's imports
from its real path, and this directory's `node_modules` holds a dev copy of
`@metamask/agent-wallet`. Installing the directory would load a second copy of the CLI, which
crashes. MetaMask's own plugin template does the same when installed from a directory.

### Monad testnet: two one-time steps

1. **Point the wallet at Monad testnet's RPC.** Agent Wallet 7.0 lists Monad testnet (10143) as
   supported, and its policy accepts it. But its default RPC gateway answers `Invalid chainId` for
   10143, so its transaction pipeline stalls there. `scripts/add-monad-testnet.mjs` adds Monad
   testnet to the wallet's `customEvmChains` with Monad's public RPC. That's the list the CLI
   checks first. Signing, policy and 2FA are unchanged. The script backs up `wallets.json` first.
   For the same reason, the plugin's own reads go to Monad's RPC instead of `ctx.publicClient`,
   and it waits for confirmation on that RPC: on this chain the wallet's job ends at
   `BROADCASTED`.
2. **Allow Ninety in a Guard Mode policy.** Add chain `10143` to `allowed_chains`, and allowlist
   the bet router `0xd368165544A427d1d42FCF53846fA84c37cBB387`, nUSD
   `0x85fe9D32c8B5c02639767399D7DCA585042ea57b`, and each vault you'll back (from
   `mm ninety agents --json`), with `mm wallet policy set`. MetaMask asks you to approve that
   change. Without it, each bet waits for 2FA, and its prices, which live about 5 seconds,
   expire first.

Set `NINETY_URL` to the Ninety app's address. It defaults to `http://localhost:3000`.

## Commands

| Command | Capabilities | Does |
| --- | --- | --- |
| `mm ninety matches` | none | Matches on offer, and which is live |
| `mm ninety markets [--match <id>]` | none | Open markets, best YES/NO odds, seconds left. With `--match` it starts that match |
| `mm ninety quote <market> <yes\|no> <nUSD>` | none | Exact blended odds and payout for a stake, without betting |
| `mm ninety bet <market> <yes\|no> <nUSD> [--min-odds x]` | wallet-read, wallet-submit | Places the bet, split across the best three prices |
| `mm ninety bets` | wallet-read | Balance, recent bets, winnings to collect |
| `mm ninety collect` | wallet-read, wallet-submit | Collects settled winnings and refunds in one transaction |
| `mm ninety faucet` | wallet-read, wallet-submit | Free test nUSD, plus gas if you're low |
| `mm ninety agents` | wallet-read | Market makers: vault, return to backers, your stake |
| `mm ninety back <name> <nUSD>` | wallet-read, wallet-submit | Deposits into a market maker's vault |
| `mm ninety withdraw <name> <nUSD\|all>` | wallet-read, wallet-submit | Withdraws from it |

Every command takes `--json`. [`skills/ninety/SKILL.md`](skills/ninety/SKILL.md) tells an agent
when and how to use each one.

## A real run on Monad testnet

Server wallet `0xd0f8…7903` in Guard Mode, 1 October 2026:

| Command | What happened | Transaction |
| --- | --- | --- |
| `faucet` | Claim 1,000 test nUSD | [`0x9437d7d5…`](https://testnet.monadexplorer.com/tx/0x9437d7d5abad817deead7f8d0096bc8be1986a7149b482dfb145dcf097b96288) |
| `bet` (1/2) | Allow the bet router this 2 nUSD stake | [`0xd0c33dfa…`](https://testnet.monadexplorer.com/tx/0xd0c33dfacae042777e3210f71bfa310c45199c71afd5357bcb86733080be3413) |
| `bet` (2/2) | 2 nUSD on NO, "Card shown in the next 5 min?" (#96), at 1.04x | [`0xf1e224d9…`](https://testnet.monadexplorer.com/tx/0xf1e224d9b0128db76ccc5085f1b47dfc91e68984d0d800299273a270b5c645ed) |
| `collect` | No card came: collect the 2.08 nUSD it won | [`0x89e21d87…`](https://testnet.monadexplorer.com/tx/0x89e21d874b8fd1ac4a67712ac5425917b760f9eebddec7c87838f0845d39f23a) |
| `back` (1/2) | Allow Tempo's vault 5 nUSD | [`0xeb6bdb3c…`](https://testnet.monadexplorer.com/tx/0xeb6bdb3cdf1b91f11feb39dd46f7864237eb44e67ad87439b64f5697a2b7948b) |
| `back` (2/2) | Back Tempo with 5 nUSD | [`0xea353863…`](https://testnet.monadexplorer.com/tx/0xea3538634120395ce0a20454f81c2ebd7bdcff964ec82d15d04f15458aad1ecb) |
| `withdraw` | After the 15-minute cooldown, withdraw it all: 4.999958 nUSD (Tempo's vault dipped slightly meanwhile) | [`0x9f9b88d4…`](https://testnet.monadexplorer.com/tx/0x9f9b88d48844c9e713510a42beeefbc831ef993236e08885c568f3ead5512f6e) |

The bet went from submission to inclusion in about 1.5 seconds, well inside its prices' 5-second
life. Each command takes 15 to 40 seconds end to end, because MetaMask polls each wallet job.
A withdrawal straight after `back` is refused with the time it unlocks (`NINETY_WITHDRAW_LOCKED`):
the vault has a 15-minute cooldown after a deposit.

## Development

```bash
pnpm test        # bet planning, the executor hand-off, history, manifest/capability consistency
pnpm typecheck
pnpm build       # esbuild bundles each command; viem and @ninety/core are inlined
```

The bundle has no runtime dependencies. Its only external import is the host's plugin SDK, which
resolves to the running `mm`.
