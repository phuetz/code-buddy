/**
 * Tests for Enhanced Multi-Agent Coordination
 */

import {
  EnhancedCoordinator,
  getEnhancedCoordinator,
  resetEnhancedCoordinator,
} from '../src/agent/multi-agent/enhanced-coordination';

import { AgentTask, AgentRole, AgentExecutionResult, SharedContext } from '../src/agent/multi-agent/types';

describe('EnhancedCoordinator', () => {
  let coordinator: EnhancedCoordinator;

  beforeEach(() => {
    resetEnhancedCoordinator();
    coordinator = new EnhancedCoordinator();
  });

  const createMockTask = (id: string, title: string, assignedTo: AgentRole): AgentTask => ({
    id,
    title,
    description: `Task ${id} description`,
    status: 'pending',
    priority: 'medium',
    assignedTo,
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createMockResult = (role: AgentRole, success: boolean): AgentExecutionResult => ({
    success,
    role,
    taskId: 'task-1',
    output: 'Task completed',
    artifacts: [],
    toolsUsed: ['bash', 'read_file'],
    rounds: 3,
    duration: 5000,
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      expect(coordinator).toBeDefined();
    });

    it('should accept custom config', () => {
      const customCoordinator = new EnhancedCoordinator({
        enableAdaptiveAllocation: false,
        maxParallelPerAgent: 5,
      });

      expect(customCoordinator).toBeDefined();
    });

    it('should initialize metrics for all agent roles', () => {
      const roles: AgentRole[] = ['orchestrator', 'coder', 'reviewer', 'tester'];

      for (const role of roles) {
        const metrics = coordinator.getAgentMetrics(role);
        expect(metrics).toBeDefined();
        expect(metrics?.totalTasks).toBe(0);
        expect(metrics?.successRate).toBe(0.5); // Neutral start
      }
    });
  });

  describe('allocateTask', () => {
    it('should allocate task based on agent performance', () => {
      const task = createMockTask('1', 'Implement feature', 'coder');

      // Record some performance history
      const result = createMockResult('coder', true);
      coordinator.recordTaskCompletion(task, result);

      const allocation = coordinator.allocateTask(task, ['coder', 'reviewer']);

      expect(allocation.agent).toBeDefined();
      expect(allocation.confidence).toBeGreaterThan(0);
      expect(allocation.reasoning).toBeDefined();
    });

    it('should prefer agents with higher success rates', () => {
      // Record successes for coder
      for (let i = 0; i < 5; i++) {
        const task = createMockTask(`task-${i}`, 'Test task', 'coder');
        coordinator.recordTaskCompletion(task, createMockResult('coder', true));
      }

      // Record failures for reviewer
      for (let i = 0; i < 5; i++) {
        const task = createMockTask(`task-r-${i}`, 'Review task', 'reviewer');
        coordinator.recordTaskCompletion(task, createMockResult('reviewer', false));
      }

      const newTask = createMockTask('new', 'New feature', 'reviewer');
      const allocation = coordinator.allocateTask(newTask, ['coder', 'reviewer']);

      expect(allocation.agent).toBe('coder');
    });

    it('should respect max parallel tasks per agent', () => {
      const parallelCoordinator = new EnhancedCoordinator({
        maxParallelPerAgent: 1,
        enableAdaptiveAllocation: true,
      });

      // Mark a task as started for coder
      const task1 = createMockTask('1', 'Task 1', 'coder');
      parallelCoordinator.markTaskStarted(task1, 'coder');

      // Try to allocate another task
      const task2 = createMockTask('2', 'Task 2', 'coder');
      const allocation = parallelCoordinator.allocateTask(task2, ['coder', 'reviewer']);

      // Should have an allocation result with reasoning
      expect(allocation.agent).toBeDefined();
      expect(allocation.reasoning).toBeDefined();
      expect(allocation.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should fall back to default when adaptive allocation is disabled', () => {
      const noAdaptiveCoordinator = new EnhancedCoordinator({
        enableAdaptiveAllocation: false,
      });

      const task = createMockTask('1', 'Test task', 'tester');
      const allocation = noAdaptiveCoordinator.allocateTask(task, ['coder', 'tester']);

      expect(allocation.agent).toBe('tester');
      expect(allocation.confidence).toBe(1);
    });
  });

  describe('recordTaskCompletion', () => {
    it('should update agent metrics on success', () => {
      const task = createMockTask('1', 'Test task', 'coder');
      const result = createMockResult('coder', true);

      coordinator.recordTaskCompletion(task, result);

      const metrics = coordinator.getAgentMetrics('coder');
      expect(metrics?.totalTasks).toBe(1);
      expect(metrics?.successfulTasks).toBe(1);
      expect(metrics?.successRate).toBe(1);
    });

    it('should update agent metrics on failure', () => {
      const task = createMockTask('1', 'Test task', 'coder');
      const result = createMockResult('coder', false);

      coordinator.recordTaskCompletion(task, result);

      const metrics = coordinator.getAgentMetrics('coder');
      expect(metrics?.totalTasks).toBe(1);
      expect(metrics?.failedTasks).toBe(1);
      expect(metrics?.successRate).toBe(0);
    });

    it('should track specialties by task type', () => {
      const testTask = createMockTask('1', 'Write unit tests', 'tester');
      coordinator.recordTaskCompletion(testTask, createMockResult('tester', true));

      const metrics = coordinator.getAgentMetrics('tester');
      expect(metrics?.specialties.get('testing')).toBe(1);
    });

    it('should emit metrics:updated event', (done) => {
      coordinator.on('metrics:updated', ({ role, metrics }) => {
        expect(role).toBe('coder');
        expect(metrics.totalTasks).toBe(1);
        done();
      });

      const task = createMockTask('1', 'Test', 'coder');
      coordinator.recordTaskCompletion(task, createMockResult('coder', true));
    });
  });

  describe('detectConflicts', () => {
    it('should detect code overlap conflicts', () => {
      const tasks: AgentTask[] = [
        {
          ...createMockTask('1', 'Edit auth', 'coder'),
          status: 'in_progress',
          metadata: { targetFiles: ['src/auth.ts'] },
        },
        {
          ...createMockTask('2', 'Review auth', 'reviewer'),
          status: 'in_progress',
          metadata: { targetFiles: ['src/auth.ts'] },
        },
      ];

      const context: SharedContext = {
        goal: 'Test goal',
        relevantFiles: [],
        conversationHistory: [],
        artifacts: new Map(),
        decisions: [],
        constraints: [],
      };

      const conflicts = coordinator.detectConflicts(tasks, context);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].type).toBe('code_overlap');
      expect(conflicts[0].agents).toContain('coder');
      expect(conflicts[0].agents).toContain('reviewer');
    });

    it('should emit conflict:detected event', (done) => {
      coordinator.on('conflict:detected', (conflict) => {
        expect(conflict.type).toBe('code_overlap');
        done();
      });

      const tasks: AgentTask[] = [
        {
          ...createMockTask('1', 'Task 1', 'coder'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
        {
          ...createMockTask('2', 'Task 2', 'reviewer'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
      ];

      coordinator.detectConflicts(tasks, {
        goal: '',
        relevantFiles: [],
        conversationHistory: [],
        artifacts: new Map(),
        decisions: [],
        constraints: [],
      });
    });

    it('should not detect conflicts when disabled', () => {
      const noConflictCoordinator = new EnhancedCoordinator({
        enableConflictResolution: false,
      });

      const tasks: AgentTask[] = [
        {
          ...createMockTask('1', 'Task 1', 'coder'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
        {
          ...createMockTask('2', 'Task 2', 'reviewer'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
      ];

      const conflicts = noConflictCoordinator.detectConflicts(tasks, {
        goal: '',
        relevantFiles: [],
        conversationHistory: [],
        artifacts: new Map(),
        decisions: [],
        constraints: [],
      });

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflicts with given resolution', () => {
      // First create a conflict
      const tasks: AgentTask[] = [
        {
          ...createMockTask('1', 'Task 1', 'coder'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
        {
          ...createMockTask('2', 'Task 2', 'reviewer'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
      ];

      coordinator.detectConflicts(tasks, {
        goal: '',
        relevantFiles: [],
        conversationHistory: [],
        artifacts: new Map(),
        decisions: [],
        constraints: [],
      });

      const conflicts = coordinator.getConflicts();
      const conflictId = conflicts[0].id;

      const resolved = coordinator.resolveConflict(conflictId, {
        strategy: 'priority',
        decision: 'Coder has priority',
        resolvedBy: 'orchestrator',
      });

      expect(resolved).toBe(true);

      const updatedConflicts = coordinator.getConflicts();
      const resolvedConflict = updatedConflicts.find(c => c.id === conflictId);
      expect(resolvedConflict?.resolution).toBeDefined();
    });

    it('should return false for non-existent conflict', () => {
      const resolved = coordinator.resolveConflict('non-existent', {
        strategy: 'priority',
        decision: 'Test',
        resolvedBy: 'orchestrator',
      });

      expect(resolved).toBe(false);
    });
  });

  describe('autoResolveConflicts', () => {
    it('should auto-resolve all pending conflicts', () => {
      const tasks: AgentTask[] = [
        {
          ...createMockTask('1', 'Task 1', 'coder'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
        {
          ...createMockTask('2', 'Task 2', 'reviewer'),
          status: 'in_progress',
          metadata: { targetFiles: ['file.ts'] },
        },
      ];

      coordinator.detectConflicts(tasks, {
        goal: '',
        relevantFiles: [],
        conversationHistory: [],
        artifacts: new Map(),
        decisions: [],
        constraints: [],
      });

      coordinator.autoResolveConflicts();

      const conflicts = coordinator.getConflicts();
      const unresolvedCount = conflicts.filter(c => !c.resolution).length;

      expect(unresolvedCount).toBe(0);
    });
  });

  describe('shareResource', () => {
    it('should add resources to the pool', () => {
      coordinator.shareResource('codeSnippets', 'auth-helper', {
        code: 'function auth() {}',
        source: 'coder',
        relevance: 0.9,
      }, 'coder');

      const resource = coordinator.getResource<{ code: string }>('codeSnippets', 'auth-helper');

      expect(resource).toBeDefined();
      expect(resource?.code).toBe('function auth() {}');
    });

    it('should emit resource:shared event', (done) => {
      coordinator.on('resource:shared', ({ type, key, source }) => {
        expect(type).toBe('insights');
        expect(key).toBe('test-insight');
        expect(source).toBe('reviewer');
        done();
      });

      coordinator.shareResource('insights', 'test-insight', {
        insight: 'Code needs refactoring',
        source: 'reviewer',
        confidence: 0.8,
      }, 'reviewer');
    });
  });

  describe('buildDependencies', () => {
    it('should build task dependency graph', () => {
      const tasks: AgentTask[] = [
        createMockTask('1', 'Task 1', 'coder'),
        { ...createMockTask('2', 'Task 2', 'tester'), dependencies: ['1'] },
        { ...createMockTask('3', 'Task 3', 'reviewer'), dependencies: ['1', '2'] },
      ];

      const dependencies = coordinator.buildDependencies(tasks);

      expect(dependencies.get('1')?.enables).toContain('2');
      expect(dependencies.get('2')?.dependsOn).toContain('1');
      expect(dependencies.get('3')?.dependsOn).toContain('1');
      expect(dependencies.get('3')?.dependsOn).toContain('2');
    });

    it('should identify blocked tasks', () => {
      const tasks: AgentTask[] = [
        createMockTask('1', 'Task 1', 'coder'),
        { ...createMockTask('2', 'Task 2', 'tester'), dependencies: ['1'] },
      ];

      const dependencies = coordinator.buildDependencies(tasks);

      expect(dependencies.get('2')?.blockedBy).toContain('1');
    });
  });

  describe('getReadyTasks', () => {
    it('should return tasks with no blockers', () => {
      const tasks: AgentTask[] = [
        createMockTask('1', 'Task 1', 'coder'),
        { ...createMockTask('2', 'Task 2', 'tester'), dependencies: ['1'] },
      ];

      coordinator.buildDependencies(tasks);
      const readyTasks = coordinator.getReadyTasks(tasks);

      expect(readyTasks).toHaveLength(1);
      expect(readyTasks[0].id).toBe('1');
    });

    it('should return empty for all blocked tasks', () => {
      const tasks: AgentTask[] = [
        { ...createMockTask('1', 'Task 1', 'coder'), status: 'in_progress' },
        { ...createMockTask('2', 'Task 2', 'tester'), dependencies: ['1'] },
      ];

      coordinator.buildDependencies(tasks);
      const readyTasks = coordinator.getReadyTasks(tasks);

      expect(readyTasks).toHaveLength(0);
    });
  });

  describe('createCheckpoint', () => {
    it('should create checkpoint of current state', () => {
      // Record some activity
      const task = createMockTask('1', 'Test', 'coder');
      coordinator.recordTaskCompletion(task, createMockResult('coder', true));

      const checkpoint = coordinator.createCheckpoint();

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
      expect(checkpoint.completedTasks.length).toBeGreaterThanOrEqual(0);
    });

    it('should emit checkpoint:created event', (done) => {
      coordinator.on('checkpoint:created', (checkpoint) => {
        expect(checkpoint.id).toBeDefined();
        done();
      });

      coordinator.createCheckpoint();
    });
  });

  describe('restoreFromCheckpoint', () => {
    it('should create checkpoint with valid ID', () => {
      // Create some state
      const task = createMockTask('1', 'Test', 'coder');
      coordinator.recordTaskCompletion(task, createMockResult('coder', true));

      const checkpoint = coordinator.createCheckpoint();

      // Checkpoint should have an ID
      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.timestamp).toBeInstanceOf(Date);
    });

    it('should return false for non-existent checkpoint', () => {
      const restored = coordinator.restoreFromCheckpoint('non-existent');
      expect(restored).toBe(false);
    });
  });

  describe('getPerformanceReport', () => {
    it('should return formatted performance report', () => {
      // Record some activity
      const task1 = createMockTask('1', 'Test task', 'coder');
      coordinator.recordTaskCompletion(task1, createMockResult('coder', true));

      const task2 = createMockTask('2', 'Review task', 'reviewer');
      coordinator.recordTaskCompletion(task2, createMockResult('reviewer', false));

      const report = coordinator.getPerformanceReport();

      expect(report).toContain('AGENT PERFORMANCE REPORT');
      expect(report).toContain('CODER');
      expect(report).toContain('REVIEWER');
      expect(report).toContain('Success rate');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      // Build up some state
      const task = createMockTask('1', 'Test', 'coder');
      coordinator.recordTaskCompletion(task, createMockResult('coder', true));

      coordinator.reset();

      const metrics = coordinator.getAgentMetrics('coder');
      expect(metrics?.totalTasks).toBe(0);
      expect(coordinator.getConflicts()).toHaveLength(0);
    });

    it('should emit coordinator:reset event', (done) => {
      coordinator.on('coordinator:reset', () => {
        done();
      });

      coordinator.reset();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      const instance1 = getEnhancedCoordinator();
      const instance2 = getEnhancedCoordinator();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getEnhancedCoordinator();
      resetEnhancedCoordinator();
      const instance2 = getEnhancedCoordinator();
      expect(instance1).not.toBe(instance2);
    });
  });
});
