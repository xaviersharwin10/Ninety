import type { LocalAccount, TransactionReceipt } from "viem";
import { type BetPreview, freshQuotes, previewBet } from "./bet-preview";
import { BET_ROUTER, BetRouterAbi } from "./contracts";
import { ensureAllowance } from "./erc20";
import type { SignedQuote } from "./quote-relay";
import { revertErrorName, sendTx, TxRevertedError } from "./tx";

/** The book moved, or dried up, between the tap and the send. Nothing was sent. */
export class PriceMovedError extends Error {}

/** How long to wait for agents' next round of quotes when none on hand would outlive the trip. */
const FRESH_QUOTE_WAIT_MS = 4000;

/**
 * The bet priced from quotes that will still be valid when it lands, for exactly `stake`. Agents
 * re-quote every few seconds, so if every quote on hand is about to expire, the next round is at
 * most a moment away.
 */
async function freshFills(
  current: () => SignedQuote[],
  side: "yes" | "no",
  stake: bigint,
): Promise<BetPreview> {
  const deadline = Date.now() + FRESH_QUOTE_WAIT_MS;
  for (;;) {
    const fills = previewBet(freshQuotes(current()), side, stake);
    // Never stake more than the fan agreed to, and never quietly stake less.
    if (fills.fillableStake === stake) return fills;
    if (Date.now() > deadline) throw new PriceMovedError();
    await new Promise((r) => setTimeout(r, 250));
  }
}

export interface PlaceBetArgs {
  account: LocalAccount;
  marketId: string;
  side: "yes" | "no";
  stake: bigint;
  /** The least the bet may pay if it wins; below this it isn't sent (and the contract agrees). */
  minPayout: bigint;
  /** The live book for `side`, read at the moment of sending. */
  quotes: () => SignedQuote[];
}

/**
 * Places a bet: priced at the moment it's sent -- after any gas top-up and queued write -- from
 * quotes that will outlive the trip, and checked against `minPayout` before anything is spent.
 * Resolves once it's mined; only a mined, successful transaction is a placed bet.
 */
export async function placeBet(args: PlaceBetArgs): Promise<TransactionReceipt> {
  const { account, marketId, side, stake, minPayout } = args;
  // Normally a no-op: the account's setup approves the betting contract at sign-in.
  await ensureAllowance(account, BET_ROUTER, stake);
  return sendTx(account, async (wallet) => {
    const fills = await freshFills(args.quotes, side, stake);
    if (fills.totalPayout < minPayout) throw new PriceMovedError();
    return wallet.writeContract({
      address: BET_ROUTER,
      abi: BetRouterAbi,
      functionName: "placeBet",
      args: [
        BigInt(marketId),
        side === "yes" ? 0 : 1,
        fills.fillableStake,
        minPayout,
        fills.fills
          .filter((f) => f.stake > 0n)
          .map((f) => ({ quote: f.quote.quote, signature: f.quote.signature })),
      ],
    });
  });
}

/**
 * What the fan reads when a bet doesn't go through. Every case below reverts before the stake is
 * pulled, so each can honestly say nothing was charged. Raw viem errors (addresses, calldata, ABI
 * dumps) never reach the screen.
 */
export function betErrorMessage(err: unknown): string {
  const nothingCharged = "Nothing was charged.";
  if (err instanceof PriceMovedError) {
    return `The price moved before your bet went out. ${nothingCharged} Try again.`;
  }
  if (err instanceof TxRevertedError) {
    return `Your bet didn't go through -- the market may have just closed. ${nothingCharged}`;
  }
  {
    switch (revertErrorName(err)) {
      case "QuoteExpired":
      case "QuoteOverfilled":
      case "PayoutBelowMinimum":
      case "FillsNotBestPriceFirst":
        return `The price moved before your bet landed. ${nothingCharged} Try again.`;
      case "MarketNotBettable":
        return `This market just closed. ${nothingCharged}`;
      case "InsufficientFreeCapital":
      case "MarketExposureExceeded":
        return `Not enough liquidity for that stake right now -- try a smaller amount. ${nothingCharged}`;
    }
  }
  return `The bet couldn't be placed. ${nothingCharged}`;
}
