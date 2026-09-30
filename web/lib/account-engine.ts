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
import { MarketManagerAbi, TEMPLATE_NAME_BY_ID } from "@ninety/core";
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

export interface BetResult {
  betId: string;
  outcome: "Won" | "Lost" | "Voided";
  /** What landed in the balance: the payout if won, the stake back if voided, 0 if lost. */
  amount: bigint;
  stake: bigint;
  question: string | null;
}

export interface AccountState {
  setup: "working" | "ready" | "failed";
  /** Winnings or refunds settled but not yet in the balance. */
  collecting: bigint;
  /** Set while payouts are failing; they keep being retried. */
  collectError: string | null;
  /** When the balance is empty and the faucet is cooling down: when more nUSD arrives (ms). */
  refillAt: number | null;
}

interface OnChainBet {
  marketId: bigint;
  stake: bigint;
  payout: bigint;
  status: number;
}

export class AccountEngine {
  private state: AccountState = {
    setup: "working",
    collecting: 0n,
    collectError: null,
    refillAt: null,
  };
  private readonly watched = new Set<bigint>();
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
      if (this.state.collecting !== 0n) this.update({ collecting: 0n });
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
    for (const [i, bet] of bets.entries()) {
      const id = ids[i]!;
      if (bet.status === STATUS.Open) continue;
      if (owed[i]! > 0n) {
        payable.push({ id, bet, amount: owed[i]! });
      } else {
        // Lost, or paid out already (by this tab earlier, or another device).
        this.watched.delete(id);
        if (bet.status === STATUS.Lost) this.announce(id, bet, "Lost", 0n);
      }
    }

    const collecting = payable.reduce((sum, p) => sum + p.amount, 0n);
    if (collecting !== this.state.collecting) this.update({ collecting });
    if (payable.length === 0 || Date.now() < this.retryAfter) return;

    try {
      await sendTx(this.account, (wallet) =>
        wallet.writeContract({
          address: BET_ROUTER,
          abi: BetRouterAbi,
          functionName: "claim",
          args: [payable.map((p) => p.id)],
        }),
      );
    } catch (err) {
      console.warn("collecting winnings failed:", err);
      this.retryAfter = Date.now() + RETRY_MS;
      this.update({ collectError: "Your winnings are waiting -- retrying shortly." });
      return;
    }
    for (const p of payable) {
      this.watched.delete(p.id);
      this.announce(p.id, p.bet, p.bet.status === STATUS.Won ? "Won" : "Voided", p.amount);
    }
    this.update({ collecting: 0n, collectError: null });
    notifyBalanceChanged();
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

  private async announce(
    id: bigint,
    bet: OnChainBet,
    outcome: BetResult["outcome"],
    amount: bigint,
  ) {
    let question: string | null = null;
    try {
      const market = (await publicClient.readContract({
        address: MARKET_MANAGER,
        abi: MarketManagerAbi,
        functionName: "getMarket",
        args: [bet.marketId],
      })) as { templateId: Hex };
      const template = TEMPLATE_NAME_BY_ID[market.templateId];
      question = template ? TEMPLATE_QUESTION[template] : null;
    } catch {
      // The result is still worth showing without its question.
    }
    this.onResult({ betId: id.toString(), outcome, amount, stake: bet.stake, question });
  }
}

/** Balances shown anywhere refresh at once when the account moves money, not on their next poll. */
export const BALANCE_CHANGED_EVENT = "ninety:balance-changed";
function notifyBalanceChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}
