/**
 * Limits on what the gas sponsor gives away. /api/gas-drip has to fund addresses it has never seen
 * -- a new passkey account holds nothing to prove itself with -- so without limits anyone could
 * script fresh addresses and empty the sponsor in seconds, and every new fan after them would be
 * unable to bet. Three limits, each over a rolling day:
 *
 * - **New accounts per IP:** a few is plenty for a person trying the app on a phone and a laptop;
 *   it stops one machine minting addresses in a loop.
 * - **MON per IP:** enough for one person to do everything the app offers, registering an agent
 *   included. Without it the overall ceiling was the only bound on a busy user, and one thorough
 *   tester used all of it: nobody else could bet for the rest of the day.
 * - **A ceiling on everything given:** whatever gets past the first two, the sponsor can't be
 *   drained in one day.
 *
 * Kept in memory: a restart forgets it, which errs on the side of the fan.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export type DripDenial = "ip_limit" | "ip_cap" | "daily_cap";

interface Grant {
  at: number;
  ip: string;
  newAccount: boolean;
  amount: bigint;
}

export class DripBudget {
  private grants: Grant[] = [];

  constructor(
    private readonly limits: { newAccountsPerIp: number; ipCapWei: bigint; dailyCapWei: bigint },
    private readonly now: () => number = Date.now,
  ) {}

  private live(): Grant[] {
    const since = this.now() - DAY_MS;
    this.grants = this.grants.filter((g) => g.at > since);
    return this.grants;
  }

  /** Why this drip can't be given, or null if it can. */
  check(ip: string, newAccount: boolean, amount: bigint): DripDenial | null {
    const grants = this.live();
    if (newAccount) {
      const fromIp = grants.filter((g) => g.newAccount && g.ip === ip).length;
      if (fromIp >= this.limits.newAccountsPerIp) return "ip_limit";
    }
    const total = (of: Grant[]) => of.reduce((sum, g) => sum + g.amount, 0n);
    if (total(grants.filter((g) => g.ip === ip)) + amount > this.limits.ipCapWei) return "ip_cap";
    if (total(grants) + amount > this.limits.dailyCapWei) return "daily_cap";
    return null;
  }

  record(ip: string, newAccount: boolean, amount: bigint) {
    this.grants.push({ at: this.now(), ip, newAccount, amount });
  }
}

/**
 * The caller's IP: the first entry of `x-forwarded-for`, which Vercel sets itself and won't take
 * from the caller (a Cloudflare tunnel sets it too). Not `cf-connecting-ip` or similar: those pass
 * through from whoever sends them, so trusting one would let a script dodge the per-IP limit.
 */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
