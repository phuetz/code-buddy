import { describe, it, expect } from 'vitest';
import { computeNextPollDelay } from '../src/renderer/hooks/use-backend-status';

describe('computeNextPollDelay', () => {
  const base = 10_000;

  it('returns the base interval after a successful probe (failures=0)', () => {
    expect(computeNextPollDelay(0, base)).toBe(base);
    expect(computeNextPollDelay(0, 5_000)).toBe(5_000);
  });

  it('doubles the interval per consecutive failure', () => {
    // failures=1 → 10s × 1 = 10s, failures=2 → 10s × 2 = 20s,
    // failures=3 → 10s × 4 = 40s, failures=4 → 10s × 8 = 80s capped at 60s.
    expect(computeNextPollDelay(1, base)).toBe(10_000);
    expect(computeNextPollDelay(2, base)).toBe(20_000);
    expect(computeNextPollDelay(3, base)).toBe(40_000);
  });

  it('caps at 60 seconds however many failures', () => {
    expect(computeNextPollDelay(4, base)).toBe(60_000);
    expect(computeNextPollDelay(50, base)).toBe(60_000);
    expect(computeNextPollDelay(1000, base)).toBe(60_000);
  });

  it('respects custom base intervals', () => {
    // base=2_000 → failures=1 → 2_000, failures=2 → 4_000, failures=3 → 8_000
    expect(computeNextPollDelay(1, 2_000)).toBe(2_000);
    expect(computeNextPollDelay(2, 2_000)).toBe(4_000);
    expect(computeNextPollDelay(3, 2_000)).toBe(8_000);
    // Even with base=2_000, failures=10 still hits the 60s ceiling.
    expect(computeNextPollDelay(10, 2_000)).toBe(12_000);
    // A very large base is also capped.
    expect(computeNextPollDelay(0, 100_000)).toBe(100_000); // success case ignores cap
    expect(computeNextPollDelay(2, 100_000)).toBe(60_000);
  });
});
