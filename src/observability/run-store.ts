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
import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import { executeHermesLifecycleHook } from '../hooks/hermes-lifecycle-hooks.js';
import { isProofLedgerArtifact } from './proof-ledger-constants.js';

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
  | 'metric'
  | 'lesson_added'
  | 'lesson_candidate_proposed'
  | 'skill_selected';

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

export interface RunSearchOptions {
  includeArtifacts?: boolean;
  includeEvents?: boolean;
  limit?: number;
  sources?: string[];
}

export interface RunSearchResult {
  runId: string;
  objective: string;
  status: RunSummary['status'];
  startedAt: number;
  matched: 'artifact' | 'event' | 'summary';
  score: number;
  snippet: string;
  artifact?: string;
  eventType?: RunEventType;
  source?: string;
}

export interface RunArtifactIndexBackfillOptions {
  limit?: number;
  sources?: string[];
}

export interface RunArtifactIndexBackfillResult {
  artifactCount: number;
  failedCount: number;
  indexedCount: number;
  limit: number;
  runCount: number;
  runIds: string[];
  skippedCount: number;
  sources: string[];
  unavailable: boolean;
}

/**
 * A single artifact FTS index row that no longer maps to live data on disk.
 *
 * `missing_run` — the whole run folder was pruned (MAX_RUNS) or moved, so the
 * row can never be reconstructed and just bloats search results.
 * `missing_artifact` — the run folder still exists but the artifact file was
 * deleted; the indexed content is still searchable but no longer openable.
 */
export interface ArtifactIndexStaleRow {
  runId: string;
  artifact: string;
  reason: 'missing_run' | 'missing_artifact';
}

export interface ArtifactIndexHealthReport {
  /** True when the SQLite/FTS layer could not be opened (no DB to inspect). */
  unavailable: boolean;
  totalRows: number;
  healthyRows: number;
  /** Rows whose run folder is gone (the primary "stale" target). */
  staleRows: number;
  /** Rows whose run folder exists but the artifact file is gone. */
  orphanedRows: number;
  /** Detailed list, capped to avoid unbounded output. */
  rows: ArtifactIndexStaleRow[];
}

export interface ArtifactIndexRepairResult extends ArtifactIndexHealthReport {
  /** Whether a repair (delete) pass actually ran. */
  repaired: boolean;
  /** Whether orphaned rows were included in the repair, not only stale ones. */
  includedOrphans: boolean;
  /** Number of rows removed from the index. */
  removedRows: number;
}

/** One node in a run family tree (a run plus its forked descendants). */
export interface RunLineageNode {
  runId: string;
  objective: string;
  status: RunSummary['status'];
  startedAt: number;
  forkReason?: string;
  children: RunLineageNode[];
}

export interface RunLineageAncestor {
  runId: string;
  objective: string;
  forkReason?: string;
}

export interface RunLineageResult {
  /** The requested run id. */
  runId: string;
  /** Whether the requested run exists in the store. */
  found: boolean;
  /** Root → … → parent chain above the requested run. */
  ancestors: RunLineageAncestor[];
  /** The requested run as the root of its descendant subtree. */
  tree: RunLineageNode | null;
  /** Total runs in the family (ancestors + the requested subtree). */
  familySize: number;
}

const MAX_RUNS = 30;
const MAX_ARTIFACT_SEARCH_BYTES = 200_000;
const ARTIFACT_INDEX_DB = 'artifact-index.sqlite';
/** Cap the detail row list in health reports; counts stay accurate. */
const ARTIFACT_INDEX_HEALTH_DETAIL_CAP = 500;

interface ArtifactIndexRow {
  runId: string;
  artifact: string;
  content: string;
  rank: number;
  snippet?: string;
}

// ──────────────────────────────────────────────────────────────────
// RunStore
// ──────────────────────────────────────────────────────────────────

// Module-level active store reference (used by lessons-tools and other non-class callers)
let _activeStore: RunStore | null = null;
export function setActiveRunStore(s: RunStore | null): void { _activeStore = s; }
export function getActiveRunStore(): RunStore | null { return _activeStore; }

export class RunStore {
  private static _instance: RunStore | null = null;

  private runsDir: string;
  /** File handles for active run event streams */
  private handles: Map<string, fs.WriteStream> = new Map();
  /** Immediate in-process view of events, avoiding read-after-write stream races. */
  private eventBuffers: Map<string, RunEvent[]> = new Map();
  /** In-memory event counts per run */
  private eventCounts: Map<string, number> = new Map();
  /** In-memory summaries for fast listing */
  private summaries: Map<string, RunSummary> = new Map();
  /** The currently active run ID (set by startRun, cleared by endRun) */
  private _currentRunId: string | null = null;
  /** Durable FTS5 index for text artifacts. Opened lazily. */
  private artifactIndexDb: Database.Database | null = null;
  /** If SQLite/FTS is unavailable, keep run search on the file-scan fallback. */
  private artifactIndexUnavailable = false;

   constructor(runsDir?: string) {
    this.runsDir =
      runsDir || process.env.CODEBUDDY_RUNS_DIR || path.join(os.homedir(), '.codebuddy', 'runs');
    this.ensureDir(this.runsDir);
    this.loadSummaries();
  }

  getRunsDir(): string {
    return this.runsDir;
  }

  static getInstance(): RunStore {
    if (!RunStore._instance) {
      RunStore._instance = new RunStore();
    }
    return RunStore._instance;
  }

  /**
   * Convenience method to emit an event on the current active run.
   * No-op when no run is active (safe to call unconditionally).
   */
  appendEvent(type: RunEventType, data: Record<string, unknown>): void {
    if (this._currentRunId) {
      this.emit(this._currentRunId, { type, data });
    }
  }

  /** The id of the run currently being recorded, or null when idle. */
  getCurrentRunId(): string | null {
    return this._currentRunId;
  }

  dispose(): void {
    for (const ws of this.handles.values()) {
      try {
        ws.destroy();
      } catch {
        // Ignore dispose-time stream errors.
      }
    }
    this.handles.clear();
    this.eventBuffers.clear();
    if (this.artifactIndexDb) {
      try {
        this.artifactIndexDb.close();
      } catch {
        // Ignore dispose-time SQLite errors.
      }
      this.artifactIndexDb = null;
    }
    if (_activeStore === this) {
      setActiveRunStore(null);
    }
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
    this.eventBuffers.set(runId, []);

    // Create events file synchronously, then open append stream
    const eventsPath = path.join(runDir, 'events.jsonl');
    fs.writeFileSync(eventsPath, '', { flag: 'a' }); // ensure file exists
    const ws = fs.createWriteStream(eventsPath, { flags: 'a', encoding: 'utf-8' });
    ws.on('error', (err) => {
      logger.debug('RunStore: event stream error', {
        runId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
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

    this._currentRunId = runId;
    setActiveRunStore(this);

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

    const buffer = this.eventBuffers.get(runId);
    if (buffer) {
      buffer.push(fullEvent);
    }

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

    const afterStreamClosed = async (): Promise<void> => {
      try {
        const { writeRunProofLedgerArtifact } = await import('./proof-ledger.js');
        writeRunProofLedgerArtifact(this, runId);
      } catch (err) {
        logger.debug('RunStore: Proof Ledger artifact failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      executeHermesLifecycleHook(process.cwd(), 'after_run_complete', {
        runId,
        runStatus: status,
        runObjective: summary?.objective,
        runMetadata: summary?.metadata,
        endedAt: summary?.endedAt,
      }).catch((err) => logger.debug('RunStore: AfterRunComplete hook failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      }));

      import('../agent/learning-agent.js')
        .then(({ runLearningRetrospective }) => runLearningRetrospective(this, runId, {
          workDir: process.cwd(),
        }))
        .catch((err) => logger.debug('RunStore: Learning Agent retrospective failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        }));

      logger.debug(`RunStore: ended run ${runId} with status ${status}`);
    };

    // Close write stream before post-run analyzers read events.jsonl.
    const ws = this.handles.get(runId);
    if (ws) {
      ws.end(() => {
        void afterStreamClosed();
      });
      this.handles.delete(runId);
    } else {
      queueMicrotask(() => {
        void afterStreamClosed();
      });
    }

    if (this._currentRunId === runId) {
      this._currentRunId = null;
      setActiveRunStore(null);
    }
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

    const filePath = this.resolveArtifactPath(runId, name);
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf-8');
    const isSystemArtifact = isProofLedgerArtifact(name);
    if (!isSystemArtifact) {
      this.indexArtifactForSearch(runId, name, content);
    }

    const summary = this.summaries.get(runId);
    if (summary && !isSystemArtifact) {
      summary.artifactCount = (summary.artifactCount || 0) + 1;
      this.saveSummary(runId, summary);
    }

    if (!isSystemArtifact) {
      this.emit(runId, {
        type: 'patch_created',
        data: { artifact: name, path: filePath },
      });
    }

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
        artifacts.push(...this.listArtifactNames(artifactsDir).filter((artifact) =>
          !isProofLedgerArtifact(artifact),
        ));
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
    const buffered = this.eventBuffers.get(runId);
    if (buffered) {
      return [...buffered];
    }

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
    try {
      const filePath = this.resolveArtifactPath(runId, name);
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Search recent run summaries, event payloads, and text artifacts.
   *
   * This keeps generated scripts, plans, summaries, and command logs
   * discoverable from the CLI without loading chat history.
   */
  searchRuns(query: string, options: RunSearchOptions = {}): RunSearchResult[] {
    const terms = normalizeSearchTerms(query);
    if (terms.length === 0) return [];

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const includeArtifacts = options.includeArtifacts !== false;
    const includeEvents = options.includeEvents !== false;
    const sources = normalizeSearchFilterValues(options.sources);
    const results: RunSearchResult[] = [];
    const indexedArtifacts = new Set<string>();

    if (includeArtifacts) {
      const artifactHits = this.searchArtifactsWithIndex(terms, limit, sources);
      for (const hit of artifactHits) {
        if (hit.artifact) {
          indexedArtifacts.add(`${hit.runId}\u0000${hit.artifact}`);
        }
        results.push(hit);
      }
    }

    for (const summary of this.listRuns(100)) {
      if (!matchesRunSearchSources(summary, sources)) {
        continue;
      }
      const source = inferRunSearchSource(summary, sources);
      const summaryText = [
        summary.runId,
        summary.objective,
        summary.status,
        JSON.stringify(summary.metadata ?? {}),
      ].join(' ');
      const summaryScore = scoreSearchText(summaryText, terms);
      if (summaryScore > 0) {
        results.push({
          runId: summary.runId,
          objective: summary.objective,
          status: summary.status,
          startedAt: summary.startedAt,
          matched: 'summary',
          score: summaryScore + 20,
          snippet: buildSearchSnippet(summaryText, terms),
          source,
        });
      }

      if (includeEvents) {
        for (const event of this.getEvents(summary.runId)) {
          const eventText = `${event.type} ${safeStringify(event.data)}`;
          const eventScore = scoreSearchText(eventText, terms);
          if (eventScore > 0) {
            results.push({
              runId: summary.runId,
              objective: summary.objective,
              status: summary.status,
              startedAt: summary.startedAt,
              matched: 'event',
              eventType: event.type,
              score: eventScore + 10,
              snippet: buildSearchSnippet(eventText, terms),
              source,
            });
          }
        }
      }

      if (includeArtifacts) {
        const record = this.getRun(summary.runId);
        for (const artifact of record?.artifacts ?? []) {
          if (isProofLedgerArtifact(artifact)) {
            continue;
          }
          if (indexedArtifacts.has(`${summary.runId}\u0000${artifact}`)) {
            continue;
          }
          const artifactText = this.readArtifactForSearch(summary.runId, artifact);
          const artifactScore = scoreSearchText(`${artifact} ${artifactText}`, terms);
          if (artifactScore > 0) {
            this.indexArtifactForSearch(summary.runId, artifact, artifactText);
            results.push({
              runId: summary.runId,
              objective: summary.objective,
              status: summary.status,
              startedAt: summary.startedAt,
              matched: 'artifact',
              artifact,
              score: artifactScore + 30,
              snippet: buildSearchSnippet(artifactText || artifact, terms),
              source,
            });
          }
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score || b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Populate the durable artifact FTS index for existing run folders.
   *
   * New artifacts are indexed when saved. This backfill is for historical run
   * folders created before the index existed, or for repaired/copied stores.
   */
  backfillArtifactIndex(options: RunArtifactIndexBackfillOptions = {}): RunArtifactIndexBackfillResult {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const sources = normalizeSearchFilterValues(options.sources);
    const db = this.getArtifactIndexDb();
    const selectedRuns = this.listRuns(limit).filter((summary) =>
      matchesRunSearchSources(summary, sources),
    );
    const result: RunArtifactIndexBackfillResult = {
      artifactCount: 0,
      failedCount: 0,
      indexedCount: 0,
      limit,
      runCount: selectedRuns.length,
      runIds: selectedRuns.map((summary) => summary.runId),
      skippedCount: 0,
      sources,
      unavailable: db === null,
    };

    if (!db) {
      result.skippedCount = selectedRuns.reduce((count, summary) =>
        count + (this.getRun(summary.runId)?.artifacts.filter((artifact) =>
          !isProofLedgerArtifact(artifact),
        ).length ?? 0), 0);
      return result;
    }

    for (const summary of selectedRuns) {
      const record = this.getRun(summary.runId);
      for (const artifact of record?.artifacts ?? []) {
        if (isProofLedgerArtifact(artifact)) {
          continue;
        }
        result.artifactCount += 1;
        const artifactText = this.readArtifactForSearch(summary.runId, artifact);
        if (this.indexArtifactForSearch(summary.runId, artifact, artifactText)) {
          result.indexedCount += 1;
        } else {
          result.failedCount += 1;
        }
      }
    }

    return result;
  }

  /**
   * Inspect the durable artifact FTS index for rows that no longer map to live
   * data on disk. Stale rows accumulate when run folders are pruned (MAX_RUNS)
   * or moved, leaving search hits that point at nothing.
   *
   * Read-only: this never mutates the index. Pair it with repairArtifactIndex().
   */
  checkArtifactIndexHealth(): ArtifactIndexHealthReport {
    const scan = this.scanArtifactIndex();
    return this.toHealthReport(scan);
  }

  /**
   * Remove stale artifact FTS rows (run folder gone). When includeOrphans is
   * set, also remove rows whose run folder survived but whose artifact file was
   * deleted. The FTS mirror stays in sync via the AFTER DELETE trigger.
   */
  repairArtifactIndex(options: { includeOrphans?: boolean } = {}): ArtifactIndexRepairResult {
    const includeOrphans = options.includeOrphans === true;
    const scan = this.scanArtifactIndex();
    const report = this.toHealthReport(scan);
    const base: ArtifactIndexRepairResult = {
      ...report,
      repaired: false,
      includedOrphans: includeOrphans,
      removedRows: 0,
    };

    const db = this.getArtifactIndexDb();
    if (!db || scan.unavailable) {
      return base;
    }

    const targets = scan.rows.filter((row) =>
      row.reason === 'missing_run' || (includeOrphans && row.reason === 'missing_artifact'),
    );
    if (targets.length === 0) {
      return { ...base, repaired: true };
    }

    try {
      const stmt = db.prepare('DELETE FROM artifact_index WHERE run_id = ? AND artifact = ?');
      const removeAll = db.transaction((rows: ArtifactIndexStaleRow[]) => {
        let removed = 0;
        for (const row of rows) {
          removed += stmt.run(row.runId, row.artifact).changes;
        }
        return removed;
      });
      const removedRows = removeAll(targets);
      return { ...base, repaired: true, removedRows };
    } catch (err) {
      logger.debug('RunStore: artifact index repair failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return base;
    }
  }

  /**
   * Reconstruct the fork family of a run: the ancestor chain above it (via
   * `metadata.parentRolloutId`) and the descendant subtree below it. This is
   * the data behind a "thread family tree" view — when a session is forked,
   * compressed-and-rolled-back, or A/B varied, `forkRun` records the parent
   * link, and this walks it both ways.
   */
  getRunLineage(runId: string): RunLineageResult {
    const root = this.summaries.get(runId);
    if (!root) {
      return { runId, found: false, ancestors: [], tree: null, familySize: 0 };
    }

    // Walk ancestors upward, guarding against cycles and runaway depth.
    const ancestors: RunLineageAncestor[] = [];
    const seenUp = new Set<string>([runId]);
    let cursor = root.metadata?.parentRolloutId;
    while (cursor && !seenUp.has(cursor) && ancestors.length < 100) {
      seenUp.add(cursor);
      const parent = this.summaries.get(cursor);
      if (!parent) {
        // Parent was pruned; record the id so the chain isn't silently lost.
        ancestors.unshift({ runId: cursor, objective: '(pruned)' });
        break;
      }
      ancestors.unshift({
        runId: parent.runId,
        objective: parent.objective,
        ...(parent.metadata?.forkReason ? { forkReason: parent.metadata.forkReason } : {}),
      });
      cursor = parent.metadata?.parentRolloutId;
    }

    // Index children by parent id for the descendant walk.
    const childrenByParent = new Map<string, RunSummary[]>();
    for (const summary of this.summaries.values()) {
      const parentId = summary.metadata?.parentRolloutId;
      if (parentId) {
        const list = childrenByParent.get(parentId) ?? [];
        list.push(summary);
        childrenByParent.set(parentId, list);
      }
    }

    const seenDown = new Set<string>();
    const buildNode = (summary: RunSummary): RunLineageNode => {
      seenDown.add(summary.runId);
      const childSummaries = (childrenByParent.get(summary.runId) ?? [])
        .filter((child) => !seenDown.has(child.runId))
        .sort((a, b) => a.startedAt - b.startedAt);
      return {
        runId: summary.runId,
        objective: summary.objective,
        status: summary.status,
        startedAt: summary.startedAt,
        ...(summary.metadata?.forkReason ? { forkReason: summary.metadata.forkReason } : {}),
        children: childSummaries.map(buildNode),
      };
    };

    const tree = buildNode(root);
    const familySize = ancestors.length + seenDown.size;
    return { runId, found: true, ancestors, tree, familySize };
  }

  // ──────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────

  /**
   * Walk every artifact index row and classify it against the filesystem.
   * Returns the full (uncapped) set of stale rows so repair can act on all of
   * them; the public report caps the detail list separately.
   */
  private scanArtifactIndex(): {
    rows: ArtifactIndexStaleRow[];
    totalRows: number;
    healthyRows: number;
    unavailable: boolean;
  } {
    const db = this.getArtifactIndexDb();
    if (!db) {
      return { rows: [], totalRows: 0, healthyRows: 0, unavailable: true };
    }

    let indexed: Array<{ run_id: string; artifact: string }> = [];
    try {
      indexed = db
        .prepare('SELECT run_id, artifact FROM artifact_index')
        .all() as Array<{ run_id: string; artifact: string }>;
    } catch (err) {
      logger.debug('RunStore: artifact index scan failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return { rows: [], totalRows: 0, healthyRows: 0, unavailable: true };
    }

    const stale: ArtifactIndexStaleRow[] = [];
    let healthy = 0;
    for (const row of indexed) {
      const runDir = this.runDir(row.run_id);
      if (!fs.existsSync(runDir)) {
        stale.push({ runId: row.run_id, artifact: row.artifact, reason: 'missing_run' });
        continue;
      }
      const artifactPath = path.join(runDir, 'artifacts', row.artifact);
      if (!fs.existsSync(artifactPath)) {
        stale.push({ runId: row.run_id, artifact: row.artifact, reason: 'missing_artifact' });
        continue;
      }
      healthy += 1;
    }

    return {
      rows: stale,
      totalRows: indexed.length,
      healthyRows: healthy,
      unavailable: false,
    };
  }

  private toHealthReport(scan: {
    rows: ArtifactIndexStaleRow[];
    totalRows: number;
    healthyRows: number;
    unavailable: boolean;
  }): ArtifactIndexHealthReport {
    let staleRows = 0;
    let orphanedRows = 0;
    for (const row of scan.rows) {
      if (row.reason === 'missing_run') {
        staleRows += 1;
      } else {
        orphanedRows += 1;
      }
    }
    return {
      unavailable: scan.unavailable,
      totalRows: scan.totalRows,
      healthyRows: scan.healthyRows,
      staleRows,
      orphanedRows,
      rows: scan.rows.slice(0, ARTIFACT_INDEX_HEALTH_DETAIL_CAP),
    };
  }

  private runDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }

  private getArtifactIndexDb(): Database.Database | null {
    if (this.artifactIndexUnavailable) {
      return null;
    }
    if (this.artifactIndexDb) {
      return this.artifactIndexDb;
    }
    try {
      const db = new Database(path.join(this.runsDir, ARTIFACT_INDEX_DB));
      db.pragma('journal_mode = WAL');

      // Check if table exists and does NOT have tokenize='trigram'
      let needsRebuild = false;
      try {
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='artifact_index_fts'").get() as { sql: string } | undefined;
        if (tableInfo && !tableInfo.sql.includes("tokenize='trigram'") && !tableInfo.sql.includes('tokenize="trigram"')) {
          needsRebuild = true;
        }
      } catch {
        // Table doesn't exist or tableInfo query failed
      }

      if (needsRebuild) {
        db.exec(`
          DROP TRIGGER IF EXISTS artifact_index_ai;
          DROP TRIGGER IF EXISTS artifact_index_ad;
          DROP TRIGGER IF EXISTS artifact_index_au;
          DROP TABLE IF EXISTS artifact_index_fts;
        `);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS artifact_index (
          run_id TEXT NOT NULL,
          artifact TEXT NOT NULL,
          content TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, artifact)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS artifact_index_fts USING fts5(
          run_id UNINDEXED,
          artifact UNINDEXED,
          content,
          content='artifact_index',
          content_rowid='rowid',
          tokenize='trigram'
        );
        CREATE TRIGGER IF NOT EXISTS artifact_index_ai AFTER INSERT ON artifact_index BEGIN
          INSERT INTO artifact_index_fts(rowid, run_id, artifact, content)
          VALUES (new.rowid, new.run_id, new.artifact, new.content);
        END;
        CREATE TRIGGER IF NOT EXISTS artifact_index_ad AFTER DELETE ON artifact_index BEGIN
          INSERT INTO artifact_index_fts(artifact_index_fts, rowid, run_id, artifact, content)
          VALUES ('delete', old.rowid, old.run_id, old.artifact, old.content);
        END;
        CREATE TRIGGER IF NOT EXISTS artifact_index_au AFTER UPDATE ON artifact_index BEGIN
          INSERT INTO artifact_index_fts(artifact_index_fts, rowid, run_id, artifact, content)
          VALUES ('delete', old.rowid, old.run_id, old.artifact, old.content);
          INSERT INTO artifact_index_fts(rowid, run_id, artifact, content)
          VALUES (new.rowid, new.run_id, new.artifact, new.content);
        END;
      `);

      if (needsRebuild) {
        db.exec("INSERT INTO artifact_index_fts(artifact_index_fts) VALUES('rebuild');");
      }

      this.artifactIndexDb = db;
      return db;
    } catch (err) {
      this.artifactIndexUnavailable = true;
      logger.debug('RunStore: artifact FTS index unavailable, falling back to file scan', {
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private indexArtifactForSearch(runId: string, name: string, content: string): boolean {
    const db = this.getArtifactIndexDb();
    if (!db) return false;
    const searchContent = `${name}\n${content}`.slice(0, MAX_ARTIFACT_SEARCH_BYTES);
    try {
      db.prepare(`
        INSERT INTO artifact_index (run_id, artifact, content, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(run_id, artifact) DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(runId, name, searchContent, Date.now());
      return true;
    } catch (err) {
      logger.debug('RunStore: failed to index artifact for search', {
        runId,
        artifact: name,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  private searchArtifactsWithIndex(
    terms: string[],
    limit: number,
    sources: string[],
  ): RunSearchResult[] {
    const db = this.getArtifactIndexDb();
    const query = buildFtsQuery(terms);
    if (!db || !query) return [];

    try {
      const rows = db.prepare(`
        SELECT
          run_id AS runId,
          artifact,
          content,
          snippet(artifact_index_fts, 2, '<mark>', '</mark>', '...', 25) AS snippet,
          bm25(artifact_index_fts) AS rank
        FROM artifact_index_fts
        WHERE artifact_index_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, Math.max(limit * 5, 25)) as ArtifactIndexRow[];

      const hits: RunSearchResult[] = [];
      for (const row of rows) {
        if (isProofLedgerArtifact(row.artifact)) {
          continue;
        }
        const summary = this.summaries.get(row.runId);
        if (!summary || !matchesRunSearchSources(summary, sources)) {
          continue;
        }
        const score = scoreSearchText(row.content, terms);
        hits.push({
          runId: summary.runId,
          objective: summary.objective,
          status: summary.status,
          startedAt: summary.startedAt,
          matched: 'artifact',
          artifact: row.artifact,
          score: (score > 0 ? score : 1) + 35,
          snippet: buildSearchSnippet(row.content, terms),
          source: inferRunSearchSource(summary, sources),
        });
      }
      return hits;
    } catch (err) {
      logger.debug('RunStore: artifact FTS search failed, falling back to file scan', {
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private readArtifactForSearch(runId: string, name: string): string {
    try {
      const filePath = this.resolveArtifactPath(runId, name);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return '';
      const fd = fs.openSync(filePath, 'r');
      try {
        const length = Math.min(stat.size, MAX_ARTIFACT_SEARCH_BYTES);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, 0);
        return buffer.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
  }

  private listArtifactNames(artifactsDir: string): string[] {
    const names: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }
        if (entry.isFile()) {
          names.push(path.relative(artifactsDir, fullPath).split(path.sep).join('/'));
        }
      }
    };
    visit(artifactsDir);
    return names.sort((a, b) => a.localeCompare(b));
  }

  private resolveArtifactPath(runId: string, name: string): string {
    const artifactsDir = path.resolve(this.runDir(runId), 'artifacts');
    const filePath = path.resolve(artifactsDir, name);
    if (filePath !== artifactsDir && filePath.startsWith(`${artifactsDir}${path.sep}`)) {
      return filePath;
    }
    throw new Error(`Artifact path escapes run artifacts directory: ${name}`);
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
      this.eventBuffers.delete(s.runId);

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

function normalizeSearchTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function buildFtsQuery(terms: string[]): string {
  return terms
    .map((term) => term.replace(/"/g, '""').trim())
    .filter((term) => {
      const isCjk = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(term);
      return term.length >= 2 || (isCjk && term.length >= 1);
    })
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(' ');
}

function normalizeSearchFilterValues(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .flatMap((value) => expandRunSourceAliases(value)),
  )];
}

function matchesRunSearchSources(summary: RunSummary, sources: string[]): boolean {
  if (sources.length === 0) {
    return true;
  }
  const candidates = new Set(runSearchSourceCandidates(summary).flatMap((value) => expandRunSourceAliases(value)));
  return sources.some((source) => candidates.has(source));
}

function inferRunSearchSource(summary: RunSummary, requestedSources: string[]): string | undefined {
  const candidates = runSearchSourceCandidates(summary);
  if (candidates.length === 0) {
    return undefined;
  }
  if (requestedSources.length === 0) {
    return candidates[0];
  }
  return candidates.find((candidate) =>
    expandRunSourceAliases(candidate).some((alias) => requestedSources.includes(alias)),
  ) ?? candidates[0];
}

function runSearchSourceCandidates(summary: RunSummary): string[] {
  const metadata = summary.metadata as (RunMetadata & Record<string, unknown>) | undefined;
  const candidates = [
    metadata?.channel,
    metadata?.source,
    metadata?.platform,
    metadata?.origin,
    ...(Array.isArray(metadata?.tags) ? metadata.tags : []),
  ];
  return [...new Set(
    candidates
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function expandRunSourceAliases(value: string): string[] {
  switch (value) {
    case 'cli':
    case 'terminal':
      return ['cli', 'terminal'];
    case 'cowork':
    case 'desktop':
      return ['cowork', 'desktop'];
    case 'scheduled':
    case 'schedule':
    case 'cron':
      return ['scheduled', 'schedule', 'cron'];
    case 'phone':
    case 'mobile':
      return ['mobile', 'phone'];
    default:
      return [value];
  }
}

function scoreSearchText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  if (!terms.every((term) => lower.includes(term))) {
    return 0;
  }

  return terms.reduce((score, term) => {
    const index = lower.indexOf(term);
    return score + 10 + Math.max(0, 20 - Math.floor(index / 20));
  }, 0);
}

function buildSearchSnippet(text: string, terms: string[], maxLength = 180): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  const lower = compact.toLowerCase();
  const indexes = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0);
  const first = indexes.length > 0 ? Math.min(...indexes) : 0;
  const start = Math.max(0, first - 50);
  const end = Math.min(compact.length, start + maxLength);
  const snippet = compact.slice(start, end);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compact.length ? '...' : '';
  return prefix + snippet + suffix;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
