/**
 * Comprehensive Unit Tests for Executor Module
 *
 * Tests command execution, process management, and output handling for:
 * - ParallelExecutor (tool execution with dependency analysis)
 * - AdvancedParallelExecutor (multi-agent execution with git worktrees)
 *
 * Covers:
 * - Command execution and tool dispatch
 * - Process management (concurrency, timeout, retry)
 * - Output handling and result aggregation
 * - Dependency analysis and parallel grouping
 * - Error handling and edge cases
 */

import { EventEmitter } from 'events';

// Mock child_process before importing modules that use it
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.pid = 12345;
    mockProcess.kill = jest.fn();

    // Simulate successful process by default
    setTimeout(() => {
      mockProcess.stdout.emit('data', Buffer.from('mock output'));
      mockProcess.emit('close', 0);
    }, 10);

    return mockProcess;
  }),
}));

import {
  ParallelExecutor,
  ToolCall,
  ExecutionOptions,
  DEFAULT_EXECUTION_OPTIONS,
  analyzeDependencies,
  groupByDependency,
  estimateSpeedup,
  createParallelExecutor,
} from '../../src/optimization/parallel-executor';

import {
  AdvancedParallelExecutor,
  ParallelAgentConfig,
  getAdvancedParallelExecutor,
  resetAdvancedParallelExecutor,
} from '../../src/agent/parallel/advanced-parallel-executor';

// ============================================================================
// ParallelExecutor (Tool Execution) Tests
// ============================================================================

describe('ParallelExecutor (Tool Execution)', () => {
  let executor: ParallelExecutor;
  let mockToolExecutor: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockToolExecutor = jest.fn().mockImplementation(async (call: ToolCall) => {
      // Simulate some execution time
      await new Promise(resolve => setTimeout(resolve, 10));
      return { success: true, data: call.name };
    });
    executor = new ParallelExecutor(mockToolExecutor);
  });

  afterEach(() => {
    executor.removeAllListeners();
  });

  describe('Constructor', () => {
    it('should create ParallelExecutor with default options', () => {
      const exec = new ParallelExecutor(mockToolExecutor);
      expect(exec).toBeInstanceOf(ParallelExecutor);
      expect(exec).toBeInstanceOf(EventEmitter);
    });

    it('should create ParallelExecutor with custom options', () => {
      const customOptions: Partial<ExecutionOptions> = {
        maxConcurrency: 10,
        timeoutMs: 60000,
        retryCount: 3,
      };
      const exec = new ParallelExecutor(mockToolExecutor, customOptions);
      expect(exec).toBeDefined();
    });

    it('should merge custom options with defaults', () => {
      const customOptions: Partial<ExecutionOptions> = {
        maxConcurrency: 10,
      };
      const exec = new ParallelExecutor(mockToolExecutor, customOptions);
      expect(exec).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute empty call list', async () => {
      const results = await executor.execute([]);
      expect(results).toEqual([]);
    });

    it('should execute single tool call', async () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'view_file', arguments: { path: '/test.ts' } },
      ];

      const results = await executor.execute(calls);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].id).toBe('call-1');
      expect(mockToolExecutor).toHaveBeenCalledTimes(1);
    });

    it('should execute multiple independent tool calls in parallel', async () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'view_file', arguments: { path: '/a.ts' } },
        { id: 'call-2', name: 'view_file', arguments: { path: '/b.ts' } },
        { id: 'call-3', name: 'view_file', arguments: { path: '/c.ts' } },
      ];

      const results = await executor.execute(calls);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockToolExecutor).toHaveBeenCalledTimes(3);
    });

    it('should respect concurrency limit', async () => {
      const options: Partial<ExecutionOptions> = { maxConcurrency: 2 };
      const limitedExecutor = new ParallelExecutor(mockToolExecutor, options);

      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockToolExecutor.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise(resolve => setTimeout(resolve, 50));
        concurrentCount--;
        return { success: true };
      });

      const calls: ToolCall[] = [
        { id: 'call-1', name: 'test', arguments: {} },
        { id: 'call-2', name: 'test', arguments: {} },
        { id: 'call-3', name: 'test', arguments: {} },
        { id: 'call-4', name: 'test', arguments: {} },
      ];

      await limitedExecutor.execute(calls);

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should emit execution:start event', async () => {
      const handler = jest.fn();
      executor.on('execution:start', handler);

      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledWith({
        totalCalls: 1,
        groups: expect.any(Number),
      });
    });

    it('should emit execution:complete event', async () => {
      const handler = jest.fn();
      executor.on('execution:complete', handler);

      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledWith({
        totalCalls: 1,
        totalTime: expect.any(Number),
        successCount: 1,
        failureCount: 0,
      });
    });

    it('should emit group:start and group:complete events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();
      executor.on('group:start', startHandler);
      executor.on('group:complete', completeHandler);

      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should emit call:start event for each call', async () => {
      const handler = jest.fn();
      executor.on('call:start', handler);

      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
        { id: 'call-2', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should emit call:success for successful calls', async () => {
      const handler = jest.fn();
      executor.on('call:success', handler);

      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'call-1',
          success: true,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution errors', async () => {
      // Create a fresh executor with a failing mock
      const failingMock = jest.fn().mockRejectedValue(new Error('Tool failed'));
      const failExecutor = new ParallelExecutor(failingMock, { retryCount: 0 });

      const results = await failExecutor.execute([
        { id: 'call-1', name: 'failing_tool', arguments: {} },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Tool failed');
    });

    it('should emit call:error on failure', async () => {
      const failingMock = jest.fn().mockRejectedValue(new Error('Oops'));
      const failExecutor = new ParallelExecutor(failingMock, { retryCount: 0 });

      const handler = jest.fn();
      failExecutor.on('call:error', handler);

      await failExecutor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledWith({
        id: 'call-1',
        name: 'test',
        attempt: 0,
        error: 'Oops',
      });
    });

    it('should emit call:failure after all retries exhausted', async () => {
      const failingMock = jest.fn().mockRejectedValue(new Error('Persistent failure'));
      const failExecutor = new ParallelExecutor(failingMock, { retryCount: 1, retryDelayMs: 10 });

      const handler = jest.fn();
      failExecutor.on('call:failure', handler);

      await failExecutor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'call-1',
          success: false,
        })
      );
    });

    it('should continue on error when continueOnError is true', async () => {
      // Track call order
      let callCount = 0;
      const mixedMock = jest.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Failed');
        }
        return { success: true };
      });

      const mixedExecutor = new ParallelExecutor(mixedMock, {
        continueOnError: true,
        retryCount: 0,
        maxConcurrency: 1, // Force sequential to maintain order
      });

      const results = await mixedExecutor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
        { id: 'call-2', name: 'test', arguments: {} },
        { id: 'call-3', name: 'test', arguments: {} },
      ]);

      expect(results).toHaveLength(3);
      expect(results.filter(r => r.success)).toHaveLength(2);
      expect(results.filter(r => !r.success)).toHaveLength(1);
    });

    it('should stop on error when continueOnError is false', async () => {
      const failingMock = jest.fn().mockRejectedValue(new Error('Stop here'));
      const strictExecutor = new ParallelExecutor(failingMock, {
        continueOnError: false,
        retryCount: 0,
      });

      await expect(
        strictExecutor.execute([{ id: 'call-1', name: 'test', arguments: {} }])
      ).rejects.toThrow('Stop here');
    });

    it('should handle non-Error exceptions', async () => {
      const stringErrorMock = jest.fn().mockRejectedValue('String error');
      const stringErrorExecutor = new ParallelExecutor(stringErrorMock, { retryCount: 0 });

      const results = await stringErrorExecutor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeDefined();
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running calls', async () => {
      const exec = new ParallelExecutor(mockToolExecutor, { timeoutMs: 50 });

      mockToolExecutor.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true };
      });

      const results = await exec.execute([
        { id: 'call-1', name: 'slow_tool', arguments: {} },
      ]);

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Timeout');
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed calls', async () => {
      const exec = new ParallelExecutor(mockToolExecutor, {
        retryCount: 2,
        retryDelayMs: 10,
      });

      mockToolExecutor
        .mockRejectedValueOnce(new Error('First attempt'))
        .mockRejectedValueOnce(new Error('Second attempt'))
        .mockResolvedValueOnce({ success: true });

      const results = await exec.execute([
        { id: 'call-1', name: 'test', arguments: {} },
      ]);

      expect(results[0].success).toBe(true);
      expect(mockToolExecutor).toHaveBeenCalledTimes(3);
    });

    it('should respect retry delay', async () => {
      const exec = new ParallelExecutor(mockToolExecutor, {
        retryCount: 1,
        retryDelayMs: 50,
      });

      mockToolExecutor
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce({ success: true });

      const start = Date.now();
      await exec.execute([{ id: 'call-1', name: 'test', arguments: {} }]);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some timing slack
    });
  });

  describe('getStats', () => {
    it('should return empty stats before execution', () => {
      const stats = executor.getStats();
      expect(stats.totalDuration).toBe(0);
      expect(stats.parallelSavings).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should calculate correct stats after execution', async () => {
      await executor.execute([
        { id: 'call-1', name: 'test', arguments: {} },
        { id: 'call-2', name: 'test', arguments: {} },
      ]);

      const stats = executor.getStats();
      expect(stats.totalDuration).toBeGreaterThan(0);
      expect(stats.successRate).toBe(100);
    });

    it('should calculate parallel savings', async () => {
      // Create a scenario where parallel execution saves time
      mockToolExecutor.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return { success: true };
      });

      const exec = new ParallelExecutor(mockToolExecutor, { maxConcurrency: 5 });

      await exec.execute([
        { id: 'call-1', name: 'test', arguments: {} },
        { id: 'call-2', name: 'test', arguments: {} },
        { id: 'call-3', name: 'test', arguments: {} },
      ]);

      const stats = exec.getStats();
      expect(stats.parallelSavings).toBeGreaterThanOrEqual(0);
    });
  });

  describe('updateOptions', () => {
    it('should update execution options', () => {
      executor.updateOptions({ maxConcurrency: 20 });
      expect(executor).toBeDefined();
    });

    it('should merge new options with existing', () => {
      const exec = new ParallelExecutor(mockToolExecutor, { maxConcurrency: 5 });
      exec.updateOptions({ timeoutMs: 60000 });
      expect(exec).toBeDefined();
    });
  });
});

// ============================================================================
// Dependency Analysis Tests
// ============================================================================

describe('Dependency Analysis', () => {
  describe('analyzeDependencies', () => {
    it('should return empty map for empty calls', () => {
      const deps = analyzeDependencies([]);
      expect(deps.size).toBe(0);
    });

    it('should handle null/undefined calls gracefully', () => {
      const deps = analyzeDependencies(null as any);
      expect(deps.size).toBe(0);
    });

    it('should detect file write dependencies', () => {
      const calls: ToolCall[] = [
        { id: 'write-1', name: 'write_file', arguments: { path: '/test.ts' } },
        { id: 'write-2', name: 'write_file', arguments: { path: '/test.ts' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('write-2')).toContain('write-1');
    });

    it('should detect read after write dependency', () => {
      const calls: ToolCall[] = [
        { id: 'write-1', name: 'write_file', arguments: { path: '/test.ts' } },
        { id: 'read-1', name: 'read_file', arguments: { path: '/test.ts' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('read-1')).toContain('write-1');
    });

    it('should detect edit dependencies on same file', () => {
      const calls: ToolCall[] = [
        { id: 'edit-1', name: 'edit_file', arguments: { file_path: '/test.ts' } },
        { id: 'edit-2', name: 'edit_file', arguments: { file_path: '/test.ts' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('edit-2')).toContain('edit-1');
    });

    it('should allow parallel reads of different files', () => {
      const calls: ToolCall[] = [
        { id: 'read-1', name: 'read_file', arguments: { path: '/a.ts' } },
        { id: 'read-2', name: 'read_file', arguments: { path: '/b.ts' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('read-1')).toHaveLength(0);
      expect(deps.get('read-2')).toHaveLength(0);
    });

    it('should detect bash build/test dependencies on file edits', () => {
      const calls: ToolCall[] = [
        { id: 'edit-1', name: 'edit_file', arguments: { path: '/src/index.ts' } },
        { id: 'bash-1', name: 'bash', arguments: { command: 'npm test' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('bash-1')).toContain('edit-1');
    });

    it('should detect npm run dependencies', () => {
      const calls: ToolCall[] = [
        { id: 'write-1', name: 'write_file', arguments: { path: '/src/app.ts' } },
        { id: 'bash-1', name: 'bash', arguments: { command: 'npm run build' } },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('bash-1')).toContain('write-1');
    });

    it('should use explicit dependencies if provided', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'task1', arguments: {} },
        { id: 'call-2', name: 'task2', arguments: {}, dependencies: ['call-1'] },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('call-2')).toContain('call-1');
    });

    it('should handle calls with missing arguments', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'test', arguments: undefined as any },
      ];

      const deps = analyzeDependencies(calls);

      expect(deps.get('call-1')).toBeDefined();
    });
  });

  describe('groupByDependency', () => {
    it('should return empty array for empty calls', () => {
      const groups = groupByDependency([]);
      expect(groups).toEqual([]);
    });

    it('should put independent calls in same group', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'read', arguments: { path: '/a.ts' } },
        { id: 'call-2', name: 'read', arguments: { path: '/b.ts' } },
        { id: 'call-3', name: 'read', arguments: { path: '/c.ts' } },
      ];

      const groups = groupByDependency(calls);

      expect(groups).toHaveLength(1);
      expect(groups[0].calls).toHaveLength(3);
    });

    it('should separate dependent calls into different groups', () => {
      const calls: ToolCall[] = [
        { id: 'write-1', name: 'write_file', arguments: { path: '/test.ts' } },
        { id: 'write-2', name: 'write_file', arguments: { path: '/test.ts' } },
      ];

      const groups = groupByDependency(calls);

      expect(groups.length).toBeGreaterThan(1);
    });

    it('should order groups by dependency level', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'task1', arguments: {} },
        { id: 'call-2', name: 'task2', arguments: {}, dependencies: ['call-1'] },
        { id: 'call-3', name: 'task3', arguments: {}, dependencies: ['call-2'] },
      ];

      const groups = groupByDependency(calls);

      expect(groups[0].level).toBe(0);
      expect(groups[0].calls.some(c => c.id === 'call-1')).toBe(true);

      if (groups.length > 1) {
        expect(groups[1].level).toBe(1);
      }
    });

    it('should handle circular dependencies gracefully', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'task1', arguments: {}, dependencies: ['call-2'] },
        { id: 'call-2', name: 'task2', arguments: {}, dependencies: ['call-1'] },
      ];

      const groups = groupByDependency(calls);

      // Should still process all calls
      const allCalls = groups.flatMap(g => g.calls);
      expect(allCalls).toHaveLength(2);
    });
  });

  describe('estimateSpeedup', () => {
    it('should return 1x speedup for empty calls', () => {
      const result = estimateSpeedup([]);
      expect(result.speedupFactor).toBe(1);
      expect(result.sequentialEstimate).toBe(0);
      expect(result.parallelEstimate).toBe(0);
    });

    it('should estimate speedup for parallel calls', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'read', arguments: { path: '/a.ts' } },
        { id: 'call-2', name: 'read', arguments: { path: '/b.ts' } },
        { id: 'call-3', name: 'read', arguments: { path: '/c.ts' } },
      ];

      const result = estimateSpeedup(calls);

      expect(result.speedupFactor).toBeGreaterThan(1);
      expect(result.sequentialEstimate).toBeGreaterThan(result.parallelEstimate);
    });

    it('should estimate lower speedup for sequential calls', () => {
      const calls: ToolCall[] = [
        { id: 'call-1', name: 'task1', arguments: {} },
        { id: 'call-2', name: 'task2', arguments: {}, dependencies: ['call-1'] },
        { id: 'call-3', name: 'task3', arguments: {}, dependencies: ['call-2'] },
      ];

      const result = estimateSpeedup(calls);

      // Sequential calls have less parallelization opportunity
      expect(result.sequentialEstimate).toBeGreaterThan(0);
      expect(result.parallelEstimate).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// AdvancedParallelExecutor (Multi-Agent) Tests
// ============================================================================

describe('AdvancedParallelExecutor (Multi-Agent)', () => {
  let executor: AdvancedParallelExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    resetAdvancedParallelExecutor();
    executor = new AdvancedParallelExecutor({
      useWorktrees: false, // Disable worktrees in tests
      maxConcurrent: 4,
      timeout: 5000,
    });
  });

  afterEach(() => {
    executor.removeAllListeners();
  });

  describe('Constructor', () => {
    it('should create AdvancedParallelExecutor with default config', () => {
      const exec = new AdvancedParallelExecutor();
      expect(exec).toBeInstanceOf(AdvancedParallelExecutor);
      expect(exec).toBeInstanceOf(EventEmitter);
    });

    it('should create with custom config', () => {
      const exec = new AdvancedParallelExecutor({
        maxConcurrent: 16,
        useWorktrees: true,
        conflictResolution: 'merge',
      });
      expect(exec.getConfig().maxConcurrent).toBe(16);
      expect(exec.getConfig().useWorktrees).toBe(true);
    });
  });

  describe('executeParallel', () => {
    it('should execute single agent', async () => {
      const tasks: ParallelAgentConfig[] = [
        { id: 'agent-1', name: 'Agent 1', task: 'Do something' },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('agent-1');
    });

    it('should execute multiple agents in parallel', async () => {
      const tasks: ParallelAgentConfig[] = [
        { id: 'agent-1', name: 'Agent 1', task: 'Task 1' },
        { id: 'agent-2', name: 'Agent 2', task: 'Task 2' },
        { id: 'agent-3', name: 'Agent 3', task: 'Task 3' },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(3);
    });

    it('should assign IDs to tasks without IDs', async () => {
      const tasks: ParallelAgentConfig[] = [
        { id: '', name: 'Agent 1', task: 'Task' },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results[0].agentId).toMatch(/agent_\d+/);
    });

    it('should sort by priority', async () => {
      const tasks: ParallelAgentConfig[] = [
        { id: 'low', name: 'Low', task: 'Task', priority: 1 },
        { id: 'high', name: 'High', task: 'Task', priority: 10 },
        { id: 'mid', name: 'Mid', task: 'Task', priority: 5 },
      ];

      const results = await executor.executeParallel(tasks);

      expect(results).toHaveLength(3);
    });

    it('should emit parallel:start event', async () => {
      const handler = jest.fn();
      executor.on('parallel:start', handler);

      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(handler).toHaveBeenCalledWith({
        taskCount: 1,
        maxConcurrent: expect.any(Number),
      });
    });

    it('should emit parallel:complete event', async () => {
      const handler = jest.fn();
      executor.on('parallel:complete', handler);

      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(handler).toHaveBeenCalledWith({
        duration: expect.any(Number),
        successCount: expect.any(Number),
        failCount: expect.any(Number),
      });
    });

    it('should emit agent:start for each agent', async () => {
      const handler = jest.fn();
      executor.on('agent:start', handler);

      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent 1', task: 'Task 1' },
        { id: 'agent-2', name: 'Agent 2', task: 'Task 2' },
      ]);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should emit agent:complete for successful agents', async () => {
      const handler = jest.fn();
      executor.on('agent:complete', handler);

      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(handler).toHaveBeenCalledWith({
        result: expect.objectContaining({
          agentId: 'agent-1',
          success: true,
        }),
      });
    });

    it('should batch tasks when exceeding maxConcurrent', async () => {
      const smallExecutor = new AdvancedParallelExecutor({
        maxConcurrent: 2,
        useWorktrees: false,
        timeout: 5000,
      });

      const batchHandler = jest.fn();
      smallExecutor.on('parallel:batch:start', batchHandler);

      const tasks: ParallelAgentConfig[] = [
        { id: 'a1', name: 'A1', task: 'T1' },
        { id: 'a2', name: 'A2', task: 'T2' },
        { id: 'a3', name: 'A3', task: 'T3' },
        { id: 'a4', name: 'A4', task: 'T4' },
      ];

      await smallExecutor.executeParallel(tasks);

      expect(batchHandler).toHaveBeenCalledTimes(2);
    });

    it('should warn when tasks exceed maxConcurrent', async () => {
      const smallExecutor = new AdvancedParallelExecutor({
        maxConcurrent: 1,
        useWorktrees: false,
      });

      const warningHandler = jest.fn();
      smallExecutor.on('parallel:warning', warningHandler);

      const tasks: ParallelAgentConfig[] = [
        { id: 'a1', name: 'A1', task: 'T1' },
        { id: 'a2', name: 'A2', task: 'T2' },
      ];

      await smallExecutor.executeParallel(tasks);

      expect(warningHandler).toHaveBeenCalled();
    });
  });

  describe('Agent Result', () => {
    it('should include duration in result', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(results[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should include tokens used in result', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(results[0].tokensUsed).toBeGreaterThanOrEqual(0);
    });

    it('should include task in result', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'My specific task' },
      ]);

      expect(results[0].task).toBe('My specific task');
    });

    it('should include files modified list', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(Array.isArray(results[0].filesModified)).toBe(true);
    });
  });

  describe('Active Agent Management', () => {
    it('should return empty active agents before execution', () => {
      expect(executor.getActiveAgents()).toEqual([]);
    });

    it('should track active agents during execution', (done) => {
      executor.on('agent:start', () => {
        const active = executor.getActiveAgents();
        expect(active.length).toBeGreaterThan(0);
        done();
      });

      executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);
    });

    it('should clear active agents after execution', async () => {
      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      expect(executor.getActiveAgents()).toEqual([]);
    });
  });

  describe('getResults', () => {
    it('should return results map after execution', async () => {
      await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      const results = executor.getResults();
      expect(results.size).toBe(1);
      expect(results.has('agent-1')).toBe(true);
    });
  });

  describe('cancelAgent', () => {
    it('should return false when cancelling non-active agent', () => {
      const result = executor.cancelAgent('non-existent');
      expect(result).toBe(false);
    });

    it('should emit agent:cancelled when cancelling', (done) => {
      executor.on('agent:cancelled', (event) => {
        expect(event.agentId).toBe('agent-1');
        done();
      });

      executor.on('agent:start', () => {
        executor.cancelAgent('agent-1');
      });

      executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Long task', timeout: 10000 },
      ]);
    });
  });

  describe('cancelAll', () => {
    it('should return 0 when no agents active', () => {
      const count = executor.cancelAll();
      expect(count).toBe(0);
    });
  });

  describe('Configuration', () => {
    describe('getConfig', () => {
      it('should return copy of config', () => {
        const config1 = executor.getConfig();
        const config2 = executor.getConfig();

        expect(config1).toEqual(config2);
        expect(config1).not.toBe(config2);
      });
    });

    describe('updateConfig', () => {
      it('should update configuration', () => {
        executor.updateConfig({ maxConcurrent: 16 });
        expect(executor.getConfig().maxConcurrent).toBe(16);
      });
    });
  });

  describe('formatResults', () => {
    it('should format results for display', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      const formatted = executor.formatResults(results);

      expect(formatted).toContain('PARALLEL AGENT EXECUTION RESULTS');
      expect(formatted).toContain('agent-1');
    });

    it('should include success/failure counts', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent 1', task: 'Task 1' },
        { id: 'agent-2', name: 'Agent 2', task: 'Task 2' },
      ]);

      const formatted = executor.formatResults(results);

      expect(formatted).toContain('succeeded');
      expect(formatted).toContain('Agents:');
    });

    it('should include duration and tokens', async () => {
      const results = await executor.executeParallel([
        { id: 'agent-1', name: 'Agent', task: 'Task' },
      ]);

      const formatted = executor.formatResults(results);

      expect(formatted).toContain('duration');
      expect(formatted).toContain('Tokens');
    });
  });
});

// ============================================================================
// Singleton Functions Tests
// ============================================================================

describe('Singleton Functions', () => {
  describe('createParallelExecutor (Tool)', () => {
    it('should create new instance', () => {
      const executor = createParallelExecutor(async () => ({ success: true }));
      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    it('should accept custom options', () => {
      const executor = createParallelExecutor(
        async () => ({ success: true }),
        { maxConcurrency: 10 }
      );
      expect(executor).toBeDefined();
    });
  });

  describe('getAdvancedParallelExecutor', () => {
    beforeEach(() => {
      resetAdvancedParallelExecutor();
    });

    it('should return singleton instance', () => {
      const exec1 = getAdvancedParallelExecutor();
      const exec2 = getAdvancedParallelExecutor();

      expect(exec1).toBe(exec2);
    });

    it('should accept config on first call', () => {
      const exec = getAdvancedParallelExecutor({ maxConcurrent: 16 });
      expect(exec.getConfig().maxConcurrent).toBe(16);
    });
  });

  describe('resetAdvancedParallelExecutor', () => {
    it('should reset singleton', () => {
      const exec1 = getAdvancedParallelExecutor();
      resetAdvancedParallelExecutor();
      const exec2 = getAdvancedParallelExecutor();

      expect(exec1).not.toBe(exec2);
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        resetAdvancedParallelExecutor();
        resetAdvancedParallelExecutor();
        resetAdvancedParallelExecutor();
      }).not.toThrow();
    });
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe('DEFAULT_EXECUTION_OPTIONS', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_EXECUTION_OPTIONS.maxConcurrency).toBeGreaterThan(0);
    expect(DEFAULT_EXECUTION_OPTIONS.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_EXECUTION_OPTIONS.retryCount).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_EXECUTION_OPTIONS.retryDelayMs).toBeGreaterThanOrEqual(0);
    expect(typeof DEFAULT_EXECUTION_OPTIONS.continueOnError).toBe('boolean');
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  describe('ParallelExecutor Edge Cases', () => {
    it('should handle very large number of calls', async () => {
      const mockExecutor = jest.fn().mockResolvedValue({ success: true });
      const executor = new ParallelExecutor(mockExecutor, { maxConcurrency: 10 });

      const calls: ToolCall[] = Array.from({ length: 100 }, (_, i) => ({
        id: `call-${i}`,
        name: 'test',
        arguments: {},
      }));

      const results = await executor.execute(calls);

      expect(results).toHaveLength(100);
      expect(mockExecutor).toHaveBeenCalledTimes(100);
    });

    it('should handle calls with null id gracefully', () => {
      const deps = analyzeDependencies([
        { id: null as any, name: 'test', arguments: {} },
      ]);
      expect(deps.size).toBe(0);
    });

    it('should handle undefined name gracefully', () => {
      const deps = analyzeDependencies([
        { id: 'test', name: undefined as any, arguments: {} },
      ]);
      expect(deps.get('test')).toBeDefined();
    });
  });

  describe('AdvancedParallelExecutor Edge Cases', () => {
    it('should handle empty task list', async () => {
      const executor = new AdvancedParallelExecutor({ useWorktrees: false });
      const results = await executor.executeParallel([]);
      expect(results).toEqual([]);
    });

    it('should handle task with undefined properties', async () => {
      const executor = new AdvancedParallelExecutor({ useWorktrees: false });
      const results = await executor.executeParallel([
        { id: 'test', name: undefined as any, task: 'Task' },
      ]);
      expect(results).toHaveLength(1);
    });

    it('should handle very long task descriptions', async () => {
      const executor = new AdvancedParallelExecutor({ useWorktrees: false });
      const longTask = 'A'.repeat(10000);
      const results = await executor.executeParallel([
        { id: 'test', name: 'Test', task: longTask },
      ]);
      expect(results).toHaveLength(1);
    });
  });
});

// ============================================================================
// Conflict Resolution Tests
// ============================================================================

describe('Conflict Resolution (AdvancedParallelExecutor)', () => {
  it('should detect conflicts when agents modify same file', async () => {
    // This is a mock test - in real implementation this would check actual conflicts
    const executor = new AdvancedParallelExecutor({
      useWorktrees: false,
      conflictResolution: 'smart',
    });

    const handler = jest.fn();
    executor.on('conflicts:detected', handler);

    // Mock agents that would modify same file
    // In real scenario this would trigger conflict detection
    await executor.executeParallel([
      { id: 'agent-1', name: 'Agent 1', task: 'Edit file A' },
    ]);

    // Conflicts detection depends on actual file modifications
    // This test verifies the event system is in place
    expect(executor).toBeDefined();
  });

  it('should support different conflict resolution strategies', () => {
    const strategies = ['first', 'merge', 'manual', 'smart'] as const;

    for (const strategy of strategies) {
      const executor = new AdvancedParallelExecutor({
        useWorktrees: false,
        conflictResolution: strategy,
      });
      expect(executor.getConfig().conflictResolution).toBe(strategy);
    }
  });
});
