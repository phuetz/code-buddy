import type { TFunction } from 'i18next';
import type { FleetPeer, ScheduleTask, ScheduleWeekday } from '../types';
import { formatAppDateTime, joinAppList } from '../utils/i18n-format';
import { buildAgentRun, buildAgentRunMetadata } from '../../../../src/agent/agent-run-contract.js';
import type { AgentRun } from '../../../../src/agent/agent-run-contract.js';

export type SagaStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SagaStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
/**
 * Kanban column keys for the Saga Board.
 *
 * `in_review` / `in_test` are Hermes-style chain stages — sagas with a
 * `chain` lane move through Draft (running) → In Review → In Test → Done
 * based on the active step's `role`. Non-chain sagas only ever sit in
 * `queued | running | done | attention`.
 */
export type SagaBoardColumnKey =
  | 'queued'
  | 'running'
  | 'in_review'
  | 'in_test'
  | 'done'
  | 'attention';
export type FleetDispatchProfile = 'balanced' | 'research' | 'code' | 'review' | 'safe';
export type FleetTranslate = TFunction;

export const FLEET_DISPATCH_PROFILES: FleetDispatchProfile[] = [
  'balanced',
  'research',
  'code',
  'review',
  'safe',
];

export const FLEET_DISPATCH_PROFILE_LABEL_KEYS: Record<FleetDispatchProfile, string> = {
  balanced: 'fleet.dispatchProfiles.balanced',
  research: 'fleet.dispatchProfiles.research',
  code: 'fleet.dispatchProfiles.code',
  review: 'fleet.dispatchProfiles.review',
  safe: 'fleet.dispatchProfiles.safe',
};

export const FLEET_DISPATCH_PROFILE_CONTEXT_KEYS: Record<FleetDispatchProfile, string> = {
  balanced: 'fleet.profileContext.balanced',
  research: 'fleet.profileContext.research',
  code: 'fleet.profileContext.code',
  review: 'fleet.profileContext.review',
  safe: 'fleet.profileContext.safe',
};

export interface SagaSummary {
  id: string;
  goal: string;
  status: SagaStatus;
  steps: Array<{
    peerId: string;
    model: string;
    /**
     * `chain` is the Hermes-style sequential lane (Draft→Review→Test).
     * Mirrors the core `SagaStep.lane` union (src/fleet/saga-store.ts).
     */
    lane: 'primary' | 'fallback' | 'parallel' | 'chain';
    /** Only set for chain steps — role of this step (`code|review|safe|...`). */
    role?: string;
    /** Only set for chain steps — index of the predecessor step. */
    dependsOn?: number;
    status: SagaStepStatus;
    /**
     * The step's answer text. Present on completed steps (mirrors the
     * core `SagaStep.result`). Surfaced so the Council viewer can show
     * each peer's independent answer.
     */
    result?: string;
    toolPolicy?: {
      profile?: string;
      policyProfile?: string;
      defaultAction?: string;
      summary?: string;
    };
    toolDecisions?: Array<{
      tool: string;
      action: string;
      matchedGroup?: string;
    }>;
    toolset?: {
      toolsetId?: string;
      label?: string;
      deniedTools?: string[];
      allowedTools?: string[];
      confirmTools?: string[];
      summary?: string;
    };
  }>;
  finalResult?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface SagaToolDecisionSummary {
  allow: number;
  confirm: number;
  deny: number;
  total: number;
}

export interface ActivityEntry {
  id: number;
  type: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface FleetMemoryEntry {
  category: string;
  content: string;
  sourceSessionId?: string;
  timestamp: number;
}

export interface FleetScheduleDraft {
  prompt: string;
  scheduleMode: 'once';
  enabled: true;
  metadata: Record<string, unknown>;
}

export interface FleetScheduledDispatchDraftInput {
  dispatchGoal: string;
  dispatchProfile: FleetDispatchProfile;
  privacyTag: 'public' | 'sensitive';
  parallelism: number;
  targetPeerIds: string[];
  targetPeerLabels: string[];
  deliveryChannel: string;
  includeMemoryContext: boolean;
  memoryCount: number;
  proofMetadata?: Record<string, unknown>;
  metadataExtras?: Record<string, unknown>;
  t: FleetTranslate;
}

export interface FleetOutcomeFollowUpRunInput {
  entry: ActivityEntry;
  followUpGoal: string;
  t: FleetTranslate;
}

export interface AgentRunDraftPreview {
  title: string;
  runId: string;
  chips: string[];
  promptPreview: string;
}

export function laneClass(lane: SagaSummary['steps'][number]['lane']): string {
  if (lane === 'primary') return 'text-success';
  if (lane === 'fallback') return 'text-warning';
  // Distinct accent for Hermes chain steps so the trace UI shows the
  // stage-by-stage progression apart from the standard primary/parallel
  // running indicators. Uses a Tailwind built-in (no theme token needed).
  if (lane === 'chain') return 'text-indigo-400';
  return 'text-accent';
}

/**
 * Hermes-style stage bucketing. For chain sagas, the active step's
 * `role` drives the Kanban column so the operator can see which stage
 * a Draft→Review→Test workflow is currently in. Returns `null` for
 * non-chain sagas (caller falls back to status-based bucketing).
 */
export function getActiveSagaStageColumn(saga: SagaSummary): SagaBoardColumnKey | null {
  if (saga.steps.length === 0) return null;
  const isChain = saga.steps.every((s) => s.lane === 'chain');
  if (!isChain) return null;
  const active = saga.steps.find((s) => s.status === 'running');
  if (!active) return null;
  if (active.role === 'review') return 'in_review';
  if (active.role === 'safe' || active.role === 'test') return 'in_test';
  // `code` or undefined → still in Draft (use the standard running column).
  return 'running';
}

export function summarizeSagaToolDecisions(saga: SagaSummary): SagaToolDecisionSummary {
  const summary: SagaToolDecisionSummary = {
    allow: 0,
    confirm: 0,
    deny: 0,
    total: 0,
  };

  for (const step of saga.steps) {
    for (const decision of step.toolDecisions ?? []) {
      summary.total++;
      if (decision.action === 'allow') {
        summary.allow++;
      } else if (decision.action === 'deny') {
        summary.deny++;
      } else {
        summary.confirm++;
      }
    }
  }

  return summary;
}

export function formatSagaAge(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return '';
  const elapsedMs = Math.max(0, Date.now() - createdAt);
  if (elapsedMs < 60_000) return 'now';
  if (elapsedMs < 3_600_000) return `${Math.floor(elapsedMs / 60_000)}m`;
  if (elapsedMs < 86_400_000) return `${Math.floor(elapsedMs / 3_600_000)}h`;
  return `${Math.floor(elapsedMs / 86_400_000)}d`;
}

export function formatScheduleRunAt(nextRunAt: number | null): string {
  if (nextRunAt === null || !Number.isFinite(nextRunAt)) return '-';
  return formatAppDateTime(nextRunAt, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFleetScheduleRule(task: ScheduleTask, t: FleetTranslate): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return t('fleet.scheduledWork.ruleDaily', 'Daily at {{times}}', {
      times: joinAppList(task.scheduleConfig.times),
    });
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return t('fleet.scheduledWork.ruleWeekly', 'Weekly {{weekdays}} at {{times}}', {
      weekdays: joinAppList(task.scheduleConfig.weekdays.map((day) => weekdayLabel(day, t))),
      times: joinAppList(task.scheduleConfig.times),
    });
  }
  if (!task.repeatEvery || !task.repeatUnit) {
    return t('fleet.scheduledWork.ruleOnce', 'One-time');
  }
  if (task.repeatUnit === 'minute') {
    return t('fleet.scheduledWork.repeatEveryMinute', 'Every {{count}} minutes', {
      count: task.repeatEvery,
    });
  }
  if (task.repeatUnit === 'hour') {
    return t('fleet.scheduledWork.repeatEveryHour', 'Every {{count}} hours', {
      count: task.repeatEvery,
    });
  }
  return t('fleet.scheduledWork.repeatEveryDay', 'Every {{count}} days', {
    count: task.repeatEvery,
  });
}

export function buildFleetScheduledWorkChips(task: ScheduleTask, t: FleetTranslate): string[] {
  const chips = [formatFleetScheduleRule(task, t)];

  chips.push(
    task.lastRunAt === null
      ? t('fleet.scheduledWork.lastRunNever', 'Never run')
      : t('fleet.scheduledWork.lastRun', 'Last {{value}}', {
          value: formatScheduleRunAt(task.lastRunAt),
        })
  );

  const metadata = task.metadata ?? {};
  const isFleetSource = metadata.source === 'fleet-command-center';
  if (task.lastRunSessionId) {
    chips.push(
      t(
        isFleetSource ? 'fleet.scheduledWork.saga' : 'fleet.scheduledWork.session',
        isFleetSource ? 'Saga {{value}}' : 'Session {{value}}',
        {
          value: shortId(task.lastRunSessionId),
        }
      )
    );
  }

  if (isFleetSource) {
    chips.push(t('fleet.scheduledWork.sourceFleet', 'Fleet'));
  }
  const hermesPlanProfile = metadataString(metadata, 'hermesPlanProfile');
  if (metadataString(metadata, 'hermesPlanId') || hermesPlanProfile) {
    chips.push(
      t('fleet.scheduledWork.hermesPlanChip', 'Hermes {{value}}', {
        value: hermesPlanProfile ?? 'plan',
      })
    );
  }
  const dispatchProfile = metadataString(metadata, 'dispatchProfile');
  if (dispatchProfile) {
    chips.push(
      t('fleet.scheduledWork.profileChip', 'Profile {{value}}', {
        value: dispatchProfile,
      })
    );
  }
  const privacyTag = metadataString(metadata, 'privacyTag');
  if (privacyTag) {
    chips.push(
      t('fleet.scheduledWork.privacyChip', 'Privacy {{value}}', {
        value: privacyTag,
      })
    );
  }
  const memoryCount = metadataNumber(metadata, 'memoryCount');
  const peerCount = metadataNumber(metadata, 'peerCount');
  if (peerCount !== null && peerCount > 0) {
    chips.push(
      t('fleet.scheduledWork.peerCountChip', '{{count}} peers', {
        count: peerCount,
      })
    );
  }
  const targetPeerLabels = metadataStringList(metadata, 'targetPeerLabels');
  if (targetPeerLabels.length > 0) {
    chips.push(
      t('fleet.scheduledWork.targetPeersChip', 'Targets {{value}}', {
        value: joinAppList(targetPeerLabels.slice(0, 4)),
        count: targetPeerLabels.length,
      })
    );
  }
  const deliveryChannel = metadataString(metadata, 'deliveryChannel');
  if (deliveryChannel) {
    chips.push(
      t('fleet.scheduledWork.deliveryChannelChip', 'Channel {{value}}', {
        value: deliveryChannel,
      })
    );
  }
  if (memoryCount !== null && memoryCount > 0) {
    chips.push(
      t('fleet.scheduledWork.memoryChip', 'Memory {{count}}', {
        count: memoryCount,
      })
    );
  }
  const internetProofChip = buildFleetInternetProofChip(metadata, t);
  if (internetProofChip) {
    chips.push(internetProofChip);
  }

  if (task.lastError) {
    chips.push(t('fleet.scheduledWork.errorChip', 'Last error'));
  }

  return chips;
}

export function buildFleetScheduledRunNowLabel(
  task: ScheduleTask,
  t: FleetTranslate,
  running = false
): string {
  const metadata = task.metadata ?? {};
  const hermesPlanProfile = metadataString(metadata, 'hermesPlanProfile');
  if (metadataString(metadata, 'hermesPlanId') || hermesPlanProfile) {
    if (running) {
      return t('fleet.scheduledWork.runningHermesNow', 'Running Hermes {{value}}', {
        value: hermesPlanProfile ?? 'plan',
      });
    }
    return t('fleet.scheduledWork.runHermesNow', 'Run Hermes {{value}} now', {
      value: hermesPlanProfile ?? 'plan',
    });
  }
  if (isFleetScheduledTask(task)) {
    if (running) {
      return t('fleet.scheduledWork.runningFleetNow', 'Running Fleet task');
    }
    return t('fleet.scheduledWork.runFleetNow', 'Run Fleet task now');
  }
  return running
    ? t('fleet.scheduledWork.runningNow', 'Running now')
    : t('fleet.scheduledWork.runNow', 'Run now');
}

export function isFleetScheduledTask(task: ScheduleTask): boolean {
  return task.metadata?.source === 'fleet-command-center';
}

export function formatActivityTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  return formatAppDateTime(timestamp, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatActivityDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  return formatAppDateTime(timestamp);
}

export function isFleetActivity(entry: ActivityEntry): boolean {
  return (
    entry.type === 'fleet.dispatch' ||
    entry.type.startsWith('fleet.saga.') ||
    entry.type.startsWith('fleet.chatSession.') ||
    isFleetScheduledTaskActivity(entry)
  );
}

export function isFleetTerminalActivity(entry: ActivityEntry): boolean {
  return (
    entry.type === 'fleet.saga.completed' ||
    entry.type === 'fleet.saga.failed' ||
    (entry.type === 'scheduledTask.failed' && isFleetScheduledTaskActivity(entry))
  );
}

export function buildFleetOutcomeChips(entry: ActivityEntry, t: FleetTranslate): string[] {
  const metadata = entry.metadata ?? {};
  const chips: string[] = [];
  if (typeof metadata.taskId === 'string') chips.push(`task ${shortId(metadata.taskId)}`);
  if (typeof metadata.sagaId === 'string') chips.push(`saga ${shortId(metadata.sagaId)}`);
  if (typeof metadata.scheduleKind === 'string') chips.push(metadata.scheduleKind);
  const hermesChip = buildHermesPlanChip(metadata, t);
  if (hermesChip) chips.push(hermesChip);
  if (typeof metadata.privacyTag === 'string') chips.push(metadata.privacyTag);
  if (typeof metadata.dispatchProfile === 'string') chips.push(metadata.dispatchProfile);
  const targetPeerLabels = metadataStringList(metadata, 'targetPeerLabels');
  if (targetPeerLabels.length > 0) {
    chips.push(
      t('fleet.outcomes.targetPeersChip', 'Targets {{value}}', {
        value: joinAppList(targetPeerLabels.slice(0, 4)),
        count: targetPeerLabels.length,
      })
    );
  }
  const deliveryChannel = metadataString(metadata, 'deliveryChannel');
  if (deliveryChannel) {
    chips.push(
      t('fleet.outcomes.deliveryChannelChip', 'Channel {{value}}', {
        value: deliveryChannel,
      })
    );
  }
  const memoryCount = metadataNumber(metadata, 'memoryCount');
  if (memoryCount !== null && memoryCount > 0) {
    chips.push(
      t('fleet.outcomes.memoryChip', 'Memory {{count}}', {
        count: memoryCount,
      })
    );
  }
  if (typeof metadata.completedSteps === 'number' && typeof metadata.totalSteps === 'number') {
    chips.push(
      t('fleet.outcomes.doneChip', '{{completed}}/{{total}} done', {
        completed: metadata.completedSteps,
        total: metadata.totalSteps,
      })
    );
  }
  if (typeof metadata.failedSteps === 'number' && metadata.failedSteps > 0) {
    chips.push(
      t('fleet.outcomes.failedChip', '{{count}} failed', {
        count: metadata.failedSteps,
      })
    );
  }
  const policyChip = buildFleetToolPolicyChip(metadata);
  if (policyChip) chips.push(policyChip);
  const internetProofChip = buildFleetInternetProofChip(metadata, t);
  if (internetProofChip) chips.push(internetProofChip);
  if (typeof metadata.error === 'string') chips.push('error');
  if (typeof metadata.durationMs === 'number') {
    chips.push(formatOutcomeDuration(metadata.durationMs));
  }
  return chips;
}

export function buildFleetOutcomeFollowUpGoal(entry: ActivityEntry, t: FleetTranslate): string {
  const metadata = entry.metadata ?? {};
  const sagaId = metadataString(metadata, 'sagaId');
  const status = metadataString(metadata, 'status') ?? outcomeStatusLabel(entry);
  const completedSteps = metadataNumber(metadata, 'completedSteps');
  const totalSteps = metadataNumber(metadata, 'totalSteps');
  const finalResultPreview = metadataString(metadata, 'finalResultPreview');
  const errorSummary =
    metadataString(metadata, 'errorSummary') ?? metadataString(metadata, 'error');
  const hermesPlanSummary = buildHermesPlanSummary(metadata);
  const toolPolicySummary = buildFleetToolPolicyChip(metadata);
  const internetProofSummary = buildFleetInternetProofSummary(metadata);
  const internetProofSteps = buildFleetInternetProofStepSummary(metadata);
  const targetPeerSummary = buildTargetPeerSummary(metadata);
  const deliveryChannel = metadataString(metadata, 'deliveryChannel');
  const memoryCount = metadataNumber(metadata, 'memoryCount');
  const lines = [
    t('fleet.followUp.heading', 'Continue from this Fleet outcome.'),
    `${t('fleet.followUp.outcome', 'Outcome')}: ${entry.description ?? entry.title}`,
    `${t('fleet.followUp.status', 'Status')}: ${status}`,
  ];

  if (sagaId) {
    lines.push(`${t('fleet.followUp.saga', 'Saga')}: ${sagaId}`);
  }

  if (completedSteps !== null && totalSteps !== null) {
    lines.push(`${t('fleet.followUp.steps', 'Steps')}: ${completedSteps}/${totalSteps}`);
  }

  if (hermesPlanSummary) {
    lines.push(`${t('fleet.followUp.hermesPlan', 'Hermes plan')}: ${hermesPlanSummary}`);
  }

  if (targetPeerSummary) {
    lines.push(`${t('fleet.followUp.targets', 'Targets')}: ${targetPeerSummary}`);
  }

  if (deliveryChannel) {
    lines.push(`${t('fleet.followUp.deliveryChannel', 'Delivery channel')}: ${deliveryChannel}`);
  }

  if (memoryCount !== null && memoryCount > 0) {
    lines.push(`${t('fleet.followUp.memory', 'Memory context')}: ${memoryCount}`);
  }

  if (toolPolicySummary) {
    lines.push(`${t('fleet.followUp.toolPolicy', 'Tool policy')}: ${toolPolicySummary}`);
  }

  if (internetProofSummary) {
    lines.push('', `${t('fleet.followUp.webProof', 'Web proof')}: ${internetProofSummary}`);
  }

  if (internetProofSteps) {
    lines.push(`${t('fleet.followUp.webProofSteps', 'Proof steps')}: ${internetProofSteps}`);
  }

  if (finalResultPreview) {
    lines.push(
      '',
      `${t('fleet.followUp.finalResultPreview', 'Previous final result preview')}:`,
      finalResultPreview
    );
  }

  if (errorSummary) {
    lines.push('', `${t('fleet.followUp.errorSummary', 'Previous error summary')}:`, errorSummary);
  }

  lines.push(
    '',
    t('fleet.followUp.instruction', 'Use this context to execute the next useful step.')
  );
  return lines.join('\n').trim();
}

export function buildFleetOutcomeFollowUpRun({
  entry,
  followUpGoal,
  t,
}: FleetOutcomeFollowUpRunInput): AgentRun {
  const metadata = entry.metadata ?? {};
  const sagaId = metadataString(metadata, 'sagaId');
  const outcomeId = String(entry.id);
  const dispatchProfile = metadataString(metadata, 'dispatchProfile');
  const privacyTag = metadataString(metadata, 'privacyTag');
  const targetPeerLabels = metadataStringList(metadata, 'targetPeerLabels');
  const targetPeerIds = metadataStringList(metadata, 'targetPeerIds');
  const peerCount =
    metadataNumber(metadata, 'peerCount') ??
    Math.max(targetPeerIds.length, targetPeerLabels.length);
  const memoryCount = metadataNumber(metadata, 'memoryCount') ?? 0;
  const proofSteps = Array.isArray(metadata.internetProofSteps)
    ? metadata.internetProofSteps.filter(isRecord)
    : undefined;

  return buildAgentRun({
    source: 'cowork',
    status: 'draft',
    title: t('fleet.followUp.runTitle', 'Fleet outcome follow-up'),
    prompt: followUpGoal,
    profile: isFleetDispatchProfile(dispatchProfile) ? dispatchProfile : undefined,
    privacyTag: privacyTag === 'public' || privacyTag === 'sensitive' ? privacyTag : undefined,
    lineage: {
      outcomeId,
      parentRunId:
        metadataString(metadata, 'agentRunId') ??
        metadataString(metadata, 'parentRunId') ??
        undefined,
      sagaId: sagaId ?? undefined,
      scheduleTaskId: metadataString(metadata, 'taskId') ?? undefined,
      sourceSessionId: metadataString(metadata, 'sourceSessionId') ?? undefined,
      deliveryChannel: metadataString(metadata, 'deliveryChannel') ?? undefined,
      hermesPlanId: metadataString(metadata, 'hermesPlanId') ?? undefined,
      hermesPlanProfile: metadataString(metadata, 'hermesPlanProfile') ?? undefined,
      hermesPlanSurface: metadataString(metadata, 'hermesPlanSurface') ?? undefined,
    },
    memory: {
      included: memoryCount > 0,
      count: memoryCount,
    },
    fleet: {
      peerCount,
      targetPeerIds,
      targetPeerLabels,
    },
    proof: {
      stepCount: metadataNumber(metadata, 'internetProofStepCount') ?? undefined,
      requiredCount: metadataNumber(metadata, 'internetProofRequiredCount') ?? undefined,
      assertionCount: metadataNumber(metadata, 'internetProofAssertionCount') ?? undefined,
      steps: proofSteps,
      tools: metadataStringList(metadata, 'internetProofTools'),
    },
    toolPolicy: isFleetDispatchProfile(dispatchProfile)
      ? {
          toolsetId: `fleet.hermes.${dispatchProfile}`,
          profile: dispatchProfile,
        }
      : undefined,
    metadata: {
      outcomeTitle: entry.title,
      outcomeDescription: entry.description,
      outcomeStatus: metadataString(metadata, 'status') ?? outcomeStatusLabel(entry),
      sourceActivityType: entry.type,
    },
  });
}

export function buildAgentRunDraftPreview(run: AgentRun, t: FleetTranslate): AgentRunDraftPreview {
  const chips = [`run ${shortId(run.id)}`];
  if (run.lineage?.parentRunId) {
    chips.push(`parent ${shortId(run.lineage.parentRunId)}`);
  }
  if (run.lineage?.outcomeId) {
    chips.push(`outcome ${shortId(run.lineage.outcomeId)}`);
  }
  if (run.lineage?.hermesPlanProfile) {
    chips.push(`Hermes ${run.lineage.hermesPlanProfile}`);
  }
  if (run.profile) {
    chips.push(`profile ${run.profile}`);
  }
  if (run.privacyTag) {
    chips.push(`privacy ${run.privacyTag}`);
  }
  if (run.fleet?.peerCount && run.fleet.peerCount > 0) {
    chips.push(`${run.fleet.peerCount} peers`);
  }
  if (run.fleet?.targetPeerLabels && run.fleet.targetPeerLabels.length > 0) {
    chips.push(`targets ${run.fleet.targetPeerLabels.slice(0, 4).join(', ')}`);
  }
  if (run.memory?.included && run.memory.count > 0) {
    chips.push(`memory ${run.memory.count}`);
  }
  if (run.proof?.stepCount && run.proof.stepCount > 0) {
    const requiredSuffix =
      run.proof.requiredCount && run.proof.requiredCount > 0 ? `/${run.proof.requiredCount}` : '';
    const assertionSuffix =
      run.proof.assertionCount && run.proof.assertionCount > 0
        ? ` assert ${run.proof.assertionCount}`
        : '';
    chips.push(`web proof ${run.proof.stepCount}${requiredSuffix}${assertionSuffix}`);
  }
  if (run.toolPolicy?.toolsetId) {
    chips.push(run.toolPolicy.toolsetId);
  }

  return {
    title: t('fleet.runDraft.title', 'Follow-up run draft'),
    runId: run.id,
    chips,
    promptPreview: truncateRunPromptPreview(run.prompt),
  };
}

export function buildFleetOutcomeMemoryContent(entry: ActivityEntry): string {
  const metadata = entry.metadata ?? {};
  const sagaId = metadataString(metadata, 'sagaId');
  const status = metadataString(metadata, 'status') ?? outcomeStatusLabel(entry);
  const completedSteps = metadataNumber(metadata, 'completedSteps');
  const totalSteps = metadataNumber(metadata, 'totalSteps');
  const finalResultPreview = metadataString(metadata, 'finalResultPreview');
  const errorSummary =
    metadataString(metadata, 'errorSummary') ?? metadataString(metadata, 'error');
  const hermesPlanSummary = buildHermesPlanSummary(metadata);
  const toolPolicySummary = buildFleetToolPolicyChip(metadata);
  const internetProofSummary = buildFleetInternetProofSummary(metadata);
  const internetProofSteps = buildFleetInternetProofStepSummary(metadata);
  const targetPeerSummary = buildTargetPeerSummary(metadata);
  const deliveryChannel = metadataString(metadata, 'deliveryChannel');
  const memoryCount = metadataNumber(metadata, 'memoryCount');
  const parts = [`Fleet outcome lesson: ${entry.description ?? entry.title}`, `status=${status}`];

  if (sagaId) {
    parts.push(`saga=${sagaId}`);
  }

  if (completedSteps !== null && totalSteps !== null) {
    parts.push(`steps=${completedSteps}/${totalSteps}`);
  }

  if (finalResultPreview) {
    parts.push(`result=${truncateMemorySegment(finalResultPreview)}`);
  }

  if (hermesPlanSummary) {
    parts.push(`hermes=${hermesPlanSummary}`);
  }

  if (targetPeerSummary) {
    parts.push(`targets=${targetPeerSummary}`);
  }

  if (deliveryChannel) {
    parts.push(`channel=${deliveryChannel}`);
  }

  if (memoryCount !== null && memoryCount > 0) {
    parts.push(`memory=${memoryCount}`);
  }

  if (errorSummary) {
    parts.push(`error=${truncateMemorySegment(errorSummary)}`);
  }

  if (toolPolicySummary) {
    parts.push(`toolPolicy=${toolPolicySummary}`);
  }

  if (internetProofSummary) {
    parts.push(`webProof=${internetProofSummary}`);
  }

  if (internetProofSteps) {
    parts.push(`proofSteps=${truncateMemorySegment(internetProofSteps)}`);
  }

  return parts.join(' | ');
}

export function buildFleetOutcomeLessonContent(entry: ActivityEntry): string {
  const metadata = entry.metadata ?? {};
  const status = metadataString(metadata, 'status') ?? outcomeStatusLabel(entry);
  const sagaId = metadataString(metadata, 'sagaId');
  const agentRunId = metadataString(metadata, 'agentRunId');
  const parentRunId = metadataString(metadata, 'parentRunId');
  const finalResultPreview = metadataString(metadata, 'finalResultPreview');
  const errorSummary =
    metadataString(metadata, 'errorSummary') ?? metadataString(metadata, 'error');
  const hermesPlanSummary = buildHermesPlanSummary(metadata);
  const toolPolicySummary = buildFleetToolPolicyChip(metadata);
  const internetProofSummary = buildFleetInternetProofSummary(metadata);
  const internetProofSteps = buildFleetInternetProofStepSummary(metadata);
  const targetPeerSummary = buildTargetPeerSummary(metadata);
  const deliveryChannel = metadataString(metadata, 'deliveryChannel');
  const lines = [
    '[[fleet-outcome]] [[agent-run-lineage]]',
    'When reusing a Fleet outcome, preserve the run lineage before dispatching the next step.',
    '',
    'Prerequisites:',
    `- Outcome status: ${status}`,
    `- Outcome id: ${entry.id}`,
  ];

  if (sagaId) lines.push(`- Saga id: ${sagaId}`);
  if (agentRunId) lines.push(`- AgentRun id: ${agentRunId}`);
  if (parentRunId) lines.push(`- Parent AgentRun id: ${parentRunId}`);
  if (hermesPlanSummary) lines.push(`- Hermes context: ${hermesPlanSummary}`);
  if (targetPeerSummary) lines.push(`- Target peers: ${targetPeerSummary}`);
  if (deliveryChannel) lines.push(`- Delivery channel: ${deliveryChannel}`);
  if (toolPolicySummary) lines.push(`- Tool policy: ${toolPolicySummary}`);
  if (internetProofSummary) lines.push(`- Web proof: ${internetProofSummary}`);

  lines.push(
    '',
    'Steps:',
    '- Convert the selected outcome into an explicit follow-up AgentRun draft.',
    '- Carry parentRunId, outcomeId, saga/Hermes context, targets, memory and proof metadata.',
    '- Show the inherited context before dispatch or scheduling.',
    '- Save factual context as memory and procedural reuse as a lesson separately.',
    '',
    'Traps:',
    '- Do not silently write lessons from outcomes; require an operator action.',
    '- Do not drop source URLs, proof counts, or target peer context when continuing research.',
    '- Do not treat a parent saga id as the current saga id for a new run.',
    '',
    'Verification:',
    '- The follow-up dispatch or scheduled task has agentRunId/outcomeId lineage.',
    '- Activity Feed chips expose run, parent and outcome context.'
  );

  if (internetProofSteps) lines.push(`- Proof steps retained: ${internetProofSteps}`);
  if (finalResultPreview)
    lines.push('', `Result preview: ${truncateMemorySegment(finalResultPreview)}`);
  if (errorSummary) lines.push('', `Error summary: ${truncateMemorySegment(errorSummary)}`);

  return lines.join('\n');
}

export function isFleetOutcomeMemory(entry: FleetMemoryEntry): boolean {
  return entry.category === 'pattern' && entry.content.startsWith('Fleet outcome lesson:');
}

export function buildFleetDispatchGoalWithMemories(
  goal: string,
  memories: FleetMemoryEntry[],
  t: FleetTranslate
): string {
  if (memories.length === 0) return goal;

  return [
    goal,
    '',
    t('fleet.memoryContext.heading', 'Relevant Fleet memories:'),
    ...memories.map((memory) => `- ${memory.content}`),
    '',
    t(
      'fleet.memoryContext.instruction',
      'Use these memories as background context; the dispatch goal above remains the priority.'
    ),
  ].join('\n');
}

export function buildFleetDispatchGoalWithProfile(
  goal: string,
  profile: FleetDispatchProfile,
  t: FleetTranslate
): string {
  if (profile === 'balanced') return goal;

  return [
    goal,
    '',
    t('fleet.profileContext.heading', 'Dispatch profile:'),
    `- ${t(
      FLEET_DISPATCH_PROFILE_CONTEXT_KEYS[profile],
      getFleetDispatchProfileFallback(profile)
    )}`,
  ].join('\n');
}

export function buildFleetDispatchGoalContext(
  goal: string,
  profile: FleetDispatchProfile,
  memories: FleetMemoryEntry[],
  t: FleetTranslate
): string {
  const withProfile = buildFleetDispatchGoalWithProfile(goal, profile, t);
  return buildFleetDispatchGoalWithMemories(withProfile, memories, t);
}

export function buildFleetScheduledDispatchPrompt(
  dispatchGoal: string,
  profile: FleetDispatchProfile,
  privacyTag: 'public' | 'sensitive',
  parallelism: number,
  t: FleetTranslate,
  options: {
    targetPeerIds?: string[];
    targetPeerLabels?: string[];
    deliveryChannel?: string;
  } = {}
): string {
  const targetPeerIds = normalizePromptStringList(options.targetPeerIds);
  const targetPeerLabels = normalizePromptStringList(options.targetPeerLabels);
  const deliveryChannel = options.deliveryChannel?.trim();
  const targetLines = [
    targetPeerIds.length > 0
      ? `${t('fleet.scheduledDispatch.targetPeerIds', 'Target peer IDs')}: ${targetPeerIds.join(', ')}`
      : null,
    targetPeerLabels.length > 0
      ? `${t('fleet.scheduledDispatch.targetPeers', 'Target peers')}: ${joinAppList(targetPeerLabels)}`
      : null,
    deliveryChannel
      ? `${t('fleet.scheduledDispatch.deliveryChannel', 'Delivery channel')}: ${deliveryChannel}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return [
    t('fleet.scheduledDispatch.heading', 'Run this scheduled Fleet dispatch.'),
    `${t('fleet.scheduledDispatch.profile', 'Profile')}: ${profile}`,
    `${t('fleet.scheduledDispatch.privacy', 'Privacy')}: ${privacyTag}`,
    `${t('fleet.scheduledDispatch.parallelism', 'Parallelism')}: ${parallelism}`,
    ...targetLines,
    '',
    t(
      'fleet.scheduledDispatch.instruction',
      'Use the available Fleet dispatch/delegation tools to send the goal below to the best peers, preserve the requested profile and privacy, then summarize the saga outcome.'
    ),
    '',
    `${t('fleet.scheduledDispatch.goal', 'Goal')}:`,
    dispatchGoal,
  ]
    .join('\n')
    .trim();
}

export function buildFleetScheduledDispatchDraft({
  dispatchGoal,
  dispatchProfile,
  privacyTag,
  parallelism,
  targetPeerIds,
  targetPeerLabels,
  deliveryChannel,
  includeMemoryContext,
  memoryCount,
  proofMetadata = {},
  metadataExtras = {},
  t,
}: FleetScheduledDispatchDraftInput): FleetScheduleDraft {
  const agentRun = buildAgentRun({
    source: 'cowork',
    status: 'draft',
    title: 'Scheduled Fleet dispatch',
    prompt: dispatchGoal,
    profile: dispatchProfile,
    privacyTag,
    lineage: {
      deliveryChannel,
      hermesPlanId: metadataString(metadataExtras, 'hermesPlanId') ?? undefined,
      hermesPlanProfile: metadataString(metadataExtras, 'hermesPlanProfile') ?? undefined,
      hermesPlanSurface: metadataString(metadataExtras, 'hermesPlanSurface') ?? undefined,
      outcomeId: metadataString(metadataExtras, 'outcomeId') ?? undefined,
      parentRunId: metadataString(metadataExtras, 'parentRunId') ?? undefined,
      sagaId: metadataString(metadataExtras, 'sagaId') ?? undefined,
      scheduleTaskId: metadataString(metadataExtras, 'scheduleTaskId') ?? undefined,
      sourceSessionId: metadataString(metadataExtras, 'sourceSessionId') ?? undefined,
    },
    memory: {
      included: includeMemoryContext,
      count: memoryCount,
    },
    fleet: {
      peerCount: targetPeerIds.length,
      targetPeerIds,
      targetPeerLabels,
    },
    proof: {
      stepCount: metadataNumber(proofMetadata, 'internetProofStepCount') ?? undefined,
      requiredCount: metadataNumber(proofMetadata, 'internetProofRequiredCount') ?? undefined,
      assertionCount: metadataNumber(proofMetadata, 'internetProofAssertionCount') ?? undefined,
      steps: Array.isArray(proofMetadata.internetProofSteps)
        ? proofMetadata.internetProofSteps.filter(isRecord)
        : undefined,
      tools: metadataStringList(proofMetadata, 'internetProofTools'),
    },
    toolPolicy: {
      toolsetId: `fleet.hermes.${dispatchProfile}`,
      profile: dispatchProfile,
    },
    metadata: {
      scheduleMode: 'once',
    },
  });

  return {
    prompt: buildFleetScheduledDispatchPrompt(
      dispatchGoal,
      dispatchProfile,
      privacyTag,
      parallelism,
      t,
      {
        targetPeerIds,
        targetPeerLabels,
        deliveryChannel,
      }
    ),
    scheduleMode: 'once',
    enabled: true,
    metadata: {
      source: 'fleet-command-center',
      dispatchGoal,
      dispatchProfile,
      privacyTag,
      parallelism,
      peerCount: targetPeerIds.length,
      targetPeerIds,
      targetPeerLabels,
      deliveryChannel,
      includeMemoryContext,
      memoryCount,
      ...proofMetadata,
      ...metadataExtras,
      ...buildAgentRunMetadata(agentRun),
    },
  };
}

function normalizePromptStringList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function getFleetDispatchProfileFallback(profile: FleetDispatchProfile): string {
  if (profile === 'research') {
    return 'Research: prefer read, search and synthesis tools before suggesting edits.';
  }
  if (profile === 'code') {
    return 'Code: implement the smallest working change, then verify it with targeted tests.';
  }
  if (profile === 'review') {
    return 'Review: audit first, report risks clearly and avoid edits unless explicitly needed.';
  }
  if (profile === 'safe') {
    return 'Safe: minimize side effects, avoid destructive actions and verify each step.';
  }
  return 'Balanced: use the normal agent loop and choose tools as needed.';
}

export function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function metadataStringList(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function isFleetDispatchProfile(value: string | null): value is FleetDispatchProfile {
  return value !== null && FLEET_DISPATCH_PROFILES.includes(value as FleetDispatchProfile);
}

export function buildFleetOutcomeDispatchPreset(entry: ActivityEntry): {
  privacyTag?: 'public' | 'sensitive';
  dispatchProfile?: FleetDispatchProfile;
} {
  const metadata = entry.metadata ?? {};
  const privacyTag = metadataString(metadata, 'privacyTag');
  const dispatchProfile = metadataString(metadata, 'dispatchProfile');

  return {
    ...(privacyTag === 'public' || privacyTag === 'sensitive' ? { privacyTag } : {}),
    ...(isFleetDispatchProfile(dispatchProfile) ? { dispatchProfile } : {}),
  };
}

export function outcomeStatusLabel(entry: ActivityEntry): string {
  if (entry.type === 'fleet.saga.completed') return 'completed';
  if (entry.type === 'fleet.saga.failed') return 'failed';
  if (entry.type === 'scheduledTask.failed') return 'failed';
  return entry.type;
}

export function outcomeStatusTone(entry: ActivityEntry): string {
  if (entry.type === 'fleet.saga.completed') return 'text-success';
  if (entry.type === 'fleet.saga.failed' || entry.type === 'scheduledTask.failed')
    return 'text-error';
  return 'text-text-secondary';
}

export function formatOutcomeDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0s';
  if (durationMs < 60_000) return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  if (durationMs < 3_600_000) return `${Math.round(durationMs / 60_000)}m`;
  return `${Math.round(durationMs / 3_600_000)}h`;
}

export function peerStatusTone(status: FleetPeer['status']): string {
  if (status === 'authenticated' || status === 'connected') return 'text-success';
  if (status === 'connecting' || status === 'reconnecting') return 'text-warning';
  if (status === 'disconnected' || status === 'error') return 'text-error';
  return 'text-text-secondary';
}

export function sagaStatusTone(status: SagaSummary['status']): string {
  if (status === 'completed') return 'text-success';
  if (status === 'running') return 'text-accent';
  if (status === 'failed' || status === 'cancelled') return 'text-error';
  return 'text-text-secondary';
}

export function formatPeerSeenAt(lastSeenAt?: number): string {
  if (!lastSeenAt || !Number.isFinite(lastSeenAt)) return '-';
  const elapsedMs = Math.max(0, Date.now() - lastSeenAt);
  if (elapsedMs < 60_000) return 'now';
  if (elapsedMs < 3_600_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 86_400_000) return `${Math.floor(elapsedMs / 3_600_000)}h ago`;
  return `${Math.floor(elapsedMs / 86_400_000)}d ago`;
}

export function shortId(id: string): string {
  return id.length <= 10 ? id : id.slice(0, 8);
}

function weekdayLabel(day: ScheduleWeekday, t: FleetTranslate): string {
  const keys: Record<ScheduleWeekday, string> = {
    0: 'schedule.weekdaySunday',
    1: 'schedule.weekdayMonday',
    2: 'schedule.weekdayTuesday',
    3: 'schedule.weekdayWednesday',
    4: 'schedule.weekdayThursday',
    5: 'schedule.weekdayFriday',
    6: 'schedule.weekdaySaturday',
  };
  return t(keys[day], `${day}`);
}

function truncateMemorySegment(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357)}...`;
}

function truncateRunPromptPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

function buildFleetToolPolicyChip(metadata: Record<string, unknown>): string | null {
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

  const decisionSummary = `tools ${allow}/${confirm}/${deny}`;
  const toolsetId = metadataString(metadata, 'toolsetId');
  return toolsetId ? `${toolsetId} ${decisionSummary}` : decisionSummary;
}

function buildHermesPlanChip(metadata: Record<string, unknown>, t: FleetTranslate): string | null {
  const profile = metadataString(metadata, 'hermesPlanProfile');
  if (profile) {
    return t('fleet.outcomes.hermesPlanChip', 'Hermes {{value}}', { value: profile });
  }
  if (metadataString(metadata, 'hermesPlanId')) {
    return t('fleet.outcomes.hermesPlanChip', 'Hermes {{value}}', { value: 'plan' });
  }
  return null;
}

function buildHermesPlanSummary(metadata: Record<string, unknown>): string | null {
  const id = metadataString(metadata, 'hermesPlanId');
  const profile = metadataString(metadata, 'hermesPlanProfile');
  const surface = metadataString(metadata, 'hermesPlanSurface');
  if (!id && !profile && !surface) return null;
  return [
    id ? `id=${id}` : null,
    profile ? `profile=${profile}` : null,
    surface ? `surface=${surface}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function buildTargetPeerSummary(metadata: Record<string, unknown>): string | null {
  const labels = metadataStringList(metadata, 'targetPeerLabels');
  if (labels.length > 0) return labels.join(', ');
  const ids = metadataStringList(metadata, 'targetPeerIds');
  return ids.length > 0 ? ids.join(', ') : null;
}

function isFleetScheduledTaskActivity(entry: ActivityEntry): boolean {
  return (
    entry.type.startsWith('scheduledTask.') && entry.metadata?.source === 'fleet-command-center'
  );
}

function buildFleetInternetProofChip(
  metadata: Record<string, unknown>,
  t: FleetTranslate
): string | null {
  const stepCount = metadataNumber(metadata, 'internetProofStepCount');
  if (stepCount === null || stepCount <= 0) return null;

  const requiredCount = metadataNumber(metadata, 'internetProofRequiredCount');
  const assertionCount = metadataNumber(metadata, 'internetProofAssertionCount');
  const requiredSuffix = requiredCount !== null && requiredCount > 0 ? `/${requiredCount}` : '';

  if (assertionCount !== null && assertionCount > 0) {
    return t(
      'fleet.outcomes.webProofAssertChip',
      'web proof {{steps}}{{required}} assert {{assertions}}',
      {
        steps: stepCount,
        required: requiredSuffix,
        assertions: assertionCount,
      }
    );
  }

  return t('fleet.outcomes.webProofChip', 'web proof {{steps}}{{required}} steps', {
    steps: stepCount,
    required: requiredSuffix,
  });
}

function buildFleetInternetProofSummary(metadata: Record<string, unknown>): string | null {
  const stepCount = metadataNumber(metadata, 'internetProofStepCount');
  if (stepCount === null || stepCount <= 0) return null;

  const requiredCount = metadataNumber(metadata, 'internetProofRequiredCount');
  const assertionCount = metadataNumber(metadata, 'internetProofAssertionCount');
  const stepSummary =
    requiredCount !== null && requiredCount > 0
      ? `${stepCount}/${requiredCount} steps`
      : `${stepCount} steps`;
  const parts = [stepSummary];

  if (assertionCount !== null && assertionCount > 0) {
    parts.push(`${assertionCount} assertion${assertionCount > 1 ? 's' : ''}`);
  }

  return parts.join(', ');
}

function buildFleetInternetProofStepSummary(metadata: Record<string, unknown>): string | null {
  const source = Array.isArray(metadata.internetProofSteps)
    ? metadata.internetProofSteps
    : isRecord(metadata.internetProofPlan) && Array.isArray(metadata.internetProofPlan.steps)
      ? metadata.internetProofPlan.steps
      : [];

  const labels = source
    .map((step) => (isRecord(step) ? formatFleetInternetProofStep(step) : null))
    .filter((label): label is string => Boolean(label))
    .slice(0, 8);

  return labels.length > 0 ? labels.join(' > ') : null;
}

function formatFleetInternetProofStep(step: Record<string, unknown>): string | null {
  const id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : null;
  const tool = typeof step.tool === 'string' && step.tool.trim() ? step.tool.trim() : null;
  const action = typeof step.action === 'string' && step.action.trim() ? step.action.trim() : null;

  if (!id && !tool) return null;
  const toolLabel = tool ? `${tool}${action ? `.${action}` : ''}` : '';
  return [id, toolLabel].filter(Boolean).join(':');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
