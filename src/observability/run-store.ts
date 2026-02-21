/**
 * RunStore — JSONL-based observability store for agent runs.
 *
 * Each run gets its own directory under .codebuddy/runs/run_<id>/ with:
 *   events.jsonl   — append-only event log (one JSON object per line)
 *   metrics.json   — tokens, cost, duration, failover count
 *   artifacts/     — plan.md, patch.diff, commands.log, summary.md …
 *
 * Written in append mode for performance — no full-file parsing per event.
 * Automatic pruning keeps the 30 most recent runs.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type RunEventType =
  | 'run_start'
  | 'run_end'
  | 'step_start'
  | 'step_end'
  | 'tool_call'
  | 'tool_result'
  | 'patch_created'
  | 'patch_applied'
  | 'decision'
  | 'error'
  | 'metric';

export interface RunEvent {
  ts: number;
  type: RunEventType;
  runId: string;
  data: Record<string, unknown>;
}

export interface RunMetadata {
  /** Channel or context (e.g. 'terminal', 'telegram') */
  channel?: string;
  /** User ID if applicable */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Tags for filtering */
  tags?: string[];
  /**
   * Session Fork / Rollout unification (Codex-inspired).
   * When a run is forked (e.g. retry from checkpoint, A/B rollout variant),
   * this field links it to the original parent run ID so lineage can be
   * reconstructed. Enables `buddy run replay --from-fork` and cost attribution.
   */
  parentRolloutId?: string;
  /** Fork reason for traceability (e.g. 'retry', 'ab-variant-B', 'checkpoint-rollback') */
  forkReason?: string;
}

export interface RunMetrics {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  durationMs: number;
  toolCallCount: number;
  failoverCount: number;
}

export interface RunSummary {
  runId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  eventCount: number;
  artifactCount: number;
  metadata?: RunMetadata;
}

export interface RunRecord {
  summary: RunSummary;
  metrics: Partial<RunMetrics>;
  artifacts: string[]; // file paths relative to run dir
}

const MAX_RUNS = 30;

// ──────────────────────────────────────────────────────────────────
// RunStore
// ──────────────────────────────────────────────────────────────────

export class RunStore {
  private static _instance: RunStore | null = null;

  private runsDir: string;
  /** File handles for active run event streams */
  private handles: Map<string, fs.WriteStream> = new Map();
  /** In-memory event counts per run */
  private eventCounts: Map<string, number> = new Map();
  /** In-memory summaries for fast listing */
  private summaries: Map<string, RunSummary> = new Map();

  constructor(runsDir?: string) {
    this.runsDir = runsDir || path.join(os.homedir(), '.codebuddy', 'runs');
    this.ensureDir(this.runsDir);
    this.loadSummaries();
  }

  static getInstance(): RunStore {
    if (!RunStore._instance) {
      RunStore._instance = new RunStore();
    }
    return RunStore._instance;
  }

  // ──────────────────────────────────────────────────────────────
  // Run lifecycle
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a new run and return its ID.
   */
  startRun(objective: string, metadata?: RunMetadata): string {
    const runId = `run_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
    const runDir = this.runDir(runId);

    this.ensureDir(runDir);
    this.ensureDir(path.join(runDir, 'artifacts'));

    const summary: RunSummary = {
      runId,
      objective,
      status: 'running',
      startedAt: Date.now(),
      eventCount: 0,
      artifactCount: 0,
      metadata,
    };

    this.summaries.set(runId, summary);
    this.eventCounts.set(runId, 0);

    // Create events file synchronously, then open append stream
    const eventsPath = path.join(runDir, 'events.jsonl');
    fs.writeFileSync(eventsPath, '', { flag: 'a' }); // ensure file exists
    const ws = fs.createWriteStream(eventsPath, { flags: 'a', encoding: 'utf-8' });
    this.handles.set(runId, ws);

    // Emit run_start event
    this.emit(runId, { type: 'run_start', data: { objective, metadata } });

    // Save initial metrics
    this.saveMetrics(runId, {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalCost: 0,
      durationMs: 0,
      toolCallCount: 0,
      failoverCount: 0,
    });

    this.saveSummary(runId, summary);
    this.pruneOldRuns();

    logger.debug(`RunStore: started run ${runId}`, { objective });
    return runId;
  }

  /**
   * Fork an existing run — creates a new child run that inherits the parent's
   * objective and metadata, with `parentRolloutId` set for lineage tracking.
   *
   * Codex-inspired session fork / rollout unification: both the checkpoint
   * rollback path and A/B variant rollouts produce forked runs that can be
   * compared via `buddy run show <id>`.
   *
   * @param parentRunId - The run being forked
   * @param reason      - Human-readable fork reason ('retry', 'ab-variant-B', etc.)
   * @param overrides   - Optional metadata overrides for the forked run
   */
  forkRun(parentRunId: string, reason: string, overrides?: Partial<RunMetadata>): string {
    const parent = this.summaries.get(parentRunId);
    const objective = parent
      ? `[fork:${reason}] ${parent.objective}`
      : `[fork:${reason}]`;

    const parentMeta = parent?.metadata ?? {};
    const forkMeta: RunMetadata = {
      ...parentMeta,
      ...overrides,
      parentRolloutId: parentRunId,
      forkReason: reason,
    };

    const newRunId = this.startRun(objective, forkMeta);
    this.emit(newRunId, {
      type: 'decision',
      data: { kind: 'fork', parentRunId, reason },
    });
    logger.debug(`RunStore: forked run ${parentRunId} → ${newRunId}`, { reason });
    return newRunId;
  }

  /**
   * Emit an event for a run. Thread-safe: writes are serialized by the writable stream.
   */
  emit(runId: string, event: Omit<RunEvent, 'ts' | 'runId'>): void {
    const ws = this.handles.get(runId);
    if (!ws) return;

    const fullEvent: RunEvent = {
      ts: Date.now(),
      runId,
      ...event,
    };

    try {
      ws.write(JSON.stringify(fullEvent) + '\n');
    } catch (err) {
      logger.debug('RunStore: failed to write event', { runId, err });
    }

    // Update in-memory count
    const count = (this.eventCounts.get(runId) || 0) + 1;
    this.eventCounts.set(runId, count);

    const summary = this.summaries.get(runId);
    if (summary) {
      summary.eventCount = count;
    }
  }

  /**
   * End a run and flush the event stream.
   */
  endRun(runId: string, status: 'completed' | 'failed' | 'cancelled'): void {
    this.emit(runId, { type: 'run_end', data: { status } });

    const summary = this.summaries.get(runId);
    if (summary) {
      summary.status = status;
      summary.endedAt = Date.now();
      this.saveSummary(runId, summary);
    }

    // Update metrics duration
    try {
      const metricsPath = path.join(this.runDir(runId), 'metrics.json');
      if (fs.existsSync(metricsPath)) {
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as RunMetrics;
        metrics.durationMs = (summary?.endedAt || Date.now()) - (summary?.startedAt || Date.now());
        fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
      }
    } catch {
      // Ignore
    }

    // Close write stream
    const ws = this.handles.get(runId);
    if (ws) {
      ws.end();
      this.handles.delete(runId);
    }

    logger.debug(`RunStore: ended run ${runId} with status ${status}`);
  }

  // ──────────────────────────────────────────────────────────────
  // Artifacts
  // ──────────────────────────────────────────────────────────────

  /**
   * Save an artifact file for a run. Returns the absolute path.
   */
  saveArtifact(runId: string, name: string, content: string): string {
    const artifactsDir = path.join(this.runDir(runId), 'artifacts');
    this.ensureDir(artifactsDir);

    const filePath = path.join(artifactsDir, name);
    fs.writeFileSync(filePath, content, 'utf-8');

    const summary = this.summaries.get(runId);
    if (summary) {
      summary.artifactCount = (summary.artifactCount || 0) + 1;
      this.saveSummary(runId, summary);
    }

    this.emit(runId, {
      type: 'patch_created',
      data: { artifact: name, path: filePath },
    });

    return filePath;
  }

  /**
   * Update metrics for a run (merges with existing).
   */
  updateMetrics(runId: string, metrics: Partial<RunMetrics>): void {
    try {
      const metricsPath = path.join(this.runDir(runId), 'metrics.json');
      let existing: Partial<RunMetrics> = {};
      if (fs.existsSync(metricsPath)) {
        existing = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      }
      const merged = { ...existing, ...metrics };
      fs.writeFileSync(metricsPath, JSON.stringify(merged, null, 2));
    } catch {
      // Ignore
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Reading
  // ──────────────────────────────────────────────────────────────

  /**
   * Get the full record for a run (summary + metrics + artifact list).
   */
  getRun(runId: string): RunRecord | null {
    const summary = this.summaries.get(runId);
    if (!summary) return null;

    const runDir = this.runDir(runId);

    let metrics: Partial<RunMetrics> = {};
    try {
      const metricsPath = path.join(runDir, 'metrics.json');
      if (fs.existsSync(metricsPath)) {
        metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      }
    } catch {
      // Ignore
    }

    const artifacts: string[] = [];
    try {
      const artifactsDir = path.join(runDir, 'artifacts');
      if (fs.existsSync(artifactsDir)) {
        artifacts.push(...fs.readdirSync(artifactsDir));
      }
    } catch {
      // Ignore
    }

    return { summary, metrics, artifacts };
  }

  /**
   * List runs, most recent first.
   */
  listRuns(limit = 20): RunSummary[] {
    return Array.from(this.summaries.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Read all events from a run's JSONL file.
   */
  getEvents(runId: string): RunEvent[] {
    const eventsPath = path.join(this.runDir(runId), 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return [];

    const events: RunEvent[] = [];
    try {
      const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as RunEvent);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Ignore
    }
    return events;
  }

  /**
   * Async generator that yields new events as they are appended to events.jsonl.
   * Stops when the run ends (status no longer 'running') or after timeout.
   */
  async *streamEvents(runId: string, timeoutMs = 300_000): AsyncIterable<RunEvent> {
    const eventsPath = path.join(this.runDir(runId), 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return;

    let offset = 0;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const summary = this.summaries.get(runId);
      const isActive = summary?.status === 'running' || this.handles.has(runId);

      // Read new bytes since last offset
      try {
        const buf = Buffer.alloc(1024 * 64);
        const fd = fs.openSync(eventsPath, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);

        if (bytesRead > 0) {
          const chunk = buf.slice(0, bytesRead).toString('utf-8');
          offset += bytesRead;

          const lines = chunk.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              yield JSON.parse(line) as RunEvent;
            } catch {
              // Skip malformed
            }
          }
        }
      } catch {
        // Ignore read errors
      }

      if (!isActive) break;

      // Small delay before next poll
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /**
   * Read artifact content.
   */
  getArtifact(runId: string, name: string): string | null {
    const filePath = path.join(this.runDir(runId), 'artifacts', name);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────

  private runDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private saveMetrics(runId: string, metrics: Partial<RunMetrics>): void {
    try {
      const metricsPath = path.join(this.runDir(runId), 'metrics.json');
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
    } catch {
      // Ignore
    }
  }

  private saveSummary(runId: string, summary: RunSummary): void {
    try {
      const summaryPath = path.join(this.runDir(runId), 'summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    } catch {
      // Ignore
    }
  }

  private loadSummaries(): void {
    try {
      if (!fs.existsSync(this.runsDir)) return;

      const dirs = fs.readdirSync(this.runsDir).filter((d) => d.startsWith('run_'));
      for (const dir of dirs) {
        try {
          const summaryPath = path.join(this.runsDir, dir, 'summary.json');
          if (fs.existsSync(summaryPath)) {
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as RunSummary;
            this.summaries.set(summary.runId, summary);
            // Count events from file size heuristic (avoid full parse on load)
            const eventsPath = path.join(this.runsDir, dir, 'events.jsonl');
            if (fs.existsSync(eventsPath)) {
              this.eventCounts.set(summary.runId, summary.eventCount || 0);
            }
          }
        } catch {
          // Skip malformed
        }
      }
    } catch {
      // Ignore
    }
  }

  private pruneOldRuns(): void {
    const sorted = Array.from(this.summaries.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );

    if (sorted.length <= MAX_RUNS) return;

    const toRemove = sorted.slice(MAX_RUNS);
    for (const s of toRemove) {
      const runDir = this.runDir(s.runId);
      this.summaries.delete(s.runId);
      this.eventCounts.delete(s.runId);

      // Destroy handle immediately (force close, no flush needed for pruned runs)
      const ws = this.handles.get(s.runId);
      if (ws) {
        ws.destroy();
        this.handles.delete(s.runId);
      }

      // Remove directory after a short delay to let the stream fully close
      setTimeout(() => {
        try {
          fs.rmSync(runDir, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }, 20);
    }
  }
}
