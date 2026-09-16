/**
 * Injectable randomness. Phrase pools are picked with an `Rng`, so a test can
 * pin the exact line without stubbing globals.
 *
 * @module runtime/rng
 */

/** Same contract as `Math.random`: a float in [0, 1). */
export type Rng = () => number;

/** Deterministic mulberry32 — identical sequence for a given seed, on every platform. */
export function seededRng(seed: number): Rng {
  let state = Math.floor(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Always returns the same value — picks the first eligible line. */
export function constantRng(value = 0): Rng {
  return () => value;
}
