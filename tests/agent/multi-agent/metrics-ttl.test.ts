/**
 * Phase d.21 ship 5 — V0.5 metrics TTL enforcement tests.
 *
 * Validates that EnhancedCoordinator.enablePersistence() actually
 * clears metrics that exceed the configured TTL (V0.4.1 was warn-only).
 */

import path from 'path';
import os from 'os';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { EnhancedCoordinator } from '../../../src/agent/multi-agent/enhanced-coordination.js';
import type { AgentRole } from '../../../src/agent/multi-agent/types.js';

let METRICS_PATH: string;
let directory: string;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Write a metrics file with a custom savedAt timestamp using the
 *  canonical envelope shape (schemaVersion 'v0.4', tuple-encoded). */
async function writeMetricsFile(savedAt: Date): Promise<void> {
  const envelope = {
    schemaVersion: 'v0.4' as const,
    savedAt: savedAt.toISOString(),
    metrics: [
      [
        'coder',
        {
          role: 'coder',
          totalTasks: 10,
          successfulTasks: 8,
          failedTasks: 2,
          avgDuration: 1500,
          avgRounds: 3.2,
          successRate: 0.8,
          specialties: [['testing', 5]],
          recentPerformance: [1, 1, 0, 1],
          totalCostUsd: 0.045,
          avgCostPerTask: 0.0045,
        },
      ],
    ],
  };
  await fs.mkdir(path.dirname(METRICS_PATH), { recursive: true });
  await fs.writeFile(METRICS_PATH, JSON.stringify(envelope, null, 2), 'utf-8');
}

describe('Metrics TTL — V0.5 auto-clear (Phase d.21 ship 5)', () => {
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metrics-test-'));
    METRICS_PATH = path.join(directory, 'metrics.json');
    vi.stubEnv('CODEBUDDY_METRICS_PATH', METRICS_PATH);
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('fresh metrics (within TTL) are loaded into memory, file kept', async () => {
    // Save metrics with a savedAt 1 day ago (well within default 30d TTL).
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await writeMetricsFile(oneDayAgo);

    const coord = new EnhancedCoordinator({ enableLearning: true });
    await coord.enablePersistence({ metricsTtlDays: 30 });

    expect(await fileExists(METRICS_PATH)).toBe(true);
    const m = coord.getAgentMetrics('coder' as AgentRole);
    expect(m).toBeDefined();
    expect(m!.totalTasks).toBe(10); // hydrated
  });

  it('stale metrics (older than TTL) are cleared, file deleted, in-memory reset', async () => {
    // 31 days old: just past the default 30d TTL.
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await writeMetricsFile(stale);

    const coord = new EnhancedCoordinator({ enableLearning: true });
    await coord.enablePersistence({ metricsTtlDays: 30 });

    expect(await fileExists(METRICS_PATH)).toBe(false); // file gone
    const m = coord.getAgentMetrics('coder' as AgentRole);
    // initializeMetrics resets to default — totalTasks=0
    expect(m).toBeDefined();
    expect(m!.totalTasks).toBe(0);
  });

  it('custom TTL respected — 7d TTL with 8d-old metrics → cleared', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await writeMetricsFile(eightDaysAgo);

    const coord = new EnhancedCoordinator({ enableLearning: true });
    await coord.enablePersistence({ metricsTtlDays: 7 });

    expect(await fileExists(METRICS_PATH)).toBe(false);
    expect(coord.getAgentMetrics('coder' as AgentRole)?.totalTasks).toBe(0);
  });

  it('custom TTL respected — 60d TTL with 31d-old metrics → kept', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await writeMetricsFile(thirtyOneDaysAgo);

    const coord = new EnhancedCoordinator({ enableLearning: true });
    await coord.enablePersistence({ metricsTtlDays: 60 });

    expect(await fileExists(METRICS_PATH)).toBe(true);
    expect(coord.getAgentMetrics('coder' as AgentRole)?.totalTasks).toBe(10);
  });

  it('no metrics file at all is OK — initializeMetrics defaults remain', async () => {
    // No write — file does not exist.
    const coord = new EnhancedCoordinator({ enableLearning: true });
    await coord.enablePersistence({ metricsTtlDays: 30 });
    expect(coord.getAgentMetrics('coder' as AgentRole)?.totalTasks).toBe(0);
  });
});
