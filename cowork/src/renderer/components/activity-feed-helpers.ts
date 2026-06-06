export interface ActivityEntry {
  id: number;
  type: string;
  title: string;
  description?: string;
  sessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export type ActivityFilter = 'all' | 'fleet' | 'scheduled';

export type ActivityActionTone = 'neutral' | 'running' | 'success' | 'warning';

export interface ActivityActionLine {
  label: string;
  tone: ActivityActionTone;
  title?: string;
}

export interface ActivityFeedOverviewCounter {
  label: string;
  tone: ActivityActionTone;
}

export interface ActivityFeedOverview {
  counters: ActivityFeedOverviewCounter[];
  detail?: string;
  headline: string;
  tone: ActivityActionTone;
}

export function isScheduledTaskActivity(entry: ActivityEntry): boolean {
  return entry.type.startsWith('scheduledTask.');
}

export function isFleetScheduledTaskActivity(entry: ActivityEntry): boolean {
  return (
    isScheduledTaskActivity(entry) &&
    entry.metadata?.source === 'fleet-command-center'
  );
}

export function isFleetActivity(entry: ActivityEntry): boolean {
  return (
    entry.type === 'fleet.dispatch' ||
    entry.type.startsWith('fleet.saga.') ||
    entry.type.startsWith('fleet.chatSession.') ||
    isFleetScheduledTaskActivity(entry)
  );
}

export function filterActivityEntries(
  entries: ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  if (filter === 'fleet') return entries.filter(isFleetActivity);
  if (filter === 'scheduled') return entries.filter(isScheduledTaskActivity);
  return entries;
}

export function shouldRenderFleetActivityMeta(entry: ActivityEntry): boolean {
  return !isScheduledTaskActivity(entry) && isFleetActivity(entry);
}

export function shouldRenderScheduledTaskActivityMeta(entry: ActivityEntry): boolean {
  return isScheduledTaskActivity(entry);
}

export function shouldOpenScheduleSettings(entry: ActivityEntry): boolean {
  return isScheduledTaskActivity(entry);
}

export function shouldOpenFleetCommandCenter(entry: ActivityEntry): boolean {
  return !isScheduledTaskActivity(entry) && isFleetActivity(entry);
}

export function buildActivityActionLines(entry: ActivityEntry): ActivityActionLine[] {
  const metadata = entry.metadata ?? {};
  const lines: ActivityActionLine[] = [];
  const latestCommand = readLatestCommandSummary(metadata);
  if (latestCommand) {
    lines.push({
      label: formatCommandActionLine(latestCommand),
      tone: commandTone(latestCommand.status),
      title: latestCommand.text,
    });
  }

  const progress = buildStepProgressActionLine(metadata);
  if (progress) lines.push(progress);

  const proof = buildInternetProofActionLine(metadata);
  if (proof) lines.push(proof);

  const errorSummary = metadataString(metadata.errorSummary) ?? metadataString(metadata.error);
  if (errorSummary) {
    lines.push({
      label: `Error: ${truncateInline(errorSummary, 120)}`,
      tone: 'warning',
      title: errorSummary,
    });
  } else {
    const resultPreview = metadataString(metadata.finalResultPreview);
    if (resultPreview) {
      lines.push({
        label: `Result: ${truncateInline(resultPreview, 120)}`,
        tone: 'success',
        title: resultPreview,
      });
    }
  }

  return dedupeActionLines(lines).slice(0, 4);
}

export function buildActivityFeedOverview(entries: ActivityEntry[]): ActivityFeedOverview | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((left, right) => right.timestamp - left.timestamp);
  const runningEntries = sorted.filter(isRunningActivityEntry);
  const warningEntries = sorted.filter(isWarningActivityEntry);
  const proofEntries = sorted.filter(hasProofActivityEvidence);
  const focus = runningEntries[0] ?? warningEntries[0] ?? sorted[0];
  if (!focus) return null;

  const actionLine = buildActivityActionLines(focus)[0];
  const focusTitle = truncateInline(focus.title, 88);
  const detail = actionLine?.label
    ?? (focus.description ? truncateInline(focus.description, 120) : undefined);
  const tone: ActivityActionTone = runningEntries.length > 0
    ? 'running'
    : warningEntries.length > 0
      ? 'warning'
      : proofEntries.length > 0
        ? 'success'
        : 'neutral';
  const prefix = tone === 'running'
    ? 'Running'
    : tone === 'warning'
      ? 'Needs attention'
      : tone === 'success'
        ? 'Verified'
        : 'Latest';

  return {
    counters: [
      { label: `${entries.length} event${entries.length === 1 ? '' : 's'}`, tone: 'neutral' },
      ...(runningEntries.length > 0
        ? [{ label: `${runningEntries.length} running`, tone: 'running' as const }]
        : []),
      ...(warningEntries.length > 0
        ? [{ label: `${warningEntries.length} warning${warningEntries.length === 1 ? '' : 's'}`, tone: 'warning' as const }]
        : []),
      ...(proofEntries.length > 0
        ? [{ label: `${proofEntries.length} proof-backed`, tone: 'success' as const }]
        : []),
    ],
    ...(detail ? { detail } : {}),
    headline: `${prefix}: ${focusTitle}`,
    tone,
  };
}

export function buildFleetActivityChips(metadata: Record<string, unknown>): string[] {
  const chips: string[] = [];
  if (typeof metadata.sagaId === 'string') chips.push(`saga ${shortId(metadata.sagaId)}`);
  if (typeof metadata.sessionShortId === 'string') {
    chips.push(`session ${metadata.sessionShortId}`);
  } else if (typeof metadata.sessionId === 'string') {
    chips.push(`session ${shortId(metadata.sessionId)}`);
  }
  appendRunLineageChips(chips, metadata);
  if (typeof metadata.peerLabel === 'string') chips.push(metadata.peerLabel);
  const hermesPlanChip = buildHermesPlanChip(metadata);
  if (hermesPlanChip) chips.push(hermesPlanChip);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.dispatchProfile === 'string') chips.push(metadata.dispatchProfile);
  if (typeof metadata.model === 'string') chips.push(metadata.model);
  if (typeof metadata.turnCount === 'number') chips.push(`turn ${metadata.turnCount}`);
  if (typeof metadata.reason === 'string') chips.push(metadata.reason);
  if (typeof metadata.parallelism === 'number' && metadata.parallelism > 1) {
    chips.push(`parallel ${metadata.parallelism}`);
  }
  if (typeof metadata.peerCount === 'number') chips.push(`${metadata.peerCount} peers`);
  if (
    typeof metadata.completedSteps === 'number' &&
    typeof metadata.totalSteps === 'number'
  ) {
    chips.push(`${metadata.completedSteps}/${metadata.totalSteps} done`);
  }
  if (typeof metadata.failedSteps === 'number' && metadata.failedSteps > 0) {
    chips.push(`${metadata.failedSteps} failed`);
  }
  const policySummary = buildToolPolicySummaryChip(metadata);
  if (policySummary) chips.push(policySummary);
  const internetProofSummary = buildInternetProofSummaryChip(metadata);
  if (internetProofSummary) chips.push(internetProofSummary);
  if (typeof metadata.durationMs === 'number') {
    chips.push(formatDuration(metadata.durationMs));
  }
  return chips;
}

export function buildFleetInternetProofStepLabels(
  metadata: Record<string, unknown>,
): string[] {
  const steps = readInternetProofSteps(metadata);
  return steps.map((step, index) => {
    const title = typeof step.title === 'string' && step.title.trim()
      ? step.title.trim()
      : step.id;
    const tool = typeof step.action === 'string' && step.action.trim()
      ? `${step.tool}.${step.action.trim()}`
      : step.tool;
    const evidence = typeof step.evidence === 'string' && step.evidence.trim()
      ? step.evidence.trim()
      : 'proof';
    const optional = step.required === false ? ' optional' : '';
    return `${index + 1}. ${title} - ${tool} - ${evidence}${optional}`;
  });
}

export function buildScheduledTaskActivityChips(
  metadata: Record<string, unknown>,
): string[] {
  const chips: string[] = [];
  const isFleetSource = metadata.source === 'fleet-command-center';
  const sagaId = typeof metadata.sagaId === 'string'
    ? metadata.sagaId
    : isFleetSource && typeof metadata.sessionId === 'string'
      ? metadata.sessionId
      : null;
  const sagaShortId = typeof metadata.sagaShortId === 'string'
    ? metadata.sagaShortId
    : sagaId
      ? shortId(sagaId)
      : null;

  if (typeof metadata.taskId === 'string') chips.push(`task ${shortId(metadata.taskId)}`);
  if (sagaShortId) {
    chips.push(`saga ${sagaShortId}`);
  } else if (typeof metadata.sessionShortId === 'string') {
    chips.push(`session ${metadata.sessionShortId}`);
  } else if (typeof metadata.sessionId === 'string') {
    chips.push(`session ${shortId(metadata.sessionId)}`);
  }
  appendRunLineageChips(chips, metadata);
  if (typeof metadata.scheduleKind === 'string') chips.push(metadata.scheduleKind);
  if (isFleetSource) chips.push('fleet');
  const hermesPlanChip = buildHermesPlanChip(metadata);
  if (hermesPlanChip) chips.push(hermesPlanChip);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.dispatchProfile === 'string') chips.push(metadata.dispatchProfile);
  if (typeof metadata.parallelism === 'number' && metadata.parallelism > 1) {
    chips.push(`parallel ${metadata.parallelism}`);
  }
  if (typeof metadata.peerCount === 'number' && metadata.peerCount > 0) {
    chips.push(`${metadata.peerCount} peers`);
  }
  const targetPeerLabels = metadataStringList(metadata.targetPeerLabels);
  if (targetPeerLabels.length > 0) {
    chips.push(`targets ${targetPeerLabels.slice(0, 4).join(', ')}`);
  }
  if (typeof metadata.deliveryChannel === 'string' && metadata.deliveryChannel.trim()) {
    chips.push(`channel ${metadata.deliveryChannel.trim()}`);
  }
  if (typeof metadata.memoryCount === 'number' && metadata.memoryCount > 0) {
    chips.push(`memory ${metadata.memoryCount}`);
  }
  const policySummary = buildToolPolicySummaryChip(metadata);
  if (policySummary) chips.push(policySummary);
  const internetProofSummary = buildInternetProofSummaryChip(metadata);
  if (internetProofSummary) chips.push(internetProofSummary);
  if (typeof metadata.error === 'string') chips.push('error');
  return chips;
}

function metadataStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

interface ActivityCommandSummary {
  count: number;
  durationMs?: number;
  status?: ActivityCommandStatus;
  text: string;
}

type ActivityCommandStatus = 'failed' | 'passed' | 'running' | 'unknown';

interface ActivityCommandRecord {
  command?: string;
  durationMs?: number;
  sequence?: number;
  status?: ActivityCommandStatus;
  toolName?: string;
}

function readLatestCommandSummary(
  metadata: Record<string, unknown>,
): ActivityCommandSummary | null {
  const directText = metadataString(metadata.lastCommandText) ?? metadataString(metadata.lastCommandTool);
  if (directText) {
    return {
      count: metadataNumber(metadata.commandCount) ?? 1,
      durationMs: metadataNumber(metadata.lastCommandDurationMs) ?? undefined,
      status: normalizeCommandStatus(metadata.lastCommandStatus),
      text: directText,
    };
  }

  const records = [
    ...metadataCommandRecords(metadata.proofCommands),
    ...metadataCommandRecords(metadata.commands),
    ...metadataCommandRecords(isRecord(metadata.tests) ? metadata.tests.commands : undefined),
  ].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
  const latest = records.at(-1);
  const text = latest ? metadataString(latest.command) ?? metadataString(latest.toolName) : null;
  if (!latest || !text) return null;
  return {
    count: records.length,
    durationMs: latest.durationMs,
    status: latest.status,
    text,
  };
}

function metadataCommandRecords(value: unknown): ActivityCommandRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const command = metadataString(raw.command);
    const toolName = metadataString(raw.toolName);
    if (!command && !toolName) return [];
    const durationMs = metadataNumber(raw.durationMs);
    const sequence = metadataNumber(raw.sequence);
    return [{
      ...(command ? { command } : {}),
      ...(durationMs !== null ? { durationMs } : {}),
      ...(sequence !== null ? { sequence } : {}),
      status: normalizeCommandStatus(raw.status, raw.success),
      ...(toolName ? { toolName } : {}),
    }];
  });
}

function formatCommandActionLine(command: ActivityCommandSummary): string {
  const status = command.status ?? 'unknown';
  const duration = command.durationMs === undefined ? '' : ` ${formatCommandDuration(command.durationMs)}`;
  const count = command.count > 1 ? ` (${command.count} commands)` : '';
  return `${status}${duration} ${command.text}${count}`;
}

function buildStepProgressActionLine(
  metadata: Record<string, unknown>,
): ActivityActionLine | null {
  const total = metadataNumber(metadata.totalSteps);
  if (total === null || total <= 0) return null;
  const completed = metadataNumber(metadata.completedSteps) ?? 0;
  const failed = metadataNumber(metadata.failedSteps) ?? 0;
  const duration = metadataNumber(metadata.durationMs);
  const durationSuffix = duration === null ? '' : ` in ${formatDuration(duration)}`;
  const failedSuffix = failed > 0 ? `, ${failed} failed` : '';
  const status = metadataString(metadata.status);
  return {
    label: `Steps ${completed}/${total}${failedSuffix}${durationSuffix}`,
    tone: failed > 0 || status === 'failed' ? 'warning' : completed >= total ? 'success' : 'running',
  };
}

function buildInternetProofActionLine(
  metadata: Record<string, unknown>,
): ActivityActionLine | null {
  const stepCount = metadataNumber(metadata.internetProofStepCount);
  if (stepCount === null || stepCount <= 0) return null;
  const requiredCount = metadataNumber(metadata.internetProofRequiredCount);
  const assertionCount = metadataNumber(metadata.internetProofAssertionCount);
  const required = requiredCount !== null && requiredCount > 0 ? `/${requiredCount}` : '';
  const assertions = assertionCount !== null && assertionCount > 0
    ? `, ${assertionCount} assertion${assertionCount === 1 ? '' : 's'}`
    : '';
  return {
    label: `Proof ${stepCount}${required}${assertions}`,
    tone: 'neutral',
  };
}

function metadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeCommandStatus(
  status: unknown,
  success?: unknown,
): ActivityCommandStatus | undefined {
  if (typeof success === 'boolean') return success ? 'passed' : 'failed';
  if (status === 'passed' || status === 'failed' || status === 'unknown') return status;
  if (status === 'running' || status === 'active' || status === 'in_progress') {
    return 'running';
  }
  return undefined;
}

function commandTone(status?: ActivityCommandStatus): ActivityActionTone {
  if (status === 'failed') return 'warning';
  if (status === 'passed') return 'success';
  if (status === 'running') return 'running';
  return 'neutral';
}

function formatCommandDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0ms';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 60_000) return `${Math.round(durationMs / 1000)}s`;
  return formatDuration(durationMs);
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function dedupeActionLines(lines: ActivityActionLine[]): ActivityActionLine[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line.label)) return false;
    seen.add(line.label);
    return true;
  });
}

function appendRunLineageChips(
  chips: string[],
  metadata: Record<string, unknown>,
): void {
  if (typeof metadata.agentRunId === 'string' && metadata.agentRunId.trim()) {
    chips.push(`run ${shortId(metadata.agentRunId.trim())}`);
  }
  if (typeof metadata.parentRunId === 'string' && metadata.parentRunId.trim()) {
    chips.push(`parent ${shortId(metadata.parentRunId.trim())}`);
  }
  if (typeof metadata.outcomeId === 'string' && metadata.outcomeId.trim()) {
    chips.push(`outcome ${shortId(metadata.outcomeId.trim())}`);
  }
}

function buildHermesPlanChip(metadata: Record<string, unknown>): string | null {
  const profile = typeof metadata.hermesPlanProfile === 'string'
    ? metadata.hermesPlanProfile.trim()
    : '';
  if (profile) return `hermes ${profile}`;
  if (typeof metadata.hermesPlanId === 'string' && metadata.hermesPlanId.trim()) {
    return 'hermes plan';
  }
  return null;
}

function shortId(id: string): string {
  if (id.length <= 10) return id;
  return id.slice(0, 8);
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0s';
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  if (durationMs < 3_600_000) return `${Math.round(durationMs / 60_000)}m`;
  return `${Math.round(durationMs / 3_600_000)}h`;
}

function buildToolPolicySummaryChip(metadata: Record<string, unknown>): string | null {
  const total = metadata.toolDecisionCount;
  const allow = metadata.toolAllowCount;
  const confirm = metadata.toolConfirmCount;
  const deny = metadata.toolDenyCount;
  if (
    typeof total !== 'number' ||
    total <= 0 ||
    typeof allow !== 'number' ||
    typeof confirm !== 'number' ||
    typeof deny !== 'number'
  ) {
    return null;
  }

  return `tools ${allow}/${confirm}/${deny}`;
}

function buildInternetProofSummaryChip(metadata: Record<string, unknown>): string | null {
  const stepCount = metadata.internetProofStepCount;
  const requiredCount = metadata.internetProofRequiredCount;
  const assertionCount = metadata.internetProofAssertionCount;
  if (typeof stepCount !== 'number' || stepCount <= 0) return null;
  const requiredSuffix =
    typeof requiredCount === 'number' && requiredCount > 0 ? `/${requiredCount}` : '';
  if (typeof assertionCount === 'number' && assertionCount > 0) {
    return `web proof ${stepCount}${requiredSuffix} assert ${assertionCount}`;
  }
  return `web proof ${stepCount}${requiredSuffix}`;
}

function isRunningActivityEntry(entry: ActivityEntry): boolean {
  const status = metadataString(entry.metadata?.status);
  return (
    status === 'running' ||
    status === 'active' ||
    status === 'in_progress' ||
    status === 'queued'
  );
}

function isWarningActivityEntry(entry: ActivityEntry): boolean {
  const metadata = entry.metadata ?? {};
  const status = metadataString(metadata.status);
  const failedSteps = metadataNumber(metadata.failedSteps) ?? 0;
  return (
    entry.type.includes('failed') ||
    status === 'failed' ||
    failedSteps > 0 ||
    Boolean(metadataString(metadata.error)) ||
    Boolean(metadataString(metadata.errorSummary)) ||
    buildActivityActionLines(entry).some((line) => line.tone === 'warning')
  );
}

function hasProofActivityEvidence(entry: ActivityEntry): boolean {
  const metadata = entry.metadata ?? {};
  const proofCount = metadataNumber(metadata.internetProofStepCount) ?? 0;
  const completed = metadataNumber(metadata.completedSteps) ?? 0;
  const total = metadataNumber(metadata.totalSteps) ?? 0;
  return (
    entry.type.includes('complete') ||
    entry.type.includes('completed') ||
    proofCount > 0 ||
    completed > 0 && total > 0 && completed >= total ||
    buildActivityActionLines(entry).some((line) => line.tone === 'success')
  );
}

function readInternetProofSteps(metadata: Record<string, unknown>): Array<{
  action?: string;
  evidence?: string;
  id: string;
  required?: boolean;
  title?: string;
  tool: string;
}> {
  const source = Array.isArray(metadata.internetProofSteps)
    ? metadata.internetProofSteps
    : isRecord(metadata.internetProofPlan) && Array.isArray(metadata.internetProofPlan.steps)
      ? metadata.internetProofPlan.steps
      : [];

  return source.flatMap((rawStep): Array<{
    action?: string;
    evidence?: string;
    id: string;
    required?: boolean;
    title?: string;
    tool: string;
  }> => {
    if (!isRecord(rawStep) || typeof rawStep.tool !== 'string') return [];
    const id = typeof rawStep.id === 'string' && rawStep.id.trim()
      ? rawStep.id.trim()
      : rawStep.tool;
    return [{
      id,
      tool: rawStep.tool,
      ...(typeof rawStep.action === 'string' ? { action: rawStep.action } : {}),
      ...(typeof rawStep.evidence === 'string' ? { evidence: rawStep.evidence } : {}),
      ...(typeof rawStep.title === 'string' ? { title: rawStep.title } : {}),
      ...(typeof rawStep.required === 'boolean' ? { required: rawStep.required } : {}),
    }];
  }).slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
