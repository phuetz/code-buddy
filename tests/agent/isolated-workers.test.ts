import { describe, expect, it } from 'vitest';
import { isolatedSessionKey, runIsolatedWorkers } from '../../src/agent/isolated-workers.js';

describe('isolated workers', () => {
  it('runs jobs under a concurrency cap and isolates session keys', async () => {
    const seen: number[] = [];
    let live = 0;
    let peak = 0;
    const results = await runIsolatedWorkers(
      [1, 2, 3, 4].map((n) => ({
        id: `job-${n}`,
        run: async () => {
          live += 1;
          peak = Math.max(peak, live);
          await new Promise((resolve) => setTimeout(resolve, 20));
          seen.push(n);
          live -= 1;
          return n * 2;
        },
      })),
      { concurrency: 2, sessionPrefix: 'goal-abc' },
    );
    expect(results).toHaveLength(4);
    expect(results.every((row) => row.ok)).toBe(true);
    expect(results.map((row) => row.value).sort()).toEqual([2, 4, 6, 8]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(isolatedSessionKey('goal-abc', 'job-1')).toBe('goal-abc:job-1');
  });

  it('captures failures without aborting siblings', async () => {
    const results = await runIsolatedWorkers(
      [
        { id: 'ok', run: async () => 'yes' },
        {
          id: 'bad',
          run: async () => {
            throw new Error('boom');
          },
        },
      ],
      { concurrency: 2 },
    );
    expect(results.find((row) => row.id === 'ok')?.ok).toBe(true);
    expect(results.find((row) => row.id === 'bad')?.error).toBe('boom');
  });
});
