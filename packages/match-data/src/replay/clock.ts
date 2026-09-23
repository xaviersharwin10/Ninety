import { EventEmitter } from "node:events";
import type { NormalizedEvent } from "@ninety/core";

export interface ReplayClockEvents {
  event: [NormalizedEvent];
  end: [];
}

/**
 * Streams a match's events on a clock, at real-time speed or accelerated, through the exact same
 * `event` interface a live feed would use — agents, the quote relay and the web app never need to
 * know they're watching a replay rather than a live match.
 *
 * Gaps between events are honoured (a quiet spell in the match is a quiet spell in the replay);
 * only the half-time gap is collapsed to zero, since waiting out a real interval only ever costs
 * demo time. Events within a period play back at `elapsed_real_time = elapsed_period_sec / speed`.
 */
export class ReplayClock extends EventEmitter<ReplayClockEvents> {
  private timer: NodeJS.Timeout | undefined;
  private index = 0;
  /** `periodSec` of the event most recently scheduled, used to detect a period boundary crossing. */
  private lastPeriodSec = 0;
  private lastPeriod: string | undefined;

  constructor(
    private readonly events: readonly NormalizedEvent[],
    private readonly speed = 1,
  ) {
    super();
    if (speed <= 0) throw new Error(`speed must be positive, got ${speed}`);
  }

  start(): void {
    if (this.timer) return;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** How far into the current period's clock the replay has reached, in match-clock seconds. */
  get cursorMatchClockSec(): number {
    // Guarded by `this.index > 0`, so the index is provably in bounds; noUncheckedIndexedAccess
    // can't see that from here.
    return this.index > 0 ? this.events[this.index - 1]!.matchClockSec : 0;
  }

  private scheduleNext(): void {
    if (this.index >= this.events.length) {
      this.emit("end");
      return;
    }

    // Guarded by the length check just above, so this index is provably in bounds.
    const next = this.events[this.index]!;
    const crossedPeriod = this.lastPeriod !== undefined && next.period !== this.lastPeriod;

    // Half-time (or any period change) plays out instantly rather than waiting out the real gap
    // between the last event of one period and the first of the next.
    const delayRealMs = crossedPeriod
      ? 0
      : Math.max(0, ((next.periodSec - this.lastPeriodSec) / this.speed) * 1000);

    this.timer = setTimeout(() => {
      this.emit("event", next);
      this.lastPeriodSec = next.periodSec;
      this.lastPeriod = next.period;
      this.index++;
      this.scheduleNext();
    }, delayRealMs);
  }
}
