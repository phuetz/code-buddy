/**
 * Unified read-only Trajectory view of an existing run (Harness C1).
 *
 * Pure function: `buildTrajectory(sources) → Trajectory`.
 * The CLI is only a presenter. No new telemetry is written.
 */

import os from 'node:os';
import type { ToolEffectClass } from '../tools/types.js';
import { resolveToolEffect } from '../tools/metadata.js';

export const RUN_TRAJECTORY_SCHEMA_VERSION = 1 as const;
export const RUN_TRAJECTORY_KIND = 'run_trajectory' as const;

export interface Unlogged {
  journaled: false;
  reason: string;
}

export function unlogged(reason: string): Unlogged {
  return { journaled: false, reason };
}

export function isUnlogged(value: unknown): value is Unlogged {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Unlogged).journaled === false
    && typeof (value as Unlogged).reason === 'string',
  );
}

export interface TrajectoryEvent {
  ts: number;
  type: string;
  data: Record<string, unknown>;
}

export interface TrajectoryAuditEntry {
  timestamp: string;
  action: string;
  decision?: string;
  target?: string;
  details?: string;
  source?: string;
}

export interface TrajectoryTimelineEntry {
  turn: number;
  ts: string;
  toolCalls: Array<{ name: string; ok: boolean }>;
  filesTouched: string[];
}

export interface TrajectorySessionTurn {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface TrajectoryCostRecord {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface TrajectoryRuleRun {
  ts: number;
  rule: string;
  action: string;
  ok: boolean;
}

export interface TrajectorySources {
  runId: string;
  since?: number;
  generatedAt?: string;
  summary?: {
    objective: string;
    status: string;
    startedAt: number;
    endedAt?: number;
    sessionId?: string;
  } | null;
  metrics?: {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalCost?: number;
    durationMs?: number;
    toolCallCount?: number;
  };
  events?: TrajectoryEvent[];
  artifacts?: string[];
  auditEntries?: TrajectoryAuditEntry[];
  timelineEntries?: TrajectoryTimelineEntry[] | null;
  sessionTurns?: TrajectorySessionTurn[] | null;
  costRecords?: TrajectoryCostRecord[];
  ruleRuns?: TrajectoryRuleRun[] | null;
  missing?: string[];
}

export interface TrajectoryToolCall {
  name: string;
  effect: ToolEffectClass | 'unknown';
  durationMs: number | Unlogged;
  success: boolean | Unlogged;
  ts: number;
  callId?: string;
}

export interface TrajectoryPermission {
  ts: number;
  action: 'requested' | 'granted' | 'denied';
  target?: string;
  operation?: string;
  source?: string;
}

export interface TrajectoryUsage {
  inputTokens: number | Unlogged;
  outputTokens: number | Unlogged;
  cacheTokens: number | Unlogged;
  costUsd: number | Unlogged;
}

export interface TrajectoryProcessEffect {
  tool: string;
  command?: string;
  pid: Unlogged;
}

export interface TrajectoryOutboundEffect {
  tool: string;
  kind: string;
}

export interface TrajectorySideEffects {
  files: string[] | Unlogged;
  processes: TrajectoryProcessEffect[] | Unlogged;
  outbound: TrajectoryOutboundEffect[] | Unlogged;
}

export interface TrajectoryTurn {
  turn: number | Unlogged;
  ts: number;
  tools: TrajectoryToolCall[];
  permissions: TrajectoryPermission[] | Unlogged;
  usage: TrajectoryUsage;
  sideEffects: TrajectorySideEffects;
}

export interface TrajectoryPointOfNoReturn {
  ts: number;
  tool: string;
  reason: string;
}

export interface TrajectorySummary {
  toolCallCount: number;
  emissionCount: number;
  emissionPct: number | Unlogged;
  pointsOfNoReturn: TrajectoryPointOfNoReturn[];
  totals: {
    durationMs: number | Unlogged;
    inputTokens: number | Unlogged;
    outputTokens: number | Unlogged;
    cacheTokens: Unlogged;
    costUsd: number | Unlogged;
  };
}

export interface Trajectory {
  schemaVersion: typeof RUN_TRAJECTORY_SCHEMA_VERSION;
  kind: typeof RUN_TRAJECTORY_KIND;
  generatedAt: string;
  runId: string;
  objective: string | Unlogged;
  status: string | Unlogged;
  startedAt: number | Unlogged;
  endedAt: number | Unlogged;
  since?: number;
  sessionId?: string;
  turns: TrajectoryTurn[];
  ruleRuns: TrajectoryRuleRun[] | Unlogged;
  summary: TrajectorySummary;
  unlogged: string[];
}

const PROCESS_TOOLS = new Set([
  'bash', 'terminal', 'interactive_shell', 'process', 'app_server',
  'js_repl', 'execute_code', 'code_exec', 'run_script', 'lint_project',
  'test_runner', 'build_project', 'spawn_subagent', 'spawn_parallel_agents',
  'sessions_spawn', 'delegate_agent', 'terminate',
]);

const OUTBOUND_TOOLS = new Set([
  'web_search', 'community_search', 'weather', 'stock_quote', 'web_fetch',
  'web_scrape', 'web_extract', 'deep_research', 'firecrawl_search', 'firecrawl_scrape',
  'send_message', 'discord', 'discord_admin', 'x_search', 'http_probe',
  'peer_delegate', 'peer_chain', 'list_peers', 'route_peer',
  'ha_call_service', 'ha_list_entities', 'ha_get_state', 'ha_list_services',
  'yb_send_dm', 'yb_send_sticker', 'feishu_drive_add_comment', 'feishu_drive_reply_comment',
]);

const NOT_JOURNALED = 'non journalisé';

function inWindow(ts: number, startedAt: number | undefined, endedAt: number | undefined, since?: number): boolean {
  if (since !== undefined && ts < since) return false;
  if (startedAt !== undefined && ts < startedAt - 5_000) return false;
  if (endedAt !== undefined && ts > endedAt + 5_000) return false;
  return true;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function redactHome(value: string): string {
  const home = os.homedir();
  if (!home) return value;
  return value.split(home).join('~');
}

function parseIso(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

interface PairedTool {
  name: string;
  ts: number;
  callId?: string;
  durationMs?: number;
  success?: boolean;
  command?: string;
}

function pairTools(events: TrajectoryEvent[]): PairedTool[] {
  const pending = new Map<string, PairedTool>();
  const fifo = new Map<string, PairedTool[]>();
  const out: PairedTool[] = [];

  const pushPending = (tool: PairedTool, id?: string): void => {
    if (id) {
      pending.set(id, tool);
      return;
    }
    const queue = fifo.get(tool.name) ?? [];
    queue.push(tool);
    fifo.set(tool.name, queue);
  };

  const takePending = (name: string, id?: string): PairedTool | undefined => {
    if (id && pending.has(id)) {
      const found = pending.get(id);
      pending.delete(id);
      return found;
    }
    const queue = fifo.get(name);
    return queue?.shift();
  };

  for (const event of events) {
    const name = asString(event.data.toolName) ?? asString(event.data.name) ?? 'unknown';
    const callId = asString(event.data.toolCallId) ?? asString(event.data.callId);
    if (event.type === 'tool_call') {
      const args = event.data.args && typeof event.data.args === 'object'
        ? event.data.args as Record<string, unknown>
        : {};
      pushPending({
        name,
        ts: event.ts,
        callId,
        command: asString(args.command) ?? asString(event.data.command),
      }, callId);
    } else if (event.type === 'tool_result') {
      const existing = takePending(name, callId) ?? { name, ts: event.ts, callId };
      existing.durationMs = asNumber(event.data.durationMs);
      existing.success = asBoolean(event.data.success);
      out.push(existing);
    }
  }

  for (const leftover of pending.values()) out.push(leftover);
  for (const queue of fifo.values()) out.push(...queue);
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function permissionAction(action: string): TrajectoryPermission['action'] | null {
  if (action === 'confirmation_requested') return 'requested';
  if (action === 'confirmation_granted') return 'granted';
  if (action === 'confirmation_denied') return 'denied';
  return null;
}

function collectPermissions(entries: TrajectoryAuditEntry[], startedAt?: number, endedAt?: number, since?: number): TrajectoryPermission[] {
  const permissions: TrajectoryPermission[] = [];
  for (const entry of entries) {
    const ts = parseIso(entry.timestamp);
    if (!inWindow(ts, startedAt, endedAt, since)) continue;
    const action = permissionAction(entry.action);
    if (!action) continue;
    permissions.push({
      ts,
      action,
      target: entry.target ? redactHome(entry.target) : undefined,
      operation: entry.details,
      source: entry.source,
    });
  }
  return permissions;
}

function assignTurnIndex(ts: number, bounds: Array<{ turn: number; ts: number }>): number {
  if (bounds.length === 0) return 0;
  let chosen = bounds[0]!.turn;
  for (const bound of bounds) {
    if (ts >= bound.ts) chosen = bound.turn;
  }
  return chosen;
}

function numericOrUnlogged(value: number | undefined, reason: string): number | Unlogged {
  return typeof value === 'number' && Number.isFinite(value) ? value : unlogged(reason);
}

/**
 * Build a unified Trajectory from already-loaded sources. Never throws.
 */
export function buildTrajectory(sources: TrajectorySources): Trajectory {
  const unloggedList = [...(sources.missing ?? [])];
  const summary = sources.summary ?? null;
  const startedAt = summary?.startedAt;
  const endedAt = summary?.endedAt;
  const since = sources.since;
  const events = (sources.events ?? []).filter((event) => inWindow(event.ts, startedAt, endedAt, since));
  const tools = pairTools(events);
  const permissions = collectPermissions(sources.auditEntries ?? [], startedAt, endedAt, since);
  const timeline = sources.timelineEntries ?? null;
  const sessionTurns = sources.sessionTurns ?? null;
  const ruleRuns = (sources.ruleRuns ?? []).filter((run) => inWindow(run.ts, startedAt, endedAt, since));

  const loaderExplained = (sources.missing ?? []).length > 0;
  if (!loaderExplained) {
    if (!summary) unloggedList.push('run summary');
    if (!sources.events) unloggedList.push('run events');
    if (sources.auditEntries === undefined) unloggedList.push('audit JSONL');
    if (timeline === null) unloggedList.push('session timeline (CODEBUDDY_TIMELINE or missing file)');
    if (sessionTurns === null) unloggedList.push('session turn usage');
    if (sources.costRecords === undefined) unloggedList.push('cost-history');
    if (sources.ruleRuns === null || sources.ruleRuns === undefined) {
      unloggedList.push('rule-runs.jsonl');
    }
  }
  unloggedList.push('cache tokens (jamais journalisés dans RunStore ni SessionTurnUsage)');
  unloggedList.push('pids de processus');
  unloggedList.push('ModelRoutingFacade (coût de session en mémoire, non persisté)');
  if (!permissions.some((entry) => entry.action === 'requested')) {
    unloggedList.push('confirmation_requested (type déclaré, jamais émis par ConfirmationService)');
  }
  const hasMetricEvent = events.some((event) => event.type === 'metric');
  if (!hasMetricEvent && sessionTurns === null) {
    unloggedList.push('tokens in/out/cache par tour (RunStore n\'émet pas d\'événement metric)');
  }

  const turnBounds = (timeline ?? []).map((entry) => ({
    turn: entry.turn,
    ts: parseIso(entry.ts),
  })).sort((a, b) => a.ts - b.ts);

  const grouped = new Map<number, PairedTool[]>();
  if (turnBounds.length > 0) {
    for (const tool of tools) {
      const turn = assignTurnIndex(tool.ts, turnBounds);
      const bucket = grouped.get(turn) ?? [];
      bucket.push(tool);
      grouped.set(turn, bucket);
    }
  } else {
    grouped.set(0, tools);
    if (tools.length > 0) unloggedList.push('bornes de tour');
  }

  const turns: TrajectoryTurn[] = [];
  const keys = [...grouped.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const bucket = grouped.get(key) ?? [];
    const ts = bucket[0]?.ts ?? turnBounds.find((bound) => bound.turn === key)?.ts ?? startedAt ?? 0;
    const files = collectFiles({
      events,
      timeline,
      audit: sources.auditEntries ?? [],
      turn: turnBounds.length > 0 ? key : undefined,
      startedAt,
      endedAt,
      since,
    });
    const processes = collectProcesses(bucket);
    const outbound = collectOutbound(bucket);
    const turnPermissions = permissions.filter((entry) => {
      if (turnBounds.length === 0) return true;
      return assignTurnIndex(entry.ts, turnBounds) === key;
    });
    const usageFromSession = matchSessionTurn(sessionTurns, ts);
    turns.push({
      turn: turnBounds.length > 0 ? key : unlogged('bornes de tour non journalisées'),
      ts,
      tools: bucket.map((tool) => ({
        name: tool.name,
        effect: resolveToolEffect(tool.name),
        durationMs: numericOrUnlogged(tool.durationMs, `${NOT_JOURNALED}: durée d'outil`),
        success: tool.success === undefined ? unlogged(`${NOT_JOURNALED}: succès/échec`) : tool.success,
        ts: tool.ts,
        callId: tool.callId,
      })),
      permissions: turnPermissions.length > 0
        ? turnPermissions
        : unlogged(`${NOT_JOURNALED}: permissions (audit JSONL absent ou hors fenêtre)`),
      usage: {
        inputTokens: numericOrUnlogged(usageFromSession?.inputTokens, `${NOT_JOURNALED}: tokens in par tour`),
        outputTokens: numericOrUnlogged(usageFromSession?.outputTokens, `${NOT_JOURNALED}: tokens out par tour`),
        cacheTokens: unlogged(`${NOT_JOURNALED}: tokens cache par tour`),
        costUsd: numericOrUnlogged(usageFromSession?.costUsd, `${NOT_JOURNALED}: coût par tour`),
      },
      sideEffects: {
        files: files.length > 0 ? files : unlogged(`${NOT_JOURNALED}: fichiers touchés`),
        processes: processes.length > 0 ? processes : unlogged(`${NOT_JOURNALED}: processus lancés`),
        outbound: outbound.length > 0 ? outbound : unlogged(`${NOT_JOURNALED}: requêtes sortantes`),
      },
    });
  }

  const emissionTools = tools.filter((tool) => resolveToolEffect(tool.name) === 'emission');
  const successfulEmission = tools.filter((tool) => (
    resolveToolEffect(tool.name) === 'emission' && tool.success !== false
  ));
  const metrics = sources.metrics ?? {};

  const uniqueUnlogged = [...new Set(unloggedList)];

  return {
    schemaVersion: RUN_TRAJECTORY_SCHEMA_VERSION,
    kind: RUN_TRAJECTORY_KIND,
    generatedAt: sources.generatedAt ?? new Date().toISOString(),
    runId: sources.runId,
    objective: summary?.objective ?? unlogged(`${NOT_JOURNALED}: objectif`),
    status: summary?.status ?? unlogged(`${NOT_JOURNALED}: statut`),
    startedAt: numericOrUnlogged(startedAt, `${NOT_JOURNALED}: startedAt`),
    endedAt: numericOrUnlogged(endedAt, `${NOT_JOURNALED}: endedAt`),
    since,
    sessionId: summary?.sessionId,
    turns,
    ruleRuns: sources.ruleRuns === undefined || sources.ruleRuns === null
      ? unlogged(`${NOT_JOURNALED}: rule-runs.jsonl`)
      : ruleRuns,
    summary: {
      toolCallCount: tools.length,
      emissionCount: emissionTools.length,
      emissionPct: tools.length === 0
        ? unlogged('aucun appel d\'outil')
        : Math.round((emissionTools.length / tools.length) * 1000) / 10,
      pointsOfNoReturn: successfulEmission.map((tool) => ({
        ts: tool.ts,
        tool: tool.name,
        reason: `effect=emission (${resolveToolEffect(tool.name) === 'emission' ? 'irréversible' : 'unknown'})`,
      })),
      totals: {
        durationMs: numericOrUnlogged(metrics.durationMs, `${NOT_JOURNALED}: durée run`),
        inputTokens: numericOrUnlogged(metrics.promptTokens, `${NOT_JOURNALED}: tokens in agrégés`),
        outputTokens: numericOrUnlogged(metrics.completionTokens, `${NOT_JOURNALED}: tokens out agrégés`),
        cacheTokens: unlogged(`${NOT_JOURNALED}: tokens cache agrégés`),
        costUsd: numericOrUnlogged(metrics.totalCost, `${NOT_JOURNALED}: coût agrégé`),
      },
    },
    unlogged: uniqueUnlogged,
  };
}

function collectFiles(args: {
  events: TrajectoryEvent[];
  timeline: TrajectoryTimelineEntry[] | null;
  audit: TrajectoryAuditEntry[];
  turn?: number;
  startedAt: number | undefined;
  endedAt: number | undefined;
  since?: number;
}): string[] {
  const files = new Set<string>();
  if (args.timeline) {
    for (const entry of args.timeline) {
      if (args.turn !== undefined && entry.turn !== args.turn) continue;
      for (const file of entry.filesTouched) files.add(redactHome(file));
    }
  }
  for (const event of args.events) {
    if (event.type === 'patch_applied') {
      const applied = event.data.filesApplied;
      if (Array.isArray(applied)) {
        for (const file of applied) {
          if (typeof file === 'string') files.add(redactHome(file));
        }
      }
    }
  }
  for (const entry of args.audit) {
    if (!['file_write', 'file_edit', 'file_delete', 'patch_apply', 'checkpoint_created'].includes(entry.action)) {
      continue;
    }
    const ts = parseIso(entry.timestamp);
    if (!inWindow(ts, args.startedAt, args.endedAt, args.since)) continue;
    if (entry.target) files.add(redactHome(entry.target));
  }
  return [...files];
}

function collectProcesses(bucket: PairedTool[]): TrajectoryProcessEffect[] {
  return bucket
    .filter((tool) => PROCESS_TOOLS.has(tool.name))
    .map((tool) => ({
      tool: tool.name,
      command: tool.command ? redactHome(tool.command) : undefined,
      pid: unlogged(`${NOT_JOURNALED}: pid`),
    }));
}

function collectOutbound(bucket: PairedTool[]): TrajectoryOutboundEffect[] {
  return bucket
    .filter((tool) => OUTBOUND_TOOLS.has(tool.name) || resolveToolEffect(tool.name) === 'emission' && !PROCESS_TOOLS.has(tool.name))
    .filter((tool) => OUTBOUND_TOOLS.has(tool.name))
    .map((tool) => ({
      tool: tool.name,
      kind: 'network-or-message',
    }));
}

function matchSessionTurn(
  sessionTurns: TrajectorySessionTurn[] | null,
  ts: number,
): TrajectorySessionTurn | undefined {
  if (!sessionTurns || sessionTurns.length === 0) return undefined;
  let best: TrajectorySessionTurn | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const turn of sessionTurns) {
    const delta = Math.abs(parseIso(turn.timestamp) - ts);
    if (delta < bestDelta && delta < 120_000) {
      best = turn;
      bestDelta = delta;
    }
  }
  return best;
}

function formatUnlogged(value: unknown): string {
  if (isUnlogged(value)) return value.reason.startsWith(NOT_JOURNALED) ? value.reason : `${NOT_JOURNALED}: ${value.reason}`;
  return String(value);
}

function formatTsValue(value: number | Unlogged): string {
  if (isUnlogged(value)) return formatUnlogged(value);
  return new Date(value).toISOString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

/**
 * Human-readable presenter. Read-only.
 */
export function renderTrajectory(trajectory: Trajectory): string {
  const lines: string[] = [
    `Run trajectory  schema=${trajectory.schemaVersion}  kind=${trajectory.kind}`,
    `Run: ${trajectory.runId}  status=${formatUnlogged(trajectory.status)}`,
    `Objective: ${formatUnlogged(trajectory.objective)}`,
  ];
  if (trajectory.sessionId) lines.push(`Session: ${trajectory.sessionId}`);
  lines.push(`Started: ${formatTsValue(trajectory.startedAt)}`);
  lines.push(`Ended:   ${formatTsValue(trajectory.endedAt)}`);
  if (trajectory.since !== undefined) lines.push(`Since:   ${trajectory.since}`);

  const summary = trajectory.summary;
  const emission = isUnlogged(summary.emissionPct)
    ? formatUnlogged(summary.emissionPct)
    : `${summary.emissionPct}% (${summary.emissionCount}/${summary.toolCallCount})`;
  lines.push('');
  lines.push('── Résumé ────────────────────────────────');
  lines.push(`  Appels d'outils: ${summary.toolCallCount}`);
  lines.push(`  Emission:        ${emission}`);
  lines.push(`  Tokens in/out:   ${formatUnlogged(summary.totals.inputTokens)} / ${formatUnlogged(summary.totals.outputTokens)}`);
  lines.push(`  Tokens cache:    ${formatUnlogged(summary.totals.cacheTokens)}`);
  lines.push(`  Coût:            ${formatUnlogged(summary.totals.costUsd)}`);
  lines.push(`  Durée:           ${typeof summary.totals.durationMs === 'number' ? formatDuration(summary.totals.durationMs) : formatUnlogged(summary.totals.durationMs)}`);
  if (summary.pointsOfNoReturn.length === 0) {
    lines.push('  Points de non-retour: (aucun appel emission réussi journalisé)');
  } else {
    lines.push('  Points de non-retour:');
    for (const point of summary.pointsOfNoReturn) {
      lines.push(`    - ${new Date(point.ts).toISOString()}  ${point.tool}  ${point.reason}`);
    }
  }

  lines.push('');
  lines.push('── Tours ─────────────────────────────────');
  if (trajectory.turns.length === 0) {
    lines.push('  (aucun événement d\'outil)');
  }
  for (const turn of trajectory.turns) {
    const label = isUnlogged(turn.turn) ? formatUnlogged(turn.turn) : `tour ${turn.turn}`;
    lines.push(`  ${label}  ts=${new Date(turn.ts).toISOString()}`);
    if (turn.tools.length === 0) {
      lines.push('    outils: (aucun)');
    }
    for (const tool of turn.tools) {
      const dur = typeof tool.durationMs === 'number' ? formatDuration(tool.durationMs) : formatUnlogged(tool.durationMs);
      const ok = typeof tool.success === 'boolean' ? (tool.success ? 'ok' : 'fail') : formatUnlogged(tool.success);
      lines.push(`    - ${tool.name}  effect=${tool.effect}  ${dur}  ${ok}`);
    }
    lines.push(`    permissions: ${isUnlogged(turn.permissions) ? formatUnlogged(turn.permissions) : turn.permissions.map((p) => `${p.action}${p.target ? ` ${p.target}` : ''}`).join(', ')}`);
    lines.push(`    usage in/out/cache/cost: ${formatUnlogged(turn.usage.inputTokens)} / ${formatUnlogged(turn.usage.outputTokens)} / ${formatUnlogged(turn.usage.cacheTokens)} / ${formatUnlogged(turn.usage.costUsd)}`);
    lines.push(`    fichiers: ${isUnlogged(turn.sideEffects.files) ? formatUnlogged(turn.sideEffects.files) : turn.sideEffects.files.join(', ')}`);
    lines.push(`    processus: ${isUnlogged(turn.sideEffects.processes) ? formatUnlogged(turn.sideEffects.processes) : turn.sideEffects.processes.map((p) => `${p.tool}${p.command ? ` command="${p.command}"` : ''} pid=${formatUnlogged(p.pid)}`).join('; ')}`);
    lines.push(`    outbound: ${isUnlogged(turn.sideEffects.outbound) ? formatUnlogged(turn.sideEffects.outbound) : turn.sideEffects.outbound.map((o) => `${o.tool} (${o.kind})`).join(', ')}`);
  }

  lines.push('');
  lines.push('── rule-runs ─────────────────────────────');
  if (isUnlogged(trajectory.ruleRuns)) {
    lines.push(`  ${formatUnlogged(trajectory.ruleRuns)}`);
  } else if (trajectory.ruleRuns.length === 0) {
    lines.push('  (aucun overlap avec la fenêtre du run)');
  } else {
    for (const run of trajectory.ruleRuns) {
      lines.push(`  - ${new Date(run.ts).toISOString()}  ${run.rule}  ${run.action}  ${run.ok ? 'ok' : 'fail'}`);
    }
  }

  lines.push('');
  lines.push('── Non journalisé ────────────────────────');
  for (const item of trajectory.unlogged) {
    lines.push(`  - ${item}`);
  }
  lines.push('');
  return lines.join('\n');
}
