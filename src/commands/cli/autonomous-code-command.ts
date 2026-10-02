import fs from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';

import {
  buildAgenticCodingEditProposalProducerDispatch,
  deriveAgenticCodingProposalLoopArtifacts,
  persistRunArtifact,
  renderAgenticCodingRunReport,
  runAgenticCodingCell,
  writeAgenticCodingApprovalDecisionPrompt,
  writeAgenticCodingApprovalSnapshot,
  writeAgenticCodingEditProposalProducerDispatch,
  writeAgenticCodingEditProposalReviewSnapshot,
  writeAgenticCodingEditProposalPrompt,
  writeAgenticCodingProposalLoopArtifactBundle,
  writeAgenticCodingProposalLoopCanvas,
  writeAgenticCodingProposalLoopCoworkImport,
  writeAgenticCodingProposalLoopCoworkImportCheck,
  writeAgenticCodingProposalLoopCoworkWorkspace,
  writeAgenticCodingProposalLoopNextActionSnapshot,
  writeAgenticCodingProposalLoopSnapshot,
  writeAgenticCodingRunReport,
  writeAgenticCodingWorkflowBuilderPrompt,
  writeAgenticCodingWorkflowBuilderProposalCanvas,
  writeAgenticCodingWorkflowCanvas,
  writeAgenticCodingWorkflowEventsSnapshot,
  writeAgenticCodingWorkflowProgressSnapshot,
  type AgenticCodingRunOptions,
  type AgenticCodingRunReport,
} from '../../agent/autonomous/agentic-coding-runner.js';
import { getCheckpointPath } from '../../agent/autonomous/checkpoint-manager.js';
import type { FleetDispatchProfile } from '../../fleet/dispatch-profile.js';
import { executePeerChain } from '../../tools/peer-chain-tool.js';
import type { ToolResult } from '../../types/index.js';

interface AutonomousCodeOptions {
  auditOvernightManifest?: string;
  autonomyPreset?: string;
  overnightManifestFile?: string;
  applyEdits?: boolean;
  approvalDecisionFile?: string;
  approvalDecisionPromptFile?: string;
  approvalFile?: string;
  editProposalFile?: string;
  editProposalProducerDispatchFile?: string;
  editProposalReviewFile?: string;
  generateEditProposalFile?: string;
  json?: boolean;
  previewEdits?: boolean;
  proposalLoopArtifactsDir?: string;
  proposalLoopCanvasFile?: string;
  proposalLoopCoworkImportCheckFile?: string;
  proposalLoopCoworkImportFile?: string;
  proposalLoopCoworkWorkspaceFile?: string;
  proposalLoopFile?: string;
  proposalLoopNextActionFile?: string;
  proposalPromptFile?: string;
  requireApproval?: boolean;
  requireFleetCollaboration?: boolean;
  requireOvernightCompletion?: boolean;
  requireOvernightReadiness?: boolean;
  requirePreview?: boolean;
  reportFile?: string;
  recoverFromSupervision?: string;
  resumeFromManifest?: string;
  runVerification?: boolean;
  superviseCycles?: string;
  supervisionFleetTriageFile?: string;
  supervisionFleetTriageResultFile?: string;
  superviseMaxErrorCycles?: string;
  superviseMaxStalledCycles?: string;
  supervisionEventsFile?: string;
  supervisionRecoveryFile?: string;
  superviseFromManifest?: string;
  superviseSleepMs?: string;
  taskFile?: string;
  verificationTimeoutMs?: string;
  workflowBuilderPromptFile?: string;
  workflowBuilderProposalCanvasFile?: string;
  workflowBuilderProposalFile?: string;
  workflowEventsFile?: string;
  workflowFile?: string;
  workflowProgressFile?: string;
  resume?: string;
  runId?: string;
  maxCostUsd?: string;
  maxIterations?: string;
}

type AutonomousCodePreset = 'standard' | 'overnight';

interface AutonomousCodePresetDefaults {
  maxCostUsd?: number;
  maxIterations?: number;
  verificationTimeoutMs?: number;
}

const AUTONOMOUS_CODE_PRESET_DEFAULTS: Record<AutonomousCodePreset, AutonomousCodePresetDefaults> = {
  standard: {},
  overnight: {
    maxCostUsd: 10,
    maxIterations: 16,
    verificationTimeoutMs: 300000,
  },
};

const DEFAULT_OVERNIGHT_SUPERVISION_SLEEP_MS = 30000;
const DEFAULT_OVERNIGHT_SUPERVISION_CYCLES = 961;
const DEFAULT_OVERNIGHT_SUPERVISION_MAX_STALLED_CYCLES = 3;
const DEFAULT_OVERNIGHT_SUPERVISION_MAX_ERROR_CYCLES = 3;
const DEFAULT_SUPERVISION_FLEET_TRIAGE_STAGE_TIMEOUT_MS = 30000;
const MINIMUM_OVERNIGHT_WINDOW_MS = 8 * 60 * 60 * 1000;

interface LoadedOvernightManifest {
  artifacts: Record<string, string>;
  autonomyBudgets: { maxCostUsd?: number; maxIterations?: number; verificationTimeoutMs?: number };
  autonomyPreset?: AutonomousCodePreset;
  executionProfile: AutonomousCodeExecutionProfile;
  filePath: string;
  runId?: string;
  supervision?: AutonomousCodeSupervisionSummary;
  supervisionDefaults?: {
    maxErrorCycles?: number;
    maxStalledCycles?: number;
    requestedCycles?: number;
    sleepMs?: number;
  };
}

interface LoadedSupervisionRecovery {
  artifacts: Record<string, string>;
  filePath: string;
  runId?: string;
  sourceManifestPath: string;
  summary: {
    maxErrorCycles?: number;
    maxStalledCycles?: number;
    requestedCycles?: number;
    sleepMs?: number;
  };
}

interface AutonomousCodeExecutionProfile {
  applyEdits?: boolean;
  approvalDecisionFile?: string;
  editProposalFile?: string;
  editProposalProducerDispatchFile?: string;
  previewEdits?: boolean;
  requireApproval?: boolean;
  requireFleetCollaboration?: boolean;
  requirePreview?: boolean;
  runVerification?: boolean;
  workflowBuilderProposalFile?: string;
}

interface AutonomousCodeSupervisionCycle {
  consecutiveErrorCycles: number;
  error?: string;
  index: number;
  nextCycleAt?: string;
  progressSignature: string;
  runId?: string;
  stalledCycles: number;
  status: string;
  timestamp: string;
}

interface AutonomousCodeRequiredFleetCollaborationProof {
  completedPeerChainCalls: number;
  completedRoutePeerCalls: number;
  expectedCollaboration: boolean;
  proven: boolean;
  state?: string;
  tracePath?: string;
}

interface AutonomousCodeSupervisionSummary {
  completedCycles: number;
  cycles: AutonomousCodeSupervisionCycle[];
  fleetCollaborationProof?: AutonomousCodeRequiredFleetCollaborationProof;
  maxErrorCycles: number;
  maxStalledCycles: number;
  requestedCycles: number;
  sleepMs: number;
  sourceManifestPath: string;
  stoppedReason: 'cycle_error_limit' | 'cycle_limit' | 'stalled' | 'terminal_status';
}

interface AutonomousCodeOvernightReadiness {
  blockers: string[];
  completedOvernightWindow: boolean;
  completedWindowMs: number;
  completionProven: boolean;
  configuredForOvernight: boolean;
  configuredWindowMs: number;
  fleetCollaborationProven: boolean;
  fleetCollaborationRequired: boolean;
  minimumWindowMs: number;
  multiAgentReady: boolean;
  ready: boolean;
}

interface AutonomousCodeSupervisionFleetSnapshot {
  allowedTools: string[];
  chainRoles: FleetDispatchProfile[];
  expectedCollaboration: boolean;
  invocation?: {
    chainRoles: FleetDispatchProfile[];
    privacyTag: 'sensitive' | 'public';
    stageTimeoutMs: number;
    tool: 'peer_chain';
  };
  mode: string;
  policy: string;
  state: 'disabled' | 'advisory_ready' | 'delegated_chain_ready';
}

interface AutonomousCodeSupervisionEvent {
  fleet?: AutonomousCodeSupervisionFleetSnapshot;
  fleetCollaborationProof?: AutonomousCodeRequiredFleetCollaborationProof;
  kind: 'agentic-coding-supervision-cycle';
  maxErrorCycles: number;
  maxStalledCycles: number;
  schemaVersion: 1;
  cycle: AutonomousCodeSupervisionCycle;
  requestedCycles: number;
  sleepMs: number;
  sourceManifestPath: string;
  stoppedReason?: AutonomousCodeSupervisionSummary['stoppedReason'];
}

interface AutonomousCodeSupervisionEventAudit {
  blockers: string[];
  eventCount: number;
  exists: boolean;
  lastCycleIndex?: number;
  lastCycleStatus?: string;
  lastCycleTimestamp?: string;
  lastStoppedReason?: AutonomousCodeSupervisionSummary['stoppedReason'];
  matchesSupervision: boolean;
  path?: string;
}

interface AutonomousCodeSupervisionRecoveryAction {
  command?: string[];
  invocation?: AutonomousCodeSupervisionFleetSnapshot['invocation'];
  path?: string;
  reason: string;
  type:
    | 'ask_fleet_triage'
    | 'audit_overnight_manifest'
    | 'inspect_fleet_triage_result'
    | 'inspect_supervision_events'
    | 'restart_supervision'
    | 'resume_once';
}

interface AutonomousCodeSupervisionArtifactCommandPaths {
  supervisionEventsPath?: string;
  supervisionFleetTriagePath?: string;
  supervisionFleetTriageResultPath?: string;
  supervisionRecoveryPath?: string;
}

interface AutonomousCodeSupervisionRecovery {
  actions: AutonomousCodeSupervisionRecoveryAction[];
  artifacts: Record<string, string>;
  fleet?: AutonomousCodeSupervisionFleetSnapshot;
  kind: 'agentic-coding-supervision-recovery';
  lastCycle?: AutonomousCodeSupervisionCycle;
  overnightReadiness: AutonomousCodeOvernightReadiness;
  runId?: string;
  schemaVersion: 1;
  sourceManifestPath: string;
  stoppedReason: AutonomousCodeSupervisionSummary['stoppedReason'];
  summary: {
    completedCycles: number;
    maxErrorCycles: number;
    maxStalledCycles: number;
    requestedCycles: number;
    sleepMs: number;
  };
}

interface AutonomousCodeSupervisionFleetTriage {
  artifacts: Record<string, string>;
  fleet: AutonomousCodeSupervisionFleetSnapshot;
  kind: 'agentic-coding-supervision-fleet-triage';
  lastCycle?: AutonomousCodeSupervisionCycle;
  peerChainCall: {
    chainRoles: FleetDispatchProfile[];
    privacyTag: 'sensitive' | 'public';
    prompt: string;
    stageTimeoutMs: number;
    tool: 'peer_chain';
  };
  recoveryPath: string;
  runId?: string;
  schemaVersion: 1;
  sourceManifestPath: string;
  stoppedReason: AutonomousCodeSupervisionSummary['stoppedReason'];
  summary: {
    completedCycles: number;
    maxErrorCycles: number;
    maxStalledCycles: number;
    requestedCycles: number;
    sleepMs: number;
  };
}

interface AutonomousCodeSupervisionFleetTriageResult {
  attemptedAt: string;
  artifacts: Record<string, string>;
  error?: string;
  finalText?: string;
  kind: 'agentic-coding-supervision-fleet-triage-result';
  output?: string;
  peerChainCall: {
    chainRoles: FleetDispatchProfile[];
    privacyTag: 'sensitive' | 'public';
    promptLength: number;
    stageTimeoutMs: number;
    tool: 'peer_chain';
  };
  recoveryPath: string;
  runId?: string;
  schemaVersion: 1;
  sourceManifestPath: string;
  stageCount?: number;
  stoppedReason: AutonomousCodeSupervisionSummary['stoppedReason'];
  success: boolean;
  triagePath: string;
}

interface AutonomousCodeProducerFleetTrace {
  completedPeerChainCalls?: number;
  completedRoutePeerCalls?: number;
  expectedCollaboration?: boolean;
  state?: string;
}

interface AutonomousCodeProducerTrace {
  fleet?: AutonomousCodeProducerFleetTrace;
}

function readTraceCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readErrorCode(error: unknown): string | undefined {
  return isJsonObject(error) && typeof error.code === 'string' ? error.code : undefined;
}

function parseAutonomyPreset(value: string | undefined): AutonomousCodePreset {
  if (value === undefined || value === 'standard') {
    return 'standard';
  }

  if (value === 'overnight') {
    return 'overnight';
  }

  throw new Error('--autonomy-preset must be one of: standard, overnight');
}

function parseOptionalAutonomyPreset(value: unknown): AutonomousCodePreset | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value === 'standard' || value === 'overnight') {
    return value;
  }

  throw new Error('overnight manifest autonomyPreset must be one of: standard, overnight');
}

function createOvernightRunId(): string {
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `overnight-${stamp}-${suffix}`;
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    throw new Error('--verification-timeout-ms must be an integer >= 1000');
  }

  return parsed;
}

function parsePositiveIntegerOption(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function parseNonNegativeIntegerOption(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }

  return parsed;
}

function parseNonNegativeNumberOption(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a finite non-negative number`);
  }

  return parsed;
}

function parseManifestBudget(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`overnight manifest autonomyBudgets.${fieldName} must be a finite non-negative number`);
  }

  return value;
}

function parseManifestPositiveIntegerBudget(value: unknown, fieldName: string): number | undefined {
  const parsed = parseManifestBudget(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`overnight manifest autonomyBudgets.${fieldName} must be a positive integer`);
  }

  return parsed;
}

function parseRecoveryPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`supervision recovery summary.${fieldName} must be a positive integer`);
  }

  return value;
}

function parseRecoveryNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`supervision recovery summary.${fieldName} must be a non-negative integer`);
  }

  return value;
}

function summarizeAutonomyBudgets(runOptions: {
  maxCostUsd?: number;
  maxIterations?: number;
  verificationTimeoutMs?: number;
}): { maxCostUsd: number | null; maxIterations: number | null; verificationTimeoutMs: number | null } {
  return {
    maxCostUsd: runOptions.maxCostUsd ?? null,
    maxIterations: runOptions.maxIterations ?? null,
    verificationTimeoutMs: runOptions.verificationTimeoutMs ?? null,
  };
}

function parseManifestBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`overnight manifest executionProfile.${fieldName} must be a boolean`);
  }

  return value;
}

function parseManifestPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`overnight manifest ${fieldName} must be a positive integer`);
  }

  return value;
}

function parseManifestNonNegativeInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`overnight manifest ${fieldName} must be a non-negative integer`);
  }

  return value;
}

function parseManifestString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`overnight manifest ${fieldName} must be a non-empty string`);
  }

  return value;
}

function parseManifestFleetCollaborationProof(
  value: unknown,
  fieldName: string,
): AutonomousCodeRequiredFleetCollaborationProof | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isJsonObject(value)) {
    throw new Error(`overnight manifest ${fieldName} must be a JSON object`);
  }

  const completedPeerChainCalls = parseManifestNonNegativeInteger(
    value.completedPeerChainCalls,
    `${fieldName}.completedPeerChainCalls`,
  );
  const completedRoutePeerCalls = parseManifestNonNegativeInteger(
    value.completedRoutePeerCalls,
    `${fieldName}.completedRoutePeerCalls`,
  );
  const expectedCollaboration = value.expectedCollaboration;
  const proven = value.proven;
  if (completedPeerChainCalls === undefined || completedRoutePeerCalls === undefined) {
    throw new Error(`overnight manifest ${fieldName} must include completed peer-call counts`);
  }
  if (typeof expectedCollaboration !== 'boolean') {
    throw new Error(`overnight manifest ${fieldName}.expectedCollaboration must be a boolean`);
  }
  if (typeof proven !== 'boolean') {
    throw new Error(`overnight manifest ${fieldName}.proven must be a boolean`);
  }

  return {
    completedPeerChainCalls,
    completedRoutePeerCalls,
    expectedCollaboration,
    proven,
    state: parseManifestString(value.state, `${fieldName}.state`),
    tracePath: parseManifestString(value.tracePath, `${fieldName}.tracePath`),
  };
}

function parseManifestSupervisionStoppedReason(
  value: unknown,
  fieldName: string,
): AutonomousCodeSupervisionSummary['stoppedReason'] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    value === 'cycle_error_limit'
    || value === 'cycle_limit'
    || value === 'stalled'
    || value === 'terminal_status'
  ) {
    return value;
  }

  throw new Error(`overnight manifest ${fieldName} must be a known supervision stoppedReason`);
}

function parseManifestSupervisionCycle(value: unknown, index: number): AutonomousCodeSupervisionCycle {
  if (!isJsonObject(value)) {
    throw new Error(`overnight manifest supervision.cycles[${index}] must be a JSON object`);
  }

  const consecutiveErrorCycles = parseManifestNonNegativeInteger(
    value.consecutiveErrorCycles,
    `supervision.cycles[${index}].consecutiveErrorCycles`,
  );
  const cycleIndex = parseManifestPositiveInteger(value.index, `supervision.cycles[${index}].index`);
  const progressSignature = parseManifestString(
    value.progressSignature,
    `supervision.cycles[${index}].progressSignature`,
  );
  const stalledCycles = parseManifestNonNegativeInteger(
    value.stalledCycles,
    `supervision.cycles[${index}].stalledCycles`,
  );
  const status = parseManifestString(value.status, `supervision.cycles[${index}].status`);
  const timestamp = parseManifestString(value.timestamp, `supervision.cycles[${index}].timestamp`);
  if (
    consecutiveErrorCycles === undefined
    || cycleIndex === undefined
    || progressSignature === undefined
    || stalledCycles === undefined
    || status === undefined
    || timestamp === undefined
  ) {
    throw new Error(`overnight manifest supervision.cycles[${index}] is missing required fields`);
  }

  return {
    consecutiveErrorCycles,
    error: parseManifestString(value.error, `supervision.cycles[${index}].error`),
    index: cycleIndex,
    nextCycleAt: parseManifestString(value.nextCycleAt, `supervision.cycles[${index}].nextCycleAt`),
    progressSignature,
    runId: parseManifestString(value.runId, `supervision.cycles[${index}].runId`),
    stalledCycles,
    status,
    timestamp,
  };
}

function parseManifestSupervisionSummary(value: unknown): AutonomousCodeSupervisionSummary | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isJsonObject(value)) {
    throw new Error('overnight manifest supervision must be a JSON object');
  }

  if (!Array.isArray(value.cycles)) {
    throw new Error('overnight manifest supervision.cycles must be an array');
  }

  const completedCycles = parseManifestNonNegativeInteger(value.completedCycles, 'supervision.completedCycles');
  const maxErrorCycles = parseManifestPositiveInteger(value.maxErrorCycles, 'supervision.maxErrorCycles');
  const maxStalledCycles = parseManifestPositiveInteger(value.maxStalledCycles, 'supervision.maxStalledCycles');
  const requestedCycles = parseManifestPositiveInteger(value.requestedCycles, 'supervision.requestedCycles');
  const sleepMs = parseManifestNonNegativeInteger(value.sleepMs, 'supervision.sleepMs');
  const sourceManifestPath = parseManifestString(value.sourceManifestPath, 'supervision.sourceManifestPath');
  const stoppedReason = parseManifestSupervisionStoppedReason(value.stoppedReason, 'supervision.stoppedReason');
  if (
    completedCycles === undefined
    || maxErrorCycles === undefined
    || maxStalledCycles === undefined
    || requestedCycles === undefined
    || sleepMs === undefined
    || sourceManifestPath === undefined
    || stoppedReason === undefined
  ) {
    throw new Error('overnight manifest supervision is missing required fields');
  }

  return {
    completedCycles,
    cycles: value.cycles.map(parseManifestSupervisionCycle),
    fleetCollaborationProof: parseManifestFleetCollaborationProof(
      value.fleetCollaborationProof,
      'supervision.fleetCollaborationProof',
    ),
    maxErrorCycles,
    maxStalledCycles,
    requestedCycles,
    sleepMs,
    sourceManifestPath,
    stoppedReason,
  };
}

function parseManifestSupervisionDefaults(
  value: unknown,
): LoadedOvernightManifest['supervisionDefaults'] {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isJsonObject(value)) {
    throw new Error('overnight manifest supervisionDefaults must be a JSON object');
  }

  return {
    maxErrorCycles: parseManifestPositiveInteger(value.maxErrorCycles, 'supervisionDefaults.maxErrorCycles'),
    maxStalledCycles: parseManifestPositiveInteger(value.maxStalledCycles, 'supervisionDefaults.maxStalledCycles'),
    requestedCycles: parseManifestPositiveInteger(value.requestedCycles, 'supervisionDefaults.requestedCycles'),
    sleepMs: parseManifestNonNegativeInteger(value.sleepMs, 'supervisionDefaults.sleepMs'),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateArtifactText(value: string | undefined, maxLength = 100_000): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

function isAutonomousSupervisionTerminal(status: string): boolean {
  return [
    'blocked',
    'edited',
    'previewed',
    'validation_failed',
    'verification_failed',
    'verified',
  ].includes(status);
}

function buildSupervisionFleetSnapshot(
  report: Awaited<ReturnType<typeof runAgenticCodingCell>>,
): AutonomousCodeSupervisionFleetSnapshot {
  const expectedCollaboration = report.fleet.mode !== 'disabled';
  const state: AutonomousCodeSupervisionFleetSnapshot['state'] =
    report.fleet.mode === 'data_only_delegated_slices'
      ? 'delegated_chain_ready'
      : expectedCollaboration
        ? 'advisory_ready'
        : 'disabled';

  return {
    allowedTools: report.fleet.allowedTools,
    chainRoles: report.fleet.chainRoles,
    expectedCollaboration,
    ...(report.fleet.invocation
      ? {
        invocation: {
          chainRoles: report.fleet.invocation.args.chainRoles,
          privacyTag: report.fleet.invocation.args.privacyTag,
          stageTimeoutMs: report.fleet.invocation.args.stageTimeoutMs,
          tool: report.fleet.invocation.tool,
        },
      }
      : {}),
    mode: report.fleet.mode,
    policy: report.fleet.policy,
    state,
  };
}

async function appendSupervisionCycleEvent(
  filePath: string,
  event: AutonomousCodeSupervisionEvent,
): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  return filePath;
}

function parseSupervisionEvent(value: unknown, index: number): AutonomousCodeSupervisionEvent {
  if (!isJsonObject(value)) {
    throw new Error(`supervision event line ${index + 1} must be a JSON object`);
  }
  if (value.kind !== 'agentic-coding-supervision-cycle') {
    throw new Error(`supervision event line ${index + 1} must be an agentic-coding-supervision-cycle`);
  }

  const maxErrorCycles = parseManifestPositiveInteger(
    value.maxErrorCycles,
    `supervisionEvents[${index}].maxErrorCycles`,
  );
  const maxStalledCycles = parseManifestPositiveInteger(
    value.maxStalledCycles,
    `supervisionEvents[${index}].maxStalledCycles`,
  );
  const requestedCycles = parseManifestPositiveInteger(
    value.requestedCycles,
    `supervisionEvents[${index}].requestedCycles`,
  );
  const sleepMs = parseManifestNonNegativeInteger(value.sleepMs, `supervisionEvents[${index}].sleepMs`);
  const sourceManifestPath = parseManifestString(value.sourceManifestPath, `supervisionEvents[${index}].sourceManifestPath`);
  if (
    maxErrorCycles === undefined
    || maxStalledCycles === undefined
    || requestedCycles === undefined
    || sleepMs === undefined
    || sourceManifestPath === undefined
  ) {
    throw new Error(`supervision event line ${index + 1} is missing required fields`);
  }

  return {
    fleetCollaborationProof: parseManifestFleetCollaborationProof(
      value.fleetCollaborationProof,
      `supervisionEvents[${index}].fleetCollaborationProof`,
    ),
    kind: 'agentic-coding-supervision-cycle',
    maxErrorCycles,
    maxStalledCycles,
    schemaVersion: 1,
    cycle: parseManifestSupervisionCycle(value.cycle, index),
    requestedCycles,
    sleepMs,
    sourceManifestPath,
    stoppedReason: parseManifestSupervisionStoppedReason(value.stoppedReason, `supervisionEvents[${index}].stoppedReason`),
  };
}

async function readSupervisionEvents(filePath: string): Promise<AutonomousCodeSupervisionEvent[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => parseSupervisionEvent(JSON.parse(line) as unknown, index));
}

function listSupervisionCycleMismatches(
  eventCycle: AutonomousCodeSupervisionCycle,
  manifestCycle: AutonomousCodeSupervisionCycle,
): string[] {
  const mismatches: string[] = [];
  if (eventCycle.consecutiveErrorCycles !== manifestCycle.consecutiveErrorCycles) {
    mismatches.push('consecutiveErrorCycles');
  }
  if (eventCycle.error !== manifestCycle.error) {
    mismatches.push('error');
  }
  if (eventCycle.index !== manifestCycle.index) {
    mismatches.push('index');
  }
  if (eventCycle.nextCycleAt !== manifestCycle.nextCycleAt) {
    mismatches.push('nextCycleAt');
  }
  if (eventCycle.progressSignature !== manifestCycle.progressSignature) {
    mismatches.push('progressSignature');
  }
  if (eventCycle.runId !== manifestCycle.runId) {
    mismatches.push('runId');
  }
  if (eventCycle.stalledCycles !== manifestCycle.stalledCycles) {
    mismatches.push('stalledCycles');
  }
  if (eventCycle.status !== manifestCycle.status) {
    mismatches.push('status');
  }
  if (eventCycle.timestamp !== manifestCycle.timestamp) {
    mismatches.push('timestamp');
  }
  return mismatches;
}

async function buildSupervisionEventAudit(manifest: LoadedOvernightManifest): Promise<AutonomousCodeSupervisionEventAudit> {
  const eventPath = manifest.artifacts.supervisionEventsPath;
  const blockers: string[] = [];
  if (!eventPath) {
    if (manifest.supervision) {
      blockers.push('Supervision event path is missing from manifest artifacts.');
    }
    return {
      blockers,
      eventCount: 0,
      exists: false,
      matchesSupervision: blockers.length === 0,
    };
  }

  let events: AutonomousCodeSupervisionEvent[] = [];
  let eventFileExists = true;
  try {
    events = await readSupervisionEvents(eventPath);
  } catch (error) {
    eventFileExists = readErrorCode(error) !== 'ENOENT';
    blockers.push(`Supervision event audit file is missing or unreadable: ${eventPath}.`);
    if (error instanceof Error && error.message) {
      blockers.push(error.message);
    }
  }

  const supervision = manifest.supervision;
  if (supervision) {
    if (supervision.completedCycles !== supervision.cycles.length) {
      blockers.push(
        `Manifest completedCycles ${supervision.completedCycles} does not match manifest cycles ${supervision.cycles.length}.`,
      );
    }
    if (events.length !== supervision.cycles.length) {
      blockers.push(`Supervision event count ${events.length} does not match manifest cycles ${supervision.cycles.length}.`);
    }

    const comparableSourceManifestPath = path.resolve(supervision.sourceManifestPath);
    for (const [index, event] of events.entries()) {
      if (path.resolve(event.sourceManifestPath) !== comparableSourceManifestPath) {
        blockers.push(`Supervision event ${index + 1} sourceManifestPath does not match the manifest supervision source.`);
      }
      const manifestCycle = supervision.cycles[index];
      if (!manifestCycle) {
        continue;
      }
      const mismatches = listSupervisionCycleMismatches(event.cycle, manifestCycle);
      if (mismatches.length > 0) {
        blockers.push(`Supervision event ${index + 1} cycle does not match manifest cycle: ${mismatches.join(', ')}.`);
      }
    }

    const lastEvent = events[events.length - 1];
    if (lastEvent && lastEvent.stoppedReason !== supervision.stoppedReason) {
      blockers.push(
        `Last supervision event stoppedReason ${lastEvent.stoppedReason ?? 'none'} does not match manifest stoppedReason ${supervision.stoppedReason}.`,
      );
    }
  }

  const lastEvent = events[events.length - 1];
  return {
    blockers,
    eventCount: events.length,
    exists: eventFileExists,
    ...(lastEvent
      ? {
        lastCycleIndex: lastEvent.cycle.index,
        lastCycleStatus: lastEvent.cycle.status,
        lastCycleTimestamp: lastEvent.cycle.timestamp,
        lastStoppedReason: lastEvent.stoppedReason,
      }
      : {}),
    matchesSupervision: blockers.length === 0,
    path: eventPath,
  };
}

function mergeContinuedSupervisionSummary(
  previous: AutonomousCodeSupervisionSummary | undefined,
  next: AutonomousCodeSupervisionSummary,
): AutonomousCodeSupervisionSummary {
  if (!previous) {
    return next;
  }

  const cycles = [...previous.cycles, ...next.cycles];
  return {
    ...next,
    completedCycles: cycles.length,
    cycles,
    fleetCollaborationProof: next.fleetCollaborationProof ?? previous.fleetCollaborationProof,
  };
}

async function writeMachineReadableJsonArtifact(filePath: string, value: unknown): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
  return filePath;
}

function appendExecutionProfileArgs(args: string[], executionProfile: AutonomousCodeExecutionProfile): string[] {
  if (executionProfile.editProposalFile) {
    args.push('--edit-proposal-file', executionProfile.editProposalFile);
  }
  if (executionProfile.approvalDecisionFile) {
    args.push('--approval-decision-file', executionProfile.approvalDecisionFile);
  }
  if (executionProfile.workflowBuilderProposalFile) {
    args.push('--workflow-builder-proposal-file', executionProfile.workflowBuilderProposalFile);
  }
  if (executionProfile.editProposalProducerDispatchFile) {
    args.push('--edit-proposal-producer-dispatch-file', executionProfile.editProposalProducerDispatchFile);
  }
  if (executionProfile.previewEdits) {
    args.push('--preview-edits');
  }
  if (executionProfile.applyEdits) {
    args.push('--apply-edits');
  }
  if (executionProfile.requirePreview) {
    args.push('--require-preview');
  }
  if (executionProfile.requireApproval) {
    args.push('--require-approval');
  }
  if (executionProfile.requireFleetCollaboration) {
    args.push('--require-fleet-collaboration');
  }
  if (executionProfile.runVerification) {
    args.push('--run-verification');
  }

  return args;
}

function appendSupervisionArtifactArgs(
  args: string[],
  artifactPaths: AutonomousCodeSupervisionArtifactCommandPaths,
): string[] {
  const flagPairs: Array<[keyof AutonomousCodeSupervisionArtifactCommandPaths, string]> = [
    ['supervisionEventsPath', '--supervision-events-file'],
    ['supervisionRecoveryPath', '--supervision-recovery-file'],
    ['supervisionFleetTriagePath', '--supervision-fleet-triage-file'],
    ['supervisionFleetTriageResultPath', '--supervision-fleet-triage-result-file'],
  ];

  for (const [key, flag] of flagPairs) {
    const value = artifactPaths[key];
    if (value) {
      args.push(flag, path.resolve(value));
    }
  }

  return args;
}

function buildOvernightResumeCommand(
  manifestPath: string,
  executionProfile: AutonomousCodeExecutionProfile,
): string[] {
  return [
    ...appendExecutionProfileArgs(
      ['buddy', 'autonomous-code', '--resume-from-manifest', path.resolve(manifestPath)],
      executionProfile,
    ),
    '--json',
  ];
}

function buildOvernightAuditCommand(
  manifestPath: string,
  requireOvernightCompletion = false,
): string[] {
  const args = [
    'buddy',
    'autonomous-code',
    '--audit-overnight-manifest',
    path.resolve(manifestPath),
    '--json',
  ];

  if (requireOvernightCompletion) {
    args.push('--require-overnight-completion');
  }

  return args;
}

function buildOvernightSuperviseCommand(
  manifestPath: string,
  requestedCycles: number,
  sleepMs: number,
  maxStalledCycles: number,
  maxErrorCycles: number,
  executionProfile: AutonomousCodeExecutionProfile,
  requireOvernightReadiness = false,
  requireOvernightCompletion = false,
  artifactPaths: AutonomousCodeSupervisionArtifactCommandPaths = {},
): string[] {
  const args = [
    ...appendExecutionProfileArgs([
      'buddy',
      'autonomous-code',
      '--supervise-from-manifest',
      path.resolve(manifestPath),
      '--supervise-cycles',
      String(requestedCycles),
      '--supervise-sleep-ms',
      String(sleepMs),
      '--supervise-max-stalled-cycles',
      String(maxStalledCycles),
      '--supervise-max-error-cycles',
      String(maxErrorCycles),
    ], executionProfile),
    '--json',
  ];

  appendSupervisionArtifactArgs(args, artifactPaths);

  if (requireOvernightReadiness) {
    args.push('--require-overnight-readiness');
  }
  if (requireOvernightCompletion) {
    args.push('--require-overnight-completion');
  }

  return args;
}

function buildSupervisionProgressSignature(
  report: Awaited<ReturnType<typeof runAgenticCodingCell>>,
): string {
  return JSON.stringify({
    activeNodeId: report.workflow.activeNodeId,
    appliedEdits: report.editResults.filter((result) => result.status === 'applied').length,
    blockedNodeIds: report.workflow.blockedNodeIds,
    blockedReasons: report.blockedReasons,
    completedNodeIds: report.workflow.completedNodeIds,
    editProposal: report.editProposal
      ? {
        editCount: report.editProposal.editCount,
        file: report.editProposal.file,
        summary: report.editProposal.summary,
      }
      : null,
    nodeErrors: report.workflow.nodeErrors,
    previewedEdits: report.editPreviews.filter((preview) => preview.status === 'previewed').length,
    status: report.status,
    validationErrors: report.validationErrors,
    verification: report.verification.map((result) => ({
      command: result.command,
      reason: result.reason ?? null,
      status: result.status,
    })),
  });
}

function buildSupervisionErrorSignature(error: string): string {
  return JSON.stringify({
    error,
    status: 'cycle_error',
  });
}

function buildSupervisionNextCycleAt(input: {
  cycle: number;
  requestedCycles: number;
  sleepMs: number;
  stoppedReason?: AutonomousCodeSupervisionSummary['stoppedReason'];
  timestamp: Date;
}): string | undefined {
  if (input.stoppedReason || input.cycle >= input.requestedCycles) {
    return undefined;
  }

  return new Date(input.timestamp.getTime() + input.sleepMs).toISOString();
}

function isRecoverableSupervisionStoppedReason(
  reason: AutonomousCodeSupervisionSummary['stoppedReason'],
): boolean {
  return reason !== 'terminal_status';
}

function parseSupervisionCycleTimestamp(cycle: { timestamp: string } | undefined): number | undefined {
  if (!cycle) {
    return undefined;
  }

  const parsed = Date.parse(cycle.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function calculateCompletedSupervisionWindowMs(
  supervision: { cycles: Array<{ timestamp: string }>; stoppedReason: string } | undefined,
): number {
  if (!supervision || supervision.stoppedReason !== 'cycle_limit' || supervision.cycles.length < 2) {
    return 0;
  }

  const firstTimestamp = parseSupervisionCycleTimestamp(supervision.cycles[0]);
  const lastTimestamp = parseSupervisionCycleTimestamp(supervision.cycles[supervision.cycles.length - 1]);
  if (firstTimestamp === undefined || lastTimestamp === undefined || lastTimestamp < firstTimestamp) {
    return 0;
  }

  return lastTimestamp - firstTimestamp;
}

function buildOvernightReadiness(input: {
  executionProfile: AutonomousCodeExecutionProfile;
  fleetCollaborationProof?: AutonomousCodeRequiredFleetCollaborationProof;
  requestedCycles: number;
  sleepMs: number;
  supervision?: AutonomousCodeSupervisionSummary;
}): AutonomousCodeOvernightReadiness {
  const configuredWindowMs = Math.max(0, input.requestedCycles - 1) * input.sleepMs;
  const completedWindowMs = calculateCompletedSupervisionWindowMs(input.supervision);
  const configuredForOvernight = configuredWindowMs >= MINIMUM_OVERNIGHT_WINDOW_MS
    && input.requestedCycles > 1
    && input.sleepMs > 0;
  const completedOvernightWindow = completedWindowMs >= MINIMUM_OVERNIGHT_WINDOW_MS;
  const fleetCollaborationRequired = input.executionProfile.requireFleetCollaboration === true;
  const fleetCollaborationProven = input.fleetCollaborationProof?.proven === true;
  const multiAgentReady = fleetCollaborationRequired && fleetCollaborationProven;
  const blockers: string[] = [];

  if (!configuredForOvernight) {
    blockers.push('Supervision window is shorter than the minimum overnight window.');
  }

  if (!fleetCollaborationRequired) {
    blockers.push('Fleet collaboration is not required by the execution profile.');
  } else if (!fleetCollaborationProven) {
    blockers.push('Fleet collaboration proof is missing or incomplete.');
  }

  return {
    blockers,
    completedOvernightWindow,
    completedWindowMs,
    completionProven: configuredForOvernight && completedOvernightWindow && multiAgentReady,
    configuredForOvernight,
    configuredWindowMs,
    fleetCollaborationProven,
    fleetCollaborationRequired,
    minimumWindowMs: MINIMUM_OVERNIGHT_WINDOW_MS,
    multiAgentReady,
    ready: configuredForOvernight && multiAgentReady,
  };
}

function assertOvernightReadiness(readiness: AutonomousCodeOvernightReadiness): void {
  if (readiness.ready) {
    return;
  }

  const blockers = readiness.blockers.length > 0
    ? readiness.blockers.join(' ')
    : 'Overnight readiness is not satisfied.';
  throw new Error(`--require-overnight-readiness failed: ${blockers}`);
}

function assertOvernightCompletion(readiness: AutonomousCodeOvernightReadiness): void {
  if (readiness.completionProven) {
    return;
  }

  const blockers = [
    ...readiness.blockers,
    ...(!readiness.completedOvernightWindow
      ? [`Completed supervision window ${readiness.completedWindowMs}ms is shorter than minimum ${readiness.minimumWindowMs}ms.`]
      : []),
    ...(!readiness.multiAgentReady ? ['Multi-agent Fleet proof is missing or incomplete.'] : []),
  ].join(' ');
  throw new Error(`--require-overnight-completion failed: ${blockers || 'Overnight completion is not proven.'}`);
}

function assertOvernightAuditCompletion(audit: Awaited<ReturnType<typeof buildOvernightManifestAudit>>): void {
  assertOvernightCompletion(audit.overnightReadiness);
  if (audit.eventAudit.matchesSupervision) {
    return;
  }

  const blockers = audit.eventAudit.blockers.length > 0
    ? audit.eventAudit.blockers.join(' ')
    : 'Supervision event evidence is missing or inconsistent.';
  throw new Error(`--require-overnight-completion failed: ${blockers}`);
}

async function buildOvernightManifestAudit(manifest: LoadedOvernightManifest): Promise<{
  artifacts: Record<string, string>;
  evidence: {
    completedCycles?: number;
    fleetTracePath?: string;
    supervisionEventsPath?: string;
    stoppedReason?: AutonomousCodeSupervisionSummary['stoppedReason'];
  };
  eventAudit: AutonomousCodeSupervisionEventAudit;
  kind: 'agentic-coding-overnight-audit';
  manifestPath: string;
  overnightReadiness: AutonomousCodeOvernightReadiness;
  runId?: string;
  schemaVersion: 1;
  status: 'completion_proven' | 'evidence_mismatch' | 'not_complete' | 'not_ready';
  supervision?: AutonomousCodeSupervisionSummary;
}> {
  let fleetCollaborationProof = manifest.supervision?.fleetCollaborationProof;
  let fleetTracePath = fleetCollaborationProof?.tracePath;
  if (!fleetCollaborationProof && manifest.executionProfile.requireFleetCollaboration) {
    const tracePath = manifest.artifacts.editProposalProducerTracePath;
    if (tracePath) {
      fleetTracePath = tracePath;
      try {
        fleetCollaborationProof = await assertRequiredFleetCollaborationFromFile(tracePath);
      } catch {
        fleetCollaborationProof = undefined;
      }
    }
  }
  const requestedCycles =
    manifest.supervision?.requestedCycles
    ?? manifest.supervisionDefaults?.requestedCycles
    ?? DEFAULT_OVERNIGHT_SUPERVISION_CYCLES;
  const sleepMs =
    manifest.supervision?.sleepMs
    ?? manifest.supervisionDefaults?.sleepMs
    ?? DEFAULT_OVERNIGHT_SUPERVISION_SLEEP_MS;
  const overnightReadiness = buildOvernightReadiness({
    executionProfile: manifest.executionProfile,
    fleetCollaborationProof,
    requestedCycles,
    sleepMs,
    supervision: manifest.supervision,
  });
  const eventAudit = await buildSupervisionEventAudit(manifest);
  const status = overnightReadiness.completionProven
    ? eventAudit.matchesSupervision
      ? 'completion_proven'
      : 'evidence_mismatch'
    : overnightReadiness.ready
      ? 'not_complete'
      : 'not_ready';

  return {
    artifacts: manifest.artifacts,
    evidence: {
      completedCycles: manifest.supervision?.completedCycles,
      fleetTracePath,
      supervisionEventsPath: manifest.artifacts.supervisionEventsPath,
      stoppedReason: manifest.supervision?.stoppedReason,
    },
    eventAudit,
    kind: 'agentic-coding-overnight-audit',
    manifestPath: manifest.filePath,
    overnightReadiness,
    runId: manifest.runId,
    schemaVersion: 1,
    status,
    supervision: manifest.supervision,
  };
}

function renderOvernightManifestAudit(audit: Awaited<ReturnType<typeof buildOvernightManifestAudit>>): string {
  return [
    `Overnight audit: ${audit.status}`,
    `Manifest: ${audit.manifestPath}`,
    `Run ID: ${audit.runId ?? 'unknown'}`,
    `Configured window: ${audit.overnightReadiness.configuredWindowMs}ms`,
    `Completed window: ${audit.overnightReadiness.completedWindowMs}ms`,
    `Fleet proof: ${audit.overnightReadiness.fleetCollaborationProven ? 'proven' : 'missing'}`,
    `Supervision: ${audit.evidence.completedCycles ?? 0} cycles (${audit.evidence.stoppedReason ?? 'none'})`,
    `Supervision events: ${audit.eventAudit.eventCount} events (${audit.eventAudit.matchesSupervision ? 'matched' : 'mismatch'})`,
    audit.overnightReadiness.blockers.length > 0
      ? `Blockers: ${audit.overnightReadiness.blockers.join(' ')}`
      : audit.eventAudit.blockers.length > 0
        ? `Blockers: ${audit.eventAudit.blockers.join(' ')}`
        : 'Blockers: none',
  ].join('\n');
}

function buildSupervisionRecoveryArtifact(input: {
  artifactPaths: Record<string, string | undefined>;
  executionProfile: AutonomousCodeExecutionProfile;
  fleet?: AutonomousCodeSupervisionFleetSnapshot;
  overnightReadiness: AutonomousCodeOvernightReadiness;
  runId?: string;
  sourceManifestPath: string;
  supervision: AutonomousCodeSupervisionSummary;
}): AutonomousCodeSupervisionRecovery | undefined {
  if (!isRecoverableSupervisionStoppedReason(input.supervision.stoppedReason)) {
    return undefined;
  }

  const artifacts = Object.fromEntries(
    Object.entries(input.artifactPaths).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const lastCycle = input.supervision.cycles[input.supervision.cycles.length - 1];
  const actions: AutonomousCodeSupervisionRecoveryAction[] = [
    {
      path: artifacts.supervisionEventsPath,
      reason: 'Inspect the per-cycle audit trail before changing the run profile.',
      type: 'inspect_supervision_events',
    },
    {
      command: buildOvernightAuditCommand(input.sourceManifestPath),
      reason: 'Recalculate readiness and completion from the persisted manifest before resuming.',
      type: 'audit_overnight_manifest',
    },
    {
      command: buildOvernightResumeCommand(input.sourceManifestPath, input.executionProfile),
      reason: 'Run one bounded resume cycle after reviewing the stopped state.',
      type: 'resume_once',
    },
    {
      command: buildOvernightSuperviseCommand(
        input.sourceManifestPath,
        input.supervision.requestedCycles,
        input.supervision.sleepMs,
        input.supervision.maxStalledCycles,
        input.supervision.maxErrorCycles,
        input.executionProfile,
        input.overnightReadiness.ready,
        input.overnightReadiness.ready,
        {
          supervisionEventsPath: artifacts.supervisionEventsPath,
          supervisionFleetTriagePath: artifacts.supervisionFleetTriagePath,
          supervisionFleetTriageResultPath: artifacts.supervisionFleetTriageResultPath,
          supervisionRecoveryPath: artifacts.supervisionRecoveryPath,
        },
      ),
      reason: 'Restart the watchdog with the same manifest profile once the blocker is understood.',
      type: 'restart_supervision',
    },
  ];

  if (input.fleet?.invocation) {
    actions.splice(1, 0, {
      invocation: input.fleet.invocation,
      path: artifacts.supervisionFleetTriagePath,
      reason: 'Ask Fleet peers to triage the stalled or failed supervision state before editing.',
      type: 'ask_fleet_triage',
    });
  }

  if (artifacts.supervisionFleetTriageResultPath) {
    const insertAt = actions.findIndex((action) => action.type === 'ask_fleet_triage');
    actions.splice(insertAt === -1 ? 1 : insertAt, 0, {
      path: artifacts.supervisionFleetTriageResultPath,
      reason: 'Inspect the attempted Fleet triage result before rerunning peer triage.',
      type: 'inspect_fleet_triage_result',
    });
  }

  return {
    actions,
    artifacts,
    ...(input.fleet ? { fleet: input.fleet } : {}),
    kind: 'agentic-coding-supervision-recovery',
    ...(lastCycle ? { lastCycle } : {}),
    overnightReadiness: input.overnightReadiness,
    ...(input.runId ? { runId: input.runId } : {}),
    schemaVersion: 1,
    sourceManifestPath: input.sourceManifestPath,
    stoppedReason: input.supervision.stoppedReason,
    summary: {
      completedCycles: input.supervision.completedCycles,
      maxErrorCycles: input.supervision.maxErrorCycles,
      maxStalledCycles: input.supervision.maxStalledCycles,
      requestedCycles: input.supervision.requestedCycles,
      sleepMs: input.supervision.sleepMs,
    },
  };
}

async function writeSupervisionRecoveryArtifact(
  filePath: string,
  input: Parameters<typeof buildSupervisionRecoveryArtifact>[0],
): Promise<string | undefined> {
  const recovery = buildSupervisionRecoveryArtifact(input);
  if (!recovery) {
    return undefined;
  }

  return writeMachineReadableJsonArtifact(filePath, recovery);
}

function buildSupervisionFleetTriagePrompt(input: {
  artifacts: Record<string, string>;
  lastCycle?: AutonomousCodeSupervisionCycle;
  overnightReadiness: AutonomousCodeOvernightReadiness;
  recoveryPath: string;
  runId?: string;
  sourceManifestPath: string;
  supervision: AutonomousCodeSupervisionSummary;
}): string {
  const lastCycleLines = input.lastCycle
    ? [
      `Last cycle index: ${input.lastCycle.index}`,
      `Last cycle status: ${input.lastCycle.status}`,
      `Last cycle stalled count: ${input.lastCycle.stalledCycles}`,
      `Last cycle consecutive errors: ${input.lastCycle.consecutiveErrorCycles}`,
      ...(input.lastCycle.error ? [`Last cycle error: ${input.lastCycle.error}`] : []),
    ]
    : ['Last cycle: unavailable'];
  const artifactLines = Object.entries(input.artifacts)
    .map(([name, artifactPath]) => `- ${name}: ${artifactPath}`);
  const blockerLines = input.overnightReadiness.blockers.length > 0
    ? input.overnightReadiness.blockers.map((blocker) => `- ${blocker}`)
    : ['- none'];

  return [
    'Fleet triage request for an autonomous overnight supervision stop.',
    `Stopped reason: ${input.supervision.stoppedReason}`,
    `Run id: ${input.runId ?? 'unknown'}`,
    `Source manifest: ${input.sourceManifestPath}`,
    `Recovery handoff: ${input.recoveryPath}`,
    `Completed cycles: ${input.supervision.completedCycles}/${input.supervision.requestedCycles}`,
    `Sleep ms: ${input.supervision.sleepMs}`,
    `Max stalled cycles: ${input.supervision.maxStalledCycles}`,
    `Max error cycles: ${input.supervision.maxErrorCycles}`,
    ...lastCycleLines,
    'Overnight readiness blockers:',
    ...blockerLines,
    'Artifacts:',
    ...(artifactLines.length > 0 ? artifactLines : ['- none']),
    'Return a concise diagnosis, safest next action, and whether to run resume_once or restart_supervision.',
  ].join('\n');
}

function buildSupervisionFleetTriageArtifact(input: {
  artifactPaths: Record<string, string | undefined>;
  fleet: AutonomousCodeSupervisionFleetSnapshot;
  overnightReadiness: AutonomousCodeOvernightReadiness;
  recoveryPath: string;
  runId?: string;
  sourceManifestPath: string;
  supervision: AutonomousCodeSupervisionSummary;
}): AutonomousCodeSupervisionFleetTriage | undefined {
  if (!isRecoverableSupervisionStoppedReason(input.supervision.stoppedReason) || !input.fleet.invocation) {
    return undefined;
  }

  const artifacts = Object.fromEntries(
    Object.entries(input.artifactPaths).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const lastCycle = input.supervision.cycles[input.supervision.cycles.length - 1];

  return {
    artifacts,
    fleet: input.fleet,
    kind: 'agentic-coding-supervision-fleet-triage',
    ...(lastCycle ? { lastCycle } : {}),
    peerChainCall: {
      ...input.fleet.invocation,
      prompt: buildSupervisionFleetTriagePrompt({
        artifacts,
        lastCycle,
        overnightReadiness: input.overnightReadiness,
        recoveryPath: input.recoveryPath,
        runId: input.runId,
        sourceManifestPath: input.sourceManifestPath,
        supervision: input.supervision,
      }),
    },
    recoveryPath: input.recoveryPath,
    ...(input.runId ? { runId: input.runId } : {}),
    schemaVersion: 1,
    sourceManifestPath: input.sourceManifestPath,
    stoppedReason: input.supervision.stoppedReason,
    summary: {
      completedCycles: input.supervision.completedCycles,
      maxErrorCycles: input.supervision.maxErrorCycles,
      maxStalledCycles: input.supervision.maxStalledCycles,
      requestedCycles: input.supervision.requestedCycles,
      sleepMs: input.supervision.sleepMs,
    },
  };
}

function summarizeSupervisionFleetTriageResult(
  triage: AutonomousCodeSupervisionFleetTriage,
  triagePath: string,
  result: ToolResult,
): AutonomousCodeSupervisionFleetTriageResult {
  const data = isJsonObject(result.data) ? result.data : {};
  const stages = Array.isArray(data.stages) ? data.stages : undefined;
  const finalText = typeof data.finalText === 'string' ? data.finalText : undefined;

  return {
    attemptedAt: new Date().toISOString(),
    artifacts: triage.artifacts,
    ...(result.error ? { error: truncateArtifactText(result.error, 5000) } : {}),
    ...(finalText ? { finalText: truncateArtifactText(finalText) } : {}),
    kind: 'agentic-coding-supervision-fleet-triage-result',
    ...(result.output ? { output: truncateArtifactText(result.output) } : {}),
    peerChainCall: {
      chainRoles: triage.peerChainCall.chainRoles,
      privacyTag: triage.peerChainCall.privacyTag,
      promptLength: triage.peerChainCall.prompt.length,
      stageTimeoutMs: Math.min(
        triage.peerChainCall.stageTimeoutMs,
        DEFAULT_SUPERVISION_FLEET_TRIAGE_STAGE_TIMEOUT_MS,
      ),
      tool: 'peer_chain',
    },
    recoveryPath: triage.recoveryPath,
    ...(triage.runId ? { runId: triage.runId } : {}),
    schemaVersion: 1,
    sourceManifestPath: triage.sourceManifestPath,
    ...(stages ? { stageCount: stages.length } : {}),
    stoppedReason: triage.stoppedReason,
    success: result.success,
    triagePath,
  };
}

async function writeSupervisionFleetTriageResultArtifact(
  filePath: string,
  triagePath: string,
  triage: AutonomousCodeSupervisionFleetTriage,
): Promise<string> {
  const stageTimeoutMs = Math.min(
    triage.peerChainCall.stageTimeoutMs,
    DEFAULT_SUPERVISION_FLEET_TRIAGE_STAGE_TIMEOUT_MS,
  );
  const result = await executePeerChain({
    chainRoles: triage.peerChainCall.chainRoles,
    privacyTag: triage.peerChainCall.privacyTag,
    prompt: triage.peerChainCall.prompt,
    stageTimeoutMs,
  });

  return writeMachineReadableJsonArtifact(
    filePath,
    summarizeSupervisionFleetTriageResult(triage, triagePath, result),
  );
}

function buildRequiredFleetCollaborationProof(
  trace: AutonomousCodeProducerTrace,
  tracePath?: string,
): AutonomousCodeRequiredFleetCollaborationProof {
  const fleet = trace.fleet;
  const completedPeerChainCalls = readTraceCount(fleet?.completedPeerChainCalls);
  const completedRoutePeerCalls = readTraceCount(fleet?.completedRoutePeerCalls);
  const completedCalls = completedPeerChainCalls + completedRoutePeerCalls;

  return {
    completedPeerChainCalls,
    completedRoutePeerCalls,
    expectedCollaboration: fleet?.expectedCollaboration === true,
    proven: fleet?.expectedCollaboration === true && completedCalls >= 1,
    ...(typeof fleet?.state === 'string' ? { state: fleet.state } : {}),
    ...(tracePath ? { tracePath: path.resolve(tracePath) } : {}),
  };
}

function assertRequiredFleetCollaboration(
  trace: AutonomousCodeProducerTrace,
  tracePath?: string,
): AutonomousCodeRequiredFleetCollaborationProof {
  const proof = buildRequiredFleetCollaborationProof(trace, tracePath);
  if (!proof.proven) {
    throw new Error(
      '--require-fleet-collaboration requires a generated proposal trace with at least one completed '
      + `route_peer or peer_chain call; trace state is ${proof.state ?? 'missing'}`,
    );
  }

  return proof;
}

function getDefaultEditProposalProducerTracePath(editProposalFile: string | undefined): string | undefined {
  return editProposalFile
    ? path.join(path.dirname(path.resolve(editProposalFile)), 'edit-proposal-producer-trace.json')
    : undefined;
}

async function assertRequiredFleetCollaborationFromFile(
  filePath: string,
): Promise<AutonomousCodeRequiredFleetCollaborationProof> {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`--require-fleet-collaboration trace file must be a JSON object: ${filePath}`);
  }

  return assertRequiredFleetCollaboration(parsed, filePath);
}

function getOvernightManifestPath(
  options: AutonomousCodeOptions,
  autonomyPreset: AutonomousCodePreset,
  checkpointPath: string | undefined,
  effectiveManifestPath?: string,
): string | undefined {
  if (options.overnightManifestFile) {
    return path.resolve(options.overnightManifestFile);
  }

  if (options.resumeFromManifest) {
    return path.resolve(options.resumeFromManifest);
  }

  if (options.superviseFromManifest) {
    return path.resolve(options.superviseFromManifest);
  }

  if (effectiveManifestPath) {
    return path.resolve(effectiveManifestPath);
  }

  if (autonomyPreset === 'overnight' && checkpointPath) {
    return path.join(path.dirname(checkpointPath), 'overnight-manifest.json');
  }

  return undefined;
}

function resolveManifestArtifactPath(manifestPath: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  return path.isAbsolute(value)
    ? value
    : path.resolve(path.dirname(manifestPath), value);
}

function readManifestExecutionProfile(
  manifestPath: string,
  value: unknown,
): AutonomousCodeExecutionProfile {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isJsonObject(value)) {
    throw new Error('overnight manifest executionProfile must be a JSON object');
  }

  const profile: AutonomousCodeExecutionProfile = {};
  const applyEdits = parseManifestBoolean(value.applyEdits, 'applyEdits');
  const previewEdits = parseManifestBoolean(value.previewEdits, 'previewEdits');
  const requireApproval = parseManifestBoolean(value.requireApproval, 'requireApproval');
  const requireFleetCollaboration = parseManifestBoolean(value.requireFleetCollaboration, 'requireFleetCollaboration');
  const requirePreview = parseManifestBoolean(value.requirePreview, 'requirePreview');
  const runVerification = parseManifestBoolean(value.runVerification, 'runVerification');
  if (applyEdits !== undefined) {
    profile.applyEdits = applyEdits;
  }
  if (previewEdits !== undefined) {
    profile.previewEdits = previewEdits;
  }
  if (requireApproval !== undefined) {
    profile.requireApproval = requireApproval;
  }
  if (requireFleetCollaboration !== undefined) {
    profile.requireFleetCollaboration = requireFleetCollaboration;
  }
  if (requirePreview !== undefined) {
    profile.requirePreview = requirePreview;
  }
  if (runVerification !== undefined) {
    profile.runVerification = runVerification;
  }

  const approvalDecisionFile = resolveManifestArtifactPath(manifestPath, value.approvalDecisionFile);
  const editProposalFile = resolveManifestArtifactPath(manifestPath, value.editProposalFile);
  const editProposalProducerDispatchFile = resolveManifestArtifactPath(
    manifestPath,
    value.editProposalProducerDispatchFile,
  );
  const workflowBuilderProposalFile = resolveManifestArtifactPath(manifestPath, value.workflowBuilderProposalFile);
  if (approvalDecisionFile) {
    profile.approvalDecisionFile = approvalDecisionFile;
  }
  if (editProposalFile) {
    profile.editProposalFile = editProposalFile;
  }
  if (editProposalProducerDispatchFile) {
    profile.editProposalProducerDispatchFile = editProposalProducerDispatchFile;
  }
  if (workflowBuilderProposalFile) {
    profile.workflowBuilderProposalFile = workflowBuilderProposalFile;
  }

  return profile;
}

function buildOvernightExecutionProfile(
  options: AutonomousCodeOptions,
  generatedEditProposalPath: string | undefined,
  inheritedProfile: AutonomousCodeExecutionProfile = {},
): AutonomousCodeExecutionProfile {
  const profile: AutonomousCodeExecutionProfile = { ...inheritedProfile };
  const editProposalFile = generatedEditProposalPath ?? options.editProposalFile;
  if (editProposalFile) {
    profile.editProposalFile = path.resolve(editProposalFile);
  }
  if (options.approvalDecisionFile) {
    profile.approvalDecisionFile = path.resolve(options.approvalDecisionFile);
  }
  if (options.editProposalProducerDispatchFile) {
    profile.editProposalProducerDispatchFile = path.resolve(options.editProposalProducerDispatchFile);
  }
  if (options.workflowBuilderProposalFile) {
    profile.workflowBuilderProposalFile = path.resolve(options.workflowBuilderProposalFile);
  }
  if (options.applyEdits !== undefined) {
    profile.applyEdits = Boolean(options.applyEdits);
  }
  if (options.previewEdits !== undefined) {
    profile.previewEdits = Boolean(options.previewEdits);
  }
  if (options.requireApproval !== undefined) {
    profile.requireApproval = Boolean(options.requireApproval);
  }
  if (options.requireFleetCollaboration !== undefined) {
    profile.requireFleetCollaboration = Boolean(options.requireFleetCollaboration);
  }
  if (options.requirePreview !== undefined) {
    profile.requirePreview = Boolean(options.requirePreview);
  }
  if (options.runVerification !== undefined) {
    profile.runVerification = Boolean(options.runVerification);
  }

  return profile;
}

async function readOvernightManifest(filePath: string): Promise<LoadedOvernightManifest> {
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(await fs.readFile(resolved, 'utf8')) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error('--resume-from-manifest must point to a JSON object');
  }

  if (parsed.kind !== 'agentic-coding-overnight-manifest') {
    throw new Error('--resume-from-manifest must point to an agentic-coding-overnight-manifest file');
  }

  const rawRunId = parsed.runId;
  const runId = typeof rawRunId === 'string' && rawRunId.length > 0
    ? rawRunId
    : undefined;
  if (!runId) {
    throw new Error('overnight manifest is missing a resumable runId');
  }

  const rawArtifacts = isJsonObject(parsed.artifacts) ? parsed.artifacts : {};
  const artifacts = Object.fromEntries(
    Object.entries(rawArtifacts)
      .map(([key, value]) => [key, resolveManifestArtifactPath(resolved, value)])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const rawBudgets = isJsonObject(parsed.autonomyBudgets) ? parsed.autonomyBudgets : {};

  return {
    artifacts,
    autonomyBudgets: {
      maxCostUsd: parseManifestBudget(rawBudgets.maxCostUsd, 'maxCostUsd'),
      maxIterations: parseManifestPositiveIntegerBudget(rawBudgets.maxIterations, 'maxIterations'),
      verificationTimeoutMs: parseManifestPositiveIntegerBudget(
        rawBudgets.verificationTimeoutMs,
        'verificationTimeoutMs',
      ),
    },
    autonomyPreset: parseOptionalAutonomyPreset(parsed.autonomyPreset),
    executionProfile: readManifestExecutionProfile(resolved, parsed.executionProfile),
    filePath: resolved,
    runId,
    supervision: parseManifestSupervisionSummary(parsed.supervision),
    supervisionDefaults: parseManifestSupervisionDefaults(parsed.supervisionDefaults),
  };
}

async function readSupervisionRecovery(filePath: string): Promise<LoadedSupervisionRecovery> {
  const resolved = path.resolve(filePath);
  const parsed = JSON.parse(await fs.readFile(resolved, 'utf8')) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error('--recover-from-supervision must point to a JSON object');
  }

  if (parsed.kind !== 'agentic-coding-supervision-recovery') {
    throw new Error('--recover-from-supervision must point to an agentic-coding-supervision-recovery file');
  }

  const sourceManifestPath = resolveManifestArtifactPath(resolved, parsed.sourceManifestPath);
  if (!sourceManifestPath) {
    throw new Error('supervision recovery is missing a sourceManifestPath');
  }

  const rawArtifacts = isJsonObject(parsed.artifacts) ? parsed.artifacts : {};
  const artifacts = Object.fromEntries(
    Object.entries(rawArtifacts)
      .map(([key, value]) => [key, resolveManifestArtifactPath(resolved, value)])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const rawSummary = parsed.summary;
  if (!isJsonObject(rawSummary)) {
    throw new Error('supervision recovery summary must be a JSON object');
  }
  const rawRunId = parsed.runId;

  return {
    artifacts,
    filePath: resolved,
    ...(typeof rawRunId === 'string' && rawRunId.length > 0 ? { runId: rawRunId } : {}),
    sourceManifestPath,
    summary: {
      maxErrorCycles: parseRecoveryPositiveInteger(rawSummary.maxErrorCycles, 'maxErrorCycles'),
      maxStalledCycles: parseRecoveryPositiveInteger(rawSummary.maxStalledCycles, 'maxStalledCycles'),
      requestedCycles: parseRecoveryPositiveInteger(rawSummary.requestedCycles, 'requestedCycles'),
      sleepMs: parseRecoveryNonNegativeInteger(rawSummary.sleepMs, 'sleepMs'),
    },
  };
}

async function writeOvernightManifest(
  manifestPath: string,
  input: {
    artifactPaths: Record<string, string | undefined>;
    autonomyBudgets: { maxCostUsd: number | null; maxIterations: number | null; verificationTimeoutMs: number | null };
    autonomyPreset: AutonomousCodePreset;
    checkpointPath?: string;
    executionProfile: AutonomousCodeExecutionProfile;
    fleetCollaborationProof?: AutonomousCodeRequiredFleetCollaborationProof;
    report: Awaited<ReturnType<typeof runAgenticCodingCell>>;
    runId?: string;
    supervision?: AutonomousCodeSupervisionSummary;
  },
): Promise<string> {
  const artifactPaths = Object.fromEntries(
    Object.entries(input.artifactPaths).filter(([, value]) => value !== undefined),
  );
  let previousManifest: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    if (isJsonObject(parsed)) {
      previousManifest = parsed;
    }
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  const existingArtifacts = previousManifest && isJsonObject(previousManifest.artifacts)
    ? previousManifest.artifacts
    : {};
  const previousEventsPath = resolveManifestArtifactPath(manifestPath, existingArtifacts.supervisionEventsPath);
  const nextEventsPath = resolveManifestArtifactPath(manifestPath, artifactPaths.supervisionEventsPath);
  const previousSupervision = previousManifest
    ? parseManifestSupervisionSummary(previousManifest.supervision)
    : undefined;
  const supervision = input.supervision && previousEventsPath && nextEventsPath && previousEventsPath === nextEventsPath
    ? mergeContinuedSupervisionSummary(previousSupervision, input.supervision)
    : input.supervision;
  const supervisionRequestedCycles = supervision?.requestedCycles ?? DEFAULT_OVERNIGHT_SUPERVISION_CYCLES;
  const supervisionSleepMs = supervision?.sleepMs ?? DEFAULT_OVERNIGHT_SUPERVISION_SLEEP_MS;
  const supervisionMaxStalledCycles =
    supervision?.maxStalledCycles ?? DEFAULT_OVERNIGHT_SUPERVISION_MAX_STALLED_CYCLES;
  const supervisionMaxErrorCycles =
    supervision?.maxErrorCycles ?? DEFAULT_OVERNIGHT_SUPERVISION_MAX_ERROR_CYCLES;
  const overnightReadiness = buildOvernightReadiness({
    executionProfile: input.executionProfile,
    fleetCollaborationProof: supervision?.fleetCollaborationProof ?? input.fleetCollaborationProof,
    requestedCycles: supervisionRequestedCycles,
    sleepMs: supervisionSleepMs,
    supervision,
  });
  const manifest = {
    kind: 'agentic-coding-overnight-manifest',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    autonomyPreset: input.autonomyPreset,
    autonomyBudgets: input.autonomyBudgets,
    executionProfile: input.executionProfile,
    runId: input.runId ?? null,
    checkpointPath: input.checkpointPath ?? null,
    resumeCommand: input.runId
      ? buildOvernightResumeCommand(manifestPath, input.executionProfile)
      : null,
    auditCommand: buildOvernightAuditCommand(manifestPath, overnightReadiness.ready),
    superviseCommand: input.runId
      ? buildOvernightSuperviseCommand(
        manifestPath,
        supervisionRequestedCycles,
        supervisionSleepMs,
        supervisionMaxStalledCycles,
        supervisionMaxErrorCycles,
        input.executionProfile,
        overnightReadiness.ready,
        overnightReadiness.ready,
        {
          supervisionEventsPath: artifactPaths.supervisionEventsPath,
          supervisionFleetTriagePath: artifactPaths.supervisionFleetTriagePath,
          supervisionFleetTriageResultPath: artifactPaths.supervisionFleetTriageResultPath,
          supervisionRecoveryPath: artifactPaths.supervisionRecoveryPath,
        },
      )
      : null,
    supervisionDefaults: {
      maxErrorCycles: supervisionMaxErrorCycles,
      maxStalledCycles: supervisionMaxStalledCycles,
      requestedCycles: supervisionRequestedCycles,
      sleepMs: supervisionSleepMs,
    },
    status: input.report.status,
    taskFile: input.report.taskFile,
    repo: input.report.repo,
    fleet: input.report.fleet,
    workflow: {
      activeNodeId: input.report.workflow.activeNodeId,
      status: input.report.status,
    },
    supervision: supervision ?? null,
    overnightReadiness,
    artifacts: artifactPaths,
  };

  return writeMachineReadableJsonArtifact(manifestPath, manifest);
}

async function writeOvernightManifestSupervisionSummary(
  manifestPath: string,
  input: {
    artifactPaths: Record<string, string | undefined>;
    supervision: AutonomousCodeSupervisionSummary;
  },
): Promise<string> {
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error('overnight manifest must be a JSON object');
  }

  const existingArtifacts = isJsonObject(parsed.artifacts) ? parsed.artifacts : {};
  const artifactPaths = Object.fromEntries(
    Object.entries(input.artifactPaths).filter(([, value]) => value !== undefined),
  );
  const mergedArtifacts = {
    ...existingArtifacts,
    ...artifactPaths,
  };
  const existingDefaults = isJsonObject(parsed.supervisionDefaults) ? parsed.supervisionDefaults : {};
  const executionProfile = readManifestExecutionProfile(manifestPath, parsed.executionProfile);
  const previousSupervision = parseManifestSupervisionSummary(parsed.supervision);
  const previousEventsPath = resolveManifestArtifactPath(manifestPath, existingArtifacts.supervisionEventsPath);
  const nextEventsPath = resolveManifestArtifactPath(manifestPath, mergedArtifacts.supervisionEventsPath);
  const supervision = previousEventsPath && nextEventsPath && previousEventsPath === nextEventsPath
    ? mergeContinuedSupervisionSummary(previousSupervision, input.supervision)
    : input.supervision;
  const overnightReadiness = buildOvernightReadiness({
    executionProfile,
    fleetCollaborationProof: supervision.fleetCollaborationProof,
    requestedCycles: supervision.requestedCycles,
    sleepMs: supervision.sleepMs,
    supervision,
  });
  const runId = typeof parsed.runId === 'string' && parsed.runId.length > 0
    ? parsed.runId
    : undefined;
  const manifest = {
    ...parsed,
    artifacts: mergedArtifacts,
    supervisionDefaults: {
      ...existingDefaults,
      maxErrorCycles: supervision.maxErrorCycles,
      maxStalledCycles: supervision.maxStalledCycles,
      requestedCycles: supervision.requestedCycles,
      sleepMs: supervision.sleepMs,
    },
    superviseCommand: runId
      ? buildOvernightSuperviseCommand(
        manifestPath,
        supervision.requestedCycles,
        supervision.sleepMs,
        supervision.maxStalledCycles,
        supervision.maxErrorCycles,
        executionProfile,
        overnightReadiness.ready,
        overnightReadiness.ready,
        {
          supervisionEventsPath: mergedArtifacts.supervisionEventsPath as string | undefined,
          supervisionFleetTriagePath: mergedArtifacts.supervisionFleetTriagePath as string | undefined,
          supervisionFleetTriageResultPath: mergedArtifacts.supervisionFleetTriageResultPath as string | undefined,
          supervisionRecoveryPath: mergedArtifacts.supervisionRecoveryPath as string | undefined,
        },
      )
      : parsed.superviseCommand,
    auditCommand: buildOvernightAuditCommand(manifestPath, overnightReadiness.ready),
    supervision,
    overnightReadiness,
  };

  return writeMachineReadableJsonArtifact(manifestPath, manifest);
}

export function registerAutonomousCodeCommand(program: Command): void {
  program
    .command('autonomous-code')
    .description('Run a guarded Agentic Coding Cell task contract')
    .option('--task-file <path>', 'path to an Agentic Coding Cell JSON task contract')
    .option('--audit-overnight-manifest <path>', 'audit an overnight manifest without running another supervision cycle')
    .option('--resume <runId>', 'resume a run from a checkpoint state')
    .option('--resume-from-manifest <path>', 'resume a run from an overnight manifest and reuse its diagnostic artifact paths')
    .option('--run-id <runId>', 'unique run identifier for checkpointing')
    .option('--edit-proposal-file <path>', 'path to a controlled edit proposal JSON file')
    .option('--edit-proposal-producer-dispatch-file <path>', 'write a data-only dispatch artifact for a future edit-proposal producer')
    .option('--edit-proposal-review-file <path>', 'write a compact review snapshot for a controlled edit proposal')
    .option('--generate-edit-proposal-file <path>', 'run the data-only edit-proposal producer and write a controlled proposal JSON file')
    .option('--preview-edits', 'preview declared scoped edit operations without writing files')
    .option('--apply-edits', 'apply declared scoped edit operations after preflight passes')
    .option('--require-preview', 'require a successful scoped edit preview before applying edits')
    .option('--proposal-prompt-file <path>', 'write a constrained prompt for producing an edit proposal JSON file')
    .option('--proposal-loop-file <path>', 'write a Cowork proposal loop packet with prompts, artifacts, and commands')
    .option('--proposal-loop-canvas-file <path>', 'write a ReactFlow-style canvas for the proposal loop packet')
    .option('--proposal-loop-cowork-import-file <path>', 'write a standalone Cowork import manifest for proposal-loop artifacts')
    .option('--proposal-loop-cowork-import-check-file <path>', 'write a passive artifact availability check for the Cowork import manifest')
    .option('--proposal-loop-cowork-workspace-file <path>', 'write a Cowork workspace summary from the import manifest')
    .option('--proposal-loop-next-action-file <path>', 'write a compact Cowork next-action snapshot for the proposal loop')
    .option('--proposal-loop-artifacts-dir <path>', 'materialize a non-writing Cowork proposal loop artifact bundle')
    .option('--approval-file <path>', 'write a compact Cowork approval-state JSON artifact')
    .option('--approval-decision-file <path>', 'path to a controlled Cowork approval decision JSON file')
    .option('--approval-decision-prompt-file <path>', 'write a constrained prompt for producing an approval decision JSON file')
    .option('--require-approval', 'require an approved decision file before applying scoped edits')
    .option('--require-fleet-collaboration', 'fail generated proposals unless Fleet collaboration completed at least one peer call')
    .option('--require-overnight-completion', 'fail supervised overnight runs unless the minimum window and Fleet proof actually completed')
    .option('--require-overnight-readiness', 'fail supervised overnight runs unless the window and required Fleet proof are ready')
    .option('--recover-from-supervision <path>', 'resume watchdog supervision from a supervision-recovery.json handoff')
    .option('--workflow-builder-prompt-file <path>', 'write a constrained prompt for designing a workflow canvas')
    .option('--workflow-builder-proposal-file <path>', 'path to a controlled workflow builder proposal JSON file')
    .option('--workflow-builder-proposal-canvas-file <path>', 'write a canvas JSON artifact from a validated workflow builder proposal')
    .option('--workflow-file <path>', 'write a PostCommander-style workflow canvas JSON artifact')
    .option('--workflow-events-file <path>', 'write a compact workflow event timeline JSON artifact')
    .option('--workflow-progress-file <path>', 'write a compact workflow progress snapshot JSON artifact')
    .option('--run-verification', 'run declared verification commands after preflight passes')
    .option('--verification-timeout-ms <ms>', 'timeout per verification command')
    .option('--autonomy-preset <name>', 'budget preset for autonomous runs: standard or overnight')
    .option('--overnight-manifest-file <path>', 'write an overnight run manifest with checkpoint, artifacts, and resume command')
    .option('--supervise-from-manifest <path>', 'run repeated bounded resume cycles from an overnight manifest')
    .option('--supervise-cycles <count>', 'maximum supervision cycles when using --supervise-from-manifest')
    .option('--supervision-fleet-triage-file <path>', 'write a Fleet triage handoff JSON when recoverable supervision stops with Fleet enabled')
    .option('--supervision-fleet-triage-result-file <path>', 'write the attempted Fleet triage result JSON for recoverable supervision stops')
    .option('--supervise-max-stalled-cycles <count>', 'stop supervision after the same progress state repeats this many cycles')
    .option('--supervise-max-error-cycles <count>', 'stop supervision after this many consecutive cycle errors')
    .option('--supervision-events-file <path>', 'append per-cycle supervision JSONL events when using --supervise-from-manifest')
    .option('--supervision-recovery-file <path>', 'write recovery handoff JSON when supervised manifest runs stop before a terminal status')
    .option('--supervise-sleep-ms <ms>', 'delay between supervision cycles')
    .option('--max-cost-usd <usd>', 'maximum allowed cost in USD')
    .option('--max-iterations <count>', 'maximum self-correction iterations')
    .option('--report-file <path>', 'write the JSON report to a file')
    .option('--json', 'output JSON')
    .action(async (options: AutonomousCodeOptions) => {
      try {
        const dotenv = await import('dotenv');
        dotenv.config();

        if (options.auditOvernightManifest) {
          if (
            options.taskFile
            || options.resume
            || options.resumeFromManifest
            || options.recoverFromSupervision
            || options.superviseFromManifest
            || options.runId
          ) {
            throw new Error('--audit-overnight-manifest cannot be combined with task, resume, or supervision modes');
          }
          const auditManifest = await readOvernightManifest(options.auditOvernightManifest);
          const audit = await buildOvernightManifestAudit(auditManifest);
          if (options.requireOvernightReadiness) {
            assertOvernightReadiness(audit.overnightReadiness);
          }
          if (options.requireOvernightCompletion) {
            assertOvernightAuditCompletion(audit);
          }
          if (options.json) {
            console.log(JSON.stringify(audit, null, 2));
            return;
          }

          console.log(renderOvernightManifestAudit(audit));
          return;
        }

        const supervisionRecoverySource = options.recoverFromSupervision
          ? await readSupervisionRecovery(options.recoverFromSupervision)
          : undefined;
        if (supervisionRecoverySource && options.superviseFromManifest
          && path.resolve(options.superviseFromManifest) !== supervisionRecoverySource.sourceManifestPath) {
          throw new Error('--supervise-from-manifest must match the sourceManifestPath in --recover-from-supervision');
        }
        const supervisorManifestFile = options.superviseFromManifest
          ? path.resolve(options.superviseFromManifest)
          : supervisionRecoverySource?.sourceManifestPath;
        const supervisionModeFlag = supervisionRecoverySource
          ? '--recover-from-supervision'
          : '--supervise-from-manifest';
        if ((options.superviseCycles || options.supervisionFleetTriageFile || options.supervisionFleetTriageResultFile
          || options.superviseMaxErrorCycles || options.superviseMaxStalledCycles
          || options.supervisionEventsFile || options.supervisionRecoveryFile || options.superviseSleepMs
          || options.requireOvernightCompletion || options.requireOvernightReadiness)
          && !supervisorManifestFile) {
          throw new Error('--supervise-cycles, --supervision-fleet-triage-file, --supervision-fleet-triage-result-file, --supervise-max-error-cycles, --supervise-max-stalled-cycles, --supervision-events-file, --supervision-recovery-file, --supervise-sleep-ms, --require-overnight-completion, and --require-overnight-readiness require --supervise-from-manifest or --recover-from-supervision');
        }
        if (supervisorManifestFile && options.taskFile) {
          throw new Error(`${supervisionModeFlag} cannot be combined with --task-file`);
        }
        if (supervisorManifestFile && options.resume) {
          throw new Error(`${supervisionModeFlag} cannot be combined with --resume`);
        }
        if (supervisorManifestFile && options.runId) {
          throw new Error(`${supervisionModeFlag} cannot be combined with --run-id`);
        }
        if (supervisorManifestFile && options.generateEditProposalFile) {
          throw new Error(`${supervisionModeFlag} cannot be combined with --generate-edit-proposal-file`);
        }
        if (supervisorManifestFile && options.resumeFromManifest
          && path.resolve(options.resumeFromManifest) !== supervisorManifestFile) {
          throw new Error(`--resume-from-manifest must match ${supervisionModeFlag} when both are provided`);
        }
        const effectiveResumeManifestFile = options.resumeFromManifest ?? supervisorManifestFile;
        const resumeManifest = effectiveResumeManifestFile
          ? await readOvernightManifest(effectiveResumeManifestFile)
          : undefined;
        if (supervisionRecoverySource?.runId && resumeManifest?.runId
          && supervisionRecoverySource.runId !== resumeManifest.runId) {
          throw new Error('supervision recovery runId must match the source overnight manifest runId');
        }
        const manifestExecutionProfile = resumeManifest?.executionProfile ?? {};
        const supervisionRequestedCycles = supervisorManifestFile
          ? parsePositiveIntegerOption(options.superviseCycles, '--supervise-cycles')
            ?? supervisionRecoverySource?.summary.requestedCycles
            ?? DEFAULT_OVERNIGHT_SUPERVISION_CYCLES
          : 1;
        const supervisionSleepMs = supervisorManifestFile
          ? parseNonNegativeIntegerOption(options.superviseSleepMs, '--supervise-sleep-ms')
            ?? supervisionRecoverySource?.summary.sleepMs
            ?? DEFAULT_OVERNIGHT_SUPERVISION_SLEEP_MS
          : 0;
        const supervisionMaxStalledCycles = supervisorManifestFile
          ? parsePositiveIntegerOption(options.superviseMaxStalledCycles, '--supervise-max-stalled-cycles')
            ?? supervisionRecoverySource?.summary.maxStalledCycles
            ?? DEFAULT_OVERNIGHT_SUPERVISION_MAX_STALLED_CYCLES
          : 0;
        const supervisionMaxErrorCycles = supervisorManifestFile
          ? parsePositiveIntegerOption(options.superviseMaxErrorCycles, '--supervise-max-error-cycles')
            ?? supervisionRecoverySource?.summary.maxErrorCycles
            ?? DEFAULT_OVERNIGHT_SUPERVISION_MAX_ERROR_CYCLES
          : 0;
        const manifestResumeRunId = resumeManifest?.runId;
        if (options.resume && manifestResumeRunId && options.resume !== manifestResumeRunId) {
          throw new Error('--resume must match the runId stored in --resume-from-manifest');
        }
        if (options.runId && manifestResumeRunId && options.runId !== manifestResumeRunId) {
          throw new Error('--run-id must match the runId stored in --resume-from-manifest');
        }
        const effectiveResume = options.resume ?? manifestResumeRunId;

        if (!options.taskFile && !effectiveResume) {
          throw new Error('Either --task-file, --resume, or --resume-from-manifest must be provided.');
        }

        if (options.generateEditProposalFile && (options.editProposalFile || manifestExecutionProfile.editProposalFile)) {
          throw new Error('--generate-edit-proposal-file cannot be combined with --edit-proposal-file');
        }
        const effectiveRequireFleetCollaboration =
          options.requireFleetCollaboration ?? manifestExecutionProfile.requireFleetCollaboration ?? false;
        const effectiveEditProposalFile = options.editProposalFile ?? manifestExecutionProfile.editProposalFile;
        if (effectiveRequireFleetCollaboration && !options.generateEditProposalFile && !effectiveEditProposalFile) {
          throw new Error('--require-fleet-collaboration requires --generate-edit-proposal-file or --edit-proposal-file');
        }

        const autonomyPreset = parseAutonomyPreset(options.autonomyPreset ?? resumeManifest?.autonomyPreset);
        const presetDefaults = AUTONOMOUS_CODE_PRESET_DEFAULTS[autonomyPreset];
        const manifestBudgetDefaults = resumeManifest?.autonomyBudgets ?? {};
        const effectiveRunId = options.runId
          ?? effectiveResume
          ?? (autonomyPreset === 'overnight' ? createOvernightRunId() : undefined);
        const effectiveEditProposalProducerDispatchFile =
          options.editProposalProducerDispatchFile ?? manifestExecutionProfile.editProposalProducerDispatchFile;
        const runOptions: AgenticCodingRunOptions = {
          applyEdits: options.applyEdits ?? manifestExecutionProfile.applyEdits,
          approvalDecisionFile: options.approvalDecisionFile ?? manifestExecutionProfile.approvalDecisionFile,
          editProposalFile: options.editProposalFile ?? manifestExecutionProfile.editProposalFile,
          previewEdits: options.previewEdits ?? manifestExecutionProfile.previewEdits,
          requireApproval: options.requireApproval ?? manifestExecutionProfile.requireApproval,
          requirePreview: options.requirePreview ?? manifestExecutionProfile.requirePreview,
          runVerification: options.runVerification ?? manifestExecutionProfile.runVerification,
          taskFile: options.taskFile,
          verificationTimeoutMs: parseTimeout(options.verificationTimeoutMs)
            ?? manifestBudgetDefaults.verificationTimeoutMs
            ?? presetDefaults.verificationTimeoutMs
            ?? 120000,
          workflowBuilderProposalFile:
            options.workflowBuilderProposalFile ?? manifestExecutionProfile.workflowBuilderProposalFile,
          resume: effectiveResume,
          runId: effectiveRunId,
          maxCostUsd: parseNonNegativeNumberOption(options.maxCostUsd, '--max-cost-usd')
            ?? manifestBudgetDefaults.maxCostUsd
            ?? presetDefaults.maxCostUsd,
          maxIterations: parsePositiveIntegerOption(options.maxIterations, '--max-iterations')
            ?? manifestBudgetDefaults.maxIterations
            ?? presetDefaults.maxIterations,
        };
        let fleetCollaborationProof: AutonomousCodeRequiredFleetCollaborationProof | undefined;
        if (effectiveRequireFleetCollaboration && !options.generateEditProposalFile) {
          const producerTracePath = resumeManifest?.artifacts.editProposalProducerTracePath
            ?? getDefaultEditProposalProducerTracePath(effectiveEditProposalFile);
          if (!producerTracePath) {
            throw new Error('--require-fleet-collaboration requires an edit-proposal-producer-trace.json artifact');
          }
          fleetCollaborationProof = await assertRequiredFleetCollaborationFromFile(producerTracePath);
        }
        const supervisionExecutionProfile = buildOvernightExecutionProfile(
          options,
          undefined,
          manifestExecutionProfile,
        );
        if (supervisorManifestFile && options.requireOvernightReadiness) {
          assertOvernightReadiness(buildOvernightReadiness({
            executionProfile: supervisionExecutionProfile,
            fleetCollaborationProof,
            requestedCycles: supervisionRequestedCycles,
            sleepMs: supervisionSleepMs,
          }));
        }
        const autonomyBudgets = summarizeAutonomyBudgets(runOptions);
        const checkpointPath = effectiveRunId ? getCheckpointPath(effectiveRunId) : undefined;
        const runArtifactDir = checkpointPath ? path.dirname(checkpointPath) : undefined;
        const supervisionEventsPath = supervisorManifestFile
          ? path.resolve(
            options.supervisionEventsFile
              ?? supervisionRecoverySource?.artifacts.supervisionEventsPath
              ?? resumeManifest?.artifacts.supervisionEventsPath
              ?? path.join(path.dirname(supervisorManifestFile), 'supervision-events.jsonl'),
          )
          : undefined;
        const supervisionRecoveryFile = supervisorManifestFile
          ? path.resolve(
            options.supervisionRecoveryFile
              ?? supervisionRecoverySource?.filePath
              ?? resumeManifest?.artifacts.supervisionRecoveryPath
              ?? path.join(path.dirname(supervisorManifestFile), 'supervision-recovery.json'),
          )
          : undefined;
        const supervisionFleetTriageFile = supervisorManifestFile && supervisionRecoveryFile
          ? path.resolve(
            options.supervisionFleetTriageFile
              ?? supervisionRecoverySource?.artifacts.supervisionFleetTriagePath
              ?? resumeManifest?.artifacts.supervisionFleetTriagePath
              ?? path.join(path.dirname(supervisionRecoveryFile), 'supervision-fleet-triage.json'),
          )
          : undefined;
        const supervisionFleetTriageResultFile = supervisorManifestFile && supervisionRecoveryFile
          ? path.resolve(
            options.supervisionFleetTriageResultFile
              ?? supervisionRecoverySource?.artifacts.supervisionFleetTriageResultPath
              ?? resumeManifest?.artifacts.supervisionFleetTriageResultPath
              ?? path.join(path.dirname(supervisionRecoveryFile), 'supervision-fleet-triage-result.json'),
          )
          : undefined;

        let report: AgenticCodingRunReport | undefined;
        let supervisionFleetTriagePath: string | undefined;
        let supervisionFleetTriageResultPath: string | undefined;
        let supervisionRecoveryPath: string | undefined;
        const supervisionCycles: AutonomousCodeSupervisionCycle[] = [];
        let supervisionStoppedReason: AutonomousCodeSupervisionSummary['stoppedReason'] = 'cycle_limit';
        const buildSupervisionSummary = (sourceManifestPath: string): AutonomousCodeSupervisionSummary => ({
          completedCycles: supervisionCycles.length,
          cycles: supervisionCycles,
          ...(fleetCollaborationProof ? { fleetCollaborationProof } : {}),
          maxErrorCycles: supervisionMaxErrorCycles,
          maxStalledCycles: supervisionMaxStalledCycles,
          requestedCycles: supervisionRequestedCycles,
          sleepMs: supervisionSleepMs,
          sourceManifestPath,
          stoppedReason: supervisionStoppedReason,
        });
        if (supervisorManifestFile) {
          if (!supervisionEventsPath) {
            throw new Error('internal error: supervision events path was not resolved');
          }
          let previousProgressSignature: string | undefined;
          let stalledCycles = 0;
          let consecutiveErrorCycles = 0;
          let lastSupervisionError: string | undefined;

          for (let cycle = 1; cycle <= supervisionRequestedCycles; cycle += 1) {
            if (cycle > 1 && supervisionSleepMs > 0) {
              await sleep(supervisionSleepMs);
            }

            try {
              report = await runAgenticCodingCell(runOptions);
              consecutiveErrorCycles = 0;
              const progressSignature = buildSupervisionProgressSignature(report);
              stalledCycles = progressSignature === previousProgressSignature ? stalledCycles + 1 : 1;
              previousProgressSignature = progressSignature;
              const timestamp = new Date();
              const stoppedReason = isAutonomousSupervisionTerminal(report.status)
                ? 'terminal_status'
                : stalledCycles >= supervisionMaxStalledCycles
                  ? 'stalled'
                  : cycle === supervisionRequestedCycles
                    ? 'cycle_limit'
                    : undefined;
              const supervisionCycle: AutonomousCodeSupervisionCycle = {
                consecutiveErrorCycles,
                index: cycle,
                nextCycleAt: buildSupervisionNextCycleAt({
                  cycle,
                  requestedCycles: supervisionRequestedCycles,
                  sleepMs: supervisionSleepMs,
                  stoppedReason,
                  timestamp,
                }),
                progressSignature,
                runId: effectiveRunId,
                stalledCycles,
                status: report.status,
                timestamp: timestamp.toISOString(),
              };
              supervisionCycles.push(supervisionCycle);
              if (stoppedReason) {
                supervisionStoppedReason = stoppedReason;
              }
              await appendSupervisionCycleEvent(supervisionEventsPath, {
                fleet: buildSupervisionFleetSnapshot(report),
                ...(fleetCollaborationProof ? { fleetCollaborationProof } : {}),
                kind: 'agentic-coding-supervision-cycle',
                maxErrorCycles: supervisionMaxErrorCycles,
                maxStalledCycles: supervisionMaxStalledCycles,
                schemaVersion: 1,
                cycle: supervisionCycle,
                requestedCycles: supervisionRequestedCycles,
                sleepMs: supervisionSleepMs,
                sourceManifestPath: supervisorManifestFile,
                stoppedReason,
              });

              if (stoppedReason && stoppedReason !== 'cycle_limit') {
                break;
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              lastSupervisionError = errorMessage;
              consecutiveErrorCycles += 1;
              stalledCycles = 0;
              const progressSignature = buildSupervisionErrorSignature(errorMessage);
              previousProgressSignature = progressSignature;
              const timestamp = new Date();
              const stoppedReason = consecutiveErrorCycles >= supervisionMaxErrorCycles
                ? 'cycle_error_limit'
                : cycle === supervisionRequestedCycles
                  ? 'cycle_limit'
                  : undefined;
              const supervisionCycle: AutonomousCodeSupervisionCycle = {
                consecutiveErrorCycles,
                error: errorMessage,
                index: cycle,
                nextCycleAt: buildSupervisionNextCycleAt({
                  cycle,
                  requestedCycles: supervisionRequestedCycles,
                  sleepMs: supervisionSleepMs,
                  stoppedReason,
                  timestamp,
                }),
                progressSignature,
                runId: effectiveRunId,
                stalledCycles,
                status: 'cycle_error',
                timestamp: timestamp.toISOString(),
              };
              supervisionCycles.push(supervisionCycle);
              if (stoppedReason) {
                supervisionStoppedReason = stoppedReason;
              }
              await appendSupervisionCycleEvent(supervisionEventsPath, {
                ...(fleetCollaborationProof ? { fleetCollaborationProof } : {}),
                kind: 'agentic-coding-supervision-cycle',
                maxErrorCycles: supervisionMaxErrorCycles,
                maxStalledCycles: supervisionMaxStalledCycles,
                schemaVersion: 1,
                cycle: supervisionCycle,
                requestedCycles: supervisionRequestedCycles,
                sleepMs: supervisionSleepMs,
                sourceManifestPath: supervisorManifestFile,
                stoppedReason,
              });

              if (stoppedReason && stoppedReason !== 'cycle_limit') {
                break;
              }
            }
          }

          if (!report) {
            const supervision = buildSupervisionSummary(supervisorManifestFile);
            if (!supervisionRecoveryFile) {
              throw new Error('internal error: supervision recovery path was not resolved');
            }
            supervisionRecoveryPath = await writeSupervisionRecoveryArtifact(supervisionRecoveryFile, {
              artifactPaths: {
                supervisionEventsPath,
                supervisionRecoveryPath: supervisionRecoveryFile,
              },
              executionProfile: supervisionExecutionProfile,
              overnightReadiness: buildOvernightReadiness({
                executionProfile: supervisionExecutionProfile,
                fleetCollaborationProof,
                requestedCycles: supervision.requestedCycles,
                sleepMs: supervision.sleepMs,
                supervision,
              }),
              runId: effectiveRunId,
              sourceManifestPath: supervisorManifestFile,
              supervision,
            });
            await writeOvernightManifestSupervisionSummary(supervisorManifestFile, {
              artifactPaths: {
                supervisionEventsPath,
                supervisionRecoveryPath,
              },
              supervision,
            });
            throw new Error(
              `supervision failed before producing a report: ${lastSupervisionError ?? 'unknown cycle error'}`,
            );
          }
        } else {
          report = await runAgenticCodingCell(runOptions);
        }
        const supervisionSummary: AutonomousCodeSupervisionSummary | undefined = supervisorManifestFile
          ? buildSupervisionSummary(supervisorManifestFile)
          : undefined;
        let editProposalProducerDispatchPath: string | undefined;
        let editProposalProducerTracePath: string | undefined;
        let generatedEditProposalPath: string | undefined;

        if (options.generateEditProposalFile) {
          const resolvedProposalFile = path.resolve(options.generateEditProposalFile);
          const proposalDir = path.dirname(resolvedProposalFile);
          const resolvedDispatchFile = effectiveEditProposalProducerDispatchFile
            ? path.resolve(effectiveEditProposalProducerDispatchFile)
            : path.join(proposalDir, 'edit-proposal-producer-dispatch.json');
          const artifacts = {
            ...deriveAgenticCodingProposalLoopArtifacts(path.join(proposalDir, 'proposal-loop.json')),
            editProposalFile: resolvedProposalFile,
            editProposalProducerDispatchFile: resolvedDispatchFile,
          };
          const dispatch = buildAgenticCodingEditProposalProducerDispatch(report, artifacts);
          if (effectiveEditProposalProducerDispatchFile) {
            await fs.mkdir(path.dirname(resolvedDispatchFile), { recursive: true });
            await persistRunArtifact(resolvedDispatchFile, `${JSON.stringify(dispatch, null, 2)}\n`);
            editProposalProducerDispatchPath = resolvedDispatchFile;
          }
          const { generateEditProposalWithTrace } = await import('../../agent/autonomous/edit-proposal-producer.js');
          const generated = await generateEditProposalWithTrace(dispatch);
          editProposalProducerTracePath = path.join(proposalDir, 'edit-proposal-producer-trace.json');
          await fs.mkdir(proposalDir, { recursive: true });
          await persistRunArtifact(editProposalProducerTracePath, `${JSON.stringify(generated.trace, null, 2)}\n`);
          if (effectiveRequireFleetCollaboration) {
            fleetCollaborationProof = assertRequiredFleetCollaboration(generated.trace, editProposalProducerTracePath);
          }
          await persistRunArtifact(resolvedProposalFile, `${JSON.stringify(generated.proposal, null, 2)}\n`);
          generatedEditProposalPath = resolvedProposalFile;

          if (options.previewEdits || options.applyEdits || options.runVerification) {
            report = await runAgenticCodingCell({
              ...runOptions,
              editProposalFile: resolvedProposalFile,
            });
          }
        } else {
          editProposalProducerDispatchPath = effectiveEditProposalProducerDispatchFile
            ? await writeAgenticCodingEditProposalProducerDispatch(report, effectiveEditProposalProducerDispatchFile)
            : undefined;
        }

        const reportFile = options.reportFile
          ?? resumeManifest?.artifacts.reportPath
          ?? (autonomyPreset === 'overnight' && runArtifactDir
            ? path.join(runArtifactDir, 'report.json')
            : undefined);
        const reportPath = reportFile
          ? await writeAgenticCodingRunReport(report, reportFile)
          : undefined;
        const approvalPath = options.approvalFile
          ? await writeAgenticCodingApprovalSnapshot(report, options.approvalFile)
          : undefined;
        const editProposalReviewPath = options.editProposalReviewFile
          ? await writeAgenticCodingEditProposalReviewSnapshot(report, options.editProposalReviewFile)
          : undefined;
        const approvalDecisionPromptPath = options.approvalDecisionPromptFile
          ? await writeAgenticCodingApprovalDecisionPrompt(report, options.approvalDecisionPromptFile)
          : undefined;
        const proposalPromptPath = options.proposalPromptFile
          ? await writeAgenticCodingEditProposalPrompt(report, options.proposalPromptFile, {
            includeDirtyFiles: true,
          })
          : undefined;
        const proposalLoopPath = options.proposalLoopFile
          ? await writeAgenticCodingProposalLoopSnapshot(report, options.proposalLoopFile)
          : undefined;
        const proposalLoopCanvasPath = options.proposalLoopCanvasFile
          ? await writeAgenticCodingProposalLoopCanvas(report, options.proposalLoopCanvasFile)
          : undefined;
        const proposalLoopNextActionPath = options.proposalLoopNextActionFile
          ? await writeAgenticCodingProposalLoopNextActionSnapshot(report, options.proposalLoopNextActionFile)
          : undefined;
        const proposalLoopArtifactsPath = options.proposalLoopArtifactsDir
          ? await writeAgenticCodingProposalLoopArtifactBundle(report, options.proposalLoopArtifactsDir)
          : undefined;
        const proposalLoopCoworkImportPath = options.proposalLoopCoworkImportFile
          ? await writeAgenticCodingProposalLoopCoworkImport(report, options.proposalLoopCoworkImportFile)
          : undefined;
        if (options.proposalLoopCoworkImportCheckFile && !proposalLoopCoworkImportPath) {
          throw new Error('--proposal-loop-cowork-import-check-file requires --proposal-loop-cowork-import-file');
        }
        const proposalLoopCoworkImportCheckPath = options.proposalLoopCoworkImportCheckFile && proposalLoopCoworkImportPath
          ? await writeAgenticCodingProposalLoopCoworkImportCheck(
            proposalLoopCoworkImportPath,
            options.proposalLoopCoworkImportCheckFile,
          )
          : undefined;
        if (options.proposalLoopCoworkWorkspaceFile && !proposalLoopCoworkImportPath) {
          throw new Error('--proposal-loop-cowork-workspace-file requires --proposal-loop-cowork-import-file');
        }
        const proposalLoopCoworkWorkspacePath = options.proposalLoopCoworkWorkspaceFile && proposalLoopCoworkImportPath
          ? await writeAgenticCodingProposalLoopCoworkWorkspace(
            proposalLoopCoworkImportPath,
            options.proposalLoopCoworkWorkspaceFile,
          )
          : undefined;
        const workflowPath = options.workflowFile
          ? await writeAgenticCodingWorkflowCanvas(report, options.workflowFile)
          : undefined;
        const workflowBuilderPromptPath = options.workflowBuilderPromptFile
          ? await writeAgenticCodingWorkflowBuilderPrompt(report, options.workflowBuilderPromptFile, {
            includeCurrentCanvas: true,
          })
          : undefined;
        const workflowBuilderProposalCanvasPath = options.workflowBuilderProposalCanvasFile
          ? await writeAgenticCodingWorkflowBuilderProposalCanvas(
            report,
            options.workflowBuilderProposalCanvasFile,
          )
          : undefined;
        const workflowProgressFile = options.workflowProgressFile
          ?? resumeManifest?.artifacts.workflowProgressPath
          ?? (autonomyPreset === 'overnight' && runArtifactDir
            ? path.join(runArtifactDir, 'workflow-progress.json')
            : undefined);
        const workflowProgressPath = workflowProgressFile
          ? await writeAgenticCodingWorkflowProgressSnapshot(report, workflowProgressFile)
          : undefined;
        const workflowEventsFile = options.workflowEventsFile
          ?? resumeManifest?.artifacts.workflowEventsPath
          ?? (autonomyPreset === 'overnight' && runArtifactDir
            ? path.join(runArtifactDir, 'workflow-events.json')
            : undefined);
        const workflowEventsPath = workflowEventsFile
          ? await writeAgenticCodingWorkflowEventsSnapshot(report, workflowEventsFile)
          : undefined;
        const overnightExecutionProfile = buildOvernightExecutionProfile(
          options,
          generatedEditProposalPath,
          manifestExecutionProfile,
        );
        const overnightReadiness = buildOvernightReadiness({
          executionProfile: overnightExecutionProfile,
          fleetCollaborationProof,
          requestedCycles: supervisionSummary?.requestedCycles ?? DEFAULT_OVERNIGHT_SUPERVISION_CYCLES,
          sleepMs: supervisionSummary?.sleepMs ?? DEFAULT_OVERNIGHT_SUPERVISION_SLEEP_MS,
          supervision: supervisionSummary,
        });
        if (supervisorManifestFile && supervisionSummary && supervisionRecoveryFile) {
          const supervisionFleet = buildSupervisionFleetSnapshot(report);
          const recoveryArtifactPaths = {
            editProposalProducerDispatchPath,
            editProposalProducerTracePath,
            generatedEditProposalPath,
            reportPath,
            supervisionEventsPath,
            supervisionRecoveryPath: supervisionRecoveryFile,
            workflowEventsPath,
            workflowProgressPath,
          };
          const supervisionFleetTriage = buildSupervisionFleetTriageArtifact({
            artifactPaths: recoveryArtifactPaths,
            fleet: supervisionFleet,
            overnightReadiness,
            recoveryPath: supervisionRecoveryFile,
            runId: effectiveRunId,
            sourceManifestPath: supervisorManifestFile,
            supervision: supervisionSummary,
          });
          if (supervisionFleetTriageFile && supervisionFleetTriage) {
            supervisionFleetTriagePath = await writeMachineReadableJsonArtifact(
              supervisionFleetTriageFile,
              supervisionFleetTriage,
            );
            supervisionFleetTriageResultPath = supervisionFleetTriageResultFile
              ? await writeSupervisionFleetTriageResultArtifact(
                supervisionFleetTriageResultFile,
                supervisionFleetTriagePath,
                supervisionFleetTriage,
              )
              : undefined;
          }
          supervisionRecoveryPath = await writeSupervisionRecoveryArtifact(supervisionRecoveryFile, {
            artifactPaths: {
              ...recoveryArtifactPaths,
              supervisionFleetTriagePath,
              supervisionFleetTriageResultPath,
            },
            executionProfile: overnightExecutionProfile,
            fleet: supervisionFleet,
            overnightReadiness,
            runId: effectiveRunId,
            sourceManifestPath: supervisorManifestFile,
            supervision: supervisionSummary,
          });
        }
        const overnightManifestPath = await (async (): Promise<string | undefined> => {
          const manifestPath = getOvernightManifestPath(
            options,
            autonomyPreset,
            checkpointPath,
            effectiveResumeManifestFile,
          );
          if (!manifestPath) {
            return undefined;
          }

          return writeOvernightManifest(manifestPath, {
            artifactPaths: {
              approvalDecisionPromptPath,
              approvalPath,
              editProposalProducerDispatchPath,
              editProposalProducerTracePath,
              editProposalReviewPath,
              generatedEditProposalPath,
              proposalLoopArtifactsPath,
              proposalLoopCanvasPath,
              proposalLoopCoworkImportCheckPath,
              proposalLoopCoworkImportPath,
              proposalLoopCoworkWorkspacePath,
              proposalLoopNextActionPath,
              proposalLoopPath,
              proposalPromptPath,
              reportPath,
              supervisionEventsPath,
              supervisionFleetTriagePath,
              supervisionFleetTriageResultPath,
              supervisionRecoveryPath,
              workflowBuilderPromptPath,
              workflowBuilderProposalCanvasPath,
              workflowEventsPath,
              workflowPath,
              workflowProgressPath,
            },
            autonomyBudgets,
            autonomyPreset,
            checkpointPath,
            executionProfile: overnightExecutionProfile,
            fleetCollaborationProof,
            report,
            runId: effectiveRunId,
            supervision: supervisionSummary,
          });
        })();
        if (supervisorManifestFile && options.requireOvernightCompletion) {
          assertOvernightCompletion(overnightReadiness);
        }

        if (['blocked', 'validation_failed', 'verification_failed'].includes(report.status)) {
          process.exitCode = 1;
        }

        if (options.json) {
          console.log(JSON.stringify({
            ...report,
            autonomyBudgets,
            autonomyPreset,
            approvalDecisionPromptPath,
            approvalPath,
            checkpointPath,
            editProposalProducerDispatchPath,
            editProposalProducerTracePath,
            editProposalReviewPath,
            generatedEditProposalPath,
            overnightManifestPath,
            overnightReadiness,
            proposalLoopArtifactsPath,
            proposalLoopCanvasPath,
            proposalLoopCoworkImportCheckPath,
            proposalLoopCoworkImportPath,
            proposalLoopCoworkWorkspacePath,
            proposalLoopNextActionPath,
            proposalLoopPath,
            proposalPromptPath,
            reportPath,
            runId: effectiveRunId,
            supervision: supervisionSummary,
            supervisionEventsPath,
            supervisionFleetTriagePath,
            supervisionFleetTriageResultPath,
            supervisionRecoverySourcePath: supervisionRecoverySource?.filePath,
            supervisionRecoveryPath,
            workflowBuilderPromptPath,
            workflowBuilderProposalCanvasPath,
            workflowEventsPath,
            workflowPath,
            workflowProgressPath,
          }, null, 2));
          return;
        }

        console.log(renderAgenticCodingRunReport(report));
        console.log(
          `\nAutonomy preset: ${autonomyPreset} `
          + `(maxIterations=${autonomyBudgets.maxIterations ?? 'default'}, `
          + `maxCostUsd=${autonomyBudgets.maxCostUsd ?? 'default'}, `
          + `verificationTimeoutMs=${autonomyBudgets.verificationTimeoutMs ?? 'default'})`,
        );
        if (effectiveRunId) {
          console.log(`Resume run ID: ${effectiveRunId}`);
          console.log(`Checkpoint path: ${checkpointPath}`);
        }
        if (overnightManifestPath) {
          console.log(`Overnight manifest written: ${overnightManifestPath}`);
        }
        if (supervisionSummary) {
          console.log(
            `Supervision cycles: ${supervisionSummary.completedCycles}/${supervisionSummary.requestedCycles} `
            + `(${supervisionSummary.stoppedReason})`,
          );
          if (supervisionRecoverySource) {
            console.log(`Supervision recovery source: ${supervisionRecoverySource.filePath}`);
          }
          console.log(`Supervision events: ${supervisionEventsPath}`);
          if (supervisionFleetTriagePath) {
            console.log(`Supervision Fleet triage: ${supervisionFleetTriagePath}`);
          }
          if (supervisionFleetTriageResultPath) {
            console.log(`Supervision Fleet triage result: ${supervisionFleetTriageResultPath}`);
          }
          if (supervisionRecoveryPath) {
            console.log(`Supervision recovery: ${supervisionRecoveryPath}`);
          }
        }
        if (proposalPromptPath) {
          console.log(`\nProposal prompt written: ${proposalPromptPath}`);
        }
        if (proposalLoopPath) {
          console.log(`\nProposal loop packet written: ${proposalLoopPath}`);
        }
        if (proposalLoopCanvasPath) {
          console.log(`\nProposal loop canvas written: ${proposalLoopCanvasPath}`);
        }
        if (proposalLoopNextActionPath) {
          console.log(`\nProposal loop next-action snapshot written: ${proposalLoopNextActionPath}`);
        }
        if (proposalLoopArtifactsPath) {
          console.log(`\nProposal loop artifact bundle written: ${proposalLoopArtifactsPath}`);
        }
        if (proposalLoopCoworkImportPath) {
          console.log(`\nProposal loop Cowork import manifest written: ${proposalLoopCoworkImportPath}`);
        }
        if (proposalLoopCoworkImportCheckPath) {
          console.log(`\nProposal loop Cowork import check written: ${proposalLoopCoworkImportCheckPath}`);
        }
        if (proposalLoopCoworkWorkspacePath) {
          console.log(`\nProposal loop Cowork workspace written: ${proposalLoopCoworkWorkspacePath}`);
        }
        if (approvalPath) {
          console.log(`\nApproval state written: ${approvalPath}`);
        }
        if (editProposalReviewPath) {
          console.log(`\nEdit proposal review written: ${editProposalReviewPath}`);
        }
        if (editProposalProducerDispatchPath) {
          console.log(`\nEdit proposal producer dispatch written: ${editProposalProducerDispatchPath}`);
        }
        if (editProposalProducerTracePath) {
          console.log(`\nEdit proposal producer trace written: ${editProposalProducerTracePath}`);
        }
        if (generatedEditProposalPath) {
          console.log(`\nGenerated edit proposal written: ${generatedEditProposalPath}`);
        }
        if (approvalDecisionPromptPath) {
          console.log(`\nApproval decision prompt written: ${approvalDecisionPromptPath}`);
        }
        if (reportPath) {
          console.log(`\nReport written: ${reportPath}`);
        }
        if (workflowPath) {
          console.log(`\nWorkflow canvas written: ${workflowPath}`);
        }
        if (workflowBuilderPromptPath) {
          console.log(`\nWorkflow builder prompt written: ${workflowBuilderPromptPath}`);
        }
        if (workflowBuilderProposalCanvasPath) {
          console.log(`\nWorkflow builder proposal canvas written: ${workflowBuilderProposalCanvasPath}`);
        }
        if (workflowProgressPath) {
          console.log(`\nWorkflow progress snapshot written: ${workflowProgressPath}`);
        }
        if (workflowEventsPath) {
          console.log(`\nWorkflow events snapshot written: ${workflowEventsPath}`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
