/**
 * Everything a fan's account does without being asked. The fan signs in, picks a match and taps a
 * price; the rest happens here, through the same signing session that places their bets (so no
 * prompt, ever), one transaction at a time via `sendTx`:
 *
 * - **Setup, once per sign-in.** Gas, the free 1,000 nUSD, and a standing approval of the betting
 *   contract, so the first bet is a single tap like every other.
 * - **Payouts.** `BetRouter.claim` is pull-based (a push loop at settlement would be billed on its
 *   gas limit, per bettor, on Monad), and only the bettor may pull. So the account watches its own
 *   open bets on chain and pulls winnings and refunds the moment they settle. To the fan, the
 *   money simply arrives, and a result shows wherever they are in the app.
 * - **Refills.** Out of nUSD? The faucet's next claim is taken as soon as its cooldown allows.
 *
 * Nothing here holds state a fresh device couldn't rebuild: what's watched is re-read from the
 * indexer on start, so winnings left unclaimed on another device are collected here too.
 */
import { MarketManagerAbi, TEMPLATE_NAME_BY_ID, type TemplateName } from "@ninety/core";
import {
  type Hex,
  type LocalAccount,
  maxUint256,
  parseEventLogs,
  type TransactionReceipt,
} from "viem";
import { publicClient } from "./chain";
import { BET_ROUTER, BetRouterAbi, MARKET_MANAGER, NUSD_ADDRESS, NusdAbi } from "./contracts";
import { allowanceOf } from "./erc20";
import { queryIndexer } from "./indexer";
import { TEMPLATE_QUESTION } from "./templates";
import { sendTx } from "./tx";

/** Below this, the account tops itself up from the faucet (when its cooldown allows). */
export const LOW_NUSD = 5_000_000n;
const TICK_MS = 4000;
/** Bets placed on another device while this one is open are picked up this often. */
const RESEED_MS = 30_000;
/** A failed payout is retried, but not every tick. */
const RETRY_MS = 20_000;
/** Solidity BetStatus ordinals. */
const STATUS = { Open: 1, Won: 2, Lost: 3, Voided: 4 } as const;

/** How a market went for the fan, all their bets on it taken together. */
export interface BetResult {
  /** The market's id: one result per market, however many bets the fan had on it. */
  id: string;
  /** "CashedOut": they held both sides (see cash-out.ts), so they got the same whatever happened. */
  outcome: "Won" | "Lost" | "Voided" | "CashedOut";
  /** What landed in the balance: payouts plus refunds. 0 if it was lost. */
  amount: bigint;
  /** Everything staked on it. */
  stake: bigint;
  question: string | null;
}

/** One side of a fan's open position on a market: their bets on that side, together. */
export interface PositionSide {
  stake: bigint;
  /** What this side pays in total if it wins. */
  payout: bigint;
}

/** A fan's open bets on one market, both sides. */
export interface Position {
  marketId: string;
  template: TemplateName | null;
  yes: PositionSide | null;
  no: PositionSide | null;
}

export interface AccountState {
  setup: "working" | "ready" | "failed";
  /** Winnings or refunds settled but not yet in the balance. */
  collecting: bigint;
  /** Set while payouts are failing; they keep being retried. */
  collectError: string | null;
  /** When the balance is empty and the faucet is cooling down: when more nUSD arrives (ms). */
  refillAt: number | null;
  /** Open bets, by market. */
  positions: Position[];
}

interface OnChainBet {
  marketId: bigint;
  /** Solidity `Side`: 0 = Yes, 1 = No. */
  side: number;
  stake: bigint;
  payout: bigint;
  status: number;
}

interface SettledPart {
  bet: OnChainBet;
  /** What it paid into the balance. */
  amount: bigint;
}

export class AccountEngine {
  private state: AccountState = {
    setup: "working",
    collecting: 0n,
    collectError: null,
    refillAt: null,
    positions: [],
  };
  private readonly watched = new Set<bigint>();
  /** Settled bets not yet announced, by market: a market is announced once all of it has settled. */
  private readonly settled = new Map<bigint, SettledPart[]>();
  private readonly templates = new Map<bigint, TemplateName | null>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private ticking = false;
  private lastSeed = 0;
  private lastRefillCheck = Date.now();
  private retryAfter = 0;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor(
    private readonly account: LocalAccount,
    private readonly onState: (state: AccountState) => void,
    private readonly onResult: (result: BetResult) => void,
  ) {
    this.readyPromise = new Promise((r) => {
      this.resolveReady = r;
    });
  }

  get address() {
    return this.account.address;
  }

  start(): void {
    this.setup().finally(() => {
      this.resolveReady();
      if (!this.stopped) this.tick();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Resolves once setup has finished, whether or not it succeeded. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Retry setup after it failed (e.g. the gas sponsor was briefly out). */
  retrySetup(): void {
    this.update({ setup: "working" });
    this.setup();
  }

  /** Start watching the bets a just-mined `placeBet` created. */
  trackPlaced(receipt: TransactionReceipt): void {
    for (const log of parseEventLogs({
      abi: BetRouterAbi,
      eventName: "BetPlaced",
      logs: receipt.logs,
    })) {
      this.watched.add((log as unknown as { args: { betId: bigint } }).args.betId);
    }
    // Show it (and, after a cash-out, the covered position) now rather than on the next tick.
    this.collectNow();
  }

  /** Try collecting now rather than waiting out the retry delay. */
  collectNow(): void {
    this.retryAfter = 0;
    if (this.ticking) return; // the tick underway will pick it up
    if (this.timer) clearTimeout(this.timer);
    this.tick();
  }

  private update(patch: Partial<AccountState>) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  private async setup() {
    try {
      const [balance, nextClaimAt, allowance] = await Promise.all([
        this.nusdBalance(),
        this.nextClaimAt(),
        allowanceOf(this.account.address, BET_ROUTER),
      ]);
      if (balance < LOW_NUSD) await this.refill(nextClaimAt);
      // The fan can see their balance and browse from here; the approval below only matters to
      // a bet, which waits for it (see `whenReady`).
      this.update({ setup: "ready" });
      notifyBalanceChanged();
      if (allowance < maxUint256 / 2n) {
        try {
          await sendTx(this.account, (wallet) =>
            wallet.writeContract({
              address: NUSD_ADDRESS,
              abi: NusdAbi,
              functionName: "approve",
              args: [BET_ROUTER, maxUint256],
            }),
          );
        } catch (err) {
          // Not fatal: the first bet approves for itself instead (erc20.ts ensureAllowance).
          console.warn("betting approval failed:", err);
        }
      }
    } catch (err) {
      console.warn("account setup failed:", err);
      this.update({ setup: "failed" });
    }
  }

  /** Claims from the faucet if it allows it now; otherwise records when it will. */
  private async refill(nextClaimAt: number) {
    if (nextClaimAt > Date.now()) {
      this.update({ refillAt: nextClaimAt });
      return;
    }
    await sendTx(this.account, (wallet) =>
      wallet.writeContract({ address: NUSD_ADDRESS, abi: NusdAbi, functionName: "claim" }),
    );
    this.update({ refillAt: null });
    notifyBalanceChanged();
  }

  private nusdBalance(): Promise<bigint> {
    return publicClient.readContract({
      address: NUSD_ADDRESS,
      abi: NusdAbi,
      functionName: "balanceOf",
      args: [this.account.address],
    });
  }

  private async nextClaimAt(): Promise<number> {
    const at = (await publicClient.readContract({
      address: NUSD_ADDRESS,
      abi: NusdAbi,
      functionName: "nextClaimAt",
      args: [this.account.address],
    })) as bigint;
    return Number(at) * 1000;
  }

  private async tick() {
    this.ticking = true;
    try {
      if (Date.now() - this.lastSeed > RESEED_MS) await this.seed();
      await this.checkBets();
      await this.checkRefill();
    } catch (err) {
      // RPC or indexer hiccup: the next tick tries again.
      console.warn("account tick failed:", err);
    }
    this.ticking = false;
    if (!this.stopped) this.timer = setTimeout(() => this.tick(), TICK_MS);
  }

  /** Bets still open or not yet paid out, from any device. */
  private async seed() {
    const { Bet } = await queryIndexer<{ Bet: { id: string }[] }>(
      `query($a: String!) {
        Bet(where: { bettor: { _eq: $a }, _or: [
          { status: { _eq: "Open" } },
          { status: { _in: ["Won", "Voided"] }, claimedAt: { _is_null: true } }
        ] }) { id }
      }`,
      { a: this.account.address.toLowerCase() },
    );
    for (const b of Bet) this.watched.add(BigInt(b.id));
    this.lastSeed = Date.now();
  }

  private async checkBets() {
    if (this.watched.size === 0) {
      if (this.state.collecting !== 0n || this.state.positions.length > 0) {
        this.update({ collecting: 0n, positions: [] });
      }
      return;
    }
    const ids = [...this.watched];
    const [bets, owed] = await Promise.all([
      Promise.all(
        ids.map(
          (id) =>
            publicClient.readContract({
              address: BET_ROUTER,
              abi: BetRouterAbi,
              functionName: "getBet",
              args: [id],
            }) as Promise<OnChainBet>,
        ),
      ),
      Promise.all(
        ids.map(
          (id) =>
            publicClient.readContract({
              address: BET_ROUTER,
              abi: BetRouterAbi,
              functionName: "claimableAmount",
              args: [id],
            }) as Promise<bigint>,
        ),
      ),
    ]);

    const payable: { id: bigint; bet: OnChainBet; amount: bigint }[] = [];
    const open: OnChainBet[] = [];
    for (const [i, bet] of bets.entries()) {
      const id = ids[i]!;
      if (bet.status === STATUS.Open) {
        open.push(bet);
      } else if (owed[i]! > 0n) {
        payable.push({ id, bet, amount: owed[i]! });
      } else {
        // Lost, or paid out already (by this tab earlier, or another device).
        this.watched.delete(id);
        this.settle(bet, 0n);
      }
    }
    await this.publishPositions(open);

    const collecting = payable.reduce((sum, p) => sum + p.amount, 0n);
    if (collecting !== this.state.collecting) this.update({ collecting });
    if (payable.length > 0 && Date.now() >= this.retryAfter) {
      try {
        await sendTx(this.account, (wallet) =>
          wallet.writeContract({
            address: BET_ROUTER,
            abi: BetRouterAbi,
            functionName: "claim",
            args: [payable.map((p) => p.id)],
          }),
        );
        for (const p of payable) {
          this.watched.delete(p.id);
          this.settle(p.bet, p.amount);
        }
        this.update({ collecting: 0n, collectError: null });
        notifyBalanceChanged();
      } catch (err) {
        console.warn("collecting winnings failed:", err);
        this.retryAfter = Date.now() + RETRY_MS;
        this.update({ collectError: "Your winnings are waiting -- retrying shortly." });
      }
    }

    // A market is announced once none of its bets is still open or waiting to be paid.
    const pendingMarkets = new Set([
      ...open.map((b) => b.marketId),
      ...payable.filter((p) => this.watched.has(p.id)).map((p) => p.bet.marketId),
    ]);
    for (const marketId of [...this.settled.keys()]) {
      if (!pendingMarkets.has(marketId)) await this.announce(marketId);
    }
  }

  private settle(bet: OnChainBet, amount: bigint) {
    const parts = this.settled.get(bet.marketId) ?? [];
    parts.push({ bet, amount });
    this.settled.set(bet.marketId, parts);
  }

  private async templateOf(marketId: bigint): Promise<TemplateName | null> {
    if (!this.templates.has(marketId)) {
      try {
        const market = (await publicClient.readContract({
          address: MARKET_MANAGER,
          abi: MarketManagerAbi,
          functionName: "getMarket",
          args: [marketId],
        })) as { templateId: Hex };
        this.templates.set(marketId, TEMPLATE_NAME_BY_ID[market.templateId] ?? null);
      } catch {
        return null; // try again next time
      }
    }
    return this.templates.get(marketId) ?? null;
  }

  private async publishPositions(open: OnChainBet[]) {
    const byMarket = new Map<bigint, Position>();
    for (const bet of open) {
      const position = byMarket.get(bet.marketId) ?? {
        marketId: bet.marketId.toString(),
        template: await this.templateOf(bet.marketId),
        yes: null,
        no: null,
      };
      const key = bet.side === 0 ? "yes" : "no";
      const side = position[key] ?? { stake: 0n, payout: 0n };
      position[key] = { stake: side.stake + bet.stake, payout: side.payout + bet.payout };
      byMarket.set(bet.marketId, position);
    }
    const positions = [...byMarket.values()];
    const fingerprint = (ps: Position[]) =>
      JSON.stringify(ps, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    if (fingerprint(positions) !== fingerprint(this.state.positions)) this.update({ positions });
  }

  /** One result for everything the fan had on a market. */
  private async announce(marketId: bigint) {
    const parts = this.settled.get(marketId) ?? [];
    this.settled.delete(marketId);
    if (parts.length === 0) return;
    const amount = parts.reduce((sum, p) => sum + p.amount, 0n);
    const stake = parts.reduce((sum, p) => sum + p.bet.stake, 0n);
    const bothSides = new Set(parts.map((p) => p.bet.side)).size > 1;
    const outcome: BetResult["outcome"] = bothSides
      ? "CashedOut"
      : parts.some((p) => p.bet.status === STATUS.Won)
        ? "Won"
        : parts.every((p) => p.bet.status === STATUS.Voided)
          ? "Voided"
          : "Lost";
    const template = await this.templateOf(marketId);
    this.onResult({
      id: marketId.toString(),
      outcome,
      amount,
      stake,
      question: template ? TEMPLATE_QUESTION[template] : null,
    });
  }

  /** Tops up an empty balance: when the faucet's cooldown ends, and otherwise every so often. */
  private async checkRefill() {
    const due =
      this.state.refillAt !== null
        ? this.state.refillAt <= Date.now()
        : Date.now() - this.lastRefillCheck > RESEED_MS;
    if (!due) return;
    this.lastRefillCheck = Date.now();
    if ((await this.nusdBalance()) >= LOW_NUSD) {
      if (this.state.refillAt !== null) this.update({ refillAt: null });
      return;
    }
    // Winnings on their way will fix it sooner than the faucet.
    if (this.state.collecting > 0n) return;
    await this.refill(await this.nextClaimAt());
  }
}

/** Balances shown anywhere refresh at once when the account moves money, not on their next poll. */
export const BALANCE_CHANGED_EVENT = "ninety:balance-changed";
function notifyBalanceChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}
