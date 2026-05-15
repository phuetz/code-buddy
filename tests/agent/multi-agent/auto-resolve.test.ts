/**
 * Phase M (V0.4.1) — autoResolveConflicts side-effects unit tests.
 *
 * Validates the coordinator's narrow-scope auto-resolve:
 * - `prefer-reviewer` strategy on `code_overlap` mutates losing agents'
 *   tasks to status='blocked'.
 * - Other conflict types remain unresolved with V0.5+ deferral warning.
 * - Strategy='none' / autoResolveEnabled=false → no mutation and no resolution.
 * - detectConflicts now picks up `pending` tasks (loosened filter).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnhancedCoordinator,
  AgentConflict,
  resetEnhancedCoordinator,
} from '../../../src/agent/multi-agent/enhanced-coordination.js';
import type { AgentTask, SharedContext, AgentRole } from '../../../src/agent/multi-agent/types.js';
import { logger } from '../../../src/utils/logger.js';

function makeTask(
  id: string,
  assignedTo: AgentRole,
  targetFiles?: string[],
  status: AgentTask['status'] = 'pending'
): AgentTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Desc ${id}`,
    status,
    priority: 'medium',
    assignedTo,
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: targetFiles ? { targetFiles } : {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const emptyContext: SharedContext = {
  goal: 'test',
  relevantFiles: [],
  conversationHistory: [],
  artifacts: new Map(),
  decisions: [],
  constraints: [],
};

describe('EnhancedCoordinator — Phase M (V0.4.1) auto-resolve side-effects', () => {
  beforeEach(() => {
    resetEnhancedCoordinator();
  });

  describe('detectConflicts loosened filter', () => {
    it('detects code_overlap on pending tasks (Phase M loosened from in_progress-only)', () => {
      const c = new EnhancedCoordinator({ enableConflictResolution: true });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts'], 'pending'),
        makeTask('t2', 'reviewer', ['auth.ts'], 'pending'),
      ];
      const conflicts = c.detectConflicts(tasks, emptyContext);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('code_overlap');
      expect(conflicts[0].agents.sort()).toEqual(['coder', 'reviewer']);
      expect(conflicts[0].affectedFile).toBe('auth.ts');
    });

    it('still detects on in_progress tasks (V0.3 behavior preserved)', () => {
      const c = new EnhancedCoordinator({ enableConflictResolution: true });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts'], 'in_progress'),
        makeTask('t2', 'reviewer', ['auth.ts'], 'in_progress'),
      ];
      const conflicts = c.detectConflicts(tasks, emptyContext);
      expect(conflicts).toHaveLength(1);
    });

    it('does NOT detect on completed tasks', () => {
      const c = new EnhancedCoordinator({ enableConflictResolution: true });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts'], 'completed'),
        makeTask('t2', 'reviewer', ['auth.ts'], 'completed'),
      ];
      const conflicts = c.detectConflicts(tasks, emptyContext);
      expect(conflicts).toHaveLength(0);
    });

    it('does NOT detect on failed/blocked tasks', () => {
      const c = new EnhancedCoordinator({ enableConflictResolution: true });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts'], 'failed'),
        makeTask('t2', 'reviewer', ['auth.ts'], 'blocked'),
      ];
      const conflicts = c.detectConflicts(tasks, emptyContext);
      expect(conflicts).toHaveLength(0);
    });

    it('stores affectedFile in conflict for downstream auto-resolve', () => {
      const c = new EnhancedCoordinator({ enableConflictResolution: true });
      const tasks = [
        makeTask('t1', 'coder', ['payment.ts']),
        makeTask('t2', 'tester', ['payment.ts']),
      ];
      const [conflict] = c.detectConflicts(tasks, emptyContext);
      expect(conflict.affectedFile).toBe('payment.ts');
    });
  });

  describe('autoResolveConflicts side-effects (prefer-reviewer)', () => {
    it('blocks losing agents tasks on code_overlap with reviewer winner', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      const mutated = c.autoResolveConflicts(tasks);

      expect(mutated).toEqual(['t1']);
      expect(tasks[0].status).toBe('blocked');
      expect(tasks[0].error).toContain('reviewer');
      expect(tasks[0].error).toContain('auth.ts');
      expect(tasks[1].status).toBe('pending'); // winner unchanged
    });

    it('priority order is reviewer > coder > tester > orchestrator', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      // Without reviewer, coder wins
      const tasks = [
        makeTask('t1', 'tester', ['util.ts']),
        makeTask('t2', 'coder', ['util.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated).toEqual(['t1']);
      expect(tasks[0].status).toBe('blocked');
      expect(tasks[1].status).toBe('pending');
    });

    it('blocks 2 losers when 3 agents conflict on same file', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['shared.ts']),
        makeTask('t2', 'tester', ['shared.ts']),
        makeTask('t3', 'reviewer', ['shared.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated.sort()).toEqual(['t1', 't2']);
      expect(tasks[2].status).toBe('pending'); // reviewer wins
    });

    it('only blocks tasks that touch the conflicted file', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),       // conflicts
        makeTask('t2', 'reviewer', ['auth.ts']),    // winner
        makeTask('t3', 'coder', ['unrelated.ts']),  // same agent, different file → NOT blocked
      ];
      c.detectConflicts(tasks, emptyContext);
      c.autoResolveConflicts(tasks);

      expect(tasks[0].status).toBe('blocked');
      expect(tasks[1].status).toBe('pending');
      expect(tasks[2].status).toBe('pending'); // unrelated file
    });

    it('annotates conflict.resolution with auto-resolve outcome', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      c.autoResolveConflicts(tasks);
      const [conflict] = c.getConflicts();
      expect(conflict.resolution).toBeDefined();
      expect(conflict.resolution!.strategy).toBe('priority');
      expect(conflict.resolution!.decision).toContain('reviewer');
      expect(conflict.resolution!.decision).toContain('blocked 1');
    });
  });

  describe('autoResolveConflicts no side-effects when disabled', () => {
    it('autoResolveEnabled=false → no mutation and conflict stays pending', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: false,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
      expect(tasks[1].status).toBe('pending');
      const [conflict] = c.getConflicts();
      expect(conflict.resolution).toBeUndefined();
      const report = c.getPerformanceReport();
      expect(report).toContain('  Resolved: 0');
      expect(report).toContain('  Pending: 1');
    });

    it('strategy=none → no mutation and no resolution', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'none',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
      const [conflict] = c.getConflicts();
      expect(conflict.resolution).toBeUndefined();
    });

    it('no tasks param → no mutation and no resolution (back-compat with V0.3 callers)', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      // Call without tasks param (legacy V0.3 signature)
      const mutated = c.autoResolveConflicts();
      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
      const [conflict] = c.getConflicts();
      expect(conflict.resolution).toBeUndefined();
    });
  });

  describe('autoResolveConflicts non-code_overlap types remain unresolved', () => {
    it('resource_contention → no mutation, no resolution, V0.5 warning', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });

      // Manually inject a resource_contention conflict (detectConflicts in
      // V0.4.1 only fires this when activeTasksPerAgent exceeds limits, easier
      // to inject for a focused unit test).
      const inject: AgentConflict = {
        id: 'rc-1',
        type: 'resource_contention',
        agents: ['coder'],
        description: 'too many parallel',
        severity: 'medium',
        timestamp: new Date(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).conflicts.push(inject);

      const tasks = [makeTask('t1', 'coder', ['auth.ts'])];
      const mutated = c.autoResolveConflicts(tasks);

      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
      expect(inject.resolution).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('approach_disagreement → no resolution', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const inject: AgentConflict = {
        id: 'ad-1',
        type: 'approach_disagreement',
        agents: ['coder', 'reviewer'],
        description: 'design diverges',
        severity: 'low',
        timestamp: new Date(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).conflicts.push(inject);

      const mutated = c.autoResolveConflicts([]);
      expect(mutated).toEqual([]);
      expect(inject.resolution).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('deadline_conflict → no resolution', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const inject: AgentConflict = {
        id: 'dl-1',
        type: 'deadline_conflict',
        agents: ['coder'],
        description: 'deadline tight',
        severity: 'low',
        timestamp: new Date(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).conflicts.push(inject);

      const mutated = c.autoResolveConflicts([]);
      expect(mutated).toEqual([]);
      expect(inject.resolution).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('autoResolveConflicts edge cases', () => {
    it('skips already-resolved conflicts', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      c.detectConflicts(tasks, emptyContext);
      c.autoResolveConflicts(tasks); // first run blocks t1
      tasks[0].status = 'pending'; // simulate retry/reset
      const mutated = c.autoResolveConflicts(tasks); // already resolved → no-op
      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
    });

    it('no affectedFile → no-op (defensive guard)', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const inject: AgentConflict = {
        id: 'co-noFile',
        type: 'code_overlap',
        agents: ['coder', 'reviewer'],
        description: 'malformed conflict — no file',
        severity: 'high',
        timestamp: new Date(),
        // affectedFile omitted
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).conflicts.push(inject);

      const tasks = [
        makeTask('t1', 'coder', ['auth.ts']),
        makeTask('t2', 'reviewer', ['auth.ts']),
      ];
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated).toEqual([]);
      expect(tasks[0].status).toBe('pending');
      expect(inject.resolution).toBeUndefined();
    });

    it('does not block tasks already in completed status', () => {
      const c = new EnhancedCoordinator({
        enableConflictResolution: true,
        autoResolveEnabled: true,
        autoResolveStrategy: 'prefer-reviewer',
      });
      const inject: AgentConflict = {
        id: 'co-mixed',
        type: 'code_overlap',
        agents: ['coder', 'reviewer'],
        description: 'overlap',
        severity: 'high',
        timestamp: new Date(),
        affectedFile: 'auth.ts',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c as any).conflicts.push(inject);

      const tasks = [
        makeTask('t1', 'coder', ['auth.ts'], 'completed'),
        makeTask('t2', 'reviewer', ['auth.ts'], 'pending'),
      ];
      const mutated = c.autoResolveConflicts(tasks);
      expect(mutated).toEqual([]); // t1 completed, no mutation
      expect(tasks[0].status).toBe('completed');
      expect(inject.resolution).toBeUndefined();
    });
  });
});
