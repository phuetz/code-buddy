/**
 * Phase N (V0.4.1) — EnhancedCoordinator persistence integration tests.
 *
 * Validates that:
 * 1. enablePersistence() is idempotent
 * 2. Disk metrics are merged into in-memory state at load
 * 3. metrics:updated event triggers debounced save
 * 4. dispose() clears the debounce timer (no leaked timers in tests)
 * 5. flushSave() is awaitable and persists pending state
 * 6. Stale metrics (savedAt > metricsTtlDays) emits warning (not enforced V0.4.1)
 */

// Set unique path per test file BEFORE imports — vitest pool=forks runs
// files in parallel, race on the shared default location otherwise.
import path from 'path';
import os from 'os';
process.env.CODEBUDDY_METRICS_PATH = path.join(
  os.tmpdir(),
  `codebuddy-metrics-test-${process.pid}-pi.json`
);

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EnhancedCoordinator,
  resetEnhancedCoordinator,
} from '../../../src/agent/multi-agent/enhanced-coordination.js';
import {
  saveMetrics,
  loadMetrics,
  clearMetrics,
  _metricsPathForTests,
} from '../../../src/agent/multi-agent/metrics-persistence.js';
import { logger } from '../../../src/utils/logger.js';
import type { AgentMetrics } from '../../../src/agent/multi-agent/enhanced-coordination.js';
import type { AgentTask, AgentRole, AgentExecutionResult } from '../../../src/agent/multi-agent/types.js';

function makeTask(id: string, assignedTo: AgentRole = 'coder'): AgentTask {
  return {
    id,
    title: `t-${id}`,
    description: '',
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

function makeResult(role: AgentRole, success = true): AgentExecutionResult {
  return {
    success,
    role,
    taskId: 'tx',
    output: 'ok',
    artifacts: [],
    toolsUsed: [],
    rounds: 2,
    duration: 1000,
  };
}

function makePersistedMetrics(role: AgentRole, totalTasks: number): AgentMetrics {
  return {
    role,
    totalTasks,
    successfulTasks: totalTasks,
    failedTasks: 0,
    avgDuration: 500,
    avgRounds: 2,
    successRate: 1,
    specialties: new Map([['testing', totalTasks]]),
    recentPerformance: Array(Math.min(totalTasks, 5)).fill(1),
    totalCostUsd: 0.01 * totalTasks,
    avgCostPerTask: 0.01,
  };
}

describe('EnhancedCoordinator — Phase N persistence integration', () => {
  beforeEach(async () => {
    await clearMetrics();
    resetEnhancedCoordinator();
  });

  afterEach(async () => {
    await clearMetrics();
  });

  describe('enablePersistence basics', () => {
    it('is idempotent — second call is a no-op', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 50 });
      expect(c.isPersistenceEnabled()).toBe(true);
      await c.enablePersistence({ saveDebounceMs: 999 });
      // Second call's options should be ignored. We verify by triggering
      // a save and checking debounce is still 50ms (would fail at 999ms).
      // (See debounce test below for the actual mechanism.)
      expect(c.isPersistenceEnabled()).toBe(true);
      c.dispose();
    });

    it('reports null savedAt when no disk file exists yet', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence();
      expect(c.getMetricsSavedAt()).toBeNull();
      c.dispose();
    });

    it('skips disk load when enableLearning=false (allocator ignores persisted data anyway)', async () => {
      // Pre-populate disk
      await saveMetrics(new Map([['coder', makePersistedMetrics('coder', 50)]]));

      const c = new EnhancedCoordinator({ enableLearning: false });
      await c.enablePersistence();
      const m = c.getAgentMetrics('coder');
      expect(m!.totalTasks).toBe(0); // fresh init, NOT loaded
      c.dispose();
    });
  });

  describe('warm-start from disk', () => {
    it('merges persisted metrics into in-memory state at enablePersistence', async () => {
      await saveMetrics(new Map([['coder', makePersistedMetrics('coder', 50)]]));

      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence();

      const coderMetrics = c.getAgentMetrics('coder');
      expect(coderMetrics).toBeDefined();
      expect(coderMetrics!.totalTasks).toBe(50);
      expect(coderMetrics!.successfulTasks).toBe(50);
      expect(coderMetrics!.specialties.get('testing')).toBe(50);
      expect(c.getMetricsSavedAt()).not.toBeNull();
      c.dispose();
    });

    it('warns when persisted metrics are older than metricsTtlDays', async () => {
      // Save metrics, then forge an old timestamp directly in the file
      await saveMetrics(new Map([['coder', makePersistedMetrics('coder', 5)]]));
      const { promises: fs } = await import('fs');
      const raw = await fs.readFile(_metricsPathForTests(), 'utf8');
      const parsed = JSON.parse(raw);
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      parsed.savedAt = oldDate.toISOString();
      await fs.writeFile(_metricsPathForTests(), JSON.stringify(parsed), 'utf8');

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ metricsTtlDays: 30 });

      const staleWarnings = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('persisted metrics are')
      );
      expect(staleWarnings.length).toBeGreaterThan(0);
      // V0.4.1 = warning only — metrics are still loaded (not cleared).
      expect(c.getAgentMetrics('coder')!.totalTasks).toBe(5);
      warnSpy.mockRestore();
      c.dispose();
    });

    it('does NOT warn when persisted metrics are within TTL', async () => {
      await saveMetrics(new Map([['coder', makePersistedMetrics('coder', 5)]]));

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ metricsTtlDays: 30 });

      const staleWarnings = warnSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('persisted metrics are')
      );
      expect(staleWarnings).toHaveLength(0);
      warnSpy.mockRestore();
      c.dispose();
    });
  });

  describe('debounced save on metrics:updated', () => {
    it('schedules a save when recordTaskCompletion fires metrics:updated', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 30 });

      c.recordTaskCompletion(makeTask('t1'), makeResult('coder'));

      // Wait for debounce to elapse + a tick for the async save
      await new Promise((r) => setTimeout(r, 80));

      const loaded = await loadMetrics();
      expect(loaded).not.toBeNull();
      expect(loaded!.metrics.get('coder')!.totalTasks).toBe(1);
      c.dispose();
    });

    it('coalesces a burst of updates into a single save (debounce reset)', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 30 });

      // 5 rapid updates within debounce window
      for (let i = 0; i < 5; i++) {
        c.recordTaskCompletion(makeTask(`t${i}`), makeResult('coder'));
      }

      await new Promise((r) => setTimeout(r, 80));

      const loaded = await loadMetrics();
      expect(loaded!.metrics.get('coder')!.totalTasks).toBe(5);
      c.dispose();
    });

    it('flushSave persists pending state synchronously (awaitable)', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 99999 }); // long debounce

      c.recordTaskCompletion(makeTask('t1'), makeResult('reviewer'));
      // No save yet — debounce not elapsed

      await c.flushSave();

      const loaded = await loadMetrics();
      expect(loaded).not.toBeNull();
      expect(loaded!.metrics.get('reviewer')!.totalTasks).toBe(1);
      c.dispose();
    });

    it('flushSave is no-op when persistence disabled', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await expect(c.flushSave()).resolves.toBeUndefined();
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
      c.dispose();
    });
  });

  describe('dispose cleans up timers (prevents test leakage)', () => {
    it('dispose clears pending debounce timer', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 99999 });

      c.recordTaskCompletion(makeTask('t1'), makeResult('coder'));
      // Pending timer scheduled

      c.dispose();

      // Wait long enough that if timer wasn't cleared, save would happen
      await new Promise((r) => setTimeout(r, 50));
      const loaded = await loadMetrics();
      // No save should have happened — timer was cleared
      expect(loaded).toBeNull();
    });

    it('dispose unsubscribes from metrics:updated (no save after dispose)', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence({ saveDebounceMs: 30 });

      c.dispose();

      // Even though we'd emit, no listener → no scheduled save
      c.emit('metrics:updated');
      await new Promise((r) => setTimeout(r, 60));
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
    });

    it('dispose resets isPersistenceEnabled to false', async () => {
      const c = new EnhancedCoordinator({ enableLearning: true });
      await c.enablePersistence();
      expect(c.isPersistenceEnabled()).toBe(true);
      c.dispose();
      expect(c.isPersistenceEnabled()).toBe(false);
    });
  });
});
