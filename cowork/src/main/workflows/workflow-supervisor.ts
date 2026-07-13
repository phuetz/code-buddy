import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  WorkflowEventPayload,
  WorkflowRunResult,
  WorkflowVisualDefinition,
} from '../../shared/workflow-types';
import type {
  WorkflowDryRunResult,
  WorkflowDryRunStep,
  WorkflowFailureDiagnostic,
  WorkflowRunComparison,
  WorkflowRunRecord,
  WorkflowRunSource,
} from '../../shared/workflow-supervision';
import type { CoreWorkflowDefinition, CoreWorkflowStep } from './dag-compiler';
import { compileVisualToCore } from './dag-compiler';

const SECRET_KEY = /(authorization|api[_-]?key|token|secret|password|cookie|credential)/i;
const WORKFLOW_MUTATING_TOOL = /(^|__|[._-])(send|publish|post|create|update|delete|remove|write|upload|download|invite|message|email|deploy|merge|purchase|book|submit|execute|run|bash|shell|edit|patch|move|copy|rename|append|set|mark|ack|acknowledge|archive|restore|star|unstar|like|unlike|react|follow|unfollow|mute|unmute|enable|disable|assign|unassign|label|tag)(_|\.|-|$)/i;
const WORKFLOW_READ_TOOL = /(^|__|[._-])(get|list|read|search|find|fetch|query|view|inspect|status|describe|lookup|noop)(_|\.|-|$)/i;
const MAX_HISTORY_VALUE_CHARS = 512 * 1024;
const MAX_HISTORY_STRING_CHARS = 16 * 1024;
const MAX_HISTORY_ARRAY_ITEMS = 200;
const MAX_HISTORY_OBJECT_KEYS = 200;
const MAX_HISTORY_DEPTH = 10;
const MAX_HISTORY_FILE_BYTES = 20 * 1024 * 1024;
const HISTORY_TRUNCATED = '[TRUNCATED BY WORKFLOW HISTORY LIMIT]';

/** Unknown and compound tool names fail closed as externally effectful. */
export function workflowToolRequiresConfirmation(name: string): boolean {
  if (WORKFLOW_MUTATING_TOOL.test(name)) return true;
  if (WORKFLOW_READ_TOOL.test(name)) return false;
  return true;
}

function redactString(value: string): string {
  return value
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/gu, '[REDACTED PEM]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(token|secret|password|api.?key|authorization|cookie|credential)\s*[:=]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/\b(sk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED TOKEN]');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

interface HistoryBudget {
  remaining: number;
  seen: WeakSet<object>;
}

function redact(value: unknown): unknown {
  return redactBounded(value, {
    remaining: MAX_HISTORY_VALUE_CHARS,
    seen: new WeakSet<object>(),
  }, 0);
}

function redactBounded(value: unknown, budget: HistoryBudget, depth: number): unknown {
  if (budget.remaining <= 0 || depth > MAX_HISTORY_DEPTH) return HISTORY_TRUNCATED;
  if (typeof value === 'string') {
    const clean = redactString(value);
    const allowed = Math.min(MAX_HISTORY_STRING_CHARS, budget.remaining);
    budget.remaining -= Math.min(clean.length, allowed) + 8;
    return clean.length > allowed ? `${clean.slice(0, allowed)}\n${HISTORY_TRUNCATED}` : clean;
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    budget.remaining -= 16;
    return value;
  }
  if (budget.seen.has(value)) return '[TRUNCATED CIRCULAR VALUE]';
  budget.seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    const limit = Math.min(value.length, MAX_HISTORY_ARRAY_ITEMS);
    for (let index = 0; index < limit && budget.remaining > 0; index += 1) {
      result.push(redactBounded(value[index], budget, depth + 1));
    }
    if (limit < value.length || budget.remaining <= 0) result.push(HISTORY_TRUNCATED);
    return result;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const result: Record<string, unknown> = {};
  const limit = Math.min(entries.length, MAX_HISTORY_OBJECT_KEYS);
  for (let index = 0; index < limit && budget.remaining > 0; index += 1) {
    const [key, entry] = entries[index]!;
    budget.remaining -= key.length + 4;
    result[key] = SECRET_KEY.test(key)
      ? '[REDACTED]'
      : redactBounded(entry, budget, depth + 1);
  }
  if (limit < entries.length || budget.remaining <= 0) result.__historyTruncated = HISTORY_TRUNCATED;
  return result;
}

export function workflowToolArgumentPreview(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(redact(input), null, 2);
  return serialized.length > 4000 ? `${serialized.slice(0, 4000)}\n… [truncated]` : serialized;
}

export function hashWorkflowDefinition(definition: WorkflowVisualDefinition): string {
  let semanticDefinition: unknown = definition;
  try {
    semanticDefinition = compileVisualToCore(definition);
  } catch {
    // Invalid definitions still need a stable history identity so compilation
    // failures can be compared. The dry-run itself remains fail-closed.
  }
  return createHash('sha256')
    .update(JSON.stringify(stableValue(semanticDefinition)))
    .digest('hex');
}

function collectSteps(
  steps: CoreWorkflowStep[],
  target: WorkflowDryRunStep[],
  depth = 0
): void {
  for (const step of steps) {
    const tasks = step.tasks ?? [];
    if (tasks.length > 0) {
      for (const task of tasks) {
        const toolName =
          typeof task.input.toolName === 'string' ? task.input.toolName : undefined;
        target.push({
          id: task.id,
          kind: step.type === 'task' ? 'task' : step.type,
          label: task.name,
          depth,
          ...(toolName ? { toolName } : {}),
          requiresApproval: task.type === 'approval_wait',
        });
      }
    } else {
      target.push({
        id: step.id,
        kind: step.type,
        label: step.name,
        depth,
        requiresApproval: false,
        ...(
          step.branches
            ? { branches: step.branches.length }
            : step.type === 'conditional'
              ? { branches: 2 }
              : {}
        ),
      });
    }
    for (const branch of step.branches ?? []) collectSteps(branch, target, depth + 1);
    if (step.trueBranch) collectSteps(step.trueBranch, target, depth + 1);
    if (step.falseBranch) collectSteps(step.falseBranch, target, depth + 1);
    if (step.loopBody) collectSteps(step.loopBody, target, depth + 1);
    const batchBody = (step as CoreWorkflowStep & { batchBody?: CoreWorkflowStep[] }).batchBody;
    if (batchBody) collectSteps(batchBody, target, depth + 1);
  }
}

export function previewWorkflow(definition: WorkflowVisualDefinition): WorkflowDryRunResult {
  const generatedAt = Date.now();
  try {
    // Deliberately use the production compiler. A preview can never claim a
    // workflow is runnable when the real execution compiler rejects it.
    const compiled: CoreWorkflowDefinition = compileVisualToCore(definition);
    const steps: WorkflowDryRunStep[] = [];
    collectSteps(compiled.steps, steps);
    const toolSteps = steps.filter((step) => step.toolName);
    const externalToolSteps = toolSteps.filter((step) =>
      workflowToolRequiresConfirmation(step.toolName ?? '')
    ).length;
    const warnings: string[] = [];
    if (externalToolSteps > 0) {
      warnings.push(`${externalToolSteps} action(s) may affect an external system and remain subject to confirmation.`);
    }
    if (steps.some((step) => step.kind === 'loop' || step.kind === 'batch')) {
      warnings.push('Loop and batch counts depend on runtime input; this preview shows their compiled body once.');
    }
    return {
      valid: true,
      workflowId: definition.id ?? '',
      definitionHash: hashWorkflowDefinition(definition),
      generatedAt,
      totalExecutableSteps: toolSteps.length,
      approvalSteps: steps.filter((step) => step.requiresApproval).length,
      externalToolSteps,
      steps,
      warnings,
    };
  } catch (error) {
    return {
      valid: false,
      workflowId: definition.id ?? '',
      generatedAt,
      totalExecutableSteps: 0,
      approvalSteps: 0,
      externalToolSteps: 0,
      steps: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function diagnoseWorkflowFailure(
  result: WorkflowRunResult,
  events: WorkflowEventPayload[]
): WorkflowFailureDiagnostic | undefined {
  if (result.success) return undefined;
  const error = result.error ?? 'Unknown workflow failure';
  const normalized = error.toLowerCase();
  let failedNodeId: string | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'node_failed') {
      failedNodeId = event.nodeId;
      break;
    }
  }
  const action = (id: string, label: string, description: string) => ({
    id,
    label,
    description,
    safeAutomatic: false as const,
  });

  if (normalized.includes('secret input required') || normalized.includes('redacted value')) {
    return {
      category: 'secret_input',
      title: 'Fresh secret input is required',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action(
        'provide-secret',
        'Start a new reviewed run',
        'Re-enter the required credential or secret input; stored redacted values are never replayed.'
      )],
    };
  }
  if (normalized.includes('compilation') || normalized.includes('missing config') || normalized.includes('cycle detected')) {
    return {
      category: 'compilation',
      title: 'The visual graph cannot be compiled',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('open-editor', 'Open the editor', 'Inspect the highlighted topology and missing node configuration.')],
    };
  }
  if (normalized.includes('approval') || normalized.includes('rejected')) {
    return {
      category: 'approval',
      title: 'An approval was rejected or expired',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('review-approval', 'Review approval step', 'Check its action preview and timeout before replaying.')],
    };
  }
  if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('blocked')) {
    return {
      category: 'permission',
      title: 'A permission policy blocked the run',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('review-policy', 'Review permissions', 'Grant only the narrow capability needed by this node.')],
    };
  }
  if (normalized.includes('oauth') || normalized.includes('unauthor') || normalized.includes('credential') || normalized.includes('401')) {
    return {
      category: 'authentication',
      title: 'The connector must be authenticated again',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('open-connectors', 'Open connectors', 'Reconnect the affected account, then replay the stored run.')],
    };
  }
  if (normalized.includes('not found') && normalized.includes('tool')) {
    return {
      category: 'tool_missing',
      title: 'A workflow tool is unavailable',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('refresh-tools', 'Refresh connector tools', 'Enable or reinstall the connector that owns this tool.')],
    };
  }
  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return {
      category: 'timeout',
      title: 'A step exceeded its time budget',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('inspect-timeout', 'Inspect the slow step', 'Check the connector health and increase a bounded timeout only if justified.')],
    };
  }
  if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('econn') || normalized.includes('503')) {
    return {
      category: 'network',
      title: 'A connector or service was unreachable',
      explanation: error,
      ...(failedNodeId ? { failedNodeId } : {}),
      suggestedActions: [action('check-status', 'Check connector status', 'Restore connectivity before replaying; no action is retried automatically.')],
    };
  }
  return {
    category: 'runtime',
    title: 'The workflow runtime failed',
    explanation: error,
    ...(failedNodeId ? { failedNodeId } : {}),
    suggestedActions: [action('compare-run', 'Compare with a previous run', 'Review definition, input, duration and the last failed node before replaying.')],
  };
}

export function containsRedactedWorkflowValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('[REDACTED') || value.includes('[TRUNCATED');
  }
  if (Array.isArray(value)) return value.some(containsRedactedWorkflowValue);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsRedactedWorkflowValue);
  }
  return false;
}

export class WorkflowRunStore {
  private records: WorkflowRunRecord[] | null = null;

  constructor(
    private readonly filePath: string,
    private readonly maxRecords = 200
  ) {}

  list(workflowId?: string, limit = 50): WorkflowRunRecord[] {
    const records = workflowId
      ? this.load().filter((record) => record.workflowId === workflowId)
      : this.load();
    return records.slice(-Math.max(1, Math.min(limit, this.maxRecords))).reverse();
  }

  get(id: string): WorkflowRunRecord | null {
    return this.load().find((record) => record.id === id) ?? null;
  }

  create(
    definition: WorkflowVisualDefinition,
    initialContext: Record<string, unknown>,
    source: WorkflowRunSource,
    replayOf?: string
  ): WorkflowRunRecord {
    const startedAt = Date.now();
    const record: WorkflowRunRecord = {
      id: `wfr_${startedAt}_${randomUUID().slice(0, 8)}`,
      workflowId: definition.id ?? '',
      workflowName: definition.name,
      source,
      ...(replayOf ? { replayOf } : {}),
      definitionHash: hashWorkflowDefinition(definition),
      definition: redact(definition) as WorkflowVisualDefinition,
      initialContext: redact(initialContext) as Record<string, unknown>,
      startedAt,
      completedAt: startedAt,
      result: {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: 0,
        error: 'Run interrupted before completion',
      },
      events: [],
    };
    const records = this.load();
    records.push(record);
    this.records = records.slice(-this.maxRecords);
    this.persist();
    return record;
  }

  finish(
    record: WorkflowRunRecord,
    result: WorkflowRunResult,
    events: WorkflowEventPayload[]
  ): WorkflowRunRecord {
    const completed: WorkflowRunRecord = {
      ...record,
      completedAt: Date.now(),
      result: redact(result) as WorkflowRunResult,
      events: redact(events) as WorkflowEventPayload[],
      diagnostic: redact(diagnoseWorkflowFailure(result, events)) as WorkflowFailureDiagnostic | undefined,
    };
    const records = this.load();
    const existingIndex = records.findIndex((candidate) => candidate.id === completed.id);
    if (existingIndex >= 0) records[existingIndex] = completed;
    else records.push(completed);
    this.records = records.slice(-this.maxRecords);
    this.persist();
    return completed;
  }

  compare(leftRunId: string, rightRunId: string): WorkflowRunComparison | null {
    const left = this.get(leftRunId);
    const right = this.get(rightRunId);
    if (!left || !right) return null;
    const sameDefinition = left.definitionHash === right.definitionHash;
    const statusChanged = left.result.status !== right.result.status;
    const durationDeltaMs = right.result.duration - left.result.duration;
    const completedStepsDelta = right.result.completedSteps - left.result.completedSteps;
    const changedError = (left.result.error ?? '') !== (right.result.error ?? '');
    const summary = [
      sameDefinition ? 'Same compiled definition snapshot.' : 'Definition changed between runs.',
      statusChanged ? `Status changed from ${left.result.status} to ${right.result.status}.` : `Status remained ${right.result.status}.`,
      `Duration ${durationDeltaMs >= 0 ? '+' : ''}${durationDeltaMs} ms; completed steps ${completedStepsDelta >= 0 ? '+' : ''}${completedStepsDelta}.`,
    ];
    if (changedError) summary.push('Failure message changed.');
    return {
      leftRunId,
      rightRunId,
      sameDefinition,
      statusChanged,
      durationDeltaMs,
      completedStepsDelta,
      changedError,
      summary,
    };
  }

  private load(): WorkflowRunRecord[] {
    if (this.records) return this.records;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.records = Array.isArray(parsed) ? parsed as WorkflowRunRecord[] : [];
    } catch {
      this.records = [];
    }
    return this.records;
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const source = this.records ?? [];
    const retained: WorkflowRunRecord[] = [];
    let retainedBytes = 2;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const record = source[index]!;
      const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
      if (retained.length > 0 && retainedBytes + recordBytes > MAX_HISTORY_FILE_BYTES) break;
      retained.unshift(record);
      retainedBytes += recordBytes;
    }
    this.records = retained;
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(retained, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }
}
