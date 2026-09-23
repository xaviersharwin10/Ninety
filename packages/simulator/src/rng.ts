/**
 * A small, seeded, deterministic PRNG (mulberry32) -- not cryptographic, and not meant to be. The
 * entire point is that the same seed reproduces the exact same bettor population every run, which
 * is what makes a simulator result reproducible and worth citing rather than a one-off anecdote.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in `[min, max]`, inclusive. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniform bigint AUSD amount in `[min, max]`, inclusive, at 6-decimal base units. */
export function randStake(rng: () => number, minAusdUnits: bigint, maxAusdUnits: bigint): bigint {
  const span = maxAusdUnits - minAusdUnits;
  if (span < 0n) throw new Error(`min ${minAusdUnits} exceeds max ${maxAusdUnits}`);
  const offset = BigInt(Math.floor(rng() * Number(span + 1n)));
  return minAusdUnits + offset;
}
