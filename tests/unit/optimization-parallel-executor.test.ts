import { describe, it, expect } from 'vitest';
import { ParallelExecutor } from '../../src/optimization/parallel-executor.js';

describe('optimization ParallelExecutor', () => {
  it('treats resolved tool results with success=false as failed calls', async () => {
    const executor = new ParallelExecutor(
      async () => ({ success: false, error: 'tool unavailable' }),
      { retryCount: 0, timeoutMs: 1000, continueOnError: true },
    );

    const results = await executor.execute([
      { id: 'call-1', name: 'read_file', arguments: { path: 'missing.ts' } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('tool unavailable');
  });

  it('keeps ordinary resolved values successful', async () => {
    const executor = new ParallelExecutor(
      async () => 'tool output',
      { retryCount: 0, timeoutMs: 1000, continueOnError: true },
    );

    const results = await executor.execute([
      { id: 'call-1', name: 'read_file', arguments: { path: 'ok.ts' } },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe('tool output');
  });
});
