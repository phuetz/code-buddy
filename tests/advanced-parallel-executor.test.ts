/**
 * Tests for Advanced Parallel Executor
 */

import {
  AdvancedParallelExecutor,
  getAdvancedParallelExecutor,
  resetAdvancedParallelExecutor,
} from '../src/agent/parallel/advanced-parallel-executor';

describe('AdvancedParallelExecutor', () => {
  let executor: AdvancedParallelExecutor;

  beforeEach(() => {
    resetAdvancedParallelExecutor();
    executor = new AdvancedParallelExecutor({
      maxConcurrent: 4,
      useWorktrees: false, // Disable for testing
      timeout: 5000,
    });
  });

  afterEach(() => {
    // Clean up any pending operations
    executor.cancelAll();
    executor.removeAllListeners();
    resetAdvancedParallelExecutor();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const defaultExecutor = new AdvancedParallelExecutor();
      expect(defaultExecutor).toBeDefined();
      expect(defaultExecutor.getConfig().maxConcurrent).toBe(8);
    });

    it('should accept custom config', () => {
      const config = executor.getConfig();
      expect(config.maxConcurrent).toBe(4);
      expect(config.useWorktrees).toBe(false);
    });
  });

  describe('executeParallel', () => {
    it('should execute multiple agents', async () => {
      const tasks = [
        { id: 'agent1', name: 'Agent 1', task: 'Do task 1' },
        { id: 'agent2', name: 'Agent 2', task: 'Do task 2' },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(2);
      // Parallel execution doesn't guarantee order, so check both IDs are present
      const agentIds = results.map(r => r.agentId);
      expect(agentIds).toContain('agent1');
      expect(agentIds).toContain('agent2');
    });

    it('should handle priority ordering', async () => {
      const tasks = [
        { id: 'low', name: 'Low Priority', task: 'Task', priority: 1 },
        { id: 'high', name: 'High Priority', task: 'Task', priority: 10 },
        { id: 'medium', name: 'Medium Priority', task: 'Task', priority: 5 },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(3);
    });

    it('should batch tasks when exceeding maxConcurrent', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `agent${i}`,
        name: `Agent ${i}`,
        task: `Task ${i}`,
      }));

      let batchCount = 0;
      executor.on('parallel:batch:start', () => batchCount++);

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(10);
      expect(batchCount).toBeGreaterThan(1); // Should have multiple batches
    });

    it('should assign IDs to tasks without IDs', async () => {
      const tasks = [
        { name: 'Agent 1', task: 'Task 1' },
        { name: 'Agent 2', task: 'Task 2' },
      ];

      const results = await executor.executeParallel(tasks as any);

      expect(results[0].agentId).toMatch(/^agent_\d+$/);
      expect(results[1].agentId).toMatch(/^agent_\d+$/);
    });
  });

  describe('getActiveAgents', () => {
    it('should return empty array when no agents active', () => {
      const active = executor.getActiveAgents();
      expect(active).toEqual([]);
    });
  });

  describe('getResults', () => {
    it('should return results map', async () => {
      await executor.executeParallel([
        { id: 'test', name: 'Test', task: 'Task' },
      ]);

      const results = executor.getResults();
      expect(results.size).toBe(1);
      expect(results.has('test')).toBe(true);
    });
  });

  describe('cancelAgent', () => {
    it('should return false for non-existent agent', () => {
      const result = executor.cancelAgent('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('cancelAll', () => {
    it('should return 0 when no agents active', () => {
      const count = executor.cancelAll();
      expect(count).toBe(0);
    });
  });

  describe('formatResults', () => {
    it('should format results for display', async () => {
      const results = await executor.executeParallel([
        { id: 'agent1', name: 'Agent 1', task: 'Complete feature X' },
        { id: 'agent2', name: 'Agent 2', task: 'Fix bug Y' },
      ]);

      const formatted = executor.formatResults(results);

      expect(formatted).toContain('PARALLEL AGENT EXECUTION RESULTS');
      expect(formatted).toContain('Agents:');
      expect(formatted).toContain('agent1');
      expect(formatted).toContain('agent2');
    });

    it('should show success/failure counts', async () => {
      const results = await executor.executeParallel([
        { id: 'agent1', name: 'Agent 1', task: 'Task' },
      ]);

      const formatted = executor.formatResults(results);

      expect(formatted).toMatch(/\d+ succeeded/);
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      executor.updateConfig({ maxConcurrent: 16 });

      const config = executor.getConfig();
      expect(config.maxConcurrent).toBe(16);
    });
  });

  describe('events', () => {
    it('should emit parallel:start event', (done) => {
      executor.on('parallel:start', (data) => {
        expect(data.taskCount).toBeDefined();
        expect(data.maxConcurrent).toBeDefined();
        done();
      });

      executor.executeParallel([
        { id: 'test', name: 'Test', task: 'Task' },
      ]);
    });

    it('should emit agent:start event', (done) => {
      executor.on('agent:start', (data) => {
        expect(data.agentId).toBeDefined();
        expect(data.task).toBeDefined();
        done();
      });

      executor.executeParallel([
        { id: 'test', name: 'Test', task: 'Task' },
      ]);
    });

    it('should emit parallel:complete event', (done) => {
      executor.on('parallel:complete', (data) => {
        expect(data.duration).toBeDefined();
        expect(data.successCount).toBeDefined();
        done();
      });

      executor.executeParallel([
        { id: 'test', name: 'Test', task: 'Task' },
      ]);
    });

    it('should emit parallel:warning for too many tasks', (done) => {
      const smallExecutor = new AdvancedParallelExecutor({
        maxConcurrent: 2,
        useWorktrees: false,
      });

      smallExecutor.on('parallel:warning', (data) => {
        expect(data.message).toContain('exceeds max concurrent');
        done();
      });

      smallExecutor.executeParallel([
        { id: '1', name: 'A1', task: 'T1' },
        { id: '2', name: 'A2', task: 'T2' },
        { id: '3', name: 'A3', task: 'T3' },
      ]);
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getAdvancedParallelExecutor();
      const instance2 = getAdvancedParallelExecutor();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getAdvancedParallelExecutor();
      resetAdvancedParallelExecutor();
      const instance2 = getAdvancedParallelExecutor();
      expect(instance1).not.toBe(instance2);
    });
  });
});
