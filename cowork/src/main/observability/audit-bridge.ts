/**
 * AuditBridge — Claude Cowork parity Phase 3 step 10
 *
 * Wraps the core RunStore (`src/observability/run-store.ts`) so the Cowork
 * renderer can list recent runs, inspect individual event streams, and
 * export a flat CSV of the currently filtered runs. Reading is lazy:
 * the core module is only loaded when the renderer requests data.
 *
 * @module main/observability/audit-bridge
 */

import { log, logWarn } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export interface AuditRunFilter {
  limit?: number;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  sessionId?: string;
  sinceTs?: number;
  sources?: string[];
  untilTs?: number;
}

export interface AuditRunSummary {
  runId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  eventCount: number;
  artifactCount: number;
  channel?: string;
  sessionId?: string;
  source?: string;
  platform?: string;
  origin?: string;
  userId?: string;
  tags?: string[];
  totalCost?: number;
  totalTokens?: number;
  toolCallCount?: number;
}

export interface AuditRunEvent {
  ts: number;
  type: string;
  runId: string;
  data: Record<string, unknown>;
}

export interface AuditProofLedgerEntry {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'proof_ledger_entry';
  status: 'proven' | 'incomplete' | 'failed';
  summary: string;
  run: {
    artifactCount: number;
    eventCount: number;
    objective: string;
    runId: string;
    source?: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    tags: string[];
  };
  privacy: {
    artifactContentIncluded: false;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  tests: {
    failed: number;
    passed: number;
    total: number;
  };
  artifacts: Array<{
    kind: string;
    name: string;
  }>;
  filesChanged: string[];
  risks: Array<{
    detail: string;
    level: 'low' | 'medium' | 'high';
    source: string;
  }>;
}

export interface AuditRunDetail extends AuditRunSummary {
  events: AuditRunEvent[];
  metrics: Record<string, number>;
  artifacts: string[];
  proofLedger?: AuditProofLedgerEntry;
}

export interface AuditRunSearchFilter {
  cwd?: string;
  includeSnapshot?: boolean;
  includeLessons?: boolean;
  includeMemories?: boolean;
  includeSessions?: boolean;
  query?: string;
  limit?: number;
  maxMemories?: number;
  maxMatchesPerRun?: number;
  maxLessons?: number;
  maxSessions?: number;
  sources?: string[];
}

export interface AuditRunSearchResult {
  runId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  matched: 'artifact' | 'event' | 'summary';
  score: number;
  snippet: string;
  artifact?: string;
  eventType?: string;
  source?: string;
}

export interface AuditRunSearchResponse {
  schemaVersion: 1;
  generatedAt: string;
  query: string;
  filters: {
    limit: number;
    sources: string[];
  };
  count: number;
  results: AuditRunSearchResult[];
}

export interface AuditRunRecallPackResponse extends AuditRunSearchResponse {
  filters: AuditRunSearchResponse['filters'] & {
    maxMemories: number;
    maxMatchesPerRun: number;
    maxLessons: number;
    maxSessions: number;
  };
  lessonCount: number;
  lessons: Array<{
    category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
    content: string;
    context?: string;
    createdAt: number;
    id: string;
    source: 'user_correction' | 'self_observed' | 'manual';
  }>;
  memories: Array<{
    category?: string;
    content: string;
    file: string;
    key?: string;
    line: number;
    scope: 'project' | 'project-memory' | 'user' | 'custom';
    score: number;
    sourceSessionId?: string;
  }>;
  memoryCount: number;
  promptContext: string;
  runCount: number;
  runs: Array<{
    artifactCount: number;
    channel?: string;
    eventCount: number;
    matches: Array<{
      artifact?: string;
      eventType?: string;
      matched: 'artifact' | 'event' | 'summary';
      score: number;
      snippet: string;
    }>;
    objective: string;
    runId: string;
    source?: string;
    startedAt: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    tags: string[];
  }>;
  sessionCount: number;
  sessions: Array<{
    id: string;
    lastAccessedAt: string;
    messageId?: number;
    name: string;
    parentSessionId?: string;
    role?: string;
    score?: number;
    snippet?: string;
    workingDirectory: string;
  }>;
}

export interface AuditRunTrajectoryExportFilter {
  includeArtifactContent?: boolean;
  maxArtifactBytes?: number;
  maxEventValueBytes?: number;
  runId?: string;
}

export interface AuditRunTrajectoryExportResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'run_trajectory_export';
  mode: 'redacted_review_export';
  run: {
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
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    tags: string[];
  };
  privacy: {
    artifactContentIncluded: boolean;
    maxArtifactBytes: number;
    maxEventValueBytes: number;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  prompt: {
    sources: string[];
    text: string;
  };
  selectedContext: Array<{
    source: string;
    value: unknown;
  }>;
  toolCalls: Array<{
    args?: unknown;
    callId?: string;
    command?: string;
    sequence: number;
    toolName: string;
    ts: number;
  }>;
  toolResults: Array<{
    durationMs?: number;
    error?: unknown;
    output?: unknown;
    sequence: number;
    success?: boolean;
    toolName: string;
    ts: number;
  }>;
  artifacts: Array<{
    contentPreview?: string;
    includedContentBytes?: number;
    name: string;
  }>;
  finalAnswer?: unknown;
  metrics: Record<string, unknown>;
  events: Array<{
    data: unknown;
    sequence: number;
    ts: number;
    type: string;
  }>;
}

export interface AuditToolFilterBlock {
  reason?: string;
  sequence?: number;
  source?: string;
  toolCallId?: string;
  toolName: string;
}

export interface AuditPolicyEvalReportFilter {
  maxArtifactBytes?: number;
  policyIds?: string[];
  runId?: string;
}

export interface AuditGoldenWorkflowEvalReportFilter {
  fixtureIds?: string[];
  maxArtifactBytes?: number;
  runId?: string;
}

export interface AuditGoldenWorkflowEvalResultResponse {
  generatedAt: string;
  kind: 'golden_workflow_eval_result';
  passed: boolean;
  fixture: {
    id: string;
    objective: string;
    title: string;
    workflow: string;
  };
  results: Array<{
    assertionId: string;
    description: string;
    kind: string;
    passed: boolean;
    reason: string;
  }>;
  runId: string;
  schemaVersion: 1;
}

export interface AuditGoldenWorkflowEvalReportResponse {
  generatedAt: string;
  kind: 'golden_workflow_eval_report';
  mode: 'redacted_trajectory_golden_eval';
  runId: string;
  schemaVersion: 1;
  safety: {
    mutationDisabled: true;
    readOnly: true;
    toolReplay: false;
  };
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
  trajectory: {
    artifactContentIncluded: boolean;
    kind: 'run_trajectory_export';
    redaction: 'secrets-redacted';
  };
  results: AuditGoldenWorkflowEvalResultResponse[];
}

export interface AuditPolicyEvalResultResponse {
  generatedAt: string;
  kind: 'policy_eval_result';
  passed: boolean;
  policy: {
    id: string;
    objective: string;
    scope: string;
    title: string;
  };
  results: Array<{
    assertionId: string;
    description: string;
    kind: string;
    passed: boolean;
    reason: string;
  }>;
  runId: string;
  schemaVersion: 1;
}

export interface AuditPolicyEvalReportResponse {
  generatedAt: string;
  kind: 'policy_eval_report';
  mode: 'redacted_trajectory_policy_eval';
  runId: string;
  schemaVersion: 1;
  safety: {
    mutationDisabled: true;
    readOnly: true;
    toolReplay: false;
  };
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
  trajectory: {
    artifactContentIncluded: boolean;
    kind: 'run_trajectory_export';
    redaction: 'secrets-redacted';
    toolFilterBlocks: AuditToolFilterBlock[];
  };
  results: AuditPolicyEvalResultResponse[];
}

export interface AuditMobileSupervisionSnapshotResponse {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'review_only';
  query: string;
  safety: {
    autoDispatch: false;
    localApprovalRequired: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
    redaction: 'secrets-redacted';
  };
  allowedActions: string[];
  blockedActions: string[];
  redactionCount: number;
  recallPack: {
    count: number;
    filters: AuditRunRecallPackResponse['filters'];
    lessonCount: number;
    memoryCount: number;
    promptContext: string;
    runCount: number;
    schemaVersion: 1;
    sessionCount: number;
  };
  runs: Array<{
    artifactPaths: string[];
    bestSnippet?: string;
    objective: string;
    runId: string;
    source?: string;
    startedAt: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
  }>;
}

export interface AuditMobileSupervisionGatewayContractResponse {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'contract_only';
  basePath: string;
  query: string;
  auth: {
    required: true;
    scheme: 'bearer_or_pairing_code';
    scopes: string[];
    ttlSeconds: number;
  };
  transport: {
    exposure: 'local_first';
    offDeviceTlsRequired: true;
    remoteExecution: 'disabled';
  };
  endpoints: Array<{
    action: string;
    auth: AuditMobileSupervisionGatewayContractResponse['auth'];
    description: string;
    id: string;
    localApprovalRequired: boolean;
    method: 'GET' | 'POST';
    path: string;
    policy: {
      action: string;
      allowed: boolean;
      requiresLocalOperator: boolean;
      reason: string;
    };
    sideEffects: 'none' | 'draft_only';
  }>;
  blockedOperations: Array<{
    action: string;
    policy: {
      action: string;
      allowed: boolean;
      requiresLocalOperator: boolean;
      reason: string;
    };
  }>;
  snapshot?: AuditMobileSupervisionSnapshotResponse;
}

export interface AuditMobileSupervisionGatewayReviewDraftFilter extends AuditRunSearchFilter {
  action?: string;
  localOperator?: boolean;
  method?: 'GET' | 'POST' | string;
  path?: string;
}

export interface AuditMobileSupervisionGatewayReviewDraftResponse {
  schemaVersion: 1;
  generatedAt: string;
  query: string;
  draftId: string;
  contract: AuditMobileSupervisionGatewayContractResponse;
  request: {
    action: string;
    localOperator?: boolean;
    method: 'GET' | 'POST';
    path: string;
  };
  decision: {
    action: string;
    allowed: boolean;
    method: 'GET' | 'POST';
    path: string;
    reason: string;
    requiresLocalOperator: boolean;
    sideEffects: 'none' | 'draft_only';
  };
  status: 'ready' | 'needs_local_operator' | 'blocked';
  operatorActions: Array<'acknowledge' | 'approve_draft' | 'cancel_draft' | 'reject'>;
  safety: {
    autoDispatch: false;
    localOnly: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

export interface AuditMobileSupervisionGatewayListenerShellResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_gateway_listener_shell';
  query: string;
  mode: 'disabled_shell';
  basePath: string;
  bind: {
    host: '127.0.0.1';
    networkExposure: 'loopback_only';
    port: 0;
    status: 'not_started';
  };
  auth: AuditMobileSupervisionGatewayContractResponse['auth'];
  transport: AuditMobileSupervisionGatewayContractResponse['transport'] & {
    listener: 'not_started';
  };
  safety: {
    localOperatorRequiredForDrafts: true;
    mutationRoutesDisabled: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
    serverStarted: false;
  };
  routes: Array<{
    action: string;
    handler: 'read_only_stub' | 'local_operator_review_stub' | 'blocked_stub';
    localApprovalRequired: boolean;
    method: 'GET' | 'POST';
    path: string;
    policyReason: string;
    sideEffects: 'none' | 'draft_only' | 'blocked';
    status: 'planned_not_bound' | 'blocked_by_policy';
  }>;
  blockedRoutes: AuditMobileSupervisionGatewayListenerShellResponse['routes'];
  acceptanceChecks: string[];
}

export interface AuditMobileSupervisionPairingStateFilter extends AuditRunSearchFilter {
  deviceLabel?: string;
  ttlSeconds?: number;
}

export interface AuditMobileSupervisionPairingStateResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_pairing_state';
  mode: 'local_pairing_plan';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    codeFingerprint: string;
    deviceLabel: string;
    expiresAt: string;
    persisted: false;
    previewCode: string;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: false;
    ttlSeconds: number;
  };
  listener: {
    bindStatus: 'not_started';
    listenerStatus: 'not_started';
    networkExposure: 'loopback_only';
    serverStarted: false;
  };
  safety: {
    approvalMutationsDisabled: true;
    notAcceptedByAnyServer: true;
    pairingRequiresLocalOperator: true;
    remoteExecutionDisabled: true;
    secretMaterialPersisted: false;
  };
  operatorChecklist: string[];
}

export interface AuditMobileSupervisionPairingAcceptancePlanFilter
  extends AuditMobileSupervisionPairingStateFilter {
  localOperatorLabel?: string;
}

export interface AuditMobileSupervisionPairingAcceptancePlanResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_pairing_acceptance_plan';
  mode: 'acceptance_plan_only';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    codeFingerprint: string;
    deviceLabel: string;
    expiresAt: string;
    scopes: string[];
    status: 'preview_only';
    tokenIssued: false;
  };
  acceptance: {
    canAcceptNow: false;
    localOperatorLabel: string;
    requestId: string;
    status: 'blocked_until_listener_exists';
    endpoint: {
      action: 'accept_pairing_code';
      enabled: false;
      method: 'POST';
      path: string;
    };
    requiredEvidence: string[];
  };
  preconditions: Array<{
    id: string;
    label: string;
    passed: boolean;
    evidence: string;
  }>;
  plannedMutations: Array<{
    id: string;
    enabled: false;
    description: string;
  }>;
  safety: {
    approvalMutationEndpointEnabled: false;
    autoAccept: false;
    localOnly: true;
    remoteExecutionDisabled: true;
    secretMaterialPersisted: false;
    serverStarted: false;
    tokenIssued: false;
  };
  operatorChecklist: string[];
}

export type AuditMobileSupervisionApprovalQueueFilter = AuditMobileSupervisionPairingStateFilter;

export interface AuditMobileSupervisionApprovalQueueResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'mobile_supervision_approval_queue';
  mode: 'local_review_queue';
  query: string;
  basePath: string;
  pairing: {
    acceptedByListener: false;
    deviceLabel: string;
    status: 'preview_only';
    tokenIssued: false;
  };
  listener: {
    listenerStatus: 'not_started';
    serverStarted: false;
  };
  counts: {
    blocked: number;
    pending: number;
    ready: number;
    total: number;
  };
  items: Array<{
    id: string;
    source: 'gateway_endpoint' | 'blocked_operation';
    action: string;
    description: string;
    method: 'GET' | 'POST';
    path: string;
    status: 'ready_read_only' | 'pending_local_operator' | 'blocked_by_policy';
    operatorActions: Array<'acknowledge' | 'approve_draft' | 'cancel_draft' | 'reject'>;
    reason: string;
    localApprovalRequired: boolean;
    canDispatch: false;
    reviewDraft?: AuditMobileSupervisionGatewayReviewDraftResponse;
  }>;
  safety: {
    approvalMutationEndpointEnabled: false;
    autoDispatch: false;
    localOnly: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

const AUDIT_RUN_SEARCH_SCHEMA_VERSION = 1;

interface CoreRunSummaryLike {
  runId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  eventCount: number;
  artifactCount: number;
  metadata?: {
    channel?: string;
    sessionId?: string;
    source?: string;
    platform?: string;
    origin?: string;
    userId?: string;
    tags?: string[];
  };
}

interface CoreRunMetricsLike {
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalCost?: number;
  durationMs?: number;
  toolCallCount?: number;
  failoverCount?: number;
}

interface CoreRunRecordLike {
  summary: CoreRunSummaryLike;
  metrics: CoreRunMetricsLike;
  artifacts: string[];
}

interface CoreRunEventLike {
  ts: number;
  type: string;
  runId: string;
  data: Record<string, unknown>;
}

interface CoreRunStoreInstance {
  listRuns(limit?: number): CoreRunSummaryLike[];
  getRun(runId: string): CoreRunRecordLike | null;
  getEvents(runId: string): CoreRunEventLike[];
  searchRuns?: (
    query: string,
    options?: { limit?: number; sources?: string[] },
  ) => AuditRunSearchResult[];
}

interface CoreRunStoreModule {
  RunStore: {
    getInstance: () => CoreRunStoreInstance;
  };
}

interface CoreProofLedgerModule {
  buildProofLedgerForRun?: (
    store: CoreRunStoreInstance,
    runId: string,
  ) => AuditProofLedgerEntry | null;
}

interface CoreRunRecallPackModule {
  buildRunRecallPack?: (
    query: string,
    options?: {
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      cwd?: string;
      limit?: number;
      maxMemories?: number;
      maxMatchesPerRun?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    },
  ) => AuditRunRecallPackResponse;
  buildRunRecallPackAsync?: (
    query: string,
    options?: {
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      cwd?: string;
      limit?: number;
      maxMemories?: number;
      maxMatchesPerRun?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    },
  ) => Promise<AuditRunRecallPackResponse>;
}

interface CoreRunTrajectoryExportModule {
  buildRunTrajectoryExport?: (
    runId: string,
    options?: {
      includeArtifactContent?: boolean;
      maxArtifactBytes?: number;
      maxEventValueBytes?: number;
    },
  ) => AuditRunTrajectoryExportResponse | null;
}

interface CorePolicyEvalManifestLike {
  policies: Array<{
    id: string;
  }>;
}

interface CoreGoldenWorkflowEvalManifestLike {
  fixtures: Array<{
    id: string;
  }>;
}

interface CorePolicyEvalsModule {
  buildPolicyEvalManifest?: () => CorePolicyEvalManifestLike;
  evaluatePolicyEval?: (
    policyId: string,
    trajectory: unknown,
  ) => AuditPolicyEvalResultResponse | null;
}

interface CoreGoldenWorkflowEvalsModule {
  buildGoldenWorkflowEvalManifest?: () => CoreGoldenWorkflowEvalManifestLike;
  evaluateGoldenWorkflowFixture?: (
    fixtureId: string,
    trajectory: unknown,
  ) => AuditGoldenWorkflowEvalResultResponse | null;
}

interface CoreMobileSupervisionSnapshotModule {
  buildMobileSupervisionSnapshot?: (
    query: string,
    options?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    },
  ) => Promise<AuditMobileSupervisionSnapshotResponse>;
}

interface CoreMobileSupervisionGatewayContractModule {
  buildMobileSupervisionGatewayContract?: (
    query: string,
    options?: {
      cwd?: string;
      includeLessons?: boolean;
      includeMemories?: boolean;
      includeSessions?: boolean;
      includeSnapshot?: boolean;
      limit?: number;
      maxMemories?: number;
      maxLessons?: number;
      maxSessions?: number;
      sources?: string[];
    },
  ) => Promise<AuditMobileSupervisionGatewayContractResponse>;
}

interface CoreMobileSupervisionGatewayPolicyModule {
  buildMobileSupervisionGatewayReviewDraft?: (
    query: string,
    contract: AuditMobileSupervisionGatewayContractResponse,
    request: AuditMobileSupervisionGatewayReviewDraftResponse['request'],
  ) => AuditMobileSupervisionGatewayReviewDraftResponse;
}

interface CoreMobileSupervisionGatewayListenerShellModule {
  buildMobileSupervisionGatewayListenerShell?: (
    contract: AuditMobileSupervisionGatewayContractResponse,
  ) => AuditMobileSupervisionGatewayListenerShellResponse;
}

interface CoreMobileSupervisionPairingStateModule {
  buildMobileSupervisionPairingState?: (
    shell: AuditMobileSupervisionGatewayListenerShellResponse,
    options?: {
      deviceLabel?: string;
      ttlSeconds?: number;
    },
  ) => AuditMobileSupervisionPairingStateResponse;
}

interface CoreMobileSupervisionPairingAcceptancePlanModule {
  buildMobileSupervisionPairingAcceptancePlan?: (
    pairingState: AuditMobileSupervisionPairingStateResponse,
    options?: {
      localOperatorLabel?: string;
    },
  ) => AuditMobileSupervisionPairingAcceptancePlanResponse;
}

interface CoreMobileSupervisionApprovalQueueModule {
  buildMobileSupervisionApprovalQueue?: (
    contract: AuditMobileSupervisionGatewayContractResponse,
    pairingState: AuditMobileSupervisionPairingStateResponse,
  ) => AuditMobileSupervisionApprovalQueueResponse;
}

let cachedModule: CoreRunStoreModule | null = null;
let cachedProofLedgerModule: CoreProofLedgerModule | null = null;

async function loadModule(): Promise<CoreRunStoreModule | null> {
  if (cachedModule) return cachedModule;
  const mod = await loadCoreModule<CoreRunStoreModule>('observability/run-store.js');
  if (mod) {
    cachedModule = mod;
    log('[AuditBridge] Core RunStore loaded');
  } else {
    logWarn('[AuditBridge] Core RunStore unavailable');
  }
  return mod;
}

async function loadProofLedgerModule(): Promise<CoreProofLedgerModule | null> {
  if (cachedProofLedgerModule) return cachedProofLedgerModule;
  const mod = await loadCoreModule<CoreProofLedgerModule>('observability/proof-ledger.js');
  if (mod?.buildProofLedgerForRun) {
    cachedProofLedgerModule = mod;
  }
  return cachedProofLedgerModule;
}

function mergeSummary(
  summary: CoreRunSummaryLike,
  metrics: CoreRunMetricsLike
): AuditRunSummary {
  return {
    runId: summary.runId,
    objective: summary.objective,
    status: summary.status,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    durationMs: metrics.durationMs,
    eventCount: summary.eventCount ?? 0,
    artifactCount: summary.artifactCount ?? 0,
    channel: summary.metadata?.channel,
    sessionId: summary.metadata?.sessionId,
    source: summary.metadata?.source,
    platform: summary.metadata?.platform,
    origin: summary.metadata?.origin,
    userId: summary.metadata?.userId,
    tags: summary.metadata?.tags,
    totalCost: metrics.totalCost,
    totalTokens: metrics.totalTokens,
    toolCallCount: metrics.toolCallCount,
  };
}

function passesFilter(summary: AuditRunSummary, filter?: AuditRunFilter): boolean {
  if (!filter) return true;
  if (filter.status && summary.status !== filter.status) return false;
  if (filter.sessionId && summary.sessionId !== filter.sessionId) return false;
  if (filter.sinceTs && summary.startedAt < filter.sinceTs) return false;
  if (filter.untilTs && summary.startedAt > filter.untilTs) return false;
  const sources = normalizeSearchSources(filter.sources);
  if (sources.length > 0 && !matchesAuditRunSources(summary, sources)) return false;
  return true;
}

/**
 * List recent runs with optional filtering. Returns an empty list when
 * the core module isn't available (e.g. dev mode without bundled src).
 */
export async function listRuns(filter?: AuditRunFilter): Promise<AuditRunSummary[]> {
  const mod = await loadModule();
  if (!mod) return [];
  try {
    const store = mod.RunStore.getInstance();
    const limit = filter?.limit ?? 100;
    const coreRuns = store.listRuns(limit);
    const out: AuditRunSummary[] = [];
    for (const summary of coreRuns) {
      const record = store.getRun(summary.runId);
      const metrics = record?.metrics ?? {};
      const merged = mergeSummary(summary, metrics);
      if (passesFilter(merged, filter)) out.push(merged);
    }
    return out;
  } catch (err) {
    logWarn('[AuditBridge] listRuns failed:', err);
    return [];
  }
}

export async function getRunDetail(runId: string): Promise<AuditRunDetail | null> {
  const mod = await loadModule();
  if (!mod) return null;
  try {
    const store = mod.RunStore.getInstance();
    const record = store.getRun(runId);
    if (!record) return null;
    const summary = mergeSummary(record.summary, record.metrics);
    const events = store.getEvents(runId).map((ev) => ({
      ts: ev.ts,
      type: ev.type,
      runId: ev.runId,
      data: ev.data ?? {},
    }));
    const metricsPlain: Record<string, number> = {};
    for (const [k, v] of Object.entries(record.metrics)) {
      if (typeof v === 'number') metricsPlain[k] = v;
    }
    const proofMod = await loadProofLedgerModule();
    const proofLedger = proofMod?.buildProofLedgerForRun?.(store, runId) ?? undefined;
    return {
      ...summary,
      events,
      metrics: metricsPlain,
      artifacts: record.artifacts ?? [],
      ...(proofLedger ? { proofLedger } : {}),
    };
  } catch (err) {
    logWarn('[AuditBridge] getRunDetail failed:', err);
    return null;
  }
}

export async function searchRuns(filter?: AuditRunSearchFilter): Promise<AuditRunSearchResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const limit = normalizeSearchLimit(filter?.limit);
  const sources = normalizeSearchSources(filter?.sources);
  const empty = (): AuditRunSearchResponse => ({
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    query,
    filters: { limit, sources },
    count: 0,
    results: [],
  });

  if (!query) return empty();

  const mod = await loadModule();
  if (!mod) return empty();

  try {
    const store = mod.RunStore.getInstance();
    if (typeof store.searchRuns !== 'function') {
      logWarn('[AuditBridge] Core RunStore.searchRuns unavailable');
      return empty();
    }
    const results = store.searchRuns(query, { limit, sources }).map((result) => ({
      runId: result.runId,
      objective: result.objective,
      status: result.status,
      startedAt: result.startedAt,
      matched: result.matched,
      score: result.score,
      snippet: result.snippet,
      artifact: result.artifact,
      eventType: result.eventType,
      source: result.source,
    }));
    return {
      schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      query,
      filters: { limit, sources },
      count: results.length,
      results,
    };
  } catch (err) {
    logWarn('[AuditBridge] searchRuns failed:', err);
    return empty();
  }
}

export async function buildRecallPack(
  filter?: AuditRunSearchFilter,
): Promise<AuditRunRecallPackResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const cwd = normalizeOptionalString(filter?.cwd);
  const limit = normalizeSearchLimit(filter?.limit);
  const maxMemories = normalizeMaxMemories(filter?.maxMemories);
  const maxMatchesPerRun = normalizeMaxMatchesPerRun(filter?.maxMatchesPerRun);
  const maxLessons = normalizeMaxLessons(filter?.maxLessons);
  const maxSessions = normalizeMaxSessions(filter?.maxSessions);
  const sources = normalizeSearchSources(filter?.sources);
  const empty = (): AuditRunRecallPackResponse => ({
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    query,
    filters: { limit, maxMemories, maxMatchesPerRun, maxLessons, maxSessions, sources },
    count: 0,
    lessonCount: 0,
    lessons: [],
    memories: [],
    memoryCount: 0,
    runCount: 0,
    results: [],
    runs: [],
    sessionCount: 0,
    sessions: [],
    promptContext: [
      '# Run recall pack',
      `Query: ${query || '(empty)'}`,
      '',
      'No matching runs were found.',
    ].join('\n'),
  });

  const mod = await loadCoreModule<CoreRunRecallPackModule>('observability/run-recall-pack.js');
  if (!mod?.buildRunRecallPack && !mod?.buildRunRecallPackAsync) return empty();

  try {
    const build = mod.buildRunRecallPackAsync ?? mod.buildRunRecallPack;
    if (!build) return empty();
    return await build(query, {
      cwd,
      includeLessons: filter?.includeLessons === true,
      includeMemories: filter?.includeMemories === true,
      includeSessions: filter?.includeSessions === true,
      limit,
      maxMemories,
      maxMatchesPerRun,
      maxLessons,
      maxSessions,
      sources,
    });
  } catch (err) {
    logWarn('[AuditBridge] buildRecallPack failed:', err);
    return empty();
  }
}

export async function buildTrajectoryExport(
  filter?: AuditRunTrajectoryExportFilter,
): Promise<AuditRunTrajectoryExportResponse | null> {
  const runId = normalizeOptionalString(filter?.runId);
  if (!runId) return null;

  const mod = await loadCoreModule<CoreRunTrajectoryExportModule>(
    'observability/run-trajectory-export.js',
  );
  if (!mod?.buildRunTrajectoryExport) return null;

  try {
    return mod.buildRunTrajectoryExport(runId, {
      includeArtifactContent: filter?.includeArtifactContent === true,
      maxArtifactBytes: normalizeMaxBytes(filter?.maxArtifactBytes, 4_000),
      maxEventValueBytes: normalizeMaxBytes(filter?.maxEventValueBytes, 2_000),
    });
  } catch (err) {
    logWarn('[AuditBridge] buildTrajectoryExport failed:', err);
    return null;
  }
}

export async function buildPolicyEvalReport(
  filter?: AuditPolicyEvalReportFilter,
): Promise<AuditPolicyEvalReportResponse | null> {
  const runId = normalizeOptionalString(filter?.runId);
  if (!runId) return null;

  const trajectory = await buildTrajectoryExport({
    includeArtifactContent: true,
    maxArtifactBytes: normalizeMaxBytes(filter?.maxArtifactBytes, 8_000),
    maxEventValueBytes: 2_000,
    runId,
  });
  if (!trajectory) return null;

  const mod = await loadCoreModule<CorePolicyEvalsModule>('observability/policy-evals.js');
  if (!mod?.buildPolicyEvalManifest || !mod.evaluatePolicyEval) return null;

  try {
    const manifest = mod.buildPolicyEvalManifest();
    const requestedIds = normalizePolicyIds(filter?.policyIds);
    const policyIds = requestedIds.length > 0
      ? requestedIds
      : manifest.policies.map((policy) => policy.id);
    const results = policyIds
      .map((policyId) => mod.evaluatePolicyEval?.(policyId, trajectory))
      .filter((result): result is AuditPolicyEvalResultResponse => result !== null && result !== undefined);
    const passed = results.filter((result) => result.passed).length;

    return {
      generatedAt: new Date().toISOString(),
      kind: 'policy_eval_report',
      mode: 'redacted_trajectory_policy_eval',
      runId,
      schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      summary: {
        failed: results.length - passed,
        passed,
        total: results.length,
      },
      trajectory: {
        artifactContentIncluded: trajectory.privacy.artifactContentIncluded,
        kind: trajectory.kind,
        redaction: trajectory.privacy.redaction,
        toolFilterBlocks: getToolFilterBlocks(trajectory),
      },
      results,
    };
  } catch (err) {
    logWarn('[AuditBridge] buildPolicyEvalReport failed:', err);
    return null;
  }
}

export async function buildGoldenWorkflowEvalReport(
  filter?: AuditGoldenWorkflowEvalReportFilter,
): Promise<AuditGoldenWorkflowEvalReportResponse | null> {
  const runId = normalizeOptionalString(filter?.runId);
  if (!runId) return null;

  const trajectory = await buildTrajectoryExport({
    includeArtifactContent: true,
    maxArtifactBytes: normalizeMaxBytes(filter?.maxArtifactBytes, 8_000),
    maxEventValueBytes: 2_000,
    runId,
  });
  if (!trajectory) return null;

  const mod = await loadCoreModule<CoreGoldenWorkflowEvalsModule>(
    'observability/golden-workflow-evals.js',
  );
  if (!mod?.buildGoldenWorkflowEvalManifest || !mod.evaluateGoldenWorkflowFixture) return null;

  try {
    const manifest = mod.buildGoldenWorkflowEvalManifest();
    const requestedIds = normalizeEvalIds(filter?.fixtureIds);
    const fixtureIds = requestedIds.length > 0
      ? requestedIds
      : manifest.fixtures.map((fixture) => fixture.id);
    const results = fixtureIds
      .map((fixtureId) => mod.evaluateGoldenWorkflowFixture?.(fixtureId, trajectory))
      .filter((result): result is AuditGoldenWorkflowEvalResultResponse =>
        result !== null && result !== undefined,
      );
    const passed = results.filter((result) => result.passed).length;

    return {
      generatedAt: new Date().toISOString(),
      kind: 'golden_workflow_eval_report',
      mode: 'redacted_trajectory_golden_eval',
      runId,
      schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
      safety: {
        mutationDisabled: true,
        readOnly: true,
        toolReplay: false,
      },
      summary: {
        failed: results.length - passed,
        passed,
        total: results.length,
      },
      trajectory: {
        artifactContentIncluded: trajectory.privacy.artifactContentIncluded,
        kind: trajectory.kind,
        redaction: trajectory.privacy.redaction,
      },
      results,
    };
  } catch (err) {
    logWarn('[AuditBridge] buildGoldenWorkflowEvalReport failed:', err);
    return null;
  }
}

export async function buildMobileSnapshot(
  filter?: AuditRunSearchFilter,
): Promise<AuditMobileSupervisionSnapshotResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const cwd = normalizeOptionalString(filter?.cwd);
  const limit = normalizeSearchLimit(filter?.limit);
  const maxMemories = normalizeMaxMemories(filter?.maxMemories);
  const maxLessons = normalizeMaxLessons(filter?.maxLessons);
  const maxSessions = normalizeMaxSessions(filter?.maxSessions);
  const sources = normalizeSearchSources(filter?.sources);
  const empty = (): AuditMobileSupervisionSnapshotResponse => ({
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'review_only',
    query,
    safety: {
      autoDispatch: false,
      localApprovalRequired: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
      redaction: 'secrets-redacted',
    },
    allowedActions: ['view_run_summary', 'open_artifact', 'copy_recall_pack', 'draft_followup_prompt'],
    blockedActions: ['execute_tool', 'modify_files', 'send_email', 'approve_sensitive_operation', 'read_secret_values', 'push_changes'],
    redactionCount: 0,
    recallPack: {
      count: 0,
      filters: { limit, maxMemories, maxMatchesPerRun: 3, maxLessons, maxSessions, sources },
      lessonCount: 0,
      memoryCount: 0,
      promptContext: [
        '# Run recall pack',
        `Query: ${query || '(empty)'}`,
        '',
        'No matching runs were found.',
      ].join('\n'),
      runCount: 0,
      schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
      sessionCount: 0,
    },
    runs: [],
  });

  const mod = await loadCoreModule<CoreMobileSupervisionSnapshotModule>(
    'observability/mobile-supervision-snapshot.js',
  );
  if (!mod?.buildMobileSupervisionSnapshot) return empty();

  try {
    return await mod.buildMobileSupervisionSnapshot(query, {
      cwd,
      includeLessons: filter?.includeLessons === true,
      includeMemories: filter?.includeMemories === true,
      includeSessions: filter?.includeSessions === true,
      limit,
      maxMemories,
      maxLessons,
      maxSessions,
      sources,
    });
  } catch (err) {
    logWarn('[AuditBridge] buildMobileSnapshot failed:', err);
    return empty();
  }
}

export async function buildMobileGatewayContract(
  filter?: AuditRunSearchFilter,
): Promise<AuditMobileSupervisionGatewayContractResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const cwd = normalizeOptionalString(filter?.cwd);
  const limit = normalizeSearchLimit(filter?.limit);
  const maxMemories = normalizeMaxMemories(filter?.maxMemories);
  const maxLessons = normalizeMaxLessons(filter?.maxLessons);
  const maxSessions = normalizeMaxSessions(filter?.maxSessions);
  const sources = normalizeSearchSources(filter?.sources);
  const includeSnapshot = filter?.includeSnapshot !== false;
  const empty = (): AuditMobileSupervisionGatewayContractResponse =>
    buildEmptyMobileGatewayContract(query, includeSnapshot ? buildEmptyMobileSnapshot(query, {
      limit,
      maxMemories,
      maxLessons,
      maxSessions,
      sources,
    }) : undefined);

  const mod = await loadCoreModule<CoreMobileSupervisionGatewayContractModule>(
    'observability/mobile-supervision-gateway-contract.js',
  );
  if (!mod?.buildMobileSupervisionGatewayContract) return empty();

  try {
    return await mod.buildMobileSupervisionGatewayContract(query, {
      cwd,
      includeLessons: filter?.includeLessons === true,
      includeMemories: filter?.includeMemories === true,
      includeSessions: filter?.includeSessions === true,
      includeSnapshot,
      limit,
      maxMemories,
      maxLessons,
      maxSessions,
      sources,
    });
  } catch (err) {
    logWarn('[AuditBridge] buildMobileGatewayContract failed:', err);
    return empty();
  }
}

export async function buildMobileGatewayReviewDraft(
  filter?: AuditMobileSupervisionGatewayReviewDraftFilter,
): Promise<AuditMobileSupervisionGatewayReviewDraftResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const cwd = normalizeOptionalString(filter?.cwd);
  const limit = normalizeSearchLimit(filter?.limit);
  const maxMemories = normalizeMaxMemories(filter?.maxMemories);
  const maxLessons = normalizeMaxLessons(filter?.maxLessons);
  const maxSessions = normalizeMaxSessions(filter?.maxSessions);
  const sources = normalizeSearchSources(filter?.sources);
  const request: AuditMobileSupervisionGatewayReviewDraftResponse['request'] = {
    action: normalizeGatewayAction(filter?.action),
    localOperator: filter?.localOperator === true || undefined,
    method: normalizeGatewayMethod(filter?.method),
    path: normalizeGatewayPath(filter?.path),
  };
  const contract = await buildMobileGatewayContract({
    cwd,
    includeLessons: filter?.includeLessons === true,
    includeMemories: filter?.includeMemories === true,
    includeSessions: filter?.includeSessions === true,
    includeSnapshot: filter?.includeSnapshot !== false,
    limit,
    maxMemories,
    maxLessons,
    maxSessions,
    query,
    sources,
  });

  const mod = await loadCoreModule<CoreMobileSupervisionGatewayPolicyModule>(
    'observability/mobile-supervision-gateway-policy.js',
  );
  if (!mod?.buildMobileSupervisionGatewayReviewDraft) {
    return buildEmptyMobileGatewayReviewDraft(query, contract, request);
  }

  try {
    return mod.buildMobileSupervisionGatewayReviewDraft(query, contract, request);
  } catch (err) {
    logWarn('[AuditBridge] buildMobileGatewayReviewDraft failed:', err);
    return buildEmptyMobileGatewayReviewDraft(query, contract, request);
  }
}

export async function buildMobileGatewayListenerShell(
  filter?: AuditRunSearchFilter,
): Promise<AuditMobileSupervisionGatewayListenerShellResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const contract = await buildMobileGatewayContract({
    cwd: normalizeOptionalString(filter?.cwd),
    includeLessons: filter?.includeLessons === true,
    includeMemories: filter?.includeMemories === true,
    includeSessions: filter?.includeSessions === true,
    includeSnapshot: false,
    limit: normalizeSearchLimit(filter?.limit),
    maxMemories: normalizeMaxMemories(filter?.maxMemories),
    maxLessons: normalizeMaxLessons(filter?.maxLessons),
    maxSessions: normalizeMaxSessions(filter?.maxSessions),
    query,
    sources: normalizeSearchSources(filter?.sources),
  });

  const mod = await loadCoreModule<CoreMobileSupervisionGatewayListenerShellModule>(
    'observability/mobile-supervision-gateway-listener-shell.js',
  );
  if (!mod?.buildMobileSupervisionGatewayListenerShell) {
    return buildEmptyMobileGatewayListenerShell(contract);
  }

  try {
    return mod.buildMobileSupervisionGatewayListenerShell(contract);
  } catch (err) {
    logWarn('[AuditBridge] buildMobileGatewayListenerShell failed:', err);
    return buildEmptyMobileGatewayListenerShell(contract);
  }
}

export async function buildMobilePairingState(
  filter?: AuditMobileSupervisionPairingStateFilter,
): Promise<AuditMobileSupervisionPairingStateResponse> {
  const shell = await buildMobileGatewayListenerShell(filter);
  const deviceLabel = normalizeOptionalString(filter?.deviceLabel);
  const ttlSeconds = normalizePairingTtlSeconds(filter?.ttlSeconds);

  const mod = await loadCoreModule<CoreMobileSupervisionPairingStateModule>(
    'observability/mobile-supervision-pairing-state.js',
  );
  if (!mod?.buildMobileSupervisionPairingState) {
    return buildEmptyMobilePairingState(shell, deviceLabel, ttlSeconds);
  }

  try {
    return mod.buildMobileSupervisionPairingState(shell, {
      deviceLabel,
      ttlSeconds,
    });
  } catch (err) {
    logWarn('[AuditBridge] buildMobilePairingState failed:', err);
    return buildEmptyMobilePairingState(shell, deviceLabel, ttlSeconds);
  }
}

export async function buildMobilePairingAcceptancePlan(
  filter?: AuditMobileSupervisionPairingAcceptancePlanFilter,
): Promise<AuditMobileSupervisionPairingAcceptancePlanResponse> {
  const pairingState = await buildMobilePairingState(filter);
  const localOperatorLabel = normalizeOptionalString(filter?.localOperatorLabel);

  const mod = await loadCoreModule<CoreMobileSupervisionPairingAcceptancePlanModule>(
    'observability/mobile-supervision-pairing-acceptance-plan.js',
  );
  if (!mod?.buildMobileSupervisionPairingAcceptancePlan) {
    return buildEmptyMobilePairingAcceptancePlan(pairingState, localOperatorLabel);
  }

  try {
    return mod.buildMobileSupervisionPairingAcceptancePlan(pairingState, {
      localOperatorLabel,
    });
  } catch (err) {
    logWarn('[AuditBridge] buildMobilePairingAcceptancePlan failed:', err);
    return buildEmptyMobilePairingAcceptancePlan(pairingState, localOperatorLabel);
  }
}

export async function buildMobileApprovalQueue(
  filter?: AuditMobileSupervisionApprovalQueueFilter,
): Promise<AuditMobileSupervisionApprovalQueueResponse> {
  const query = normalizeSearchQuery(filter?.query);
  const contract = await buildMobileGatewayContract({
    cwd: normalizeOptionalString(filter?.cwd),
    includeLessons: filter?.includeLessons === true,
    includeMemories: filter?.includeMemories === true,
    includeSessions: filter?.includeSessions === true,
    includeSnapshot: false,
    limit: normalizeSearchLimit(filter?.limit),
    maxMemories: normalizeMaxMemories(filter?.maxMemories),
    maxLessons: normalizeMaxLessons(filter?.maxLessons),
    maxSessions: normalizeMaxSessions(filter?.maxSessions),
    query,
    sources: normalizeSearchSources(filter?.sources),
  });
  const pairingState = await buildMobilePairingState({
    ...filter,
    query,
  });

  const mod = await loadCoreModule<CoreMobileSupervisionApprovalQueueModule>(
    'observability/mobile-supervision-approval-queue.js',
  );
  if (!mod?.buildMobileSupervisionApprovalQueue) {
    return buildEmptyMobileApprovalQueue(contract, pairingState);
  }

  try {
    return mod.buildMobileSupervisionApprovalQueue(contract, pairingState);
  } catch (err) {
    logWarn('[AuditBridge] buildMobileApprovalQueue failed:', err);
    return buildEmptyMobileApprovalQueue(contract, pairingState);
  }
}

function buildEmptyMobileSnapshot(
  query: string,
  options: {
    limit: number;
    maxMemories: number;
    maxLessons: number;
    maxSessions: number;
    sources: string[];
  },
): AuditMobileSupervisionSnapshotResponse {
  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'review_only',
    query,
    safety: {
      autoDispatch: false,
      localApprovalRequired: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
      redaction: 'secrets-redacted',
    },
    allowedActions: ['view_run_summary', 'open_artifact', 'copy_recall_pack', 'draft_followup_prompt'],
    blockedActions: ['execute_tool', 'modify_files', 'send_email', 'approve_sensitive_operation', 'read_secret_values', 'push_changes'],
    redactionCount: 0,
    recallPack: {
      count: 0,
      filters: {
        limit: options.limit,
        maxMemories: options.maxMemories,
        maxMatchesPerRun: 3,
        maxLessons: options.maxLessons,
        maxSessions: options.maxSessions,
        sources: options.sources,
      },
      lessonCount: 0,
      memoryCount: 0,
      promptContext: [
        '# Run recall pack',
        `Query: ${query || '(empty)'}`,
        '',
        'No matching runs were found.',
      ].join('\n'),
      runCount: 0,
      schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
      sessionCount: 0,
    },
    runs: [],
  };
}

function buildEmptyMobileGatewayReviewDraft(
  query: string,
  contract: AuditMobileSupervisionGatewayContractResponse,
  request: AuditMobileSupervisionGatewayReviewDraftResponse['request'],
): AuditMobileSupervisionGatewayReviewDraftResponse {
  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    query,
    draftId: buildMobileGatewayReviewDraftId(request),
    contract,
    request,
    decision: {
      action: request.action,
      allowed: false,
      method: request.method,
      path: request.path,
      reason: 'Review draft builder unavailable; the request is kept blocked for local operator review.',
      requiresLocalOperator: true,
      sideEffects: 'none',
    },
    status: 'blocked',
    operatorActions: ['reject'],
    safety: {
      autoDispatch: false,
      localOnly: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
    },
  };
}

function buildEmptyMobileGatewayListenerShell(
  contract: AuditMobileSupervisionGatewayContractResponse,
): AuditMobileSupervisionGatewayListenerShellResponse {
  const routes: AuditMobileSupervisionGatewayListenerShellResponse['routes'] = contract.endpoints.map((endpoint) => ({
    action: endpoint.action,
    handler: endpoint.sideEffects === 'draft_only' ? 'local_operator_review_stub' : 'read_only_stub',
    localApprovalRequired: endpoint.localApprovalRequired,
    method: endpoint.method,
    path: endpoint.path,
    policyReason: endpoint.policy.reason,
    sideEffects: endpoint.sideEffects,
    status: 'planned_not_bound',
  }));
  const blockedRoutes: AuditMobileSupervisionGatewayListenerShellResponse['routes'] =
    contract.blockedOperations.map((operation) => ({
      action: operation.action,
      handler: 'blocked_stub',
      localApprovalRequired: true,
      method: 'POST',
      path: `${contract.basePath}/blocked`,
      policyReason: operation.policy.reason,
      sideEffects: 'blocked',
      status: 'blocked_by_policy',
    }));

  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_gateway_listener_shell',
    query: contract.query,
    mode: 'disabled_shell',
    basePath: contract.basePath,
    bind: {
      host: '127.0.0.1',
      networkExposure: 'loopback_only',
      port: 0,
      status: 'not_started',
    },
    auth: contract.auth,
    transport: {
      ...contract.transport,
      listener: 'not_started',
    },
    safety: {
      localOperatorRequiredForDrafts: true,
      mutationRoutesDisabled: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
      serverStarted: false,
    },
    routes,
    blockedRoutes,
    acceptanceChecks: [
      'No HTTP server is started by this shell.',
      'Only loopback binding is allowed before an explicit implementation step.',
      'Draft-only routes must return a local operator review draft, not dispatch work.',
      'Execution, mutation, outreach, secret-read and push operations stay blocked.',
      'Off-device access requires TLS plus bearer or pairing-code auth.',
    ],
  };
}

function buildEmptyMobilePairingState(
  shell: AuditMobileSupervisionGatewayListenerShellResponse,
  deviceLabel: string | undefined,
  ttlSeconds: number,
): AuditMobileSupervisionPairingStateResponse {
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + ttlSeconds * 1000).toISOString();

  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    kind: 'mobile_supervision_pairing_state',
    mode: 'local_pairing_plan',
    query: shell.query,
    basePath: shell.basePath,
    pairing: {
      acceptedByListener: false,
      codeFingerprint: 'unavailable',
      deviceLabel: deviceLabel ?? 'cowork-mobile-supervisor',
      expiresAt,
      persisted: false,
      previewCode: '000000',
      scopes: shell.auth.scopes,
      status: 'preview_only',
      tokenIssued: false,
      ttlSeconds,
    },
    listener: {
      bindStatus: shell.bind.status,
      listenerStatus: shell.transport.listener,
      networkExposure: shell.bind.networkExposure,
      serverStarted: false,
    },
    safety: {
      approvalMutationsDisabled: true,
      notAcceptedByAnyServer: true,
      pairingRequiresLocalOperator: true,
      remoteExecutionDisabled: true,
      secretMaterialPersisted: false,
    },
    operatorChecklist: [
      'Show this preview code only on the local operator machine.',
      'Do not accept the code from a phone until a real loopback listener is explicitly started.',
      'Pairing must mint a short-lived bearer token only after local operator confirmation.',
      'The paired phone may read snapshots, recall packs and artifact metadata, but may not execute tools.',
      'Draft follow-up prompts remain local-review artifacts until an operator approves them.',
    ],
  };
}

function buildEmptyMobilePairingAcceptancePlan(
  pairingState: AuditMobileSupervisionPairingStateResponse,
  localOperatorLabel: string | undefined,
): AuditMobileSupervisionPairingAcceptancePlanResponse {
  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_supervision_pairing_acceptance_plan',
    mode: 'acceptance_plan_only',
    query: pairingState.query,
    basePath: pairingState.basePath,
    pairing: {
      acceptedByListener: false,
      codeFingerprint: pairingState.pairing.codeFingerprint,
      deviceLabel: pairingState.pairing.deviceLabel,
      expiresAt: pairingState.pairing.expiresAt,
      scopes: pairingState.pairing.scopes,
      status: 'preview_only',
      tokenIssued: false,
    },
    acceptance: {
      canAcceptNow: false,
      localOperatorLabel: localOperatorLabel ?? 'cowork-local-operator',
      requestId: `mobile-pairing-acceptance-${pairingState.pairing.codeFingerprint}`,
      status: 'blocked_until_listener_exists',
      endpoint: {
        action: 'accept_pairing_code',
        enabled: false,
        method: 'POST',
        path: `${pairingState.basePath}/pairing/accept`,
      },
      requiredEvidence: [
        'local_operator_confirmed_code',
        'loopback_listener_started_explicitly',
        'device_label_matches_pairing_request',
        'pairing_code_not_expired',
      ],
    },
    preconditions: [
      {
        id: 'preview_code_not_expired',
        label: 'Preview code is still within its TTL.',
        passed: true,
        evidence: `expiresAt=${pairingState.pairing.expiresAt}`,
      },
      {
        id: 'loopback_listener_running',
        label: 'A real loopback listener is running.',
        passed: false,
        evidence: `listenerStatus=${pairingState.listener.listenerStatus}; serverStarted=${pairingState.listener.serverStarted}`,
      },
      {
        id: 'local_operator_confirmation',
        label: 'A local operator confirmed the phone code.',
        passed: false,
        evidence: 'No operator confirmation is captured by this artifact.',
      },
      {
        id: 'no_existing_secret_material',
        label: 'No pairing secret or bearer token has already been persisted.',
        passed: !pairingState.pairing.persisted && !pairingState.pairing.tokenIssued,
        evidence: `persisted=${pairingState.pairing.persisted}; tokenIssued=${pairingState.pairing.tokenIssued}`,
      },
    ],
    plannedMutations: [
      {
        id: 'accept_pairing_session',
        enabled: false,
        description: 'Mark the pairing code as accepted by the local listener.',
      },
      {
        id: 'persist_pairing_session',
        enabled: false,
        description: 'Persist a short-lived pairing session for this device label.',
      },
      {
        id: 'mint_short_lived_mobile_token',
        enabled: false,
        description: 'Mint a short-lived bearer token scoped to mobile read/draft actions.',
      },
      {
        id: 'enable_mobile_approval_mutations',
        enabled: false,
        description: 'Enable approve/cancel mutations after explicit local acceptance.',
      },
    ],
    safety: {
      approvalMutationEndpointEnabled: false,
      autoAccept: false,
      localOnly: true,
      remoteExecutionDisabled: true,
      secretMaterialPersisted: false,
      serverStarted: false,
      tokenIssued: false,
    },
    operatorChecklist: [
      'Start a real loopback listener explicitly before accepting any phone code.',
      'Compare the phone-displayed code with the local preview code fingerprint.',
      'Confirm the device label and requested scopes before minting a token.',
      'Keep approve/cancel endpoints disabled until this acceptance plan is implemented and tested.',
      'Never let pairing acceptance execute tools, send outreach or expose secrets.',
    ],
  };
}

function buildEmptyMobileApprovalQueue(
  contract: AuditMobileSupervisionGatewayContractResponse,
  pairingState: AuditMobileSupervisionPairingStateResponse,
): AuditMobileSupervisionApprovalQueueResponse {
  const endpointItems: AuditMobileSupervisionApprovalQueueResponse['items'] = contract.endpoints.map((endpoint) => ({
    id: endpoint.id,
    source: 'gateway_endpoint',
    action: endpoint.action,
    description: endpoint.description,
    method: endpoint.method,
    path: endpoint.path,
    status: endpoint.localApprovalRequired ? 'pending_local_operator' : 'ready_read_only',
    operatorActions: endpoint.localApprovalRequired ? ['approve_draft', 'cancel_draft'] : ['acknowledge'],
    reason: endpoint.localApprovalRequired
      ? 'This draft-only mobile action requires a local operator to review and approve the draft.'
      : endpoint.policy.reason,
    localApprovalRequired: endpoint.localApprovalRequired,
    canDispatch: false,
  }));
  const blockedItems: AuditMobileSupervisionApprovalQueueResponse['items'] =
    contract.blockedOperations.map((operation) => ({
      id: `blocked.${operation.action}`,
      source: 'blocked_operation',
      action: operation.action,
      description: 'Blocked mobile operation stub.',
      method: 'POST',
      path: `${contract.basePath}/blocked`,
      status: 'blocked_by_policy',
      operatorActions: ['reject'],
      reason: operation.policy.reason,
      localApprovalRequired: true,
      canDispatch: false,
    }));
  const items = [...endpointItems, ...blockedItems];

  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'mobile_supervision_approval_queue',
    mode: 'local_review_queue',
    query: contract.query,
    basePath: contract.basePath,
    pairing: {
      acceptedByListener: false,
      deviceLabel: pairingState.pairing.deviceLabel,
      status: 'preview_only',
      tokenIssued: false,
    },
    listener: {
      listenerStatus: pairingState.listener.listenerStatus,
      serverStarted: false,
    },
    counts: {
      blocked: items.filter((item) => item.status === 'blocked_by_policy').length,
      pending: items.filter((item) => item.status === 'pending_local_operator').length,
      ready: items.filter((item) => item.status === 'ready_read_only').length,
      total: items.length,
    },
    items,
    safety: {
      approvalMutationEndpointEnabled: false,
      autoDispatch: false,
      localOnly: true,
      outreachDisabled: true,
      remoteExecutionDisabled: true,
    },
  };
}

function buildEmptyMobileGatewayContract(
  query: string,
  snapshot?: AuditMobileSupervisionSnapshotResponse,
): AuditMobileSupervisionGatewayContractResponse {
  const auth: AuditMobileSupervisionGatewayContractResponse['auth'] = {
    required: true,
    scheme: 'bearer_or_pairing_code',
    scopes: ['mobile:read', 'mobile:draft'],
    ttlSeconds: 900,
  };
  const allowPolicy = (action: string) => ({
    action,
    allowed: true,
    requiresLocalOperator: false,
    reason: 'Allowed as a review-only supervision action; it must not execute tools or mutate local state.',
  });
  const denyPolicy = (action: string) => ({
    action,
    allowed: false,
    requiresLocalOperator: true,
    reason: 'Blocked because mobile supervision disables remote execution and requires local operator approval.',
  });

  return {
    schemaVersion: AUDIT_RUN_SEARCH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'contract_only',
    basePath: '/api/mobile',
    query,
    auth,
    transport: {
      exposure: 'local_first',
      offDeviceTlsRequired: true,
      remoteExecution: 'disabled',
    },
    endpoints: [
      {
        action: 'view_run_summary',
        auth,
        description: 'Return the redacted review-only run snapshot for the current query.',
        id: 'mobile.snapshot.read',
        localApprovalRequired: false,
        method: 'GET',
        path: '/api/mobile/snapshot',
        policy: allowPolicy('view_run_summary'),
        sideEffects: 'none',
      },
      {
        action: 'open_artifact',
        auth,
        description: 'Return metadata or a local deep-link for an artifact path already present in the snapshot.',
        id: 'mobile.artifact.open',
        localApprovalRequired: false,
        method: 'GET',
        path: '/api/mobile/runs/:runId/artifacts/:artifactPath',
        policy: allowPolicy('open_artifact'),
        sideEffects: 'none',
      },
      {
        action: 'copy_recall_pack',
        auth,
        description: 'Return the redacted recall-pack prompt context for copy/share by the operator.',
        id: 'mobile.recall.copy',
        localApprovalRequired: false,
        method: 'GET',
        path: '/api/mobile/recall-pack',
        policy: allowPolicy('copy_recall_pack'),
        sideEffects: 'none',
      },
      {
        action: 'draft_followup_prompt',
        auth,
        description: 'Create a draft prompt only; it must not dispatch, execute tools, mutate files, or send messages.',
        id: 'mobile.followup.draft',
        localApprovalRequired: true,
        method: 'POST',
        path: '/api/mobile/followup-draft',
        policy: allowPolicy('draft_followup_prompt'),
        sideEffects: 'draft_only',
      },
    ],
    blockedOperations: ['execute_tool', 'modify_files', 'send_email', 'approve_sensitive_operation', 'read_secret_values', 'push_changes']
      .map((action) => ({ action, policy: denyPolicy(action) })),
    snapshot,
  };
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[,"\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeSearchQuery(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function getToolFilterBlocks(trajectory: AuditRunTrajectoryExportResponse): AuditToolFilterBlock[] {
  const blocks: AuditToolFilterBlock[] = [];
  const seen = new Set<string>();

  const pushBlock = (block: AuditToolFilterBlock) => {
    const key = [
      block.sequence ?? '',
      block.toolCallId ?? '',
      block.toolName,
      block.reason ?? '',
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    blocks.push(block);
  };

  for (const event of trajectory.events ?? []) {
    const data = asRecord(event.data);
    if (!data) continue;

    const kind = readString(data.kind);
    const source = readString(data.source);
    const blockedBy = readString(data.blockedBy);
    const error = readString(data.error);
    const reason = readString(data.reason) ?? error;
    const isFilterDecision =
      event.type === 'decision' && (kind === 'tool_filter_block' || source === 'active_tool_filter');
    const isFilterResult =
      event.type === 'tool_result' &&
      (blockedBy === 'active_tool_filter' || /active tool filter/i.test(reason ?? ''));

    if (!isFilterDecision && !isFilterResult) continue;

    pushBlock({
      reason,
      sequence: event.sequence,
      source: source ?? blockedBy,
      toolCallId: readString(data.toolCallId),
      toolName: readString(data.toolName) ?? readString(data.name) ?? 'unknown_tool',
    });
  }

  for (const result of trajectory.toolResults ?? []) {
    const error = readString(result.error);
    if (!/active tool filter/i.test(error ?? '')) continue;
    pushBlock({
      reason: error,
      sequence: result.sequence,
      source: 'active_tool_filter',
      toolName: result.toolName,
    });
  }

  return blocks;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function normalizeSearchLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}

function normalizeMaxBytes(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(50_000, Math.max(200, Math.trunc(value as number)));
}

function normalizePolicyIds(values: string[] | undefined): string[] {
  return normalizeEvalIds(values);
}

function normalizeEvalIds(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeMaxMatchesPerRun(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.trunc(value as number)));
}

function normalizeMaxLessons(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizeMaxMemories(value: number | undefined): number {
  if (!Number.isFinite(value)) return 5;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizeMaxSessions(value: number | undefined): number {
  if (!Number.isFinite(value)) return 3;
  return Math.min(20, Math.max(0, Math.trunc(value as number)));
}

function normalizePairingTtlSeconds(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 300;
  return Math.min(900, Math.max(60, Math.trunc(value as number)));
}

function normalizeGatewayAction(value: string | undefined): string {
  return normalizeOptionalString(value) ?? 'view_run_summary';
}

function normalizeGatewayMethod(value: string | undefined): 'GET' | 'POST' {
  return value?.trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
}

function normalizeGatewayPath(value: string | undefined): string {
  return normalizeOptionalString(value) ?? '/api/mobile/snapshot';
}

function buildMobileGatewayReviewDraftId(
  request: AuditMobileSupervisionGatewayReviewDraftResponse['request'],
): string {
  return [
    'mobile-review',
    request.method.toLowerCase(),
    request.action.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'action',
    request.path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'path',
  ].join('-');
}

function normalizeSearchSources(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .flatMap((value) => value.split(','))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function matchesAuditRunSources(summary: AuditRunSummary, requestedSources: string[]): boolean {
  const requested = new Set(requestedSources.flatMap((source) => expandAuditSourceAliases(source)));
  const candidates = new Set(
    auditRunSourceCandidates(summary).flatMap((source) => expandAuditSourceAliases(source)),
  );
  return [...requested].some((source) => candidates.has(source));
}

function auditRunSourceCandidates(summary: AuditRunSummary): string[] {
  return [...new Set(
    [
      summary.channel,
      summary.source,
      summary.platform,
      summary.origin,
      ...(summary.tags ?? []),
    ]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function expandAuditSourceAliases(value: string): string[] {
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
    case 'mobile':
    case 'phone':
      return ['mobile', 'phone'];
    default:
      return [value];
  }
}

/**
 * Build a CSV export for the given filter. Header columns match the
 * `AuditRunSummary` shape plus a couple of derived columns.
 */
export async function exportCsv(filter?: AuditRunFilter): Promise<string> {
  const runs = await listRuns(filter);
  const header = [
    'runId',
    'objective',
    'status',
    'startedAt',
    'endedAt',
    'durationMs',
    'eventCount',
    'artifactCount',
    'channel',
    'sessionId',
    'userId',
    'totalCost',
    'totalTokens',
    'toolCallCount',
    'tags',
  ];
  const lines: string[] = [header.join(',')];
  for (const run of runs) {
    lines.push(
      [
        csvEscape(run.runId),
        csvEscape(run.objective),
        csvEscape(run.status),
        csvEscape(new Date(run.startedAt).toISOString()),
        csvEscape(run.endedAt ? new Date(run.endedAt).toISOString() : ''),
        csvEscape(run.durationMs ?? ''),
        csvEscape(run.eventCount),
        csvEscape(run.artifactCount),
        csvEscape(run.channel ?? ''),
        csvEscape(run.sessionId ?? ''),
        csvEscape(run.userId ?? ''),
        csvEscape(run.totalCost ?? ''),
        csvEscape(run.totalTokens ?? ''),
        csvEscape(run.toolCallCount ?? ''),
        csvEscape((run.tags ?? []).join('|')),
      ].join(',')
    );
  }
  return lines.join('\n');
}
