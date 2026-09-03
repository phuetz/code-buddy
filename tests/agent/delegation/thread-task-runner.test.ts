import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThreadTaskRunner } from '../../../src/agent/delegation/thread-task-runner.js';

interface TestOutput {
  type: 'message';
  text: string;
}

const parentBudget = {
  maxTurns: 20,
  maxCostUsd: 2,
  maxContextTokens: 16_000,
};

describe('ThreadTaskRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the inherited default concurrency at one and emits tagged outputs', async () => {
    let active = 0;
    let maxActive = 0;
    const runner = new ThreadTaskRunner<string, TestOutput>({
      parentBudget,
      createAgent: ({ agentId }) => ({
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { type: 'message', text: `${agentId}:${input}` };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });
    const events: Array<{ agentId: string; kind: string; payload: unknown }> = [];
    const drain = (async () => {
      for await (const event of runner.events()) events.push(event);
    })();

    const [alpha, beta] = await Promise.all([
      runner.submit('alpha', 'one'),
      runner.submit('beta', 'two'),
    ]);
    await runner.close();
    await drain;

    expect(ThreadTaskRunner.DEFAULT_CONCURRENCY).toBe(1);
    expect(maxActive).toBe(1);
    expect(alpha).toMatchObject({ success: true, output: { text: 'alpha:one' } });
    expect(beta).toMatchObject({ success: true, output: { text: 'beta:two' } });
    expect(events.filter((event) => event.kind === 'message')).toEqual([
      expect.objectContaining({ agentId: 'alpha', payload: { type: 'message', text: 'alpha:one' } }),
      expect.objectContaining({ agentId: 'beta', payload: { type: 'message', text: 'beta:two' } }),
    ]);
  });

  it('reports an exhausted child budget without running the queued turn', async () => {
    const execute = vi.fn(async (input: string): Promise<TestOutput> => ({
      type: 'message',
      text: input,
    }));
    const runner = new ThreadTaskRunner<string, TestOutput>({
      parentBudget: { ...parentBudget, maxTurns: 2 },
      createAgent: () => ({ execute, abortCurrentOperation() {}, dispose() {} }),
    });
    const drain = (async () => {
      for await (const _event of runner.events()) {
        // Drain the non-blocking tagged stream until close.
      }
    })();

    const first = await runner.submit('alpha', 'one');
    const second = await runner.submit('alpha', 'two');
    await runner.close();
    await drain;

    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: false,
      reason: 'turn_budget_exhausted',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('forwards a child stream in order and returns its final output', async () => {
    const runner = new ThreadTaskRunner<string, TestOutput>({
      parentBudget,
      createAgent: ({ agentId }) => ({
        async *execute(input) {
          yield { type: 'message', text: `${agentId}:${input}:one` };
          yield { type: 'message', text: `${agentId}:${input}:two` };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });
    const messages: string[] = [];
    const drain = (async () => {
      for await (const event of runner.events()) {
        if (event.kind === 'message') messages.push((event.payload as TestOutput).text);
      }
    })();

    const outcome = await runner.submit('alpha', 'turn');
    await runner.close();
    await drain;

    expect(messages).toEqual(['alpha:turn:one', 'alpha:turn:two']);
    expect(outcome).toMatchObject({
      success: true,
      output: { type: 'message', text: 'alpha:turn:two' },
    });
  });

  it('contains a throwing child so another child still completes', async () => {
    const runner = new ThreadTaskRunner<string, TestOutput>({
      parentBudget,
      concurrency: 2,
      createAgent: ({ agentId }) => ({
        async execute(input) {
          if (agentId === 'broken') throw new Error('child exploded');
          return { type: 'message', text: input };
        },
        abortCurrentOperation() {},
        dispose() {},
      }),
    });
    const drain = (async () => {
      for await (const _event of runner.events()) {
        // Drain the non-blocking tagged stream until close.
      }
    })();

    const [broken, healthy] = await Promise.all([
      runner.submit('broken', 'bad'),
      runner.submit('healthy', 'good'),
    ]);
    await runner.close();
    await drain;

    expect(broken).toMatchObject({
      success: false,
      reason: 'agent_error',
      message: 'child exploded',
    });
    expect(healthy).toMatchObject({
      success: true,
      output: { type: 'message', text: 'good' },
    });
  });

  it('propagates parent cancellation to every active child', async () => {
    const parent = new AbortController();
    const aborted: string[] = [];
    const runner = new ThreadTaskRunner<string, TestOutput>({
      parentBudget,
      concurrency: 2,
      parentSignal: parent.signal,
      createAgent: ({ agentId, signal }) => ({
        execute: () => new Promise<TestOutput>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
        abortCurrentOperation() {
          aborted.push(agentId);
        },
        dispose() {},
      }),
    });
    const drain = (async () => {
      for await (const _event of runner.events()) {
        // Drain the non-blocking tagged stream until cancellation closes it.
      }
    })();

    const submissions = [
      runner.submit('alpha', 'one'),
      runner.submit('beta', 'two'),
    ];
    await new Promise((resolve) => setTimeout(resolve, 5));
    parent.abort('parent stopped');
    const outcomes = await Promise.all(submissions);
    await drain;

    expect(outcomes).toEqual([
      expect.objectContaining({ success: false, reason: 'cancelled' }),
      expect.objectContaining({ success: false, reason: 'cancelled' }),
    ]);
    expect(aborted.sort()).toEqual(['alpha', 'beta']);
  });
});
