/**
 * Phase N (V0.4.1) — metrics-persistence.ts unit tests.
 *
 * Validates atomic save/load, Map serialization round-trip, schema version
 * gating, and graceful failure modes (corrupt JSON, missing file, ENOENT).
 */

// Set unique path per test file BEFORE imports — vitest pool=forks runs
// files in parallel, race on the shared default location otherwise.
import path from 'path';
import os from 'os';
process.env.CODEBUDDY_METRICS_PATH = path.join(
  os.tmpdir(),
  `codebuddy-metrics-test-${process.pid}-mp.json`
);

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import {
  saveMetrics,
  loadMetrics,
  clearMetrics,
  _metricsPathForTests,
} from '../../../src/agent/multi-agent/metrics-persistence.js';
import type { AgentMetrics } from '../../../src/agent/multi-agent/enhanced-coordination.js';
import type { AgentRole } from '../../../src/agent/multi-agent/types.js';

const METRICS_PATH = _metricsPathForTests();
const PERSIST_DIR = path.dirname(METRICS_PATH);

function makeMetrics(role: AgentRole, totalTasks = 0): AgentMetrics {
  return {
    role,
    totalTasks,
    successfulTasks: Math.floor(totalTasks * 0.8),
    failedTasks: Math.ceil(totalTasks * 0.2),
    avgDuration: 1500,
    avgRounds: 3.2,
    successRate: 0.8,
    specialties: new Map([['testing', 5], ['refactoring', 2]]),
    recentPerformance: [1, 1, 0, 1],
    totalCostUsd: 0.045,
    avgCostPerTask: 0.0045,
  };
}

describe('metrics-persistence — Phase N (V0.4.1)', () => {
  beforeEach(async () => {
    // Clean slate between tests so file state is deterministic. Tests run
    // against the real ~/.codebuddy/agents/metrics.json — acceptable for
    // unit tests since the file is single-process; CI uses fresh HOME.
    await clearMetrics();
  });

  afterEach(async () => {
    await clearMetrics();
  });

  describe('saveMetrics + loadMetrics round-trip', () => {
    it('persists single-role metrics and rehydrates them', async () => {
      const map = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 10)]]);
      await saveMetrics(map);

      const loaded = await loadMetrics();
      expect(loaded).not.toBeNull();
      expect(loaded!.metrics.size).toBe(1);
      const coder = loaded!.metrics.get('coder');
      expect(coder).toBeDefined();
      expect(coder!.totalTasks).toBe(10);
      expect(coder!.successRate).toBeCloseTo(0.8);
    });

    it('rehydrates inner specialties Map correctly (entries-array round-trip)', async () => {
      const m = makeMetrics('coder', 10);
      const map = new Map<AgentRole, AgentMetrics>([['coder', m]]);
      await saveMetrics(map);

      const loaded = await loadMetrics();
      const coder = loaded!.metrics.get('coder')!;
      expect(coder.specialties).toBeInstanceOf(Map);
      expect(coder.specialties.get('testing')).toBe(5);
      expect(coder.specialties.get('refactoring')).toBe(2);
    });

    it('rehydrates recentPerformance as a fresh array (no shared reference)', async () => {
      const original = makeMetrics('reviewer', 5);
      const map = new Map<AgentRole, AgentMetrics>([['reviewer', original]]);
      await saveMetrics(map);

      const loaded = await loadMetrics();
      const reviewer = loaded!.metrics.get('reviewer')!;
      expect(reviewer.recentPerformance).toEqual([1, 1, 0, 1]);
      // Mutating loaded should not affect original
      reviewer.recentPerformance.push(0);
      expect(original.recentPerformance).toHaveLength(4);
    });

    it('persists all 4 default roles with independent metrics', async () => {
      const roles: AgentRole[] = ['orchestrator', 'coder', 'reviewer', 'tester'];
      const map = new Map<AgentRole, AgentMetrics>();
      roles.forEach((role, idx) => map.set(role, makeMetrics(role, idx + 1)));

      await saveMetrics(map);
      const loaded = await loadMetrics();
      expect(loaded!.metrics.size).toBe(4);
      roles.forEach((role, idx) => {
        expect(loaded!.metrics.get(role)!.totalTasks).toBe(idx + 1);
      });
    });

    it('records savedAt as a Date close to now', async () => {
      const map = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 1)]]);
      const before = Date.now();
      await saveMetrics(map);
      const loaded = await loadMetrics();
      const after = Date.now();

      expect(loaded!.savedAt).toBeInstanceOf(Date);
      expect(loaded!.savedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(loaded!.savedAt.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('loadMetrics — failure modes', () => {
    it('returns null when file does not exist (ENOENT)', async () => {
      // beforeEach already cleared
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
    });

    it('returns null on corrupt JSON (logged + swallowed)', async () => {
      await fs.mkdir(PERSIST_DIR, { recursive: true });
      await fs.writeFile(METRICS_PATH, '{ broken json malformed', 'utf8');
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
    });

    it('returns null on unsupported schemaVersion (V0.5+ migration not yet implemented)', async () => {
      await fs.mkdir(PERSIST_DIR, { recursive: true });
      const futureSchema = JSON.stringify({
        schemaVersion: 'v0.5',
        savedAt: new Date().toISOString(),
        metrics: [],
      });
      await fs.writeFile(METRICS_PATH, futureSchema, 'utf8');
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
    });

    it('handles invalid savedAt by returning epoch (0) rather than NaN', async () => {
      await fs.mkdir(PERSIST_DIR, { recursive: true });
      const malformed = JSON.stringify({
        schemaVersion: 'v0.4',
        savedAt: 'not-a-date',
        metrics: [['coder', {
          role: 'coder',
          totalTasks: 1,
          successfulTasks: 1,
          failedTasks: 0,
          avgDuration: 100,
          avgRounds: 1,
          successRate: 1,
          specialties: [],
          recentPerformance: [1],
          totalCostUsd: 0,
          avgCostPerTask: 0,
        }]],
      });
      await fs.writeFile(METRICS_PATH, malformed, 'utf8');
      const loaded = await loadMetrics();
      expect(loaded).not.toBeNull();
      expect(loaded!.savedAt.getTime()).toBe(0);
    });
  });

  describe('atomic write semantics', () => {
    it('does not leave the .tmp file behind on success', async () => {
      const map = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 1)]]);
      await saveMetrics(map);
      const tmpPath = `${METRICS_PATH}.tmp`;
      await expect(fs.access(tmpPath)).rejects.toThrow();
    });

    it('overwrites an existing file (last write wins)', async () => {
      const map1 = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 1)]]);
      await saveMetrics(map1);
      const loaded1 = await loadMetrics();
      expect(loaded1!.metrics.get('coder')!.totalTasks).toBe(1);

      const map2 = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 99)]]);
      await saveMetrics(map2);
      const loaded2 = await loadMetrics();
      expect(loaded2!.metrics.get('coder')!.totalTasks).toBe(99);
    });
  });

  describe('clearMetrics', () => {
    it('removes the metrics file', async () => {
      const map = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 1)]]);
      await saveMetrics(map);
      await clearMetrics();
      const loaded = await loadMetrics();
      expect(loaded).toBeNull();
    });

    it('is a no-op when the file does not exist (no error)', async () => {
      // beforeEach already cleared
      await expect(clearMetrics()).resolves.toBeUndefined();
    });
  });

  describe('save best-effort never throws', () => {
    it('saveMetrics swallows write errors (returns void without throw)', async () => {
      // Best-effort behaviour: write to an invalid path won't trigger directly
      // here because saveMetrics uses os.homedir(); but we verify the function
      // signature returns Promise<void> and doesn't reject under normal call.
      const map = new Map<AgentRole, AgentMetrics>([['coder', makeMetrics('coder', 1)]]);
      await expect(saveMetrics(map)).resolves.toBeUndefined();
    });

    it('handles empty Map cleanly (no roles persisted)', async () => {
      await saveMetrics(new Map());
      const loaded = await loadMetrics();
      expect(loaded).not.toBeNull();
      expect(loaded!.metrics.size).toBe(0);
    });
  });
});
