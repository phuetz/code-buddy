import type { Session } from '../types';
import type { ActivityEntry } from './activity-feed-helpers';
import type { AutonomySnapshot } from './os-panels/autonomy-queue-model.js';
import type { OsAutonomyBriefingPayload } from '../../shared/autonomy-briefing-ipc.js';
import type { MaisonSnapshotPayload } from '../../shared/maison-ipc.js';
import type { TFunction } from 'i18next';
import { frenchT } from '../i18n/translator.js';

const FALLBACK_WINDOW_MS = 18 * 60 * 60 * 1000;
const ACTIVE_PRESENCE_MS = 15 * 60 * 1000;
const MAX_MOMENTS = 5;

export type BriefingMomentTone = 'success' | 'memory' | 'warning' | 'neutral';

export interface BriefingMoment {
  id: string;
  title: string;
  detail?: string;
  at: number;
  source: 'daemon' | 'activité' | 'session';
  tone: BriefingMomentTone;
}

export interface BriefingStat {
  label: string;
  value: number;
  tone: 'default' | 'success' | 'warning';
}

export interface LivingBriefingModel {
  greeting: string;
  headline: string;
  summary: string;
  sourceLabel: string;
  daemonLabel: string;
  daemonTone: 'live' | 'paused' | 'unknown';
  stats: BriefingStat[];
  moments: BriefingMoment[];
  nextFocus: { title: string; reason: string } | null;
  hasNewWork: boolean;
  artifactPath: string | null;
  spokenText: string;
  maisonCue: MaisonBriefingCue | null;
}

export interface MaisonBriefingCue {
  label: string;
  detail: string;
  tone: 'calm' | 'active' | 'warning';
  spokenText: string;
}

export interface LivingBriefingInput {
  t?: TFunction;
  now: number;
  activities: ActivityEntry[];
  sessions: Session[];
  snapshot: AutonomySnapshot | null;
  daemonRunning: boolean | null;
  artifact: OsAutonomyBriefingPayload | null;
  maison?: MaisonSnapshotPayload | null;
}

function dayLabel(payload: MaisonSnapshotPayload, t: TFunction): string {
  const day = payload.snapshot.day;
  if (day?.kind === 'holiday') return day.holidayName ? t('livingBriefing.holidayWithName', { name: day.holidayName }) : t('livingBriefing.holiday');
  if (day?.kind === 'weekend') return t('livingBriefing.weekend');
  if (day?.kind === 'workday') return t('livingBriefing.workday');
  return t('livingBriefing.dayToConfirm');
}

/** Assemble factual household context without calling a model or inferring availability. */
export function buildMaisonBriefingCue(
  t: TFunction,
  payload: MaisonSnapshotPayload | null | undefined,
): MaisonBriefingCue | null {
  if (!payload || payload.status !== 'ready') return null;
  const mode = payload.snapshot.mode;
  const dueCount = payload.activeTimers.filter((timer) => timer.state === 'due').length;
  const runningCount = payload.activeTimers.length - dueCount;
  // Treat the renderer payload as untrusted defense-in-depth: an older main
  // process must not make private food-profile metadata visible in guest mode.
  const unknownFoodRules = mode === 'guests' ? 0 : payload.foodProfile.unknownCount;
  const foodNote = unknownFoodRules > 0 ? t('livingBriefing.foodNote', { count: unknownFoodRules }) : '';

  if (dueCount > 0) {
    return {
      label: t('livingBriefing.timerDueLabel', { count: dueCount }),
      detail: `${t('livingBriefing.timerDueDetail')}${foodNote}`,
      tone: 'warning',
      spokenText: t('livingBriefing.timerDueSpoken', { count: dueCount }),
    };
  }

  if (mode === 'silent' || mode === 'rest' || mode === 'focus') {
    const presentation = mode === 'silent'
      ? [t('livingBriefing.modeSilentLabel'), t('livingBriefing.modeSilentDetail')]
      : mode === 'rest'
        ? [t('livingBriefing.modeRestLabel'), t('livingBriefing.modeRestDetail')]
        : [t('livingBriefing.modeFocusLabel'), t('livingBriefing.modeFocusDetail')];
    return {
      label: presentation[0]!,
      detail: `${presentation[1]}${foodNote}`,
      tone: 'calm',
      spokenText: presentation[1]!,
    };
  }

  if (mode === 'guests') {
    const timerNote = runningCount > 0 ? ' ' + t('livingBriefing.timerActiveNote', { count: runningCount }) : '';
    return {
      label: t('livingBriefing.modeGuestsLabel'),
      detail: `${t('livingBriefing.modeGuestsDetail')}${timerNote}`,
      tone: 'calm',
      spokenText: t('livingBriefing.modeGuestsSpoken'),
    };
  }

  if (mode === 'away') {
    return {
      label: t('livingBriefing.modeAwayLabel'),
      detail: `${t('livingBriefing.modeAwayDetail')}${foodNote}`,
      tone: 'calm',
      spokenText: t('livingBriefing.modeAwaySpoken'),
    };
  }

  const meal = payload.snapshot.nextMeal;
  const schedule = meal
    ? `${meal.title}${meal.whenLabel ? ` · ${meal.whenLabel}` : ''}`
    : t('livingBriefing.noMealPlanned');
  const lightDay = mode === 'free-day'
    || payload.snapshot.day?.kind === 'weekend'
    || payload.snapshot.day?.kind === 'holiday';
  const label = lightDay ? t('livingBriefing.lightDay') : t('livingBriefing.normalDay');
  const timerNote = runningCount > 0 ? ' ' + t('livingBriefing.kitchenTimerActiveNote', { count: runningCount }) : '';
  return {
    label,
    detail: `${dayLabel(payload, t)} · ${schedule}${timerNote}${foodNote}`,
    tone: runningCount > 0 ? 'active' : 'calm',
    spokenText: meal
      ? `${label}. ${t('livingBriefing.nextMealPlanned', { mealTitle: meal.title })}`
      : `${label}. ${t('livingBriefing.nothingUrgentPlanned')}`,
  };
}

function greetingFor(now: number, t: TFunction): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return t('livingBriefing.goodEvening');
  if (hour < 12) return t('livingBriefing.goodMorning');
  if (hour < 18) return t('livingBriefing.goodAfternoon');
  return t('livingBriefing.goodEvening');
}

function fallbackSourceLabel(now: number, t: TFunction): string {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 12) return t('livingBriefing.sinceLastNight');
  if (hour >= 12 && hour < 18) return t('livingBriefing.sinceThisMorning');
  return t('livingBriefing.last18Hours');
}

function isFiniteTimestamp(value: string | number | undefined): value is string | number {
  if (value === undefined) return false;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed);
}

function timestamp(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value);
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function activityTone(type: string): BriefingMomentTone {
  if (type.includes('failed') || type.includes('error')) return 'warning';
  if (type === 'memory.added') return 'memory';
  if (
    type.endsWith('.completed')
    || type === 'task.complete'
    || type === 'workflow.run'
    || type === 'session.end'
  ) return 'success';
  return 'neutral';
}

function activityIsRelevant(entry: ActivityEntry): boolean {
  return entry.type !== 'gui.action'
    && entry.type !== 'session.start'
    && entry.type !== 'fleet.chatSession.turn';
}

function outcomeTone(outcome: string): BriefingMomentTone {
  if (outcome === 'error' || outcome === 'failed' || outcome === 'blocked') return 'warning';
  if (outcome === 'self_improved') return 'memory';
  if (outcome === 'completed' || outcome === 'goal_complete') return 'success';
  return 'neutral';
}

function outcomeLabel(outcome: string, t: TFunction): string {
  const labels: Record<string, string> = {
    blocked: t('livingBriefing.outcomeBlocked'),
    completed: t('livingBriefing.outcomeCompleted'),
    error: t('livingBriefing.outcomeError'),
    failed: t('livingBriefing.outcomeFailed'),
    goal_complete: t('livingBriefing.outcomeGoalComplete'),
    goal_continued: t('livingBriefing.outcomeGoalContinued'),
    idle: t('livingBriefing.outcomeIdle'),
    self_improved: t('livingBriefing.outcomeSelfImproved'),
  };
  return labels[outcome] ?? t('livingBriefing.outcomeDefault');
}

function dedupeMoments(moments: BriefingMoment[]): BriefingMoment[] {
  const seen = new Set<string>();
  return moments
    .sort((left, right) => right.at - left.at)
    .filter((moment) => {
      const key = `${moment.title.toLocaleLowerCase()}:${(moment.detail ?? '').toLocaleLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MOMENTS);
}

function activePresenceCount(snapshot: AutonomySnapshot | null, now: number): number {
  if (!snapshot) return 0;
  return Object.values(snapshot.presence).filter((presence) => {
    if (presence.status === 'offline' || !isFiniteTimestamp(presence.lastSeen)) return false;
    return now - timestamp(presence.lastSeen) <= ACTIVE_PRESENCE_MS;
  }).length;
}

function nextQueueFocus(snapshot: AutonomySnapshot | null, t: TFunction): { title: string; reason: string } | null {
  if (!snapshot) return null;
  const statusRank = (status: string) => {
    if (['in_progress', 'claimed', 'running'].includes(status)) return 0;
    if (['completed', 'done'].includes(status)) return 2;
    return 1;
  };
  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const task = [...snapshot.tasks]
    .filter((item) => statusRank(item.status) < 2)
    .sort((left, right) => {
      const byStatus = statusRank(left.status) - statusRank(right.status);
      return byStatus || (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    })[0];
  if (!task) return null;
  const active = statusRank(task.status) === 0;
  return {
    title: clean(task.title) ?? task.id,
    reason: active ? t('livingBriefing.taskAlreadyRunning') : t('livingBriefing.taskNextMission', { priority: task.priority || t('livingBriefing.taskPriorityPlanned') }),
  };
}

function fallbackModel(input: LivingBriefingInput, t: TFunction): LivingBriefingModel {
  const cutoff = input.now - FALLBACK_WINDOW_MS;
  const activities = input.activities.filter(
    (entry) => entry.timestamp >= cutoff && entry.timestamp <= input.now && activityIsRelevant(entry),
  );
  const recentSessions = input.sessions.filter(
    (session) => !session.archived && session.updatedAt >= cutoff && session.updatedAt <= input.now,
  );
  const recentWorklog = (input.snapshot?.worklog ?? []).filter(
    (entry) => isFiniteTimestamp(entry.date) && timestamp(entry.date) >= cutoff,
  );
  const warningCount = activities.filter((entry) => activityTone(entry.type) === 'warning').length;
  const completedActivityCount = activities.filter((entry) => activityTone(entry.type) === 'success').length;
  const progressCount = completedActivityCount + recentWorklog.length;
  const agents = activePresenceCount(input.snapshot, input.now);

  const moments = dedupeMoments([
    ...recentWorklog.map((entry, index): BriefingMoment => ({
      id: `worklog:${entry.id ?? index}`,
      title: clean(entry.summary) ?? t('livingBriefing.autonomousPassDocumented'),
      ...(entry.agent ? { detail: t('livingBriefing.byAgent', { agent: entry.agent }) } : {}),
      at: isFiniteTimestamp(entry.date) ? timestamp(entry.date) : input.now,
      source: 'daemon',
      tone: 'success',
    })),
    ...activities.map((entry): BriefingMoment => ({
      id: `activity:${entry.id}`,
      title: clean(entry.title) ?? t('livingBriefing.activityCowork'),
      ...(clean(entry.description) ? { detail: clean(entry.description) } : {}),
      at: entry.timestamp,
      source: 'activité',
      tone: activityTone(entry.type),
    })),
    ...recentSessions.map((session): BriefingMoment => ({
      id: `session:${session.id}`,
      title: clean(session.title) ?? t('livingBriefing.sessionUpdated'),
      detail: session.status === 'error' ? t('livingBriefing.sessionToResume') : t('livingBriefing.sessionUpdatedLong'),
      at: session.updatedAt,
      source: 'session',
      tone: session.status === 'error' ? 'warning' : 'neutral',
    })),
  ]);

  const hasNewWork = progressCount + recentSessions.length + warningCount > 0;
  const headline = warningCount > 0
    ? t('livingBriefing.headlineAdvancedWithPoint')
    : hasNewWork
      ? t('livingBriefing.headlineAdvanced')
      : input.daemonRunning
        ? t('livingBriefing.headlineCalm')
        : input.daemonRunning === false
          ? t('livingBriefing.headlineReady')
          : t('livingBriefing.headlineGathering');
  const summary = hasNewWork
    ? t('livingBriefing.fallbackSummaryWork', {
      advances: t('livingBriefing.advanceCount', { count: progressCount }),
      sessions: t('livingBriefing.sessionCount', { count: recentSessions.length }),
      agents: t('livingBriefing.agentStandbyCount', { count: agents }),
    })
    : input.daemonRunning
      ? t('livingBriefing.fallbackSummaryActive', { count: agents })
      : t('livingBriefing.eventSummaryNoNewWork');
  const nextFocus = nextQueueFocus(input.snapshot, t);
  const spokenText = `${greetingFor(input.now, t)}. ${headline}. ${summary}${nextFocus ? t('livingBriefing.nextIntention', { title: nextFocus.title }) : ''}`;

  return {
    greeting: greetingFor(input.now, t),
    headline,
    summary,
    sourceLabel: fallbackSourceLabel(input.now, t),
    daemonLabel: input.daemonRunning === null ? t('livingBriefing.stateInProgress') : input.daemonRunning ? t('livingBriefing.daemonActive') : t('livingBriefing.daemonPaused'),
    daemonTone: input.daemonRunning === null ? 'unknown' : input.daemonRunning ? 'live' : 'paused',
    stats: [
      { label: t('livingBriefing.statAdvanced'), value: progressCount, tone: progressCount > 0 ? 'success' : 'default' },
      { label: t('livingBriefing.statSessions'), value: recentSessions.length, tone: 'default' },
      { label: t('livingBriefing.statAgents'), value: agents, tone: agents > 0 ? 'success' : 'default' },
      { label: t('livingBriefing.statToReview'), value: warningCount, tone: warningCount > 0 ? 'warning' : 'default' },
    ],
    moments,
    nextFocus,
    hasNewWork,
    artifactPath: null,
    spokenText,
    maisonCue: null,
  };
}

function artifactModel(input: LivingBriefingInput, artifact: OsAutonomyBriefingPayload, t: TFunction): LivingBriefingModel {
  const { brief } = artifact;
  const results = brief.summary.completed + brief.summary.selfImproved;
  const attention = brief.summary.failed + brief.queue.criticalAwaitingOperator;
  const agents = activePresenceCount(input.snapshot, input.now);
  const moments = dedupeMoments([
    ...brief.notableEvents.map((event, index): BriefingMoment => ({
      id: `brief-event:${event.tickNumber}:${index}`,
      title: clean(event.taskTitle) ?? outcomeLabel(event.outcome, t),
      ...(clean(event.detail) ? { detail: clean(event.detail) } : {}),
      at: isFiniteTimestamp(event.at) ? timestamp(event.at) : input.now,
      source: 'daemon',
      tone: outcomeTone(event.outcome),
    })),
    ...brief.worklog.map((entry): BriefingMoment => ({
      id: `brief-worklog:${entry.id}`,
      title: clean(entry.summary) ?? t('livingBriefing.worklogResult'),
      ...(entry.agent ? { detail: t('livingBriefing.byAgent', { agent: entry.agent }) } : {}),
      at: isFiniteTimestamp(entry.date) ? timestamp(entry.date) : input.now,
      source: 'daemon',
      tone: entry.issues.length > 0 ? 'warning' : 'success',
    })),
  ]);
  const next = brief.opportunities[0];
  const nextFocus = next
    ? { title: clean(next.title) ?? t('livingBriefing.opportunityToReview'), reason: clean(next.safeNextStep) ?? next.reason }
    : nextQueueFocus(input.snapshot, t);
  const hasNewWork = results + brief.summary.goalContinuations + attention > 0;
  const headline = attention > 0
    ? t('livingBriefing.relayReadyWithPoint')
    : results > 0
      ? t('livingBriefing.headlineAdvanced')
      : brief.summary.observedTicks > 0
        ? t('livingBriefing.headlineWatchedAndCalm')
        : t('livingBriefing.relayReady');
  const summary = t('livingBriefing.artifactSummary', {
    passages: t('livingBriefing.passagesCount', { count: brief.summary.observedTicks }),
    tasks: t('livingBriefing.completedCount', { count: brief.summary.completed }),
    improvements: t('livingBriefing.improvementsCount', { count: brief.summary.selfImproved }),
  });
  const spokenText = `${greetingFor(input.now, t)}. ${headline}. ${summary}${nextFocus ? t('livingBriefing.nextSafeIntention', { title: nextFocus.title }) : ''}`;

  return {
    greeting: greetingFor(input.now, t),
    headline,
    summary,
    sourceLabel: t('livingBriefing.relayProbativeDate', { date: brief.briefingDate }),
    daemonLabel: input.daemonRunning === null ? t('livingBriefing.relayLoaded') : input.daemonRunning ? t('livingBriefing.daemonActiveWithCount', { count: agents }) : t('livingBriefing.daemonPaused'),
    daemonTone: input.daemonRunning === false ? 'paused' : input.daemonRunning ? 'live' : 'unknown',
    stats: [
      { label: t('livingBriefing.statCompleted'), value: brief.summary.completed, tone: brief.summary.completed > 0 ? 'success' : 'default' },
      { label: t('livingBriefing.statEvolutions'), value: brief.summary.selfImproved, tone: brief.summary.selfImproved > 0 ? 'success' : 'default' },
      { label: t('livingBriefing.statInProgress'), value: brief.queue.inProgress, tone: 'default' },
      { label: t('livingBriefing.statPaid'), value: brief.summary.paidModelRuns, tone: brief.summary.paidModelRuns > 0 ? 'warning' : 'default' },
    ],
    moments,
    nextFocus,
    hasNewWork,
    artifactPath: artifact.markdownPath,
    spokenText,
    maisonCue: null,
  };
}

/** Build the visible briefing without inventing data. The daemon artifact wins when available. */
export function buildLivingBriefing(input: LivingBriefingInput): LivingBriefingModel {
  const t = input.t ?? frenchT;
  const base = input.artifact ? artifactModel(input, input.artifact, t) : fallbackModel(input, t);
  const maisonCue = buildMaisonBriefingCue(t, input.maison);
  return maisonCue
    ? { ...base, maisonCue, spokenText: `${base.spokenText} ${maisonCue.spokenText}` }
    : base;
}
