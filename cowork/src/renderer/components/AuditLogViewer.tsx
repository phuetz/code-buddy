/**
 * AuditLogViewer — Claude Cowork parity Phase 3 step 10
 *
 * Table browser for runs persisted by the core RunStore. Supports filtering
 * by status/session/date, expanding a row to view its events.jsonl, and
 * CSV export of the currently filtered set. Data is fetched lazily via
 * `window.electronAPI.audit`; no polling by default.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useWorkingDir } from '../store/selectors';
import {
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  Clock,
  Activity,
  AlertCircle,
  Loader2,
  Search,
  Clipboard,
  Check,
  Send,
  Smartphone,
  ShieldCheck,
  KeyRound,
  ListChecks,
} from 'lucide-react';
import { formatAppDateTime, formatAppNumber, formatAppTime, joinAppList } from '../utils/i18n-format';

interface AuditRunSummary {
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
  userId?: string;
  tags?: string[];
  totalCost?: number;
  totalTokens?: number;
  toolCallCount?: number;
}

interface AuditRunEvent {
  ts: number;
  type: string;
  runId: string;
  data: Record<string, unknown>;
}

interface AuditProofLedgerCommand {
  command?: string;
  durationMs?: number;
  error?: unknown;
  isTest: boolean;
  sequence: number;
  success?: boolean;
  toolName: string;
  ts: number;
}

interface AuditProofLedgerEntry {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'proof_ledger_entry';
  status: 'proven' | 'incomplete' | 'failed';
  summary: string;
  commands?: AuditProofLedgerCommand[];
  privacy: {
    artifactContentIncluded: false;
    redaction: 'secrets-redacted';
    redactionCount: number;
  };
  tests: {
    commands?: AuditProofLedgerCommand[];
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

interface AuditRunDetail extends AuditRunSummary {
  events: AuditRunEvent[];
  metrics: Record<string, number>;
  artifacts: string[];
  proofLedger?: AuditProofLedgerEntry;
}

interface AuditRunSearchResult {
  runId: string;
  objective: string;
  status: AuditRunSummary['status'];
  startedAt: number;
  matched: 'artifact' | 'event' | 'summary';
  score: number;
  snippet: string;
  artifact?: string;
  eventType?: string;
  source?: string;
}

interface AuditRunSearchResponse {
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

interface AuditRunRecallPackResponse extends AuditRunSearchResponse {
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
  runCount: number;
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
  promptContext: string;
}

interface AuditRunTrajectoryExportResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'run_trajectory_export';
  mode: 'redacted_review_export';
  run: {
    runId: string;
    objective: string;
    status: AuditRunSummary['status'];
    startedAt: number;
    eventCount: number;
    artifactCount: number;
    source?: string;
    tags: string[];
  };
  privacy: {
    artifactContentIncluded: boolean;
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
    toolName: string;
    sequence: number;
  }>;
  toolResults: Array<{
    toolName: string;
    sequence: number;
    success?: boolean;
  }>;
  artifacts: Array<{
    contentPreview?: string;
    name: string;
  }>;
  finalAnswer?: unknown;
  events: Array<{
    sequence: number;
    type: string;
  }>;
}

interface AuditToolFilterBlock {
  reason?: string;
  sequence?: number;
  source?: string;
  toolCallId?: string;
  toolName: string;
}

interface AuditPolicyEvalReportResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'policy_eval_report';
  mode: 'redacted_trajectory_policy_eval';
  runId: string;
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
  safety: {
    mutationDisabled: true;
    readOnly: true;
    toolReplay: false;
  };
  results: Array<{
    kind: 'policy_eval_result';
    passed: boolean;
    policy: {
      id: string;
      title: string;
    };
    results: Array<{
      assertionId: string;
      passed: boolean;
      reason: string;
    }>;
  }>;
  trajectory: {
    artifactContentIncluded: boolean;
    kind: 'run_trajectory_export';
    redaction: 'secrets-redacted';
    toolFilterBlocks?: AuditToolFilterBlock[];
  };
}

interface AuditGoldenWorkflowEvalReportResponse {
  schemaVersion: 1;
  generatedAt: string;
  kind: 'golden_workflow_eval_report';
  mode: 'redacted_trajectory_golden_eval';
  runId: string;
  summary: {
    failed: number;
    passed: number;
    total: number;
  };
  safety: {
    mutationDisabled: true;
    readOnly: true;
    toolReplay: false;
  };
  results: Array<{
    kind: 'golden_workflow_eval_result';
    passed: boolean;
    fixture: {
      id: string;
      title: string;
    };
    results: Array<{
      assertionId: string;
      passed: boolean;
      reason: string;
    }>;
  }>;
  trajectory: {
    artifactContentIncluded: boolean;
    kind: 'run_trajectory_export';
    redaction: 'secrets-redacted';
    toolFilterBlocks?: AuditToolFilterBlock[];
  };
}

type AuditEvalReportResponse = AuditPolicyEvalReportResponse | AuditGoldenWorkflowEvalReportResponse;

interface AuditMobileSnapshotResponse {
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
    promptContext: string;
    runCount: number;
  };
  runs: Array<{
    artifactPaths: string[];
    bestSnippet?: string;
    objective: string;
    runId: string;
    source?: string;
    status: AuditRunSummary['status'];
  }>;
}

interface AuditMobileGatewayContractResponse {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'contract_only';
  basePath: string;
  query: string;
  transport: {
    remoteExecution: 'disabled';
  };
  endpoints: Array<{
    action: string;
    path: string;
    sideEffects: 'none' | 'draft_only';
  }>;
  blockedOperations: Array<{
    action: string;
    policy: {
      allowed: boolean;
      requiresLocalOperator: boolean;
    };
  }>;
}

interface AuditMobileGatewayReviewDraftResponse {
  schemaVersion: 1;
  generatedAt: string;
  query: string;
  draftId: string;
  request: {
    action: string;
    method: 'GET' | 'POST';
    path: string;
    localOperator?: boolean;
  };
  decision: {
    allowed: boolean;
    requiresLocalOperator: boolean;
    sideEffects: 'none' | 'draft_only';
  };
  status: 'ready' | 'needs_local_operator' | 'blocked';
  operatorActions: string[];
  safety: {
    autoDispatch: false;
    localOnly: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

interface AuditMobileGatewayListenerShellResponse {
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
  transport: {
    listener: 'not_started';
    remoteExecution: 'disabled';
  };
  safety: {
    mutationRoutesDisabled: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
    serverStarted: false;
  };
  routes: Array<{
    action: string;
    handler: string;
    sideEffects: 'none' | 'draft_only' | 'blocked';
  }>;
  blockedRoutes: Array<{
    action: string;
    handler: string;
  }>;
  acceptanceChecks: string[];
}

interface AuditMobilePairingStateResponse {
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

interface AuditMobilePairingAcceptancePlanResponse {
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
    description?: string;
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

interface AuditMobileApprovalQueueResponse {
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
    action: string;
    canDispatch: false;
    description?: string;
    id?: string;
    method?: 'GET' | 'POST';
    operatorActions: string[];
    path: string;
    reason?: string;
    reviewDraft?: AuditMobileGatewayReviewDraftResponse;
    status: 'ready_read_only' | 'pending_local_operator' | 'blocked_by_policy';
  }>;
  safety: {
    approvalMutationEndpointEnabled: false;
    autoDispatch: false;
    localOnly: true;
    outreachDisabled: true;
    remoteExecutionDisabled: true;
  };
}

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
type SourceFilter = 'all' | 'cli' | 'cowork' | 'fleet' | 'scheduled' | 'mobile';

function getRecallPackSources(sourceFilter: SourceFilter): string[] {
  return sourceFilter === 'all' ? [] : [sourceFilter];
}

function buildRecallPackFleetGoal(query: string, promptContext: string): string {
  return [
    `Continue from this recall pack for: ${query}`,
    '',
    promptContext,
    '',
    'Use this cited context to propose the next safe step. Keep external outreach disabled unless an operator explicitly approves it.',
  ].join('\n');
}

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function fmtCost(cost?: number): string {
  if (cost === undefined || cost === null) return '—';
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function fmtTs(ts: number): string {
  try {
    return formatAppDateTime(ts);
  } catch {
    return String(ts);
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-success/20 text-success';
    case 'failed':
      return 'bg-error/20 text-error';
    case 'cancelled':
      return 'bg-warning/20 text-warning';
    case 'running':
    default:
      return 'bg-accent/20 text-accent';
  }
}

function proofStatusClass(status: AuditProofLedgerEntry['status']): string {
  switch (status) {
    case 'proven':
      return 'bg-success/15 text-success border-success/30';
    case 'failed':
      return 'bg-error/15 text-error border-error/30';
    case 'incomplete':
    default:
      return 'bg-warning/15 text-warning border-warning/30';
  }
}

function proofCommandStatusClass(success?: boolean): string {
  if (success === true) return 'bg-success/15 text-success border-success/30';
  if (success === false) return 'bg-error/15 text-error border-error/30';
  return 'bg-surface border-border text-text-muted';
}

function proofCommandStatusLabel(success?: boolean): string {
  if (success === true) return 'passed';
  if (success === false) return 'failed';
  return 'unknown';
}

function formatProofCommandText(command: AuditProofLedgerCommand): string {
  return (command.command ?? command.toolName).replace(/\s+/g, ' ').trim();
}

function getProofCommandTimeline(entry: AuditProofLedgerEntry): AuditProofLedgerCommand[] {
  const commands = entry.commands ?? [];
  if (commands.length > 0) return commands;
  return entry.tests.commands ?? [];
}

function getEvalReportSubjects(report: AuditEvalReportResponse): string[] {
  if (report.kind === 'golden_workflow_eval_report') {
    return report.results.slice(0, 3).map((result) => result.fixture.title);
  }
  return report.results.slice(0, 3).map((result) => result.policy.title);
}

function getToolFilterBlockNames(blocks: AuditToolFilterBlock[]): string[] {
  return [...new Set(blocks.map((block) => block.toolName).filter(Boolean))].slice(0, 4);
}

export function AuditLogViewer() {
  const { t } = useTranslation();
  const workingDir = useWorkingDir();
  const setFleetGoalDraft = useAppStore((s) => s.setFleetGoalDraft);
  const setShowFleetCommandCenter = useAppStore((s) => s.setShowFleetCommandCenter);
  const [runs, setRuns] = useState<AuditRunSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sessionFilter, setSessionFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<Record<string, AuditRunSearchResult>>({});
  const [isCopyingRecallPack, setIsCopyingRecallPack] = useState(false);
  const [isSendingRecallPack, setIsSendingRecallPack] = useState(false);
  const [isCopyingMobileSnapshot, setIsCopyingMobileSnapshot] = useState(false);
  const [isCopyingMobileContract, setIsCopyingMobileContract] = useState(false);
  const [isCopyingMobileReviewDraft, setIsCopyingMobileReviewDraft] = useState(false);
  const [isCopyingMobileListenerShell, setIsCopyingMobileListenerShell] = useState(false);
  const [isCopyingMobilePairingState, setIsCopyingMobilePairingState] = useState(false);
  const [isCopyingMobilePairingAcceptancePlan, setIsCopyingMobilePairingAcceptancePlan] = useState(false);
  const [isReviewingMobilePairingAcceptancePlan, setIsReviewingMobilePairingAcceptancePlan] = useState(false);
  const [isCopyingMobileApprovalQueue, setIsCopyingMobileApprovalQueue] = useState(false);
  const [isReviewingMobileApprovalQueue, setIsReviewingMobileApprovalQueue] = useState(false);
  const [copyingTrajectoryRunId, setCopyingTrajectoryRunId] = useState<string | null>(null);
  const [reviewingEvalRunId, setReviewingEvalRunId] = useState<string | null>(null);
  const [copyingPolicyEvalRunId, setCopyingPolicyEvalRunId] = useState<string | null>(null);
  const [copyingGoldenEvalRunId, setCopyingGoldenEvalRunId] = useState<string | null>(null);
  const [recallPackCopied, setRecallPackCopied] = useState(false);
  const [recallPackSent, setRecallPackSent] = useState(false);
  const [mobileSnapshotCopied, setMobileSnapshotCopied] = useState(false);
  const [mobileContractCopied, setMobileContractCopied] = useState(false);
  const [mobileReviewDraftCopied, setMobileReviewDraftCopied] = useState(false);
  const [mobileListenerShellCopied, setMobileListenerShellCopied] = useState(false);
  const [mobilePairingStateCopied, setMobilePairingStateCopied] = useState(false);
  const [mobilePairingAcceptancePlanCopied, setMobilePairingAcceptancePlanCopied] = useState(false);
  const [mobileApprovalQueueCopied, setMobileApprovalQueueCopied] = useState(false);
  const [copiedMobileApprovalItemId, setCopiedMobileApprovalItemId] = useState<string | null>(null);
  const [copiedTrajectoryRunId, setCopiedTrajectoryRunId] = useState<string | null>(null);
  const [reviewedEvalRunId, setReviewedEvalRunId] = useState<string | null>(null);
  const [copiedPolicyEvalRunId, setCopiedPolicyEvalRunId] = useState<string | null>(null);
  const [copiedGoldenEvalRunId, setCopiedGoldenEvalRunId] = useState<string | null>(null);
  const [policyEvalReportPreview, setPolicyEvalReportPreview] =
    useState<AuditPolicyEvalReportResponse | null>(null);
  const [goldenEvalReportPreview, setGoldenEvalReportPreview] =
    useState<AuditGoldenWorkflowEvalReportResponse | null>(null);
  const [limit, setLimit] = useState(50);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AuditRunDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [mobilePairingAcceptancePlanPreview, setMobilePairingAcceptancePlanPreview] =
    useState<AuditMobilePairingAcceptancePlanResponse | null>(null);
  const [mobileApprovalQueuePreview, setMobileApprovalQueuePreview] =
    useState<AuditMobileApprovalQueueResponse | null>(null);

  const load = useCallback(async () => {
    if (!window.electronAPI?.audit?.listRuns) {
      setError(t('audit.unavailable', 'Audit store unavailable'));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const trimmedSearch = searchQuery.trim();
      const filter: Record<string, unknown> = {
        limit: trimmedSearch ? Math.max(100, limit) : limit,
      };
      if (statusFilter !== 'all') filter.status = statusFilter;
      if (sourceFilter !== 'all') filter.sources = [sourceFilter];
      if (sessionFilter.trim()) filter.sessionId = sessionFilter.trim();

      if (trimmedSearch && window.electronAPI.audit.searchRuns) {
        const sources = sourceFilter === 'all' ? [] : [sourceFilter];
        const [searchResponse, hydratedRuns] = await Promise.all([
          window.electronAPI.audit.searchRuns({ query: trimmedSearch, limit, sources }),
          window.electronAPI.audit.listRuns(filter),
        ]) as [AuditRunSearchResponse, AuditRunSummary[]];
        const runsById = new Map((Array.isArray(hydratedRuns) ? hydratedRuns : []).map((run) => [run.runId, run]));
        const firstMatchByRun: Record<string, AuditRunSearchResult> = {};
        const orderedRuns: AuditRunSummary[] = [];
        for (const result of searchResponse.results ?? []) {
          if (!firstMatchByRun[result.runId]) {
            firstMatchByRun[result.runId] = result;
          }
          const run = runsById.get(result.runId);
          if (run && !orderedRuns.some((entry) => entry.runId === run.runId)) {
            orderedRuns.push(run);
          }
        }
        setSearchMatches(firstMatchByRun);
        setRuns(orderedRuns);
        return;
      }

      const list = (await window.electronAPI.audit.listRuns(filter)) as AuditRunSummary[];
      setSearchMatches({});
      setRuns(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [limit, statusFilter, sourceFilter, sessionFilter, searchQuery, t]);

  useEffect(() => {
    setRecallPackCopied(false);
    setRecallPackSent(false);
    setMobileSnapshotCopied(false);
    setMobileContractCopied(false);
    setMobileReviewDraftCopied(false);
    setMobileListenerShellCopied(false);
    setMobilePairingStateCopied(false);
    setMobilePairingAcceptancePlanCopied(false);
    setMobileApprovalQueueCopied(false);
    setCopiedMobileApprovalItemId(null);
    setMobilePairingAcceptancePlanPreview(null);
    setMobileApprovalQueuePreview(null);
    setCopiedTrajectoryRunId(null);
  }, [searchQuery, sourceFilter, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleRow = useCallback(
    async (runId: string) => {
      if (expanded === runId) {
        setExpanded(null);
        return;
      }
      setExpanded(runId);
      if (detailCache[runId]) return;
      if (!window.electronAPI?.audit?.getRunDetail) return;
      setLoadingDetail(runId);
      try {
        const detail = (await window.electronAPI.audit.getRunDetail(runId)) as AuditRunDetail | null;
        if (detail) {
          setDetailCache((prev) => ({ ...prev, [runId]: detail }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingDetail(null);
      }
    },
    [expanded, detailCache]
  );

  const handleExport = useCallback(async () => {
    if (!window.electronAPI?.audit?.exportCsv) return;
    try {
      const filter: Record<string, unknown> = { limit };
      if (statusFilter !== 'all') filter.status = statusFilter;
      if (sourceFilter !== 'all') filter.sources = [sourceFilter];
      if (sessionFilter.trim()) filter.sessionId = sessionFilter.trim();
      const csv = (await window.electronAPI.audit.exportCsv(filter)) as string;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-runs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [limit, statusFilter, sourceFilter, sessionFilter]);

  const handleCopyTrajectoryExport = useCallback(async (runId: string) => {
    if (!window.electronAPI?.audit?.buildTrajectoryExport) {
      setError(t('audit.trajectoryExportUnavailable', 'Trajectory export builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setCopyingTrajectoryRunId(runId);
    setError(null);
    try {
      const exported = (await window.electronAPI.audit.buildTrajectoryExport({
        includeArtifactContent: false,
        maxArtifactBytes: 4000,
        maxEventValueBytes: 2000,
        runId,
      })) as AuditRunTrajectoryExportResponse | null;
      if (!exported) {
        setError(t('audit.trajectoryExportUnavailable', 'Trajectory export builder unavailable'));
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(exported, null, 2));
      setCopiedTrajectoryRunId(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopyingTrajectoryRunId(null);
    }
  }, [t]);

  const handleCopyPolicyEvalReport = useCallback(async (runId: string) => {
    if (!window.electronAPI?.audit?.buildPolicyEvalReport) {
      setError(t('audit.policyEvalUnavailable', 'Policy eval builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setCopyingPolicyEvalRunId(runId);
    setError(null);
    try {
      const report = (await window.electronAPI.audit.buildPolicyEvalReport({
        maxArtifactBytes: 8000,
        runId,
      })) as AuditPolicyEvalReportResponse | null;
      if (!report) {
        setError(t('audit.policyEvalUnavailable', 'Policy eval builder unavailable'));
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopiedPolicyEvalRunId(runId);
      setPolicyEvalReportPreview(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopyingPolicyEvalRunId(null);
    }
  }, [t]);

  const handleCopyGoldenWorkflowEvalReport = useCallback(async (runId: string) => {
    if (!window.electronAPI?.audit?.buildGoldenWorkflowEvalReport) {
      setError(t('audit.goldenEvalUnavailable', 'Golden eval builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setCopyingGoldenEvalRunId(runId);
    setError(null);
    try {
      const report = (await window.electronAPI.audit.buildGoldenWorkflowEvalReport({
        maxArtifactBytes: 8000,
        runId,
      })) as AuditGoldenWorkflowEvalReportResponse | null;
      if (!report) {
        setError(t('audit.goldenEvalUnavailable', 'Golden eval builder unavailable'));
        return;
      }
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopiedGoldenEvalRunId(runId);
      setGoldenEvalReportPreview(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCopyingGoldenEvalRunId(null);
    }
  }, [t]);

  const handleReviewEvalReports = useCallback(async (runId: string) => {
    const audit = window.electronAPI?.audit;
    if (!audit?.buildGoldenWorkflowEvalReport || !audit?.buildPolicyEvalReport) {
      setError(t('audit.evalReportReviewUnavailable', 'Eval report review unavailable'));
      return;
    }
    setReviewingEvalRunId(runId);
    setError(null);
    try {
      const [goldenReport, policyReport] = await Promise.all([
        audit.buildGoldenWorkflowEvalReport({
          maxArtifactBytes: 8000,
          runId,
        }) as Promise<AuditGoldenWorkflowEvalReportResponse | null>,
        audit.buildPolicyEvalReport({
          maxArtifactBytes: 8000,
          runId,
        }) as Promise<AuditPolicyEvalReportResponse | null>,
      ]);
      if (!goldenReport && !policyReport) {
        setError(t('audit.evalReportReviewUnavailable', 'Eval report review unavailable'));
        return;
      }
      if (goldenReport) setGoldenEvalReportPreview(goldenReport);
      if (policyReport) setPolicyEvalReportPreview(policyReport);
      setReviewedEvalRunId(runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewingEvalRunId(null);
    }
  }, [t]);

  const handleCopyRecallPack = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildRecallPack) {
      setError(t('audit.recallPackUnavailable', 'Recall pack builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingRecallPack(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const pack = (await window.electronAPI.audit.buildRecallPack({
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxMatchesPerRun: 3,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditRunRecallPackResponse;
      await navigator.clipboard.writeText(pack.promptContext);
      setRecallPackCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingRecallPack(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleSendRecallPackToFleet = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildRecallPack) {
      setError(t('audit.recallPackUnavailable', 'Recall pack builder unavailable'));
      return;
    }
    setIsSendingRecallPack(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const pack = (await window.electronAPI.audit.buildRecallPack({
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxMatchesPerRun: 3,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditRunRecallPackResponse;
      setFleetGoalDraft({
        goal: buildRecallPackFleetGoal(query, pack.promptContext),
        dispatchProfile: 'research',
        privacyTag: 'public',
      });
      setShowFleetCommandCenter(true);
      setRecallPackSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingRecallPack(false);
    }
  }, [
    limit,
    searchQuery,
    setFleetGoalDraft,
    setShowFleetCommandCenter,
    sourceFilter,
    t,
    workingDir,
  ]);

  const handleCopyMobileSnapshot = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildMobileSnapshot) {
      setError(t('audit.mobileSnapshotUnavailable', 'Mobile snapshot builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobileSnapshot(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const snapshot = (await window.electronAPI.audit.buildMobileSnapshot({
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditMobileSnapshotResponse;
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setMobileSnapshotCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobileSnapshot(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleCopyMobileContract = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildMobileGatewayContract) {
      setError(t('audit.mobileContractUnavailable', 'Mobile gateway contract builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobileContract(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const contract = (await window.electronAPI.audit.buildMobileGatewayContract({
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        includeSnapshot: false,
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditMobileGatewayContractResponse;
      await navigator.clipboard.writeText(JSON.stringify(contract, null, 2));
      setMobileContractCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobileContract(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleCopyMobileReviewDraft = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildMobileGatewayReviewDraft) {
      setError(t('audit.mobileReviewDraftUnavailable', 'Mobile review draft builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobileReviewDraft(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const draft = (await window.electronAPI.audit.buildMobileGatewayReviewDraft({
        action: 'draft_followup_prompt',
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        includeSnapshot: true,
        localOperator: false,
        method: 'POST',
        path: '/api/mobile/followup-draft',
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditMobileGatewayReviewDraftResponse;
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
      setMobileReviewDraftCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobileReviewDraft(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleCopyMobileListenerShell = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildMobileGatewayListenerShell) {
      setError(t('audit.mobileListenerShellUnavailable', 'Mobile listener shell builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobileListenerShell(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const shell = (await window.electronAPI.audit.buildMobileGatewayListenerShell({
        cwd: workingDir ?? undefined,
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
      })) as AuditMobileGatewayListenerShellResponse;
      await navigator.clipboard.writeText(JSON.stringify(shell, null, 2));
      setMobileListenerShellCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobileListenerShell(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleCopyMobilePairingState = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    if (!window.electronAPI?.audit?.buildMobilePairingState) {
      setError(t('audit.mobilePairingStateUnavailable', 'Mobile pairing state builder unavailable'));
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobilePairingState(true);
    setError(null);
    try {
      const sources = getRecallPackSources(sourceFilter);
      const state = (await window.electronAPI.audit.buildMobilePairingState({
        cwd: workingDir ?? undefined,
        deviceLabel: 'Cowork mobile supervisor',
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
        ttlSeconds: 300,
      })) as AuditMobilePairingStateResponse;
      await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
      setMobilePairingStateCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobilePairingState(false);
    }
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const buildMobilePairingAcceptancePlanForCurrentSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return null;
    if (!window.electronAPI?.audit?.buildMobilePairingAcceptancePlan) {
      setError(t('audit.mobilePairingAcceptancePlanUnavailable', 'Mobile pairing acceptance plan builder unavailable'));
      return null;
    }
    const sources = getRecallPackSources(sourceFilter);
    return (await window.electronAPI.audit.buildMobilePairingAcceptancePlan({
      cwd: workingDir ?? undefined,
      deviceLabel: 'Cowork mobile supervisor',
      includeLessons: Boolean(workingDir),
      includeMemories: Boolean(workingDir),
      includeSessions: true,
      localOperatorLabel: 'Cowork local operator',
      query,
      limit,
      maxMemories: 5,
      maxLessons: 5,
      maxSessions: 3,
      sources,
      ttlSeconds: 300,
    })) as AuditMobilePairingAcceptancePlanResponse;
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleReviewMobilePairingAcceptancePlan = useCallback(async () => {
    setIsReviewingMobilePairingAcceptancePlan(true);
    setError(null);
    try {
      const plan = await buildMobilePairingAcceptancePlanForCurrentSearch();
      if (plan) {
        setMobilePairingAcceptancePlanPreview(plan);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReviewingMobilePairingAcceptancePlan(false);
    }
  }, [buildMobilePairingAcceptancePlanForCurrentSearch]);

  const handleCopyMobilePairingAcceptancePlan = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobilePairingAcceptancePlan(true);
    setError(null);
    try {
      const plan = await buildMobilePairingAcceptancePlanForCurrentSearch();
      if (!plan) return;
      await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
      setMobilePairingAcceptancePlanPreview(plan);
      setMobilePairingAcceptancePlanCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobilePairingAcceptancePlan(false);
    }
  }, [buildMobilePairingAcceptancePlanForCurrentSearch, t]);

  const buildMobileApprovalQueueForCurrentSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return null;
    if (!window.electronAPI?.audit?.buildMobileApprovalQueue) {
      setError(t('audit.mobileApprovalQueueUnavailable', 'Mobile approval queue builder unavailable'));
      return null;
    }
    const sources = getRecallPackSources(sourceFilter);
    return (await window.electronAPI.audit.buildMobileApprovalQueue({
        cwd: workingDir ?? undefined,
        deviceLabel: 'Cowork mobile supervisor',
        includeLessons: Boolean(workingDir),
        includeMemories: Boolean(workingDir),
        includeSessions: true,
        query,
        limit,
        maxMemories: 5,
        maxLessons: 5,
        maxSessions: 3,
        sources,
        ttlSeconds: 300,
      })) as AuditMobileApprovalQueueResponse;
  }, [limit, searchQuery, sourceFilter, t, workingDir]);

  const handleReviewMobileApprovalQueue = useCallback(async () => {
    setIsReviewingMobileApprovalQueue(true);
    setError(null);
    try {
      const queue = await buildMobileApprovalQueueForCurrentSearch();
      if (queue) {
        setMobileApprovalQueuePreview(queue);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReviewingMobileApprovalQueue(false);
    }
  }, [buildMobileApprovalQueueForCurrentSearch]);

  const handleCopyMobileApprovalQueue = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    setIsCopyingMobileApprovalQueue(true);
    setError(null);
    try {
      const queue = await buildMobileApprovalQueueForCurrentSearch();
      if (!queue) return;
      await navigator.clipboard.writeText(JSON.stringify(queue, null, 2));
      setMobileApprovalQueuePreview(queue);
      setMobileApprovalQueueCopied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCopyingMobileApprovalQueue(false);
    }
  }, [buildMobileApprovalQueueForCurrentSearch, t]);

  const handleCopyMobileApprovalItem = useCallback(async (
    item: AuditMobileApprovalQueueResponse['items'][number],
  ) => {
    if (!navigator.clipboard?.writeText) {
      setError(t('audit.clipboardUnavailable', 'Clipboard unavailable'));
      return;
    }
    const itemId = item.id ?? `${item.action}:${item.path}`;
    setError(null);
    try {
      await navigator.clipboard.writeText(JSON.stringify(item.reviewDraft ?? item, null, 2));
      setCopiedMobileApprovalItemId(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  const totals = useMemo(() => {
    return runs.reduce(
      (acc, r) => {
        acc.cost += r.totalCost ?? 0;
        acc.tokens += r.totalTokens ?? 0;
        acc.tools += r.toolCallCount ?? 0;
        return acc;
      },
      { cost: 0, tokens: 0, tools: 0 }
    );
  }, [runs]);
  const evalReportPreviews = useMemo<AuditEvalReportResponse[]>(() => {
    const previews: AuditEvalReportResponse[] = [];
    if (goldenEvalReportPreview) previews.push(goldenEvalReportPreview);
    if (policyEvalReportPreview) previews.push(policyEvalReportPreview);
    return previews;
  }, [goldenEvalReportPreview, policyEvalReportPreview]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {t('audit.title', 'Audit log')}
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {t('audit.hint', 'Recent agent runs with tools, cost and timing')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => void handleCopyRecallPack()}
            disabled={
              isCopyingRecallPack ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildRecallPack
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyRecallPackHint', 'Copy an agent-ready recall pack for the current search')}
          >
            {isCopyingRecallPack ? (
              <Loader2 size={12} className="animate-spin" />
            ) : recallPackCopied ? (
              <Check size={12} />
            ) : (
              <Clipboard size={12} />
            )}
            {recallPackCopied
              ? t('audit.recallPackCopied', 'Recall pack copied')
              : t('audit.copyRecallPack', 'Copy recall pack')}
          </button>
          <button
            onClick={() => void handleSendRecallPackToFleet()}
            disabled={
              isSendingRecallPack ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildRecallPack
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.sendRecallPackToFleetHint', 'Open Fleet with this recall pack as the next goal')}
          >
            {isSendingRecallPack ? (
              <Loader2 size={12} className="animate-spin" />
            ) : recallPackSent ? (
              <Check size={12} />
            ) : (
              <Send size={12} />
            )}
            {recallPackSent
              ? t('audit.recallPackSent', 'Sent to Fleet')
              : t('audit.sendRecallPackToFleet', 'Send to Fleet')}
          </button>
          <button
            onClick={() => void handleCopyMobileSnapshot()}
            disabled={
              isCopyingMobileSnapshot ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileSnapshot
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobileSnapshotHint', 'Copy a redacted review-only payload for mobile supervision')}
          >
            {isCopyingMobileSnapshot ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobileSnapshotCopied ? (
              <Check size={12} />
            ) : (
              <Smartphone size={12} />
            )}
            {mobileSnapshotCopied
              ? t('audit.mobileSnapshotCopied', 'Mobile snapshot copied')
              : t('audit.copyMobileSnapshot', 'Copy mobile snapshot')}
          </button>
          <button
            onClick={() => void handleCopyMobileContract()}
            disabled={
              isCopyingMobileContract ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileGatewayContract
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobileContractHint', 'Copy the review-only gateway route contract for mobile supervision')}
          >
            {isCopyingMobileContract ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobileContractCopied ? (
              <Check size={12} />
            ) : (
              <ShieldCheck size={12} />
            )}
            {mobileContractCopied
              ? t('audit.mobileContractCopied', 'Mobile contract copied')
              : t('audit.copyMobileContract', 'Copy mobile contract')}
          </button>
          <button
            onClick={() => void handleCopyMobileReviewDraft()}
            disabled={
              isCopyingMobileReviewDraft ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileGatewayReviewDraft
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobileReviewDraftHint', 'Copy a local-only operator review draft for a mobile follow-up request')}
          >
            {isCopyingMobileReviewDraft ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobileReviewDraftCopied ? (
              <Check size={12} />
            ) : (
              <Clipboard size={12} />
            )}
            {mobileReviewDraftCopied
              ? t('audit.mobileReviewDraftCopied', 'Review draft copied')
              : t('audit.copyMobileReviewDraft', 'Copy review draft')}
          </button>
          <button
            onClick={() => void handleCopyMobileListenerShell()}
            disabled={
              isCopyingMobileListenerShell ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileGatewayListenerShell
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobileListenerShellHint', 'Copy the disabled loopback listener shell for mobile supervision')}
          >
            {isCopyingMobileListenerShell ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobileListenerShellCopied ? (
              <Check size={12} />
            ) : (
              <Activity size={12} />
            )}
            {mobileListenerShellCopied
              ? t('audit.mobileListenerShellCopied', 'Listener shell copied')
              : t('audit.copyMobileListenerShell', 'Copy listener shell')}
          </button>
          <button
            onClick={() => void handleCopyMobilePairingState()}
            disabled={
              isCopyingMobilePairingState ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobilePairingState
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobilePairingStateHint', 'Copy preview-only local pairing state for mobile supervision')}
          >
            {isCopyingMobilePairingState ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobilePairingStateCopied ? (
              <Check size={12} />
            ) : (
              <KeyRound size={12} />
            )}
            {mobilePairingStateCopied
              ? t('audit.mobilePairingStateCopied', 'Pairing state copied')
              : t('audit.copyMobilePairingState', 'Copy pairing state')}
          </button>
          <button
            onClick={() => void handleReviewMobilePairingAcceptancePlan()}
            disabled={
              isReviewingMobilePairingAcceptancePlan ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobilePairingAcceptancePlan
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.reviewMobilePairingAcceptancePlanHint', 'Review the no-network pairing acceptance plan')}
          >
            {isReviewingMobilePairingAcceptancePlan ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ShieldCheck size={12} />
            )}
            {t('audit.reviewMobilePairingAcceptancePlan', 'Review acceptance')}
          </button>
          <button
            onClick={() => void handleCopyMobilePairingAcceptancePlan()}
            disabled={
              isCopyingMobilePairingAcceptancePlan ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobilePairingAcceptancePlan
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobilePairingAcceptancePlanHint', 'Copy the no-network pairing acceptance plan')}
          >
            {isCopyingMobilePairingAcceptancePlan ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobilePairingAcceptancePlanCopied ? (
              <Check size={12} />
            ) : (
              <ShieldCheck size={12} />
            )}
            {mobilePairingAcceptancePlanCopied
              ? t('audit.mobilePairingAcceptancePlanCopied', 'Acceptance plan copied')
              : t('audit.copyMobilePairingAcceptancePlan', 'Copy acceptance plan')}
          </button>
          <button
            onClick={() => void handleReviewMobileApprovalQueue()}
            disabled={
              isReviewingMobileApprovalQueue ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileApprovalQueue
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.reviewMobileApprovalQueueHint', 'Review local mobile approval counts without dispatching')}
          >
            {isReviewingMobileApprovalQueue ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <ListChecks size={12} />
            )}
            {t('audit.reviewMobileApprovalQueue', 'Review queue')}
          </button>
          <button
            onClick={() => void handleCopyMobileApprovalQueue()}
            disabled={
              isCopyingMobileApprovalQueue ||
              !searchQuery.trim() ||
              !window.electronAPI?.audit?.buildMobileApprovalQueue
            }
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            title={t('audit.copyMobileApprovalQueueHint', 'Copy the local-only mobile approval queue')}
          >
            {isCopyingMobileApprovalQueue ? (
              <Loader2 size={12} className="animate-spin" />
            ) : mobileApprovalQueueCopied ? (
              <Check size={12} />
            ) : (
              <ListChecks size={12} />
            )}
            {mobileApprovalQueueCopied
              ? t('audit.mobileApprovalQueueCopied', 'Approval queue copied')
              : t('audit.copyMobileApprovalQueue', 'Copy approval queue')}
          </button>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
          >
            {isLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t('common.refresh', 'Refresh')}
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={runs.length === 0}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <Download size={12} />
            {t('audit.exportCsv', 'Export CSV')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={statusFilter}
          onChange={(ev) => setStatusFilter(ev.target.value as StatusFilter)}
          className="px-2 py-1.5 rounded-md bg-surface border border-border text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">{t('audit.allStatuses', 'All statuses')}</option>
          <option value="running">{t('audit.running', 'Running')}</option>
          <option value="completed">{t('audit.completed', 'Completed')}</option>
          <option value="failed">{t('audit.failed', 'Failed')}</option>
          <option value="cancelled">{t('audit.cancelled', 'Cancelled')}</option>
        </select>
        <input
          value={sessionFilter}
          onChange={(ev) => setSessionFilter(ev.target.value)}
          placeholder={t('audit.sessionFilter', 'Session ID')}
          className="px-2 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
        />
        <select
          value={sourceFilter}
          onChange={(ev) => setSourceFilter(ev.target.value as SourceFilter)}
          className="px-2 py-1.5 rounded-md bg-surface border border-border text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">{t('audit.allSources', 'All sources')}</option>
          <option value="cli">{t('audit.sourceCli', 'CLI')}</option>
          <option value="cowork">{t('audit.sourceCowork', 'Cowork')}</option>
          <option value="fleet">{t('audit.sourceFleet', 'Fleet')}</option>
          <option value="scheduled">{t('audit.sourceScheduled', 'Scheduled')}</option>
          <option value="mobile">{t('audit.sourceMobile', 'Mobile')}</option>
        </select>
        <div className="relative min-w-[220px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(ev) => setSearchQuery(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') void load();
            }}
            placeholder={t('audit.searchPlaceholder', 'Search runs, events, artifacts')}
            className="w-full pl-7 pr-2 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <select
          value={limit}
          onChange={(ev) => setLimit(Number(ev.target.value))}
          className="px-2 py-1.5 rounded-md bg-surface border border-border text-text-primary focus:outline-none focus:border-accent"
        >
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <div className="ml-auto flex items-center gap-3 text-text-muted">
          <span>
            {t('audit.totals', 'Totals')}:{' '}
            <span className="text-text-primary">{runs.length}</span> {t('audit.runs', 'runs')}
          </span>
          <span>
            {fmtCost(totals.cost)} · {formatAppNumber(totals.tokens)} {t('audit.tokens', 'tokens')} · {totals.tools}{' '}
            {t('audit.tools', 'tools')}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {evalReportPreviews.length > 0 && (
        <div
          aria-label={t('audit.evalReportPanelTitle', 'Evaluation report summary')}
          className="border border-border rounded-lg bg-surface/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-text-primary font-medium">
                <ListChecks size={13} />
                {t('audit.evalReportPanelTitle', 'Evaluation report summary')}
              </div>
              <div className="mt-0.5 text-text-muted">
                {t('audit.evalReportPanelHint', 'Latest copied evals for expanded runs')}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px] text-text-muted">
              <span className="rounded-full border border-border px-2 py-0.5">
                {t('audit.evalReportReadOnlyGuardrail', 'read-only')}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5">
                {t('audit.evalReportNoReplayGuardrail', 'no tool replay')}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5">
                {t('audit.evalReportMutationOffGuardrail', 'mutations off')}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5">
                {t('audit.evalReportRedactedGuardrail', 'secrets redacted')}
              </span>
            </div>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {evalReportPreviews.map((report) => {
              const isGolden = report.kind === 'golden_workflow_eval_report';
              const label = isGolden
                ? t('audit.evalReportGoldenLabel', 'Golden workflow')
                : t('audit.evalReportPolicyLabel', 'Policy guardrails');
              const subjects = getEvalReportSubjects(report);
              const toolFilterBlocks = report.trajectory.toolFilterBlocks ?? [];
              const toolFilterBlockNames = getToolFilterBlockNames(toolFilterBlocks);
              return (
                <div
                  key={`${report.kind}:${report.runId}`}
                  className="rounded-md border border-border bg-background/60 px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-text-primary">
                      {label} · {report.runId}
                    </div>
                    <span
                      className={
                        report.summary.failed > 0
                          ? 'rounded-full bg-error/15 text-error px-2 py-0.5'
                          : 'rounded-full bg-success/15 text-success px-2 py-0.5'
                      }
                    >
                      {t('audit.evalReportPassed', 'Passed')}: {formatAppNumber(report.summary.passed)}
                      {' / '}
                      {formatAppNumber(report.summary.total)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full border border-border px-2 py-0.5 text-text-muted">
                      {t('audit.evalReportFailed', 'Failed')}: {formatAppNumber(report.summary.failed)}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-text-muted">
                      {t('audit.evalReportAssertionsLabel', 'Assertions')}: {formatAppNumber(report.results.length)}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-text-muted">
                      {report.trajectory.redaction}
                    </span>
                    {toolFilterBlocks.length > 0 && (
                      <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5">
                        {t('audit.evalReportToolFilterBlocks', 'Filtered tool blocks')}:{' '}
                        {formatAppNumber(toolFilterBlocks.length)}
                        {toolFilterBlockNames.length > 0 ? ` · ${joinAppList(toolFilterBlockNames)}` : ''}
                      </span>
                    )}
                  </div>
                  {subjects.length > 0 && (
                    <div className="mt-1.5 text-[11px] text-text-secondary truncate">
                      {joinAppList(subjects)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mobilePairingAcceptancePlanPreview && (
        <div
          aria-label={t('audit.mobilePairingAcceptancePlanPanelTitle', 'Local pairing acceptance plan')}
          className="border border-border rounded-lg bg-surface/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-text-primary font-medium">
                <ShieldCheck size={13} />
                {t('audit.mobilePairingAcceptancePlanPanelTitle', 'Local pairing acceptance plan')}
              </div>
              <div className="mt-0.5 text-text-muted truncate">
                {mobilePairingAcceptancePlanPreview.query} ·{' '}
                {mobilePairingAcceptancePlanPreview.acceptance.endpoint.method}{' '}
                {mobilePairingAcceptancePlanPreview.acceptance.endpoint.path} ·{' '}
                {mobilePairingAcceptancePlanPreview.pairing.deviceLabel}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5">
                {t('audit.mobileAcceptanceCanAcceptLabel', 'Accept now')}: {'false'}
              </span>
              <span className="rounded-full bg-error/15 text-error px-2 py-0.5">
                {t('audit.mobileAcceptanceEndpointDisabledLabel', 'Endpoint disabled')}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileApprovalLocalOnlyGuardrail', 'local-only')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileAcceptanceTokenOffGuardrail', 'token issuance off')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileAcceptanceServerOffGuardrail', 'server off')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileAcceptanceMutationsOffGuardrail', 'acceptance mutations off')}
            </span>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background/60 px-2 py-1.5">
              <div className="font-medium text-text-primary">
                {t('audit.mobileAcceptanceEvidenceLabel', 'Required evidence')}
              </div>
              <div className="mt-0.5 text-text-secondary">
                {joinAppList(mobilePairingAcceptancePlanPreview.acceptance.requiredEvidence)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-2 py-1.5">
              <div className="font-medium text-text-primary">
                {t('audit.mobileAcceptanceMutationPlanLabel', 'Planned mutations')}
              </div>
              <div className="mt-0.5 text-text-secondary">
                {mobilePairingAcceptancePlanPreview.plannedMutations
                  .slice(0, 3)
                  .map((mutation) => `${mutation.id}: enabled=${String(mutation.enabled)}`)
                  .join(' · ')}
              </div>
            </div>
          </div>
        </div>
      )}

      {mobileApprovalQueuePreview && (
        <div
          aria-label={t('audit.mobileApprovalQueuePanelTitle', 'Local mobile approval queue')}
          className="border border-border rounded-lg bg-surface/40 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-text-primary font-medium">
                <ListChecks size={13} />
                {t('audit.mobileApprovalQueuePanelTitle', 'Local mobile approval queue')}
              </div>
              <div className="mt-0.5 text-text-muted truncate">
                {mobileApprovalQueuePreview.query} · {mobileApprovalQueuePreview.basePath} ·{' '}
                {mobileApprovalQueuePreview.pairing.deviceLabel}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-success/15 text-success px-2 py-0.5">
                {t('audit.mobileApprovalReadyLabel', 'Ready read-only')}: {formatAppNumber(mobileApprovalQueuePreview.counts.ready)}
              </span>
              <span className="rounded-full bg-warning/15 text-warning px-2 py-0.5">
                {t('audit.mobileApprovalPendingLabel', 'Pending approval')}: {formatAppNumber(mobileApprovalQueuePreview.counts.pending)}
              </span>
              <span className="rounded-full bg-error/15 text-error px-2 py-0.5">
                {t('audit.mobileApprovalBlockedLabel', 'Blocked')}: {formatAppNumber(mobileApprovalQueuePreview.counts.blocked)}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-text-muted">
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileApprovalLocalOnlyGuardrail', 'local-only')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileApprovalMutationOffGuardrail', 'approval mutations off')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileApprovalAutoDispatchOffGuardrail', 'auto-dispatch off')}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {t('audit.mobileApprovalRemoteExecutionOffGuardrail', 'remote execution off')}
            </span>
          </div>
          {mobileApprovalQueuePreview.items
            .filter((item) => item.status === 'pending_local_operator')
            .slice(0, 2)
            .map((item) => (
              <div
                key={item.id ?? `${item.action}-${item.path}`}
                className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-[11px] text-text-primary truncate">
                    {item.method ?? 'POST'} {item.path} {'->'} {item.action}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyMobileApprovalItem(item)}
                    className="flex items-center gap-1 rounded-md border border-warning/40 bg-background/60 px-2 py-0.5 text-[11px] text-text-primary hover:bg-surface-hover transition-colors"
                    title={t('audit.copyMobileApprovalItemHint', 'Copy this local operator review draft')}
                  >
                    {copiedMobileApprovalItemId === (item.id ?? `${item.action}:${item.path}`) ? (
                      <Check size={11} />
                    ) : (
                      <Clipboard size={11} />
                    )}
                    {copiedMobileApprovalItemId === (item.id ?? `${item.action}:${item.path}`)
                      ? t('audit.mobileApprovalItemCopied', 'Draft copied')
                      : t('audit.copyMobileApprovalItem', 'Copy draft')}
                  </button>
                </div>
                <div className="mt-0.5 text-text-secondary">
                  {t('audit.mobileApprovalPendingActionLabel', 'Operator actions')}: {joinAppList(item.operatorActions)}
                </div>
                {item.reason && (
                  <div className="mt-0.5 text-text-muted">
                    {item.reason}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <div className="grid grid-cols-[28px_1fr_120px_100px_80px_80px_80px] items-center gap-2 px-3 py-2 bg-surface text-[11px] uppercase tracking-wide text-text-muted">
          <span></span>
          <span>{t('audit.objective', 'Objective')}</span>
          <span>{t('audit.status', 'Status')}</span>
          <span className="text-right">{t('audit.duration', 'Duration')}</span>
          <span className="text-right">{t('audit.events', 'Events')}</span>
          <span className="text-right">{t('audit.tools', 'Tools')}</span>
          <span className="text-right">{t('audit.cost', 'Cost')}</span>
        </div>

        {runs.length === 0 && !isLoading && (
          <div className="py-8 text-center text-xs text-text-muted">
            {t('audit.empty', 'No runs recorded yet')}
          </div>
        )}

        <div className="divide-y divide-border-muted">
          {runs.map((run) => {
            const isOpen = expanded === run.runId;
            const detail = detailCache[run.runId];
            const searchMatch = searchMatches[run.runId];
            return (
              <div key={run.runId}>
                <button
                  type="button"
                  onClick={() => void handleToggleRow(run.runId)}
                  className="w-full grid grid-cols-[28px_1fr_120px_100px_80px_80px_80px] items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors"
                >
                  <span className="text-text-muted">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-text-primary truncate">{run.objective}</span>
                    <span className="block text-[10px] text-text-muted mt-0.5 font-mono truncate">
                      {run.runId} · {fmtTs(run.startedAt)}
                      {run.sessionId ? ` · ${run.sessionId}` : ''}
                    </span>
                    {searchMatch && (
                      <span className="block text-[10px] text-text-secondary mt-0.5 truncate">
                        {searchMatch.artifact ?? searchMatch.eventType ?? searchMatch.matched}: {searchMatch.snippet}
                      </span>
                    )}
                  </span>
                  <span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${statusClass(run.status)}`}>
                      {t(`audit.${run.status}`, run.status)}
                    </span>
                  </span>
                  <span className="text-right text-text-secondary tabular-nums">
                    {fmtDuration(run.durationMs)}
                  </span>
                  <span className="text-right text-text-secondary tabular-nums">
                    {run.eventCount}
                  </span>
                  <span className="text-right text-text-secondary tabular-nums">
                    {run.toolCallCount ?? 0}
                  </span>
                  <span className="text-right text-text-secondary tabular-nums">
                    {fmtCost(run.totalCost)}
                  </span>
                </button>

                {isOpen && (
                  <div className="bg-background px-4 py-3 border-t border-border-muted">
                    {loadingDetail === run.runId && (
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <Loader2 size={12} className="animate-spin" />
                        {t('audit.loadingEvents', 'Loading events…')}
                      </div>
                    )}
                    {detail && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                            {detail.channel && (
                              <span>
                                {t('audit.channel', 'Channel')}: {' '}
                                <span className="text-text-primary">{detail.channel}</span>
                              </span>
                            )}
                            {detail.userId && (
                              <span>
                                {t('audit.user', 'User')}:{' '}
                                <span className="text-text-primary">{detail.userId}</span>
                              </span>
                            )}
                            {detail.artifactCount > 0 && (
                              <span>
                                {t('audit.artifacts', 'Artifacts')}:{' '}
                                <span className="text-text-primary">{detail.artifactCount}</span>
                              </span>
                            )}
                            {(detail.tags ?? []).length > 0 && (
                              <span>
                                {t('audit.tags', 'Tags')}:{' '}
                                <span className="text-text-primary">{joinAppList(detail.tags ?? [])}</span>
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleCopyTrajectoryExport(detail.runId)}
                            disabled={
                              copyingTrajectoryRunId === detail.runId ||
                              !window.electronAPI?.audit?.buildTrajectoryExport
                            }
                            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                            title={t('audit.copyTrajectoryExportHint', 'Copy a redacted trajectory export for this run')}
                          >
                            {copyingTrajectoryRunId === detail.runId ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : copiedTrajectoryRunId === detail.runId ? (
                              <Check size={11} />
                            ) : (
                              <Clipboard size={11} />
                            )}
                            {copiedTrajectoryRunId === detail.runId
                              ? t('audit.trajectoryExportCopied', 'Trajectory copied')
                              : t('audit.copyTrajectoryExport', 'Copy trajectory')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleReviewEvalReports(detail.runId)}
                            disabled={
                              reviewingEvalRunId === detail.runId ||
                              !window.electronAPI?.audit?.buildGoldenWorkflowEvalReport ||
                              !window.electronAPI?.audit?.buildPolicyEvalReport
                            }
                            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                            title={t('audit.reviewEvalReportsHint', 'Review golden and policy eval summaries without copying JSON')}
                          >
                            {reviewingEvalRunId === detail.runId ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : reviewedEvalRunId === detail.runId ? (
                              <Check size={11} />
                            ) : (
                              <ListChecks size={11} />
                            )}
                            {reviewedEvalRunId === detail.runId
                              ? t('audit.evalReportsReviewed', 'Evals reviewed')
                              : t('audit.reviewEvalReports', 'Review evals')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyGoldenWorkflowEvalReport(detail.runId)}
                            disabled={
                              copyingGoldenEvalRunId === detail.runId ||
                              !window.electronAPI?.audit?.buildGoldenWorkflowEvalReport
                            }
                            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                            title={t('audit.copyGoldenEvalHint', 'Copy golden workflow eval results for this run')}
                          >
                            {copyingGoldenEvalRunId === detail.runId ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : copiedGoldenEvalRunId === detail.runId ? (
                              <Check size={11} />
                            ) : (
                              <ListChecks size={11} />
                            )}
                            {copiedGoldenEvalRunId === detail.runId
                              ? t('audit.goldenEvalCopied', 'Golden eval copied')
                              : t('audit.copyGoldenEval', 'Copy golden eval')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyPolicyEvalReport(detail.runId)}
                            disabled={
                              copyingPolicyEvalRunId === detail.runId ||
                              !window.electronAPI?.audit?.buildPolicyEvalReport
                            }
                            className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                            title={t('audit.copyPolicyEvalHint', 'Copy policy eval results for this run')}
                          >
                            {copyingPolicyEvalRunId === detail.runId ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : copiedPolicyEvalRunId === detail.runId ? (
                              <Check size={11} />
                            ) : (
                              <ShieldCheck size={11} />
                            )}
                            {copiedPolicyEvalRunId === detail.runId
                              ? t('audit.policyEvalCopied', 'Policy eval copied')
                              : t('audit.copyPolicyEval', 'Copy policy eval')}
                          </button>
                        </div>
                        {detail.proofLedger && (
                          <div
                            data-testid="audit-proof-ledger-card"
                            className="rounded-md border border-border-muted bg-surface/40 px-3 py-2 text-[11px]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <ListChecks size={13} className="text-text-muted" />
                                <span className="font-medium text-text-primary">
                                  {t('audit.proofLedgerTitle', 'Proof ledger')}
                                </span>
                                <span
                                  className={`rounded-full border px-2 py-0.5 ${proofStatusClass(detail.proofLedger.status)}`}
                                >
                                  {t(`audit.proofLedger.${detail.proofLedger.status}`, detail.proofLedger.status)}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-text-muted">
                                <span className="rounded-full border border-border px-2 py-0.5">
                                  {t('audit.proofLedgerTests', 'Tests')}: {formatAppNumber(detail.proofLedger.tests.passed)}
                                  {' / '}
                                  {formatAppNumber(detail.proofLedger.tests.total)}
                                </span>
                                <span className="rounded-full border border-border px-2 py-0.5">
                                  {t('audit.proofLedgerArtifacts', 'Artifacts')}: {formatAppNumber(detail.proofLedger.artifacts.length)}
                                </span>
                                <span className="rounded-full border border-border px-2 py-0.5">
                                  {detail.proofLedger.privacy.redaction}
                                </span>
                              </div>
                            </div>
                            <div className="mt-1 text-text-secondary">
                              {detail.proofLedger.summary}
                            </div>
                            {(() => {
                              const commands = getProofCommandTimeline(detail.proofLedger);
                              if (commands.length === 0) return null;
                              return (
                                <div className="mt-2 border-t border-border-muted pt-2">
                                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium text-text-muted">
                                    <span>{t('audit.proofCommandTimeline', 'Command timeline')}</span>
                                    {commands.length > 5 && (
                                      <span>+{formatAppNumber(commands.length - 5)}</span>
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    {commands.slice(0, 5).map((command) => {
                                      const commandText = formatProofCommandText(command);
                                      const result = proofCommandStatusLabel(command.success);
                                      return (
                                        <div
                                          key={`${command.sequence}:${command.toolName}:${command.ts}`}
                                          data-testid="audit-proof-command-row"
                                          className="grid grid-cols-[68px_minmax(0,1fr)_56px] items-center gap-2 rounded-sm border border-border-muted bg-background/55 px-2 py-1"
                                        >
                                          <span
                                            className={`rounded-full border px-1.5 py-0.5 text-center text-[10px] ${proofCommandStatusClass(command.success)}`}
                                          >
                                            {t(`audit.proofCommand.${result}`, result)}
                                          </span>
                                          <span className="min-w-0 truncate" title={commandText}>
                                            <span className="font-mono text-text-muted">#{command.sequence}</span>
                                            <span className="ml-1.5 font-medium text-text-primary">{command.toolName}</span>
                                            {command.isTest && (
                                              <span className="ml-1.5 rounded-full border border-border px-1.5 py-0 text-[10px] text-text-muted">
                                                {t('audit.proofCommandTest', 'test')}
                                              </span>
                                            )}
                                            <span className="ml-1.5 font-mono text-text-secondary">{commandText}</span>
                                          </span>
                                          <span className="text-right font-mono text-[10px] tabular-nums text-text-muted">
                                            {fmtDuration(command.durationMs)}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                            {(detail.proofLedger.risks.length > 0 || detail.proofLedger.filesChanged.length > 0) && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {detail.proofLedger.risks.slice(0, 4).map((risk) => (
                                  <span
                                    key={`${risk.level}:${risk.source}:${risk.detail}`}
                                    className={`max-w-[320px] truncate rounded-full px-2 py-0.5 ${
                                      risk.level === 'high'
                                        ? 'bg-error/15 text-error'
                                        : risk.level === 'medium'
                                          ? 'bg-warning/15 text-warning'
                                          : 'bg-surface border border-border text-text-muted'
                                    }`}
                                    title={`${risk.level}: ${risk.detail}`}
                                  >
                                    {risk.level}: {risk.detail}
                                  </span>
                                ))}
                                {detail.proofLedger.filesChanged.slice(0, 4).map((file) => (
                                  <span
                                    key={file}
                                    className="max-w-[260px] truncate rounded-full border border-border px-2 py-0.5 font-mono text-text-muted"
                                    title={file}
                                  >
                                    {file}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="max-h-60 overflow-y-auto border border-border-muted rounded-md">
                          {detail.events.length === 0 ? (
                            <div className="p-3 text-[11px] text-text-muted">
                              {t('audit.noEvents', 'No events recorded')}
                            </div>
                          ) : (
                            detail.events.map((ev, idx) => (
                              <div
                                key={`${ev.ts}-${idx}`}
                                className="px-3 py-1.5 border-b border-border-muted last:border-0 text-[11px] font-mono flex items-start gap-2"
                              >
                                <Clock size={10} className="mt-0.5 text-text-muted shrink-0" />
                                <span className="text-text-muted w-36 shrink-0">
                                  {formatAppTime(ev.ts, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })}
                                </span>
                                <span className="text-accent w-28 shrink-0 flex items-center gap-1">
                                  <Activity size={10} />
                                  {ev.type}
                                </span>
                                <span className="text-text-secondary flex-1 truncate">
                                  {JSON.stringify(ev.data)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
