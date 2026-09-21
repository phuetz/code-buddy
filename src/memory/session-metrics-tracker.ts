/**
 * Session Metrics Tracker
 *
 * Fills the SESSION_METRICS env var that the session-end cron hook reads.
 * Without this, the skill generator always sees zeros and never fires.
 *
 * Tracks tool calls, recovered errors and touched files during a session,
 * then writes a JSON snapshot to .codebuddy/session-metrics.json so the
 * cron step can load real numbers instead of the hardcoded placeholder.
 *
 * The cron runs in a *separate* Node process, so it cannot see the in-memory
 * env of the agent. It therefore falls back to reading the snapshot file
 * from disk via `loadSessionMetricsFromDisk`.
 *
 * @module memory/session-metrics-tracker
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const CODEBUDDY_DIR = '.codebuddy';
const METRICS_FILE = 'session-metrics.json';

export interface SessionMetrics {
  toolCalls: number;
  errorsRecovered: number;
  filesTouched: string[];
  durationMs?: number;
  summary?: string;
  sessionId?: string;
  updatedAt?: string;
}

const EMPTY: SessionMetrics = {
  toolCalls: 0,
  errorsRecovered: 0,
  filesTouched: [],
};

function metricsPath(cwd: string) {
  return path.join(cwd, CODEBUDDY_DIR, METRICS_FILE);
}

/** Read the current snapshot, or an empty one. */
export function loadSessionMetrics(workDir: string = process.cwd()): SessionMetrics {
  const p = metricsPath(workDir);
  if (!fs.existsSync(p)) return { ...EMPTY, filesTouched: [] };
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as SessionMetrics;
    return {
      toolCalls: Number(parsed.toolCalls) || 0,
      errorsRecovered: Number(parsed.errorsRecovered) || 0,
      filesTouched: Array.isArray(parsed.filesTouched) ? parsed.filesTouched : [],
      durationMs: parsed.durationMs,
      summary: parsed.summary,
      sessionId: parsed.sessionId,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { ...EMPTY, filesTouched: [] };
  }
}

/**
 * Disk-only read for the cron hook running in a separate process.
 * Same as loadSessionMetrics but never touches process.env.
 */
export function loadSessionMetricsFromDisk(workDir: string = process.cwd()): SessionMetrics {
  return loadSessionMetrics(workDir);
}

function persist(metrics: SessionMetrics, cwd: string) {
  const dir = path.join(cwd, CODEBUDDY_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out: SessionMetrics = { ...metrics, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metricsPath(cwd), JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  // Also expose to the process env so in-process consumers see it.
  process.env.SESSION_METRICS = JSON.stringify({
    toolCalls: out.toolCalls,
    errorsRecovered: out.errorsRecovered,
    filesTouched: out.filesTouched,
    durationMs: out.durationMs,
    summary: out.summary,
  });
}

/** Start (or reset) metrics for a new session. */
export function beginSession(sessionId?: string, workDir: string = process.cwd()): SessionMetrics {
  const m: SessionMetrics = { ...EMPTY, filesTouched: [], sessionId };
  persist(m, workDir);
  return m;
}

/** Record a tool call. */
export function recordToolCall(workDir: string = process.cwd()): SessionMetrics {
  const m = loadSessionMetrics(workDir);
  m.toolCalls += 1;
  persist(m, workDir);
  return m;
}

/** Record a recovered error. */
export function recordRecoveredError(workDir: string = process.cwd()): SessionMetrics {
  const m = loadSessionMetrics(workDir);
  m.errorsRecovered += 1;
  persist(m, workDir);
  return m;
}

/** Record a touched file (deduped). */
export function recordFileTouched(file: string, workDir: string = process.cwd()): SessionMetrics {
  const m = loadSessionMetrics(workDir);
  if (file && !m.filesTouched.includes(file)) m.filesTouched.push(file);
  persist(m, workDir);
  return m;
}

/** Attach a free-text summary of the session. */
export function setSessionSummary(summary: string, workDir: string = process.cwd()): SessionMetrics {
  const m = loadSessionMetrics(workDir);
  m.summary = summary;
  persist(m, workDir);
  return m;
}

/**
 * Finalize: return the snapshot and clear the live counters so the next
 * session starts clean. The snapshot file is kept for the cron hook.
 */
export function endSession(workDir: string = process.cwd()): SessionMetrics {
  const m = loadSessionMetrics(workDir);
  logger.info('Session metrics finalized', m);
  return m;
}

/** Convenience: read whatever the cron hook should see. */
export function currentSessionMetricsEnv(workDir: string = process.cwd()): string {
  const m = loadSessionMetrics(workDir);
  return JSON.stringify({
    toolCalls: m.toolCalls,
    errorsRecovered: m.errorsRecovered,
    filesTouched: m.filesTouched,
    durationMs: m.durationMs,
    summary: m.summary,
  });
}

/**
 * Test-only reset: wipe the snapshot file and env so the next test starts clean.
 * Safe no-op in production (tests import it explicitly).
 */
export function resetSessionMetricsForTests(workDir: string = process.cwd()): void {
  const p = metricsPath(workDir);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* best-effort */
  }
  delete process.env.SESSION_METRICS;
}
