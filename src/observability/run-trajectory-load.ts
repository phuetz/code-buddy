/**
 * I/O loader for the unified Trajectory view. Read-only, never-throws.
 * Missing journals become `sources.missing` — the presenter says « non journalisé ».
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunStore } from './run-store.js';
import {
  buildTrajectory,
  type Trajectory,
  type TrajectoryAuditEntry,
  type TrajectoryCostRecord,
  type TrajectoryRuleRun,
  type TrajectorySessionTurn,
  type TrajectorySources,
  type TrajectoryTimelineEntry,
} from './run-trajectory.js';

export interface LoadTrajectoryOptions {
  since?: number;
  generatedAt?: string;
  homeDir?: string;
  store?: RunStore;
  timelineEnabled?: boolean;
}

function safeReadJsonl<T>(filePath: string, pick: (value: unknown) => T | null): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const out: T[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        const value = pick(parsed);
        if (value !== null) out.push(value);
      } catch {
        // skip malformed
      }
    }
    return out;
  } catch {
    return [];
  }
}

function listAuditFiles(homeDir: string): string[] {
  const dir = path.join(homeDir, '.codebuddy');
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function loadAuditEntries(homeDir: string): { entries: TrajectoryAuditEntry[]; found: boolean } {
  const files = listAuditFiles(homeDir);
  const envDir = process.env.CODEBUDDY_AUDIT_DIR;
  if (envDir) {
    try {
      files.push(
        ...fs.readdirSync(envDir)
          .filter((name) => name.endsWith('.jsonl'))
          .map((name) => path.join(envDir, name)),
      );
    } catch {
      // ignore
    }
  }
  const entries: TrajectoryAuditEntry[] = [];
  let found = false;
  for (const file of files) {
    const rows = safeReadJsonl(file, (value) => {
      if (!value || typeof value !== 'object') return null;
      const row = value as Record<string, unknown>;
      if (typeof row.timestamp !== 'string' || typeof row.action !== 'string') return null;
      return {
        timestamp: row.timestamp,
        action: row.action,
        decision: typeof row.decision === 'string' ? row.decision : undefined,
        target: typeof row.target === 'string' ? row.target : undefined,
        details: typeof row.details === 'string' ? row.details : undefined,
        source: typeof row.source === 'string' ? row.source : undefined,
      };
    });
    if (rows.length > 0) found = true;
    entries.push(...rows);
  }
  return { entries, found };
}

function loadTimeline(homeDir: string, sessionId: string | undefined, enabled: boolean): {
  entries: TrajectoryTimelineEntry[] | null;
  found: boolean;
} {
  if (!enabled) return { entries: null, found: false };
  if (!sessionId) return { entries: null, found: false };
  const filePath = path.join(homeDir, '.codebuddy', 'timelines', `${encodeURIComponent(sessionId)}.jsonl`);
  const entries = safeReadJsonl(filePath, (value) => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.turn !== 'number' || typeof row.ts !== 'string' || !Array.isArray(row.toolCalls) || !Array.isArray(row.filesTouched)) {
      return null;
    }
    return {
      turn: row.turn,
      ts: row.ts,
      toolCalls: (row.toolCalls as unknown[]).flatMap((call) => {
        if (!call || typeof call !== 'object') return [];
        const item = call as Record<string, unknown>;
        if (typeof item.name !== 'string' || typeof item.ok !== 'boolean') return [];
        return [{ name: item.name, ok: item.ok }];
      }),
      filesTouched: (row.filesTouched as unknown[]).filter((file): file is string => typeof file === 'string'),
    };
  });
  return { entries, found: entries.length > 0 };
}

function loadSessionTurns(homeDir: string, sessionId: string | undefined): {
  turns: TrajectorySessionTurn[] | null;
  found: boolean;
} {
  if (!sessionId) return { turns: null, found: false };
  const filePath = path.join(homeDir, '.codebuddy', 'sessions', `${sessionId}.json`);
  try {
    if (!fs.existsSync(filePath)) return { turns: null, found: false };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      turns?: unknown;
      metadata?: { turns?: unknown };
    };
    const list = Array.isArray(raw.turns) ? raw.turns : Array.isArray(raw.metadata?.turns) ? raw.metadata.turns : [];
    const turns: TrajectorySessionTurn[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.timestamp !== 'string') continue;
      if (typeof row.inputTokens !== 'number' || typeof row.outputTokens !== 'number') continue;
      turns.push({
        timestamp: row.timestamp,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: typeof row.costUsd === 'number' ? row.costUsd : 0,
      });
    }
    return { turns, found: turns.length > 0 };
  } catch {
    return { turns: null, found: false };
  }
}

function loadCostRecords(homeDir: string): { records: TrajectoryCostRecord[]; found: boolean } {
  const filePath = path.join(homeDir, '.codebuddy', 'cost-history.json');
  try {
    if (!fs.existsSync(filePath)) return { records: [], found: false };
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return { records: [], found: false };
    const records: TrajectoryCostRecord[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const ts = typeof row.timestamp === 'string' ? Date.parse(row.timestamp)
        : typeof row.timestamp === 'number' ? row.timestamp
          : NaN;
      if (!Number.isFinite(ts)) continue;
      records.push({
        timestamp: ts,
        inputTokens: typeof row.inputTokens === 'number' ? row.inputTokens : 0,
        outputTokens: typeof row.outputTokens === 'number' ? row.outputTokens : 0,
        cost: typeof row.cost === 'number' ? row.cost : 0,
      });
    }
    return { records, found: true };
  } catch {
    return { records: [], found: false };
  }
}

function loadRuleRuns(homeDir: string): { runs: TrajectoryRuleRun[]; found: boolean } {
  const override = process.env.CODEBUDDY_RULE_RUNS_FILE;
  const filePath = override || path.join(homeDir, '.codebuddy', 'companion', 'rule-runs.jsonl');
  const runs = safeReadJsonl(filePath, (value) => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.ts !== 'number' || typeof row.rule !== 'string') return null;
    return {
      ts: row.ts,
      rule: row.rule,
      action: typeof row.action === 'string' ? row.action : 'unknown',
      ok: row.ok === true,
    };
  });
  return { runs, found: fs.existsSync(filePath) };
}

export function loadTrajectorySources(runId: string, options: LoadTrajectoryOptions = {}): TrajectorySources {
  const homeDir = options.homeDir ?? os.homedir();
  const store = options.store ?? RunStore.getInstance();
  const missing: string[] = [];
  const record = store.getRun(runId);
  const events = record ? store.getEvents(runId) : [];
  if (!record) missing.push('run introuvable dans RunStore');

  const sessionId = record?.summary.metadata?.sessionId;
  const audit = loadAuditEntries(homeDir);
  if (!audit.found) missing.push('audit JSONL (auditLogger.init n\'est appelé nulle part en production)');

  const timelineEnabled = options.timelineEnabled ?? process.env.CODEBUDDY_TIMELINE === 'true';
  const timeline = loadTimeline(homeDir, sessionId, timelineEnabled);
  if (!timelineEnabled) missing.push('timeline désactivée (CODEBUDDY_TIMELINE ≠ true)');
  else if (!timeline.found) missing.push('timeline session absente');

  const sessionTurns = loadSessionTurns(homeDir, sessionId);
  if (!sessionTurns.found) missing.push('session.turns (usage par tour)');

  const cost = loadCostRecords(homeDir);
  if (!cost.found) missing.push('cost-history.json');

  const rules = loadRuleRuns(homeDir);
  if (!rules.found) missing.push('rule-runs.jsonl');

  const summary = record
    ? {
      objective: record.summary.objective,
      status: record.summary.status,
      startedAt: record.summary.startedAt,
      endedAt: record.summary.endedAt,
      sessionId,
    }
    : null;

  return {
    runId,
    since: options.since,
    generatedAt: options.generatedAt,
    summary,
    metrics: record?.metrics,
    events,
    artifacts: record?.artifacts,
    auditEntries: audit.found ? audit.entries : undefined,
    timelineEntries: timelineEnabled ? timeline.entries : null,
    sessionTurns: sessionTurns.found ? sessionTurns.turns : null,
    costRecords: cost.found ? cost.records : undefined,
    ruleRuns: rules.found ? rules.runs : null,
    missing,
  };
}

export function loadTrajectory(runId: string, options: LoadTrajectoryOptions = {}): Trajectory {
  return buildTrajectory(loadTrajectorySources(runId, options));
}

export function parseTrajectorySince(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('--since must be an ISO-8601 timestamp or epoch milliseconds');
    }
    return value;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new Error('--since must be an ISO-8601 timestamp or epoch milliseconds');
  }
  return ms;
}
