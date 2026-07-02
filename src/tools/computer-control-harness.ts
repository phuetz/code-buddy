import {
  approvalSchema,
  capabilitySchema,
  proofSchema,
  runSchema,
  sensitiveActionSchema,
  type Approval,
  type Capability,
  type Proof,
  type Run,
  type SensitiveAction,
} from '../harness/index.js';
import type { ToolResult } from '../types/index.js';
import type { ComputerAction, ComputerControlInput } from './computer-control-tool.js';

export interface ComputerControlAuditEntry {
  id: string;
  timestamp: string;
  action: ComputerAction;
  success: boolean;
  durationMs: number;
  safetyProfile: 'balanced' | 'strict';
  dangerous: boolean;
  simulated: boolean;
  error?: string;
}

export interface ComputerControlHarnessBundle {
  run: Run;
  proof: Proof;
  sensitiveAction?: SensitiveAction;
  approval?: Approval;
  capabilities: Capability[];
}

export interface ComputerControlHarnessBundleOptions {
  audit: ComputerControlAuditEntry;
  input: ComputerControlInput;
  result: ToolResult;
  runId?: string;
  artifactRef?: string;
}

const READ_ACTIONS = new Set<ComputerAction>([
  'snapshot',
  'snapshot_with_screenshot',
  'get_element',
  'find_elements',
  'list_macros',
  'cursor_position',
  'get_windows',
  'get_window',
  'list_window_matches',
  'wait_for_window',
  'get_active_window',
  'get_audit_log',
  'get_pilot_mode',
  'get_volume',
  'get_brightness',
  'recording_status',
  'system_info',
  'battery_info',
  'network_info',
  'check_permission',
  'wait_for_text',
  'assert_text_visible',
  'assert_element_visible',
  'inspect_dialog',
  'list_app_profiles',
  'get_app_profile',
  'read_app_text',
  'excel_get_cell',
]);

export function buildComputerControlHarnessBundle(
  options: ComputerControlHarnessBundleOptions,
): ComputerControlHarnessBundle {
  const runId = options.runId ?? `computer_${options.audit.id}`;
  const startedAt = Math.max(0, Date.parse(options.audit.timestamp) - options.audit.durationMs);
  const endedAt = Date.parse(options.audit.timestamp);
  const mutating = isComputerControlMutating(options.input);
  const sensitiveAction = mutating
    ? sensitiveActionSchema.parse({
        kind: 'sensitive-action',
        schemaVersion: 1,
        id: `codebuddy.computer_control.${options.audit.action}`,
        name: `Computer control: ${options.audit.action}`,
        riskLevel: options.audit.dangerous ? 'high' : 'medium',
        defaultDryRun: true,
        requires: options.audit.dangerous ? 'approval-required' : 'dry-run-required',
      })
    : undefined;

  const approval = sensitiveAction && options.input.confirmDangerous
    ? approvalSchema.parse({
        kind: 'approval',
        schemaVersion: 1,
        id: `approval_${options.audit.id}`,
        target: sensitiveAction.id,
        runId,
        decision: 'approved',
        // Honest provenance: this approval came from the AGENT setting
        // confirmDangerous=true, NOT from a human operator. Labelling it
        // 'human-operator' misrepresented the audit trail (S5).
        reviewer: 'agent-self-attested',
        reason: 'Computer control action carried agent-set confirmDangerous=true (no human approval).',
        decidedAt: endedAt,
        scope: options.audit.action,
      })
    : undefined;

  return {
    run: runSchema.parse({
      kind: 'run',
      schemaVersion: 1,
      id: runId,
      actor: {
        type: 'agent',
        id: 'code-buddy-computer-control',
      },
      objective: `Computer control action: ${options.audit.action}`,
      status: options.audit.success ? 'completed' : 'failed',
      startedAt,
      endedAt,
      metrics: {
        durationMs: options.audit.durationMs,
        toolCallCount: 1,
      },
      metadata: {
        channel: 'computer-control',
        organ: 'code-buddy',
        tags: ['computer-use', options.audit.action, options.audit.simulated ? 'dry-run' : 'live'],
      },
    }),
    proof: proofSchema.parse({
      kind: 'proof',
      schemaVersion: 1,
      id: `proof_${options.audit.id}`,
      runId,
      type: options.artifactRef ? 'artifact' : 'log',
      createdAt: endedAt,
      producedBy: {
        type: 'agent',
        id: 'code-buddy-computer-control',
      },
      summary: summarizeComputerControlProof(options.audit, options.result),
      ref: options.artifactRef,
    }),
    ...(sensitiveAction ? { sensitiveAction } : {}),
    ...(approval ? { approval } : {}),
    capabilities: buildComputerControlCapabilities(),
  };
}

export function buildComputerControlProofArtifact(input: {
  audit: ComputerControlAuditEntry;
  command: ComputerControlInput;
  result: ToolResult;
  harness: ComputerControlHarnessBundle;
}): Record<string, unknown> {
  return {
    kind: 'computer-control-proof',
    schemaVersion: 1,
    generatedAt: input.audit.timestamp,
    action: input.audit.action,
    command: sanitizeComputerControlInput(input.command),
    result: {
      success: input.result.success,
      output: truncateString(input.result.output, 4000),
      error: truncateString(input.result.error, 2000),
      ...(input.result.data === undefined ? {} : { data: sanitizeProofData(input.result.data) }),
    },
    audit: input.audit,
    harness: input.harness,
  };
}

export function isComputerControlMutating(input: ComputerControlInput): boolean {
  if (READ_ACTIONS.has(input.action)) return false;
  if (input.action === 'macro' || input.action === 'use_app_workflow') {
    return (input.steps ?? []).some((step) => isComputerControlMutating(step));
  }
  return true;
}

function buildComputerControlCapabilities(): Capability[] {
  return [
    capabilitySchema.parse({
      kind: 'capability',
      schemaVersion: 1,
      id: 'codebuddy.computer_control.inspect',
      name: 'Inspect desktop state',
      level: 'read',
      policy: 'autonomous',
      fleetPolicy: 'read-only-help',
      description: 'Read windows, snapshots, cursor, system info and permission state.',
    }),
    capabilitySchema.parse({
      kind: 'capability',
      schemaVersion: 1,
      id: 'codebuddy.computer_control.dry_run',
      name: 'Simulate desktop actions',
      level: 'reversible-write',
      policy: 'dry-run-required',
      fleetPolicy: 'none',
      description: 'Prepare mutating desktop actions without applying them.',
    }),
    capabilitySchema.parse({
      kind: 'capability',
      schemaVersion: 1,
      id: 'codebuddy.computer_control.live_control',
      name: 'Control the desktop',
      level: 'sensitive',
      policy: 'approval-required',
      fleetPolicy: 'none',
      description: 'Click, type, move windows, record the screen or change system state.',
    }),
  ];
}

function summarizeComputerControlProof(audit: ComputerControlAuditEntry, result: ToolResult): string {
  const mode = audit.simulated ? '[dry-run] ' : '';
  const outcome = audit.success ? 'completed' : 'failed';
  const detail = audit.success
    ? truncateString(result.output, 240)
    : truncateString(result.error, 240);
  return `${mode}${audit.action} ${outcome} in ${audit.durationMs}ms${detail ? `: ${detail}` : ''}`;
}

function sanitizeComputerControlInput(input: ComputerControlInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/password|secret|token|cookie|credential/i.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (key === 'text' && typeof value === 'string') {
      out[key] = truncateString(value, 500);
      continue;
    }
    if (key === 'steps' && Array.isArray(value)) {
      out[key] = value.map((step) => sanitizeComputerControlInput(step as ComputerControlInput));
      continue;
    }
    out[key] = value;
  }
  return out;
}

function sanitizeProofData(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return truncateString(value, 2000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 5) return '[truncated-depth]';

  if (Array.isArray(value)) {
    const items = value.slice(0, 25).map((item) => sanitizeProofData(item, depth + 1));
    if (value.length > 25) {
      items.push(`[truncated ${value.length - 25} items]`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 50);
    for (const [key, nested] of entries) {
      if (/password|secret|token|cookie|credential|authorization|api[-_]?key/i.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = sanitizeProofData(nested, depth + 1);
    }
    const entryCount = Object.keys(value as Record<string, unknown>).length;
    if (entryCount > 50) {
      out.__truncatedKeys = entryCount - 50;
    }
    return out;
  }

  return String(value);
}

function truncateString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
