/**
 * EnhancedCoordinator metrics persistence (Phase N V0.4.1).
 *
 * Persists `coordinator.agentMetrics: Map<AgentRole, AgentMetrics>` to disk
 * so that adaptive task allocation has a warm-start across process restarts
 * (Ctrl+C, crash, fresh `buddy` invocation). Without this, every session
 * begins with neutral 0.5 success rates for every role and the adaptive
 * allocator can't make informed decisions until it has accumulated several
 * task completions.
 *
 * Storage:
 *   ~/.codebuddy/agents/metrics.json   — singleton (1 file shared across all
 *                                        projects, V0.4.1 limitation; V0.5+
 *                                        could partition per-project)
 *
 * Atomic writes:
 *   write to metrics.json.tmp + rename to metrics.json (POSIX atomic;
 *   Windows fs.promises.rename is also atomic for same-volume swaps).
 *   Same pattern as workflow-persistence.ts.
 *
 * Map serialization:
 *   - Outer `Map<AgentRole, AgentMetrics>` → `Array<[AgentRole, ...]>` for JSON-safety
 *   - Inner `specialties: Map<string, number>` → `Array<[string, number]>`
 *   Both rehydrated on load.
 *
 * Stale data risk:
 *   The persisted metrics encode performance on whatever code existed when
 *   they were captured. If the repo has changed substantially (refactor,
 *   feature pivot), old metrics may bias allocation against the wrong roles.
 *   V0.4.1 ships a warning when persisted age > metrics_ttl_days (default 30).
 *   V0.5 will enforce TTL by clearing stale data automatically.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../../utils/logger.js';
import type { AgentMetrics } from './enhanced-coordination.js';
import type { AgentRole } from './types.js';

/** Phase N — schema version. v0.4 is the initial release. */
export type MetricsSchemaVersion = 'v0.4';

/** JSON-safe shape of AgentMetrics (Maps → entry arrays). */
export interface SerializedAgentMetrics {
  role: AgentRole;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  avgDuration: number;
  avgRounds: number;
  successRate: number;
  /** Inner Map<string, number> serialized as entries array. */
  specialties: Array<[string, number]>;
  recentPerformance: number[];
  totalCostUsd: number;
  avgCostPerTask: number;
}

/** Persistent envelope — `metrics` is the outer Map serialized as entries. */
export interface PersistedMetrics {
  schemaVersion: MetricsSchemaVersion;
  /** ISO timestamp string, set by saveMetrics on each write. */
  savedAt: string;
  metrics: Array<[AgentRole, SerializedAgentMetrics]>;
}

/**
 * Resolve the metrics file path. Honours `CODEBUDDY_METRICS_PATH` env var
 * so parallel test files (running in separate vitest forks) can use unique
 * paths to avoid colliding on the shared default location.
 */
function resolveMetricsPath(): string {
  const override = process.env.CODEBUDDY_METRICS_PATH;
  if (override) return override;
  return path.join(os.homedir(), '.codebuddy', 'agents', 'metrics.json');
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function serializeMetrics(metrics: AgentMetrics): SerializedAgentMetrics {
  return {
    role: metrics.role,
    totalTasks: metrics.totalTasks,
    successfulTasks: metrics.successfulTasks,
    failedTasks: metrics.failedTasks,
    avgDuration: metrics.avgDuration,
    avgRounds: metrics.avgRounds,
    successRate: metrics.successRate,
    specialties: Array.from(metrics.specialties.entries()),
    recentPerformance: [...metrics.recentPerformance],
    totalCostUsd: metrics.totalCostUsd,
    avgCostPerTask: metrics.avgCostPerTask,
  };
}

function deserializeMetrics(s: SerializedAgentMetrics): AgentMetrics {
  return {
    role: s.role,
    totalTasks: s.totalTasks,
    successfulTasks: s.successfulTasks,
    failedTasks: s.failedTasks,
    avgDuration: s.avgDuration,
    avgRounds: s.avgRounds,
    successRate: s.successRate,
    specialties: new Map(s.specialties),
    recentPerformance: [...s.recentPerformance],
    totalCostUsd: s.totalCostUsd,
    avgCostPerTask: s.avgCostPerTask,
  };
}

/**
 * Save metrics atomically (write to .tmp + rename).
 * Best-effort — never throws; logs and swallows on failure.
 */
export async function saveMetrics(map: Map<AgentRole, AgentMetrics>): Promise<void> {
  const metricsPath = resolveMetricsPath();
  const tmpPath = `${metricsPath}.tmp`;
  try {
    await ensureDir(metricsPath);
    const envelope: PersistedMetrics = {
      schemaVersion: 'v0.4',
      savedAt: new Date().toISOString(),
      metrics: Array.from(map.entries()).map(([role, m]) => [role, serializeMetrics(m)]),
    };
    const json = JSON.stringify(envelope, null, 2);
    await fs.writeFile(tmpPath, json, 'utf8');
    await fs.rename(tmpPath, metricsPath);
  } catch (err) {
    logger.warn('[multi-agent] metrics persistence save failed', { error: String(err) });
  }
}

/**
 * Loaded metrics with their captured timestamp. Returns null when:
 * - File does not exist
 * - File is unreadable
 * - JSON is corrupt (logged + swallowed)
 * - schemaVersion is unknown (logged + swallowed; V0.5 will add migrations)
 */
export interface LoadedMetrics {
  metrics: Map<AgentRole, AgentMetrics>;
  savedAt: Date;
}

export async function loadMetrics(): Promise<LoadedMetrics | null> {
  const metricsPath = resolveMetricsPath();
  try {
    const raw = await fs.readFile(metricsPath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedMetrics;

    if (parsed.schemaVersion !== 'v0.4') {
      logger.warn(
        `[multi-agent] metrics schema version "${parsed.schemaVersion}" not supported in V0.4.1; ignoring persisted metrics`
      );
      return null;
    }

    const map = new Map<AgentRole, AgentMetrics>();
    for (const [role, s] of parsed.metrics) {
      map.set(role, deserializeMetrics(s));
    }
    const savedAt = new Date(parsed.savedAt);
    if (Number.isNaN(savedAt.getTime())) {
      logger.warn('[multi-agent] metrics savedAt is invalid; treating as fresh load');
      return { metrics: map, savedAt: new Date(0) };
    }
    return { metrics: map, savedAt };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn('[multi-agent] metrics persistence load failed (corrupt or unreadable)', { error: String(err) });
    return null;
  }
}

/**
 * Remove the persisted metrics file. Best-effort no-op if absent.
 * Used by `/agents reset-metrics` (future) and tests.
 */
export async function clearMetrics(): Promise<void> {
  const metricsPath = resolveMetricsPath();
  try {
    await fs.unlink(metricsPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('[multi-agent] metrics persistence clear failed', { error: String(err) });
    }
  }
}

/** Test hook — exposes the storage path so tests can override or assert.
 *  Honours CODEBUDDY_METRICS_PATH env override if set. */
export function _metricsPathForTests(): string {
  return resolveMetricsPath();
}
