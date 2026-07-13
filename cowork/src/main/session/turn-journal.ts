import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logWarn } from '../utils/logger';

export type TurnJournalEventType =
  | 'intent_queued'
  | 'turn_submitted'
  | 'turn_started'
  | 'message_saved'
  | 'trace_step'
  | 'trace_update'
  | 'steer_delivered'
  | 'steer_fallback_queued'
  | 'turn_completed'
  | 'turn_failed'
  | 'cancel_requested';

export interface TurnJournalEvent {
  schemaVersion: 1;
  type: TurnJournalEventType;
  sessionId: string;
  ts: number;
  eventId?: string;
  runId?: string;
  seq?: number;
  turnId?: string;
  data?: Record<string, unknown>;
}

export type TurnJournalTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TurnJournalTurnSummary {
  turnId: string;
  startedAt: number;
  updatedAt: number;
  latestType: TurnJournalEventType;
  status: TurnJournalTurnStatus;
  eventCount: number;
  messageCount: number;
  traceStepCount: number;
}

export interface TurnJournalReplayAnchor {
  eventId: string;
  runId: string;
  seq: number;
  type: TurnJournalEventType;
  ts: number;
  turnId?: string;
}

export interface TurnJournalReplayRun {
  runId: string;
  turnId?: string;
  startedAt: number;
  updatedAt: number;
  latestType: TurnJournalEventType;
  status: TurnJournalTurnStatus;
  eventCount: number;
  anchorCount: number;
  terminalEvent?: TurnJournalEvent;
  anchors: TurnJournalReplayAnchor[];
  events: TurnJournalEvent[];
}

export interface TurnJournalReplayResult {
  sessionId: string;
  path: string;
  exists: boolean;
  totalEventCount: number;
  malformedLineCount: number;
  pendingTurnCount: number;
  runCount: number;
  runs: TurnJournalReplayRun[];
}

export interface TurnJournalReadResult {
  sessionId: string;
  path: string;
  exists: boolean;
  totalEventCount: number;
  malformedLineCount: number;
  pendingTurnCount: number;
  events: TurnJournalEvent[];
  turns: TurnJournalTurnSummary[];
  replay: TurnJournalReplayResult;
}

/**
 * Identifies the exact byte prefix that belonged to the history active before
 * a branch mutation. The fence itself is committed in SQLite with the branch
 * switch. If the process exits before the JSONL file can be rotated, startup
 * recovery can still ignore only that stale prefix without discarding events
 * appended after the successful switch.
 */
export interface TurnJournalFence {
  byteOffset: number;
  prefixSha256: string;
}

export class TurnJournal {
  private readonly dir: string;
  private readonly runSequences: Map<string, number> = new Map();

  constructor(dir?: string) {
    this.dir = dir ?? path.join(app.getPath('userData'), 'turn-journals');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  append(
    sessionId: string,
    type: TurnJournalEventType,
    data: Record<string, unknown> = {},
    turnId?: string,
    options?: { eventId?: string; runId?: string; seq?: number }
  ): void {
    try {
      const runId = options?.runId ?? turnId ?? sessionId;
      const seq = options?.seq ?? this.nextSequence(runId);
      const eventId =
        options?.eventId ?? `${safeJournalName(sessionId)}:${safeJournalName(runId)}:${seq}:${type}`;
      const event: TurnJournalEvent = {
        schemaVersion: 1,
        type,
        sessionId,
        ts: Date.now(),
        eventId,
        runId,
        seq,
        ...(turnId ? { turnId } : {}),
        ...(Object.keys(data).length > 0 ? { data } : {}),
      };
      appendLineDurably(this.pathFor(sessionId), `${JSON.stringify(event)}\n`);
    } catch (error) {
      logWarn('[TurnJournal] append failed:', error);
    }
  }

  primeSequenceState(sessionId: string): void {
    const replay = this.read(sessionId).replay;
    for (const run of replay.runs) {
      const maxSeq = run.events.reduce((max, event) => Math.max(max, event.seq ?? 0), 0);
      if (maxSeq <= 0) continue;
      const existing = this.runSequences.get(run.runId) ?? 0;
      if (maxSeq > existing) {
        this.runSequences.set(run.runId, maxSeq);
      }
    }
  }

  pathFor(sessionId: string): string {
    return path.join(this.dir, `${safeJournalName(sessionId)}.jsonl`);
  }

  captureFence(sessionId: string): TurnJournalFence | null {
    const file = this.pathFor(sessionId);
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file);
    return {
      byteOffset: content.byteLength,
      prefixSha256: sha256(content),
    };
  }

  read(
    sessionId: string,
    eventLimit = 200,
    fence?: TurnJournalFence | null,
  ): TurnJournalReadResult {
    const file = this.pathFor(sessionId);
    if (!fs.existsSync(file)) {
      return emptyReadResult(sessionId, file, false);
    }

    let malformedLineCount = 0;
    const events: TurnJournalEvent[] = [];

    try {
      const fileContent = fs.readFileSync(file);
      const visibleContent = stripFencedPrefix(fileContent, fence);
      const lines = visibleContent.toString('utf8').split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (!isTurnJournalEvent(parsed, sessionId)) {
            malformedLineCount += 1;
            continue;
          }
          events.push(parsed);
        } catch {
          malformedLineCount += 1;
        }
      }
    } catch (error) {
      logWarn('[TurnJournal] read failed:', error);
      const empty = emptyReadResult(sessionId, file, true);
      return {
        ...empty,
        malformedLineCount: 1,
        replay: {
          ...empty.replay,
          malformedLineCount: 1,
        },
      };
    }

    const dedupedEvents = dedupeTurnEvents(events);
    const turns = buildTurnSummaries(dedupedEvents);
    const replay = buildTurnReplay(sessionId, file, dedupedEvents, malformedLineCount, turns);
    const safeLimit = Math.max(1, Math.min(eventLimit, 1_000));

    return {
      sessionId,
      path: file,
      exists: true,
      totalEventCount: dedupedEvents.length,
      malformedLineCount,
      pendingTurnCount: turns.filter((turn) => turn.status === 'running').length,
      events: dedupedEvents.slice(-safeLimit),
      turns,
      replay,
    };
  }

  delete(sessionId: string): void {
    try {
      const file = this.pathFor(sessionId);
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      logWarn('[TurnJournal] delete failed:', error);
    }
  }

  /**
   * Atomically move recovery events out of the active journal namespace.
   * Archived JSONL remains available for audit, but startup recovery cannot
   * replay turns from a conversation branch that is no longer checked out.
   * Throws on failure so a caller can roll back its SQLite branch transaction.
   */
  rotate(sessionId: string, reason = 'history-change'): string | null {
    const file = this.pathFor(sessionId);
    if (!fs.existsSync(file)) {
      this.runSequences.delete(sessionId);
      return null;
    }

    const replay = this.read(sessionId).replay;
    const safeReason = safeJournalName(reason) || 'history-change';
    const archivedPath = `${file}.${safeReason}.${Date.now()}.${randomUUID()}.archived`;
    fs.renameSync(file, archivedPath);
    for (const run of replay.runs) {
      this.runSequences.delete(run.runId);
    }
    this.runSequences.delete(sessionId);
    return archivedPath;
  }

  private nextSequence(runId: string): number {
    const next = (this.runSequences.get(runId) ?? 0) + 1;
    this.runSequences.set(runId, next);
    return next;
  }
}

function safeJournalName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function stripFencedPrefix(content: Buffer, fence?: TurnJournalFence | null): Buffer {
  if (!fence || fence.byteOffset <= 0 || fence.byteOffset > content.byteLength) {
    return content;
  }
  const prefix = content.subarray(0, fence.byteOffset);
  if (sha256(prefix) !== fence.prefixSha256) {
    // The active journal was rotated and recreated. A hash mismatch therefore
    // means the SQLite fence belongs to a different file generation.
    return content;
  }
  return content.subarray(fence.byteOffset);
}

function emptyReadResult(sessionId: string, file: string, exists: boolean): TurnJournalReadResult {
  return {
    sessionId,
    path: file,
    exists,
    totalEventCount: 0,
    malformedLineCount: 0,
    pendingTurnCount: 0,
    events: [],
    turns: [],
    replay: {
      sessionId,
      path: file,
      exists,
      totalEventCount: 0,
      malformedLineCount: 0,
      pendingTurnCount: 0,
      runCount: 0,
      runs: [],
    },
  };
}

function isTurnJournalEvent(value: unknown, sessionId: string): value is TurnJournalEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<TurnJournalEvent>;
  if (event.schemaVersion !== 1) return false;
  if (!isTurnJournalEventType(event.type)) return false;
  if (event.sessionId !== sessionId) return false;
  if (typeof event.ts !== 'number') return false;
  if (event.eventId !== undefined && typeof event.eventId !== 'string') return false;
  if (event.runId !== undefined && typeof event.runId !== 'string') return false;
  if (event.seq !== undefined && typeof event.seq !== 'number') return false;
  if (event.turnId !== undefined && typeof event.turnId !== 'string') return false;
  if (event.data !== undefined && (!event.data || typeof event.data !== 'object')) return false;
  return true;
}

function isTurnJournalEventType(value: unknown): value is TurnJournalEventType {
  return (
    value === 'intent_queued' ||
    value === 'turn_submitted' ||
    value === 'turn_started' ||
    value === 'message_saved' ||
    value === 'trace_step' ||
    value === 'trace_update' ||
    value === 'steer_delivered' ||
    value === 'steer_fallback_queued' ||
    value === 'turn_completed' ||
    value === 'turn_failed' ||
    value === 'cancel_requested'
  );
}

function buildTurnSummaries(events: TurnJournalEvent[]): TurnJournalTurnSummary[] {
  const byTurnId = new Map<string, TurnJournalTurnSummary>();

  for (const event of events) {
    if (!event.turnId) continue;
    const existing = byTurnId.get(event.turnId);
    const summary: TurnJournalTurnSummary =
      existing ??
      {
        turnId: event.turnId,
        startedAt: event.ts,
        updatedAt: event.ts,
        latestType: event.type,
        status: statusForEventType(event.type),
        eventCount: 0,
        messageCount: 0,
        traceStepCount: 0,
      };

    summary.startedAt = Math.min(summary.startedAt, event.ts);
    summary.updatedAt = Math.max(summary.updatedAt, event.ts);
    summary.latestType = event.type;
    const nextStatus = statusForEventType(event.type);
    if (nextStatus !== 'running' || summary.status === 'running') {
      summary.status = nextStatus;
    }
    summary.eventCount += 1;
    if (event.type === 'message_saved') {
      summary.messageCount += 1;
    }
    if (event.type === 'trace_step') {
      summary.traceStepCount += 1;
    }

    byTurnId.set(event.turnId, summary);
  }

  return [...byTurnId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function dedupeTurnEvents(events: TurnJournalEvent[]): TurnJournalEvent[] {
  const deduped: TurnJournalEvent[] = [];
  const seenEventIds = new Set<string>();
  const seenRunSeq = new Set<string>();

  for (const [index, event] of events.entries()) {
    const eventId = buildJournalEventIdentity(event, index);
    if (seenEventIds.has(eventId)) continue;
    seenEventIds.add(eventId);

    if (event.runId !== undefined && event.seq !== undefined) {
      const runSeqKey = `${event.runId}:${event.seq}`;
      if (seenRunSeq.has(runSeqKey)) continue;
      seenRunSeq.add(runSeqKey);
    }

    deduped.push(event);
  }

  return deduped;
}

function buildTurnReplay(
  sessionId: string,
  file: string,
  events: TurnJournalEvent[],
  malformedLineCount: number,
  turns: TurnJournalTurnSummary[]
): TurnJournalReplayResult {
  const runs = new Map<string, TurnJournalReplayRun>();

  for (const [index, event] of sortJournalEvents(events).entries()) {
    const runId = event.runId ?? event.turnId ?? sessionId;
    const seq = typeof event.seq === 'number' ? event.seq : 0;
    const eventId = buildJournalEventIdentity(event, index, sessionId, runId);
    const anchor: TurnJournalReplayAnchor = {
      eventId,
      runId,
      seq,
      type: event.type,
      ts: event.ts,
      ...(event.turnId ? { turnId: event.turnId } : {}),
    };
    const existing =
      runs.get(runId) ??
      {
        runId,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        startedAt: event.ts,
        updatedAt: event.ts,
        latestType: event.type,
        status: statusForEventType(event.type),
        eventCount: 0,
        anchorCount: 0,
        anchors: [],
        events: [],
      };
    existing.startedAt = Math.min(existing.startedAt, event.ts);
    existing.updatedAt = Math.max(existing.updatedAt, event.ts);
    existing.latestType = event.type;
    const nextStatus = statusForEventType(event.type);
    if (nextStatus !== 'running' || existing.status === 'running') {
      existing.status = nextStatus;
    }
    if (!existing.turnId && event.turnId) {
      existing.turnId = event.turnId;
    }
    existing.eventCount += 1;
    existing.anchorCount += 1;
    existing.anchors.push(anchor);
    existing.events.push(event);
    if (nextStatus !== 'running') {
      existing.terminalEvent = event;
    }
    runs.set(runId, existing);
  }

  const replayRuns = [...runs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const pendingTurnCount = turns.filter((turn) => turn.status === 'running').length;

  return {
    sessionId,
    path: file,
    exists: true,
    totalEventCount: events.length,
    malformedLineCount,
    pendingTurnCount,
    runCount: replayRuns.length,
    runs: replayRuns,
  };
}

function sortJournalEvents(events: TurnJournalEvent[]): TurnJournalEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    const aSeq = typeof a.seq === 'number' ? a.seq : Number.MAX_SAFE_INTEGER;
    const bSeq = typeof b.seq === 'number' ? b.seq : Number.MAX_SAFE_INTEGER;
    if (aSeq !== bSeq) return aSeq - bSeq;
    const aId = a.eventId ?? '';
    const bId = b.eventId ?? '';
    return aId.localeCompare(bId);
  });
}

function buildJournalEventIdentity(
  event: TurnJournalEvent,
  index: number,
  sessionId?: string,
  runId?: string
): string {
  if (event.eventId) return event.eventId;
  const safeSessionId = safeJournalName(sessionId ?? event.sessionId);
  const safeRunId = safeJournalName(runId ?? event.runId ?? event.turnId ?? 'unknown');
  const seqPart = typeof event.seq === 'number' ? `seq:${event.seq}` : `line:${index}`;
  return `${safeSessionId}:${safeRunId}:${seqPart}:${event.ts}:${event.type}`;
}

function statusForEventType(type: TurnJournalEventType): TurnJournalTurnStatus {
  if (type === 'turn_completed') return 'completed';
  if (type === 'turn_failed') return 'failed';
  if (type === 'cancel_requested') return 'cancelled';
  return 'running';
}

function appendLineDurably(file: string, line: string): void {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line, undefined, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
