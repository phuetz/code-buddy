import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentManager, ParallelSubagentRunner } from '../../src/agent/subagents.js';

describe('ParallelSubagentRunner', () => {
  let manager: SubagentManager;
  let runner: ParallelSubagentRunner;

  beforeEach(() => {
    manager = new SubagentManager('fake-api-key');
    runner = new ParallelSubagentRunner(manager, 2);
    
    // Mock manager.spawn to return successful results
    vi.spyOn(manager, 'spawn').mockImplementation(async (name, task) => {
      return {
        success: true,
        output: `Result for ${name}: ${task}`,
        toolsUsed: [],
        rounds: 1,
        duration: 10,
      };
    });
  });

  it('should run multiple tasks in parallel', async () => {
    const tasks = [
      { id: 't1', agentType: 'explorer', task: 'task 1' },
      { id: 't2', agentType: 'debugger', task: 'task 2' },
      { id: 't3', agentType: 'documenter', task: 'task 3' },
    ];

    const result = await runner.runParallel(tasks, { batchSize: 2 });

    expect(result.success).toBe(true);
    expect(result.completedCount).toBe(3);
    expect(result.results.size).toBe(3);
    expect(result.results.get('t1')?.output).toContain('Result for explorer: task 1');
    expect(manager.spawn).toHaveBeenCalledTimes(3);
  });

  it('should handle failures in parallel tasks', async () => {
    vi.spyOn(manager, 'spawn').mockImplementationOnce(async () => {
      throw new Error('Spawn failed');
    });

    const tasks = [
      { id: 't1', agentType: 'explorer', task: 'task 1' },
    ];

    const result = await runner.runParallel(tasks);

    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.errors[0]).toContain('Spawn failed');
  });
});
