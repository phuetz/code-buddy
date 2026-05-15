import { DelegationEngine } from '../../src/agent/planner/delegation-engine.js';
import type { PlannedTask } from '../../src/agent/planner/task-graph.js';

describe('DelegationEngine', () => {
  let engine: DelegationEngine;

  beforeEach(() => {
    engine = new DelegationEngine({ maxRetries: 2, retryDelayMs: 10, backoffMultiplier: 1 });
  });

  it('should match explicit delegateTo', () => {
    const task: PlannedTask = {
      id: 't1', description: 'test', dependencies: [],
      delegateTo: 'debugger', status: 'pending',
    };
    expect(engine.matchSubagent(task)).toBe('debugger');
  });

  it('should match by keyword heuristic', () => {
    const tasks: Array<{ desc: string; expected: string }> = [
      { desc: 'Review the code changes', expected: 'code-reviewer' },
      { desc: 'Debug this error', expected: 'debugger' },
      { desc: 'Run the test suite', expected: 'test-runner' },
      { desc: 'Explore the codebase', expected: 'explorer' },
      { desc: 'Refactor the module', expected: 'refactorer' },
      { desc: 'Document the API', expected: 'documenter' },
    ];

    for (const { desc, expected } of tasks) {
      const task: PlannedTask = { id: 't1', description: desc, dependencies: [], status: 'pending' };
      expect(engine.matchSubagent(task)).toBe(expected);
    }
  });

  it('should default to main for unmatched tasks', () => {
    const task: PlannedTask = {
      id: 't1', description: 'do something generic', dependencies: [], status: 'pending',
    };
    expect(engine.matchSubagent(task)).toBe('main');
  });

  it('should execute with retry on failure', async () => {
    let attempts = 0;
    const result = await engine.executeWithRetry(
      { id: 't1', description: 'test', dependencies: [], status: 'pending' },
      async () => {
        attempts++;
        if (attempts < 2) return { success: false, output: '', duration: 0, error: 'fail' };
        return { success: true, output: 'done', duration: 10 };
      }
    );

    expect(result.result.success).toBe(true);
    expect(result.retries).toBeGreaterThanOrEqual(1);
  });

  it('should fail after max retries', async () => {
    const result = await engine.executeWithRetry(
      { id: 't1', description: 'test', dependencies: [], status: 'pending' },
      async () => ({ success: false, output: '', duration: 0, error: 'always fails' })
    );

    expect(result.result.success).toBe(false);
    expect(result.result.output).toBe('Task failed: always fails');
  });

  it('should aggregate results', () => {
    const results = [
      { taskId: 't1', subagent: 'debugger', result: { success: true, output: 'ok', duration: 10 }, retries: 0 },
      { taskId: 't2', subagent: 'test-runner', result: { success: false, output: '', duration: 5, error: 'fail' }, retries: 2 },
    ];

    const agg = engine.aggregateResults(results);
    expect(agg.success).toBe(false);
    expect(agg.totalRetries).toBe(2);
    expect(agg.summary).toContain('1/2');
  });

  it('should store shared context', async () => {
    await engine.executeWithRetry(
      { id: 't1', description: 'test', dependencies: [], status: 'pending' },
      async () => ({ success: true, output: 'context data', duration: 10 })
    );

    const ctx = engine.getSharedContext();
    expect(ctx.get('t1')).toBe('context data');
  });

  it('should support custom mappings', () => {
    engine.addMapping({ taskType: 'deploy', subagent: 'test-runner', priority: 100 });
    const task: PlannedTask = {
      id: 't1', description: 'deploy the app', dependencies: [], status: 'pending',
    };
    expect(engine.matchSubagent(task)).toBe('test-runner');
  });
});
