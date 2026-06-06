import { getDataRedactionEngine, type DataRedactionEngine } from '../security/data-redaction.js';
import {
  type RunEvent,
  type RunRecord,
  type RunStore,
  type RunSummary,
} from './run-store.js';
import {
  PROOF_LEDGER_ARTIFACT,
  PROOF_LEDGER_SCHEMA_VERSION,
  isProofLedgerArtifact,
} from './proof-ledger-constants.js';

export { PROOF_LEDGER_ARTIFACT, PROOF_LEDGER_SCHEMA_VERSION } from './proof-ledger-constants.js';

export type ProofLedgerStatus = 'proven' | 'incomplete' | 'failed';
export type ProofLedgerRiskLevel = 'low' | 'medium' | 'high';
export type ProofLedgerArtifactKind = 'capture' | 'ledger' | 'log' | 'patch' | 'summary' | 'trace' | 'other';

export interface ProofLedgerCommand {
  command?: string;
  durationMs?: number;
  error?: unknown;
  isTest: boolean;
  sequence: number;
  success?: boolean;
  toolName: string;
  ts: number;
}

export interface ProofLedgerArtifact {
  kind: ProofLedgerArtifactKind;
  name: string;
}

export interface ProofLedgerRisk {
  detail: string;
  level: ProofLedgerRiskLevel;
  source: string;
}

export interface ProofLedgerEntry {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'proof_ledger_entry';
  run: {
    artifactCount: number;
    durationMs?: number;
    endedAt?: number;
    eventCount: number;
    objective: string;
    runId: string;
    source?: string;
    startedAt: number;
    status: RunSummary['status'];
    tags: string[];
  };
  privacy: {
    artifactContentIncluded: false;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  status: ProofLedgerStatus;
  summary: string;
  commands: ProofLedgerCommand[];
  tests: {
    commands: ProofLedgerCommand[];
    failed: number;
    passed: number;
    total: number;
  };
  artifacts: ProofLedgerArtifact[];
  filesChanged: string[];
  risks: ProofLedgerRisk[];
}

interface RedactionContext {
  count: number;
  redactor: DataRedactionEngine;
}

const TEST_COMMAND_PATTERN =
  /\b(npm\s+(?:run\s+)?(?:test|typecheck|lint|validate)|pnpm\s+(?:run\s+)?(?:test|typecheck|lint|validate)|yarn\s+(?:run\s+)?(?:test|typecheck|lint|validate)|bun\s+(?:run\s+)?(?:test|typecheck|lint|validate)|vitest|jest|pytest|mocha|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\s+test)\b/i;

export function buildProofLedgerForRun(store: RunStore, runId: string): ProofLedgerEntry | null {
  const record = store.getRun(runId);
  if (!record) return null;
  return buildProofLedgerEntry(record, store.getEvents(runId));
}

export function buildProofLedgerEntry(record: RunRecord, events: RunEvent[]): ProofLedgerEntry {
  const redaction: RedactionContext = {
    count: 0,
    redactor: getDataRedactionEngine(),
  };
  const artifactNames = record.artifacts.filter((name) => !isProofLedgerArtifact(name));
  const artifacts = artifactNames.map((name): ProofLedgerArtifact => ({
    kind: classifyArtifact(name),
    name: redactText(name, redaction),
  }));
  const commands = buildCommands(events, redaction);
  const testCommands = commands.filter((command) => command.isTest);
  const risks = buildRisks(record.summary, events, artifactNames, testCommands);
  const failedTests = testCommands.filter((command) => command.success === false).length;
  const passedTests = testCommands.filter((command) => command.success === true).length;
  const status = determineStatus(record.summary, testCommands, risks);
  const filesChanged = extractFilesChanged(events, redaction);

  return {
    schemaVersion: PROOF_LEDGER_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'proof_ledger_entry',
    run: {
      artifactCount: artifactNames.length,
      durationMs: record.metrics.durationMs,
      endedAt: record.summary.endedAt,
      eventCount: events.length,
      objective: redactText(record.summary.objective, redaction),
      runId: record.summary.runId,
      source: inferProofSource(record.summary),
      startedAt: record.summary.startedAt,
      status: record.summary.status,
      tags: record.summary.metadata?.tags ?? [],
    },
    privacy: {
      artifactContentIncluded: false,
      redaction: 'secrets-redacted',
      redactionCount: redaction.count,
    },
    status,
    summary: summarizeProof(status, testCommands, artifacts, risks),
    commands,
    tests: {
      commands: testCommands,
      failed: failedTests,
      passed: passedTests,
      total: testCommands.length,
    },
    artifacts,
    filesChanged,
    risks,
  };
}

export function writeRunProofLedgerArtifact(store: RunStore, runId: string): string | null {
  const entry = buildProofLedgerForRun(store, runId);
  if (!entry) return null;
  return store.saveArtifact(runId, PROOF_LEDGER_ARTIFACT, `${JSON.stringify(entry, null, 2)}\n`);
}

export function renderProofLedger(entry: ProofLedgerEntry): string {
  const lines = [
    'Proof ledger',
    `Run: ${entry.run.runId} (${entry.run.status})`,
    `Objective: ${entry.run.objective}`,
    `Status: ${entry.status}`,
    `Summary: ${entry.summary}`,
    `Tests: ${entry.tests.passed}/${entry.tests.total} passed`,
    `Artifacts: ${entry.artifacts.length}`,
    `Privacy: ${entry.privacy.redaction}; redactions=${entry.privacy.redactionCount}; artifactContentIncluded=false`,
  ];

  if (entry.tests.commands.length > 0) {
    lines.push('', 'Test commands:');
    for (const command of entry.tests.commands) {
      const result = command.success === undefined ? 'unknown' : command.success ? 'passed' : 'failed';
      lines.push(`- #${command.sequence} ${result}: ${command.command ?? command.toolName}`);
    }
  }

  if (entry.filesChanged.length > 0) {
    lines.push('', 'Files changed:');
    for (const file of entry.filesChanged.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
    if (entry.filesChanged.length > 20) {
      lines.push(`- ... and ${entry.filesChanged.length - 20} more`);
    }
  }

  if (entry.risks.length > 0) {
    lines.push('', 'Risks:');
    for (const risk of entry.risks) {
      lines.push(`- [${risk.level}] ${risk.detail} (${risk.source})`);
    }
  }

  return lines.join('\n');
}

function buildCommands(events: RunEvent[], redaction: RedactionContext): ProofLedgerCommand[] {
  const commands: ProofLedgerCommand[] = [];
  const usedResultIndexes = new Set<number>();
  const resultCandidates = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'tool_result');

  for (const [index, event] of events.entries()) {
    if (event.type !== 'tool_call') continue;
    const toolName = firstString(event.data.toolName, event.data.name, event.data.tool) ?? 'unknown_tool';
    const command = extractCommand(event.data);
    const result = findMatchingResult(event, index, resultCandidates, usedResultIndexes);
    const redactedCommand = command ? redactText(command, redaction) : undefined;
    commands.push({
      command: redactedCommand,
      durationMs: typeof result?.event.data.durationMs === 'number' ? result.event.data.durationMs : undefined,
      error: result?.event.data.error !== undefined ? redactValue(result.event.data.error, redaction) : undefined,
      isTest: command ? TEST_COMMAND_PATTERN.test(command) : false,
      sequence: index + 1,
      success: typeof result?.event.data.success === 'boolean' ? result.event.data.success : undefined,
      toolName: redactText(toolName, redaction),
      ts: event.ts,
    });
  }

  return commands;
}

function findMatchingResult(
  callEvent: RunEvent,
  callIndex: number,
  candidates: Array<{ event: RunEvent; index: number }>,
  used: Set<number>,
): { event: RunEvent; index: number } | undefined {
  const callId = firstString(callEvent.data.toolCallId, callEvent.data.callId, callEvent.data.id);
  const toolName = firstString(callEvent.data.toolName, callEvent.data.name, callEvent.data.tool);

  if (callId) {
    const byId = candidates.find(({ event, index }) =>
      !used.has(index) &&
      index > callIndex &&
      firstString(event.data.toolCallId, event.data.callId, event.data.id) === callId,
    );
    if (byId) {
      used.add(byId.index);
      return byId;
    }
  }

  const byTool = candidates.find(({ event, index }) =>
    !used.has(index) &&
    index > callIndex &&
    firstString(event.data.toolName, event.data.name, event.data.tool) === toolName,
  );
  if (byTool) {
    used.add(byTool.index);
  }
  return byTool;
}

function buildRisks(
  summary: RunSummary,
  events: RunEvent[],
  artifacts: string[],
  testCommands: ProofLedgerCommand[],
): ProofLedgerRisk[] {
  const risks: ProofLedgerRisk[] = [];
  if (summary.status === 'running') {
    risks.push({ level: 'medium', detail: 'Run is still active.', source: 'run.status' });
  }
  if (summary.status === 'failed') {
    risks.push({ level: 'high', detail: 'Run ended as failed.', source: 'run.status' });
  }
  if (summary.status === 'cancelled') {
    risks.push({ level: 'medium', detail: 'Run was cancelled before completion.', source: 'run.status' });
  }
  if (testCommands.length === 0) {
    risks.push({ level: 'medium', detail: 'No test, typecheck, lint, or validation command was recorded.', source: 'tool_call' });
  }
  if (testCommands.some((command) => command.success === false)) {
    risks.push({ level: 'high', detail: 'At least one recorded verification command failed.', source: 'tool_result' });
  }
  if (events.some((event) => event.type === 'error')) {
    risks.push({ level: 'high', detail: 'Error events were recorded in the trajectory.', source: 'events.jsonl' });
  }
  if (events.some((event) => event.type === 'tool_result' && event.data.success === false)) {
    risks.push({ level: 'medium', detail: 'A tool returned a failed result.', source: 'tool_result' });
  }
  if (artifacts.length === 0) {
    risks.push({ level: 'low', detail: 'No supporting run artifacts were recorded.', source: 'artifacts' });
  }
  return risks;
}

function determineStatus(
  summary: RunSummary,
  testCommands: ProofLedgerCommand[],
  risks: ProofLedgerRisk[],
): ProofLedgerStatus {
  if (summary.status === 'failed' || risks.some((risk) => risk.level === 'high')) {
    return 'failed';
  }
  if (
    summary.status === 'completed' &&
    testCommands.length > 0 &&
    testCommands.every((command) => command.success !== false)
  ) {
    return 'proven';
  }
  return 'incomplete';
}

function summarizeProof(
  status: ProofLedgerStatus,
  testCommands: ProofLedgerCommand[],
  artifacts: ProofLedgerArtifact[],
  risks: ProofLedgerRisk[],
): string {
  if (status === 'proven') {
    return `Completed with ${testCommands.length} recorded verification command(s) and ${artifacts.length} supporting artifact(s).`;
  }
  if (status === 'failed') {
    return `Needs attention: ${risks.filter((risk) => risk.level === 'high').length} high-risk proof signal(s).`;
  }
  return 'Proof is incomplete until verification commands and supporting evidence are recorded.';
}

function classifyArtifact(name: string): ProofLedgerArtifactKind {
  const lower = name.toLowerCase();
  if (isProofLedgerArtifact(name)) return 'ledger';
  if (/\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i.test(lower)) return 'capture';
  if (/\.(zip|trace)$/i.test(lower) || lower.includes('trace')) return 'trace';
  if (/\.(log|txt)$/i.test(lower) || lower.includes('output')) return 'log';
  if (/\.(diff|patch)$/i.test(lower)) return 'patch';
  if (/(summary|report|retrospective|proof|evidence).*\.(md|json)$/i.test(lower)) return 'summary';
  return 'other';
}

function extractFilesChanged(events: RunEvent[], redaction: RedactionContext): string[] {
  const files = new Set<string>();
  for (const event of events) {
    collectPaths(event.data.filesChanged, files);
    collectPaths(event.data.filesApplied, files);
    collectPaths(event.data.paths, files);
    collectPaths(event.data.path, files);
    collectPaths(event.data.filePath, files);
    collectPaths(event.data.file, files);
  }
  return [...files]
    .map((file) => redactText(file, redaction))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 200);
}

function collectPaths(value: unknown, out: Set<string>): void {
  if (typeof value === 'string' && value.trim()) {
    out.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPaths(item, out);
    }
  }
}

function extractCommand(data: Record<string, unknown>): string | undefined {
  const args = isRecord(data.args) ? data.args : undefined;
  return firstString(
    args?.command,
    args?.cmd,
    data.command,
    data.cmd,
    isRecord(data.data) ? data.data.command : undefined,
  );
}

function inferProofSource(summary: RunSummary): string | undefined {
  const meta = summary.metadata;
  if (!meta) return undefined;
  const tags = meta.tags ?? [];
  if (tags.includes('fleet')) return 'fleet';
  if (tags.includes('scheduled') || meta.channel === 'cron') return 'scheduled';
  if (tags.includes('mobile') || meta.channel === 'mobile') return 'mobile';
  if (meta.channel === 'cowork' || meta.channel === 'desktop') return 'cowork';
  if (meta.channel === 'terminal') return 'cli';
  return meta.channel;
}

function redactValue(value: unknown, redaction: RedactionContext): unknown {
  if (typeof value === 'string') {
    return redactText(value, redaction);
  }
  if (isRecord(value) || Array.isArray(value)) {
    const before = safeStringify(value);
    const redacted = redaction.redactor.redactObject(value as object);
    const after = safeStringify(redacted);
    redaction.count += redaction.redactor.redact(before).redactions.length;
    try {
      return JSON.parse(after) as unknown;
    } catch {
      return after;
    }
  }
  return value;
}

function redactText(text: string, redaction: RedactionContext): string {
  const result = redaction.redactor.redact(text);
  redaction.count += result.redactions.length;
  return result.redacted;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
