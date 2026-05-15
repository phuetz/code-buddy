/**
 * Phase H — EnhancedCoordinator wired INTO MAS workflow loop tests.
 *
 * Validates that MAS:
 * 1. Honors TOML enable_adaptive_allocation flag (default off → no reassignment)
 * 2. Reassigns task to coordinator's choice when confidence ≥ threshold
 * 3. Falls back to task.assignedTo when confidence < threshold
 * 4. Calls detectConflicts after each phase if enabled
 * 5. Skips conflict detection if disabled
 *
 * Mocks EnhancedCoordinator + TOML config to isolate the integration logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoisted mocks
const mocks = vi.hoisted(() => {
  const allocateTaskMock = vi.fn();
  const detectConflictsMock = vi.fn(() => []);
  const markTaskStartedMock = vi.fn();
  const recordTaskCompletionMock = vi.fn();

  const fakeCoordinator = {
    allocateTask: allocateTaskMock,
    detectConflicts: detectConflictsMock,
    markTaskStarted: markTaskStartedMock,
    recordTaskCompletion: recordTaskCompletionMock,
  };

  const getEnhancedCoordinatorMock = vi.fn(() => fakeCoordinator);

  let tomlConfig: {
    enable_adaptive_allocation?: boolean;
    min_assignment_confidence?: number;
    enable_conflict_resolution?: boolean;
  } = {};
  const getConfigManagerMock = vi.fn(() => ({
    getConfig: () => ({
      multi_agent_system: { coordination: tomlConfig },
    }),
  }));
  const setTomlConfig = (cfg: typeof tomlConfig) => { tomlConfig = cfg; };

  return {
    allocateTaskMock, detectConflictsMock, markTaskStartedMock, recordTaskCompletionMock,
    fakeCoordinator, getEnhancedCoordinatorMock,
    getConfigManagerMock, setTomlConfig,
  };
});

vi.mock('../../../src/agent/multi-agent/enhanced-coordination.js', () => ({
  getEnhancedCoordinator: mocks.getEnhancedCoordinatorMock,
}));

vi.mock('../../../src/config/toml-config.js', () => ({
  getConfigManager: mocks.getConfigManagerMock,
}));

// Now import the MAS — its lazy imports will resolve to our mocks
import { MultiAgentSystem } from '../../../src/agent/multi-agent/multi-agent-system.js';
import type { AgentTask, AgentExecutionResult } from '../../../src/agent/multi-agent/types.js';

function makeTask(id: string, assignedTo: 'orchestrator' | 'coder' | 'reviewer' | 'tester' = 'coder'): AgentTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Desc for ${id}`,
    status: 'pending',
    priority: 'medium',
    assignedTo,
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('MAS — Phase H Coordinator integration', () => {
  let mas: MultiAgentSystem;

  beforeEach(() => {
    mas = new MultiAgentSystem('test-key');
    mocks.allocateTaskMock.mockReset();
    mocks.detectConflictsMock.mockReset().mockReturnValue([]);
    mocks.getEnhancedCoordinatorMock.mockClear();
    mocks.getConfigManagerMock.mockClear();
    mocks.setTomlConfig({});
    // Reset cached config (private field, accessed via reflection for tests)
    (mas as unknown as { coordinationConfigCache: unknown }).coordinationConfigCache = null;
  });

  afterEach(() => {
    mas.dispose();
  });

  describe('getAssignedAgent (private — accessed via reflection)', () => {
    const callHelper = (m: MultiAgentSystem, task: AgentTask) =>
      (m as unknown as { getAssignedAgent: (t: AgentTask) => Promise<string> }).getAssignedAgent(task);

    it('TOML enable_adaptive_allocation = false → returns task.assignedTo unchanged', async () => {
      mocks.setTomlConfig({ enable_adaptive_allocation: false });
      const task = makeTask('t1', 'reviewer');
      const result = await callHelper(mas, task);
      expect(result).toBe('reviewer');
      expect(mocks.allocateTaskMock).not.toHaveBeenCalled();
    });

    it('TOML missing → defaults to disabled → no reassignment', async () => {
      mocks.setTomlConfig({});
      const task = makeTask('t2', 'tester');
      const result = await callHelper(mas, task);
      expect(result).toBe('tester');
      expect(mocks.allocateTaskMock).not.toHaveBeenCalled();
    });

    it('TOML enabled + confidence ≥ threshold → reassigns to coordinator pick', async () => {
      mocks.setTomlConfig({ enable_adaptive_allocation: true, min_assignment_confidence: 0.6 });
      mocks.allocateTaskMock.mockReturnValue({ agent: 'reviewer', confidence: 0.85, reasoning: 'high success rate' });
      const task = makeTask('t3', 'coder');
      const result = await callHelper(mas, task);
      expect(result).toBe('reviewer');
      expect(mocks.allocateTaskMock).toHaveBeenCalledOnce();
    });

    it('TOML enabled + confidence < threshold → falls back to task.assignedTo', async () => {
      mocks.setTomlConfig({ enable_adaptive_allocation: true, min_assignment_confidence: 0.6 });
      mocks.allocateTaskMock.mockReturnValue({ agent: 'tester', confidence: 0.3, reasoning: 'low confidence' });
      const task = makeTask('t4', 'coder');
      const result = await callHelper(mas, task);
      expect(result).toBe('coder');
    });

    it('coordinator import fails → safe fallback to task.assignedTo', async () => {
      mocks.setTomlConfig({ enable_adaptive_allocation: true });
      mocks.getEnhancedCoordinatorMock.mockImplementationOnce(() => { throw new Error('coord boom'); });
      const task = makeTask('t5', 'orchestrator');
      const result = await callHelper(mas, task);
      expect(result).toBe('orchestrator');
    });
  });

  describe('detectAndEmitConflicts (private — accessed via reflection)', () => {
    const callHelper = (m: MultiAgentSystem, tasks: AgentTask[]) =>
      (m as unknown as { detectAndEmitConflicts: (t: AgentTask[]) => Promise<void> }).detectAndEmitConflicts(tasks);

    it('TOML enable_conflict_resolution = false → coordinator.detectConflicts NOT called', async () => {
      mocks.setTomlConfig({ enable_conflict_resolution: false });
      await callHelper(mas, [makeTask('t1')]);
      expect(mocks.detectConflictsMock).not.toHaveBeenCalled();
    });

    it('TOML missing → defaults disabled → no detection', async () => {
      mocks.setTomlConfig({});
      await callHelper(mas, [makeTask('t1')]);
      expect(mocks.detectConflictsMock).not.toHaveBeenCalled();
    });

    it('TOML enabled + no conflicts → no events emitted, no error', async () => {
      mocks.setTomlConfig({ enable_conflict_resolution: true });
      mocks.detectConflictsMock.mockReturnValue([]);
      const tasks = [makeTask('t1'), makeTask('t2')];

      const events: unknown[] = [];
      mas.on('workflow:event', (e) => events.push(e));

      await callHelper(mas, tasks);

      expect(mocks.detectConflictsMock).toHaveBeenCalledOnce();
      expect(events.filter((e) => (e as { type: string }).type === 'conflict_detected')).toHaveLength(0);
    });

    it('TOML enabled + 2 conflicts → 2 conflict_detected events emitted', async () => {
      mocks.setTomlConfig({ enable_conflict_resolution: true });
      mocks.detectConflictsMock.mockReturnValue([
        { id: 'c1', type: 'code_overlap', severity: 'high', agents: ['coder', 'reviewer'], description: 'auth.ts overlap', detectedAt: new Date() },
        { id: 'c2', type: 'resource_contention', severity: 'medium', agents: ['tester'], description: 'too many parallel', detectedAt: new Date() },
      ] as never);

      const events: unknown[] = [];
      mas.on('workflow:event', (e) => events.push(e));

      await callHelper(mas, [makeTask('t1'), makeTask('t2')]);

      const conflictEvents = events.filter((e) => (e as { type: string }).type === 'conflict_detected');
      expect(conflictEvents).toHaveLength(2);
      const first = conflictEvents[0] as { message: string; data: { conflict: { type: string } } };
      expect(first.message).toContain('auth.ts overlap');
      expect(first.data.conflict.type).toBe('code_overlap');
    });

    it('coordinator throws → emits visible degradation event without rethrowing', async () => {
      mocks.setTomlConfig({ enable_conflict_resolution: true });
      mocks.detectConflictsMock.mockImplementationOnce(() => { throw new Error('detect boom'); });

      const events: unknown[] = [];
      mas.on('workflow:event', (e) => events.push(e));

      await expect(callHelper(mas, [makeTask('t1')])).resolves.toBeUndefined();
      const warningEvents = events.filter((e) => (e as { type: string }).type === 'agent_message');
      expect(warningEvents).toHaveLength(1);
      const event = warningEvents[0] as { message: string; data: { warning: boolean; error: string } };
      expect(event.message).toContain('Conflict detection unavailable');
      expect(event.data.warning).toBe(true);
      expect(event.data.error).toContain('detect boom');
    });
  });
});
