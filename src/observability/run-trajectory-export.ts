import { getDataRedactionEngine, type DataRedactionEngine } from '../security/data-redaction.js';
import {
  type RunEvent,
  type RunMetrics,
  type RunStore,
  type RunSummary,
  RunStore as DefaultRunStore,
} from './run-store.js';
import { isProofLedgerArtifact } from './proof-ledger-constants.js';

export const RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION = 1;

export interface BuildRunTrajectoryExportOptions {
  includeArtifactContent?: boolean;
  maxArtifactBytes?: number;
  maxEventValueBytes?: number;
  store?: RunStore;
}

export interface RunTrajectoryExportRun {
  artifactCount: number;
  channel?: string;
  durationMs?: number;
  endedAt?: number;
  eventCount: number;
  objective: string;
  parentRunId?: string;
  runId: string;
  sessionId?: string;
  source?: string;
  startedAt: number;
  status: RunSummary['status'];
  tags: string[];
}

export interface RunTrajectoryExportPrompt {
  sources: string[];
  text: string;
}

export interface RunTrajectoryExportContextEntry {
  source: string;
  value: unknown;
}

export interface RunTrajectoryExportToolCall {
  args?: unknown;
  callId?: string;
  command?: string;
  sequence: number;
  toolName: string;
  ts: number;
}

export interface RunTrajectoryExportToolResult {
  durationMs?: number;
  error?: unknown;
  output?: unknown;
  sequence: number;
  success?: boolean;
  toolName: string;
  ts: number;
}

export interface RunTrajectoryExportArtifact {
  contentPreview?: string;
  includedContentBytes?: number;
  name: string;
}

export interface RunTrajectoryExportEvent {
  data: unknown;
  sequence: number;
  ts: number;
  type: RunEvent['type'];
}

export interface RunTrajectoryExport {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'run_trajectory_export';
  mode: 'redacted_review_export';
  run: RunTrajectoryExportRun;
  privacy: {
    artifactContentIncluded: boolean;
    maxArtifactBytes: number;
    maxEventValueBytes: number;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  prompt: RunTrajectoryExportPrompt;
  selectedContext: RunTrajectoryExportContextEntry[];
  toolCalls: RunTrajectoryExportToolCall[];
  toolResults: RunTrajectoryExportToolResult[];
  artifacts: RunTrajectoryExportArtifact[];
  finalAnswer?: unknown;
  metrics: Partial<RunMetrics>;
  events: RunTrajectoryExportEvent[];
}

interface RedactionContext {
  count: number;
  redactor: DataRedactionEngine;
}

const DEFAULT_MAX_ARTIFACT_BYTES = 4_000;
const DEFAULT_MAX_EVENT_VALUE_BYTES = 2_000;
const CONTEXT_KEY_PATTERN = /(context|memory|memories|lesson|lessons|recall|promptContext|selectedContext)/i;
const PROMPT_KEYS = ['objective', 'prompt', 'userPrompt', 'input', 'goal', 'query', 'message'];
const FINAL_ANSWER_KEYS = ['finalAnswer', 'answer', 'response', 'result', 'output', 'summary'];

export function buildRunTrajectoryExport(
  runId: string,
  options: BuildRunTrajectoryExportOptions = {},
): RunTrajectoryExport | null {
  const store = options.store ?? DefaultRunStore.getInstance();
  const record = store.getRun(runId);
  if (!record) return null;

  const events = store.getEvents(runId);
  const maxArtifactBytes = normalizeMaxBytes(options.maxArtifactBytes, DEFAULT_MAX_ARTIFACT_BYTES);
  const maxEventValueBytes = normalizeMaxBytes(options.maxEventValueBytes, DEFAULT_MAX_EVENT_VALUE_BYTES);
  const redaction: RedactionContext = {
    count: 0,
    redactor: getDataRedactionEngine(),
  };
  const exportArtifacts = record.artifacts.filter((artifact) => !isProofLedgerArtifact(artifact));

  const summary = record.summary;
  const run = buildExportRun(summary, record.metrics, exportArtifacts.length);
  const prompt = buildPrompt(events, summary, redaction, maxEventValueBytes);
  const selectedContext = buildSelectedContext(events, redaction, maxEventValueBytes);
  const toolCalls = buildToolCalls(events, redaction, maxEventValueBytes);
  const toolResults = buildToolResults(events, redaction, maxEventValueBytes);
  const finalAnswer = buildFinalAnswer(events, redaction, maxEventValueBytes);
  const artifacts = buildArtifacts(
    exportArtifacts,
    store,
    runId,
    options.includeArtifactContent === true,
    maxArtifactBytes,
    redaction,
  );
  const redactedEvents = events.map((event, index): RunTrajectoryExportEvent => ({
    data: redactValue(event.data, redaction, maxEventValueBytes),
    sequence: index + 1,
    ts: event.ts,
    type: event.type,
  }));

  return {
    schemaVersion: RUN_TRAJECTORY_EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'run_trajectory_export',
    mode: 'redacted_review_export',
    run,
    privacy: {
      artifactContentIncluded: options.includeArtifactContent === true,
      maxArtifactBytes,
      maxEventValueBytes,
      redaction: 'secrets-redacted',
      redactionCount: redaction.count,
    },
    prompt,
    selectedContext,
    toolCalls,
    toolResults,
    artifacts,
    finalAnswer,
    metrics: record.metrics,
    events: redactedEvents,
  };
}

export function renderRunTrajectoryExport(exported: RunTrajectoryExport): string {
  const lines = [
    'Run trajectory export',
    `Mode: ${exported.mode}`,
    `Run: ${exported.run.runId} (${exported.run.status})`,
    `Objective: ${exported.run.objective}`,
    `Events: ${exported.events.length} | tool calls: ${exported.toolCalls.length} | tool results: ${exported.toolResults.length} | artifacts: ${exported.artifacts.length}`,
    `Privacy: ${exported.privacy.redaction}; redactions=${exported.privacy.redactionCount}; artifactContentIncluded=${exported.privacy.artifactContentIncluded}`,
    '',
    'Prompt:',
    exported.prompt.text || '(none detected)',
  ];

  if (exported.selectedContext.length > 0) {
    lines.push('', 'Selected context:');
    for (const entry of exported.selectedContext.slice(0, 8)) {
      lines.push(`- ${entry.source}: ${formatInlineValue(entry.value)}`);
    }
  }

  if (exported.toolCalls.length > 0) {
    lines.push('', 'Tool calls:');
    for (const call of exported.toolCalls) {
      const command = call.command ? ` command="${call.command}"` : '';
      lines.push(`- #${call.sequence} ${call.toolName}${command}`);
    }
  }

  const policyDecisions = exported.events.filter(isPolicyDecisionEvent);
  if (policyDecisions.length > 0) {
    lines.push('', 'Policy decisions:');
    for (const event of policyDecisions.slice(0, 12)) {
      lines.push(formatPolicyDecisionEvent(event));
    }
  }

  if (exported.finalAnswer !== undefined) {
    lines.push('', 'Final answer:', formatInlineValue(exported.finalAnswer));
  }

  if (exported.artifacts.length > 0) {
    lines.push('', 'Artifacts:');
    for (const artifact of exported.artifacts) {
      const bytes = artifact.includedContentBytes !== undefined
        ? ` (${artifact.includedContentBytes} preview bytes)`
        : '';
      lines.push(`- ${artifact.name}${bytes}`);
    }
  }

  return lines.join('\n');
}

function buildExportRun(
  summary: RunSummary,
  metrics: Partial<RunMetrics>,
  artifactCount: number,
): RunTrajectoryExportRun {
  const metadata = summary.metadata;
  return {
    artifactCount,
    channel: metadata?.channel,
    durationMs: metrics.durationMs,
    endedAt: summary.endedAt,
    eventCount: summary.eventCount,
    objective: summary.objective,
    parentRunId: metadata?.parentRolloutId,
    runId: summary.runId,
    sessionId: metadata?.sessionId,
    source: inferTrajectorySource(summary),
    startedAt: summary.startedAt,
    status: summary.status,
    tags: metadata?.tags ?? [],
  };
}

function buildPrompt(
  events: RunEvent[],
  summary: RunSummary,
  redaction: RedactionContext,
  maxBytes: number,
): RunTrajectoryExportPrompt {
  const sources: string[] = [];
  const parts: string[] = [];

  if (summary.objective) {
    sources.push('summary.objective');
    parts.push(redactText(summary.objective, redaction));
  }

  for (const event of events) {
    for (const key of PROMPT_KEYS) {
      const value = event.data[key];
      if (typeof value === 'string' && value.trim() && !parts.includes(value.trim())) {
        sources.push(`${event.type}.${key}`);
        parts.push(redactText(value.trim(), redaction));
      }
    }
  }

  return {
    sources: [...new Set(sources)],
    text: clipText(parts.join('\n\n'), maxBytes),
  };
}

function buildSelectedContext(
  events: RunEvent[],
  redaction: RedactionContext,
  maxBytes: number,
): RunTrajectoryExportContextEntry[] {
  const entries: RunTrajectoryExportContextEntry[] = [];

  for (const event of events) {
    for (const [key, value] of Object.entries(event.data)) {
      if (!CONTEXT_KEY_PATTERN.test(key)) continue;
      entries.push({
        source: `${event.type}.${key}`,
        value: redactValue(value, redaction, maxBytes),
      });
    }
  }

  return entries.slice(0, 20);
}

function buildToolCalls(
  events: RunEvent[],
  redaction: RedactionContext,
  maxBytes: number,
): RunTrajectoryExportToolCall[] {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'tool_call')
    .map(({ event, index }): RunTrajectoryExportToolCall => {
      const args = isRecord(event.data.args) ? event.data.args : undefined;
      const command = typeof args?.command === 'string'
        ? redactText(args.command, redaction)
        : undefined;
      return {
        args: args ? redactValue(args, redaction, maxBytes) : undefined,
        callId: firstString(event.data.toolCallId, event.data.callId, event.data.id),
        command,
        sequence: index + 1,
        toolName: firstString(event.data.toolName, event.data.name) ?? 'unknown_tool',
        ts: event.ts,
      };
    });
}

function buildToolResults(
  events: RunEvent[],
  redaction: RedactionContext,
  maxBytes: number,
): RunTrajectoryExportToolResult[] {
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'tool_result')
    .map(({ event, index }): RunTrajectoryExportToolResult => ({
      durationMs: typeof event.data.durationMs === 'number' ? event.data.durationMs : undefined,
      error: event.data.error !== undefined ? redactValue(event.data.error, redaction, maxBytes) : undefined,
      output: extractToolOutput(event.data, redaction, maxBytes),
      sequence: index + 1,
      success: typeof event.data.success === 'boolean' ? event.data.success : undefined,
      toolName: firstString(event.data.toolName, event.data.name) ?? 'unknown_tool',
      ts: event.ts,
    }));
}

function buildFinalAnswer(
  events: RunEvent[],
  redaction: RedactionContext,
  maxBytes: number,
): unknown {
  for (const event of [...events].reverse()) {
    for (const key of FINAL_ANSWER_KEYS) {
      if (event.data[key] !== undefined) {
        return redactValue(event.data[key], redaction, maxBytes);
      }
    }
  }
  return undefined;
}

function buildArtifacts(
  artifacts: string[],
  store: RunStore,
  runId: string,
  includeContent: boolean,
  maxBytes: number,
  redaction: RedactionContext,
): RunTrajectoryExportArtifact[] {
  return artifacts.map((name) => {
    const item: RunTrajectoryExportArtifact = { name };
    if (!includeContent) return item;

    const content = store.getArtifact(runId, name);
    if (content === null) return item;

    const preview = redactText(clipText(content, maxBytes), redaction);
    item.contentPreview = preview;
    item.includedContentBytes = preview.length;
    return item;
  });
}

function extractToolOutput(
  data: Record<string, unknown>,
  redaction: RedactionContext,
  maxBytes: number,
): unknown {
  for (const key of ['output', 'result', 'stdout', 'stderr', 'message']) {
    if (data[key] !== undefined) {
      return redactValue(data[key], redaction, maxBytes);
    }
  }
  return undefined;
}

function redactValue(value: unknown, redaction: RedactionContext, maxBytes: number): unknown {
  if (typeof value === 'string') {
    return redactText(clipText(value, maxBytes), redaction);
  }

  const preRedacted = isRecord(value) || Array.isArray(value)
    ? redaction.redactor.redactObject(value as object)
    : value;
  const json = safeStringify(preRedacted);
  const clipped = clipText(json, maxBytes);
  const redacted = redactText(clipped, redaction);

  if (clipped.length !== json.length) return redacted;

  try {
    return JSON.parse(redacted) as unknown;
  } catch {
    return redacted;
  }
}

function redactText(text: string, redaction: RedactionContext): string {
  const result = redaction.redactor.redact(text);
  redaction.count += result.redactions.length;
  return result.redacted;
}

function clipText(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}... [truncated]`;
}

function formatInlineValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return safeStringify(value);
}

function isPolicyDecisionEvent(event: RunTrajectoryExportEvent): boolean {
  if (event.type !== 'decision' || !isRecord(event.data)) return false;
  return firstString(event.data.kind)?.includes('policy') === true ||
    firstString(event.data.kind)?.includes('filter') === true ||
    firstString(event.data.source)?.includes('policy') === true ||
    firstString(event.data.source)?.includes('filter') === true;
}

function formatPolicyDecisionEvent(event: RunTrajectoryExportEvent): string {
  if (!isRecord(event.data)) return `- #${event.sequence} decision`;
  const kind = firstString(event.data.kind) ?? 'decision';
  const toolName = firstString(event.data.toolName, event.data.name);
  const source = firstString(event.data.source);
  const reason = firstString(event.data.reason, event.data.error);
  const parts = [`- #${event.sequence}`, kind];
  if (toolName) parts.push(toolName);
  if (source) parts.push(`source=${source}`);
  if (reason) parts.push(`reason=${reason}`);
  return parts.join(' ');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeMaxBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(50_000, Math.max(200, Math.trunc(value as number)));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inferTrajectorySource(summary: RunSummary): string | undefined {
  const metadata = summary.metadata as (RunSummary['metadata'] & Record<string, unknown>) | undefined;
  return firstString(metadata?.channel, metadata?.source, metadata?.platform, metadata?.origin);
}
