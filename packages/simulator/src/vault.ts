/**
 * A TypeScript mirror of `AgentVault.sol`'s liability-accounting state machine -- not a simplified
 * approximation of it. Every method here corresponds to one `onlyRouter` function on the real
 * contract, with the same preconditions and the same effect on `totalAssets`/`lockedLiability`/
 * `marketExposure`. This is what lets the simulator's P&L numbers be trusted as "what the vault
 * would actually do", not "what a plausible-looking model does".
 *
 * Deliberately does not model ERC-4626 shares, multiple backers, deposits, withdrawals, the
 * withdrawal cooldown, or the performance fee -- the simulator measures one thing (does an agent's
 * vault end up net positive), for which a single running `totalAssets` balance is the whole answer.
 * A backer's individual return would need the share layer too; that is a real gap, noted in
 * docs/simulator-results.md, not hidden.
 */

export class InsufficientFreeCapitalError extends Error {
  constructor(liability: bigint, free: bigint) {
    super(`liability ${liability} exceeds free capital ${free}`);
  }
}

export class MarketExposureExceededError extends Error {
  constructor(newExposure: bigint, cap: bigint) {
    super(`market exposure ${newExposure} would exceed cap ${cap}`);
  }
}

const BPS = 10_000n;

export class SimVault {
  lockedLiability = 0n;
  private readonly marketExposure = new Map<string, bigint>();

  constructor(
    public readonly agentName: string,
    public totalAssets: bigint,
    public readonly maxMarketExposureBps: bigint,
  ) {}

  /** Mirrors `AgentVault.freeCapital()`. */
  freeCapital(): bigint {
    return this.totalAssets > this.lockedLiability ? this.totalAssets - this.lockedLiability : 0n;
  }

  private exposureCap(): bigint {
    return (this.totalAssets * this.maxMarketExposureBps) / BPS;
  }

  /** Mirrors `AgentVault.quotableBudget(marketId)`. */
  quotableBudget(marketId: string): bigint {
    const cap = this.exposureCap();
    const used = this.marketExposure.get(marketId) ?? 0n;
    const headroom = cap > used ? cap - used : 0n;
    const free = this.freeCapital();
    return free < headroom ? free : headroom;
  }

  /** Mirrors `AgentVault.lockLiability`. Called when a fill against this agent is accepted. */
  lockLiability(marketId: string, liability: bigint): void {
    const free = this.freeCapital();
    if (liability > free) throw new InsufficientFreeCapitalError(liability, free);

    const newExposure = (this.marketExposure.get(marketId) ?? 0n) + liability;
    const cap = this.exposureCap();
    if (newExposure > cap) throw new MarketExposureExceededError(newExposure, cap);

    this.lockedLiability += liability;
    this.marketExposure.set(marketId, newExposure);
  }

  /** Mirrors `AgentVault.settleAgentWon`: the bettor's stake becomes vault profit. */
  settleWon(marketId: string, liability: bigint, stakeCredited: bigint): void {
    this.release(marketId, liability);
    this.totalAssets += stakeCredited;
  }

  /** Mirrors `AgentVault.settleAgentLost`: the vault pays out the liability it had reserved. */
  settleLost(marketId: string, liability: bigint): void {
    this.release(marketId, liability);
    this.totalAssets -= liability;
  }

  /** Mirrors `AgentVault.releaseVoided`: liability released, no asset movement. */
  releaseVoided(marketId: string, liability: bigint): void {
    this.release(marketId, liability);
  }

  private release(marketId: string, liability: bigint): void {
    this.lockedLiability -= liability;
    const remaining = (this.marketExposure.get(marketId) ?? 0n) - liability;
    this.marketExposure.set(marketId, remaining);
  }
}
