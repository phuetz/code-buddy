/**
 * Unit tests for EnhancedCoordinator
 * Tests adaptive allocation, conflict resolution, metrics tracking, and resource pooling
 */

import { EnhancedCoordinator, createEnhancedCoordinator, getEnhancedCoordinator, resetEnhancedCoordinator } from '../../src/agent/multi-agent/enhanced-coordination';
import { AgentRole, AgentTask, AgentExecutionResult } from '../../src/agent/multi-agent/types';

describe('EnhancedCoordinator', () => {
  let coordinator: EnhancedCoordinator;

  beforeEach(() => {
    resetEnhancedCoordinator();
    coordinator = new EnhancedCoordinator({
      enableAdaptiveAllocation: true,
      minAssignmentConfidence: 0.1, // Set low for easier testing
    });
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default metrics', () => {
      const metrics = coordinator.getAgentMetrics('coder');
      expect(metrics).toBeDefined();
      expect(metrics?.successRate).toBe(0.5);
      expect(metrics?.totalTasks).toBe(0);
    });

    it('should initialize empty resource pool', () => {
      const pool = coordinator.getResourcePool();
      expect(pool.codeSnippets).toBeInstanceOf(Map);
      expect(pool.insights).toBeInstanceOf(Map);
    });
  });

  describe('allocateTask()', () => {
    const task: AgentTask = {
      id: 'task-1',
      title: 'Fix a bug',
      description: 'Find and fix the null pointer exception',
      status: 'pending',
      priority: 'high',
      assignedTo: 'coder',
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('should allocate to default agent when no metrics exist', () => {
      const result = coordinator.allocateTask(task, ['coder', 'reviewer']);
      expect(result.agent).toBe('coder');
    });

    it('should allocate based on performance', () => {
      // Improve reviewer metrics
      const reviewerResult: AgentExecutionResult = {
        success: true,
        role: 'reviewer',
        taskId: 't1',
        output: 'ok',
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 100,
      };
      
      // Simulate multiple successes for reviewer
      for (let i = 0; i < 5; i++) {
        coordinator.recordTaskCompletion(task, reviewerResult);
      }

      const result = coordinator.allocateTask(task, ['coder', 'reviewer']);
      // Reviewer should have much higher score now
      expect(result.agent).toBe('reviewer');
    });

    it('should respect max parallel tasks per agent', () => {
      const configCoordinator = new EnhancedCoordinator({
        maxParallelPerAgent: 1,
        minAssignmentConfidence: 0 // Ensure any score is accepted
      });
      
      configCoordinator.markTaskStarted(task, 'coder');
      
      const result = configCoordinator.allocateTask(task, ['coder', 'reviewer']);
      // Coder is busy, should pick reviewer
      expect(result.agent).toBe('reviewer');
    });
  });

  describe('Conflict Detection and Resolution', () => {
    const tasks: AgentTask[] = [
      {
        id: 'task-1',
        title: 'T1',
        description: 'D1',
        status: 'in_progress',
        assignedTo: 'coder',
        metadata: { targetFiles: ['src/app.ts'] },
        priority: 'high',
        dependencies: [],
        subtasks: [],
        artifacts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'task-2',
        title: 'T2',
        description: 'D2',
        status: 'in_progress',
        assignedTo: 'reviewer',
        metadata: { targetFiles: ['src/app.ts'] },
        priority: 'high',
        dependencies: [],
        subtasks: [],
        artifacts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    it('should detect code overlap conflicts', () => {
      const conflicts = coordinator.detectConflicts(tasks, {} as any);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('code_overlap');
      expect(conflicts[0].agents).toContain('coder');
      expect(conflicts[0].agents).toContain('reviewer');
    });

    it('should resolve conflicts', () => {
      const conflicts = coordinator.detectConflicts(tasks, {} as any);
      const conflictId = conflicts[0].id;
      
      const resolved = coordinator.resolveConflict(conflictId, {
        strategy: 'priority',
        decision: 'Reviewer wins',
        resolvedBy: 'orchestrator'
      });

      expect(resolved).toBe(true);
      const conflict = coordinator.getConflicts()[0];
      expect(conflict.resolution).toBeDefined();
      expect(conflict.resolution?.decision).toBe('Reviewer wins');
    });

    it('should auto-resolve conflicts', () => {
      coordinator.detectConflicts(tasks, {} as any);
      coordinator.autoResolveConflicts();
      
      const conflict = coordinator.getConflicts()[0];
      expect(conflict.resolution).toBeDefined();
      expect(conflict.resolution?.strategy).toBe('priority');
    });
  });

  describe('Resource Pooling', () => {
    it('should share and retrieve resources', () => {
      coordinator.shareResource('insights', 'key1', { insight: 'test', source: 'coder', confidence: 0.9 }, 'coder');
      
      const resource = coordinator.getResource<any>('insights', 'key1');
      expect(resource).toBeDefined();
      expect(resource.insight).toBe('test');
    });

    it('should emit event when resource shared', () => {
      const handler = jest.fn();
      coordinator.on('resource:shared', handler);
      
      coordinator.shareResource('codeSnippets', 's1', { code: 'x', source: 'coder', relevance: 1 }, 'coder');
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'codeSnippets',
        key: 's1'
      }));
    });
  });

  describe('Checkpointing', () => {
    it('should create and restore checkpoints', () => {
      coordinator.shareResource('insights', 'i1', {
        insight: 'v1',
        source: 'coder',
        confidence: 0.9,
      }, 'coder');
      const checkpoint = coordinator.createCheckpoint();
      
      coordinator.reset();
      expect(coordinator.getResource('insights', 'i1')).toBeUndefined();
      
      // Manually add checkpoint back for testing restoration logic
      (coordinator as any).checkpoints = [checkpoint];
      
      const restored = coordinator.restoreFromCheckpoint(checkpoint.id);
      expect(restored).toBe(true);
      const restoredInsight = coordinator.getResource<{ insight: string }>('insights', 'i1');
      expect(restoredInsight?.insight).toBe('v1');
    });
  });

  describe('Performance Reporting', () => {
    it('should generate a report', () => {
      const report = coordinator.getPerformanceReport();
      expect(report).toContain('AGENT PERFORMANCE REPORT');
      expect(report).toContain('CODER');
      expect(report).toContain('RESOURCE POOL');
    });
  });
});

describe('Singleton Functions', () => {
  it('should manage singleton instance', () => {
    const c1 = getEnhancedCoordinator();
    const c2 = getEnhancedCoordinator();
    expect(c1).toBe(c2);
    
    resetEnhancedCoordinator();
    const c3 = getEnhancedCoordinator();
    expect(c3).not.toBe(c1);
  });
});
