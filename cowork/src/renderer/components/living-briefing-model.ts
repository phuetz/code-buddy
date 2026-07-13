import type { Session } from '../types';
import type { ActivityEntry } from './activity-feed-helpers';
import type { AutonomySnapshot } from './os-panels/autonomy-queue-model.js';
import type { OsAutonomyBriefingPayload } from '../../shared/autonomy-briefing-ipc.js';
import type { MaisonSnapshotPayload } from '../../shared/maison-ipc.js';

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
  now: number;
  activities: ActivityEntry[];
  sessions: Session[];
  snapshot: AutonomySnapshot | null;
  daemonRunning: boolean | null;
  artifact: OsAutonomyBriefingPayload | null;
  maison?: MaisonSnapshotPayload | null;
}

function dayLabel(payload: MaisonSnapshotPayload): string {
  const day = payload.snapshot.day;
  if (day?.kind === 'holiday') return day.holidayName ? `Jour férié : ${day.holidayName}` : 'Jour férié';
  if (day?.kind === 'weekend') return 'Week-end';
  if (day?.kind === 'workday') return 'Journée de travail';
  return 'Journée à confirmer';
}

/** Assemble factual household context without calling a model or inferring availability. */
export function buildMaisonBriefingCue(
  payload: MaisonSnapshotPayload | null | undefined,
): MaisonBriefingCue | null {
  if (!payload || payload.status !== 'ready') return null;
  const mode = payload.snapshot.mode;
  const dueCount = payload.activeTimers.filter((timer) => timer.state === 'due').length;
  const runningCount = payload.activeTimers.length - dueCount;
  // Treat the renderer payload as untrusted defense-in-depth: an older main
  // process must not make private food-profile metadata visible in guest mode.
  const unknownFoodRules = mode === 'guests' ? 0 : payload.foodProfile.unknownCount;
  const foodNote = unknownFoodRules > 0
    ? ` ${unknownFoodRules} contrainte${unknownFoodRules > 1 ? 's' : ''} alimentaire${unknownFoodRules > 1 ? 's' : ''} ${unknownFoodRules > 1 ? 'restent' : 'reste'} à confirmer.`
    : '';

  if (dueCount > 0) {
    return {
      label: dueCount === 1 ? 'Un minuteur est terminé' : `${dueCount} minuteurs sont terminés`,
      detail: `Une confirmation explicite arrêtera la répétition.${foodNote}`,
      tone: 'warning',
      spokenText: dueCount === 1
        ? 'Un minuteur de cuisine est terminé et attend ta confirmation.'
        : `${dueCount} minuteurs de cuisine sont terminés et attendent ta confirmation.`,
    };
  }

  if (mode === 'silent' || mode === 'rest' || mode === 'focus') {
    const presentation = mode === 'silent'
      ? ['Maison silencieuse', 'Aucune initiative sonore tant que tu ne réactives pas la voix.']
      : mode === 'rest'
        ? ['Repos protégé', 'Les suggestions spontanées restent en attente.']
        : ['Concentration protégée', 'Seules les demandes directes passent au premier plan.'];
    return {
      label: presentation[0]!,
      detail: `${presentation[1]}${foodNote}`,
      tone: 'calm',
      spokenText: presentation[1]!,
    };
  }

  if (mode === 'guests') {
    const timerNote = runningCount > 0
      ? ` ${runningCount} minuteur${runningCount > 1 ? 's' : ''} ${runningCount > 1 ? 'restent' : 'reste'} actif${runningCount > 1 ? 's' : ''}.`
      : '';
    return {
      label: 'Mode invités actif',
      detail: `Les détails personnels restent masqués.${timerNote}`,
      tone: 'calm',
      spokenText: 'Le mode invités est actif et les détails personnels restent masqués.',
    };
  }

  if (mode === 'away') {
    return {
      label: 'Maison en veille discrète',
      detail: `La présence locale n’est pas supposée.${foodNote}`,
      tone: 'calm',
      spokenText: 'La maison reste en veille discrète sans supposer ta présence.',
    };
  }

  const meal = payload.snapshot.nextMeal;
  const schedule = meal
    ? `${meal.title}${meal.whenLabel ? ` · ${meal.whenLabel}` : ''}`
    : 'Aucun repas n’est encore planifié.';
  const lightDay = mode === 'free-day'
    || payload.snapshot.day?.kind === 'weekend'
    || payload.snapshot.day?.kind === 'holiday';
  const label = lightDay ? 'Journée légère' : 'Maison au rythme normal';
  const timerNote = runningCount > 0
    ? ` ${runningCount} minuteur${runningCount > 1 ? 's' : ''} de cuisine actif${runningCount > 1 ? 's' : ''}.`
    : '';
  return {
    label,
    detail: `${dayLabel(payload)} · ${schedule}${timerNote}${foodNote}`,
    tone: runningCount > 0 ? 'active' : 'calm',
    spokenText: meal
      ? `${label}. Le prochain repas prévu est ${meal.title}.`
      : `${label}. Rien d’urgent n’est prévu côté maison.`,
  };
}

function greetingFor(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 5) return 'Bonsoir';
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function fallbackSourceLabel(now: number): string {
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 12) return 'Depuis hier soir';
  if (hour >= 12 && hour < 18) return 'Depuis ce matin';
  return 'Ces 18 dernières heures';
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

function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    blocked: 'Point laissé en revue',
    completed: 'Mission terminée',
    error: 'Passage interrompu',
    failed: 'Passage à vérifier',
    goal_complete: 'Objectif atteint',
    goal_continued: 'Objectif poursuivi',
    idle: 'Veille active',
    self_improved: 'Amélioration retenue',
  };
  return labels[outcome] ?? 'Passage autonome';
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

function nextQueueFocus(snapshot: AutonomySnapshot | null): { title: string; reason: string } | null {
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
    reason: active ? 'Déjà en cours dans la boucle autonome.' : `Prochaine mission ${task.priority || 'planifiée'}.`,
  };
}

function fallbackModel(input: LivingBriefingInput): LivingBriefingModel {
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
      title: clean(entry.summary) ?? 'Passage autonome documenté',
      ...(entry.agent ? { detail: `Par ${entry.agent}` } : {}),
      at: isFiniteTimestamp(entry.date) ? timestamp(entry.date) : input.now,
      source: 'daemon',
      tone: 'success',
    })),
    ...activities.map((entry): BriefingMoment => ({
      id: `activity:${entry.id}`,
      title: clean(entry.title) ?? 'Activité Cowork',
      ...(clean(entry.description) ? { detail: clean(entry.description) } : {}),
      at: entry.timestamp,
      source: 'activité',
      tone: activityTone(entry.type),
    })),
    ...recentSessions.map((session): BriefingMoment => ({
      id: `session:${session.id}`,
      title: clean(session.title) ?? 'Session mise à jour',
      detail: session.status === 'error' ? 'Session à reprendre' : 'Session Cowork mise à jour',
      at: session.updatedAt,
      source: 'session',
      tone: session.status === 'error' ? 'warning' : 'neutral',
    })),
  ]);

  const hasNewWork = progressCount + recentSessions.length + warningCount > 0;
  const headline = warningCount > 0
    ? 'J’ai avancé, avec un point à regarder'
    : hasNewWork
      ? 'J’ai avancé pendant ton absence'
      : input.daemonRunning
        ? 'Tout est calme, je veille'
        : input.daemonRunning === false
          ? 'Je suis prêt à reprendre avec toi'
          : 'Je rassemble le fil de notre travail';
  const summary = hasNewWork
    ? `${progressCount} avancée${progressCount === 1 ? '' : 's'} concrète${progressCount === 1 ? '' : 's'}, ${recentSessions.length} session${recentSessions.length === 1 ? '' : 's'} mise${recentSessions.length === 1 ? '' : 's'} à jour et ${agents} agent${agents === 1 ? '' : 's'} en veille.`
    : input.daemonRunning
      ? `La boucle autonome est active avec ${agents} agent${agents === 1 ? '' : 's'} présent${agents === 1 ? '' : 's'}. Aucun événement récent n’exige ton attention.`
      : 'Aucun événement récent n’exige ton attention. Le contexte reste prêt pour la prochaine mission.';
  const nextFocus = nextQueueFocus(input.snapshot);
  const spokenText = `${greetingFor(input.now)}. ${headline}. ${summary}${nextFocus ? ` Prochaine intention : ${nextFocus.title}.` : ''}`;

  return {
    greeting: greetingFor(input.now),
    headline,
    summary,
    sourceLabel: fallbackSourceLabel(input.now),
    daemonLabel: input.daemonRunning === null ? 'État en cours' : input.daemonRunning ? 'Boucle active' : 'Boucle en pause',
    daemonTone: input.daemonRunning === null ? 'unknown' : input.daemonRunning ? 'live' : 'paused',
    stats: [
      { label: 'Avancées', value: progressCount, tone: progressCount > 0 ? 'success' : 'default' },
      { label: 'Sessions', value: recentSessions.length, tone: 'default' },
      { label: 'Agents', value: agents, tone: agents > 0 ? 'success' : 'default' },
      { label: 'À voir', value: warningCount, tone: warningCount > 0 ? 'warning' : 'default' },
    ],
    moments,
    nextFocus,
    hasNewWork,
    artifactPath: null,
    spokenText,
    maisonCue: null,
  };
}

function artifactModel(input: LivingBriefingInput, artifact: OsAutonomyBriefingPayload): LivingBriefingModel {
  const { brief } = artifact;
  const results = brief.summary.completed + brief.summary.selfImproved;
  const attention = brief.summary.failed + brief.queue.criticalAwaitingOperator;
  const agents = activePresenceCount(input.snapshot, input.now);
  const moments = dedupeMoments([
    ...brief.notableEvents.map((event, index): BriefingMoment => ({
      id: `brief-event:${event.tickNumber}:${index}`,
      title: clean(event.taskTitle) ?? outcomeLabel(event.outcome),
      ...(clean(event.detail) ? { detail: clean(event.detail) } : {}),
      at: isFiniteTimestamp(event.at) ? timestamp(event.at) : input.now,
      source: 'daemon',
      tone: outcomeTone(event.outcome),
    })),
    ...brief.worklog.map((entry): BriefingMoment => ({
      id: `brief-worklog:${entry.id}`,
      title: clean(entry.summary) ?? 'Résultat consigné dans le worklog',
      ...(entry.agent ? { detail: `Par ${entry.agent}` } : {}),
      at: isFiniteTimestamp(entry.date) ? timestamp(entry.date) : input.now,
      source: 'daemon',
      tone: entry.issues.length > 0 ? 'warning' : 'success',
    })),
  ]);
  const next = brief.opportunities[0];
  const nextFocus = next
    ? { title: clean(next.title) ?? 'Opportunité à examiner', reason: clean(next.safeNextStep) ?? next.reason }
    : nextQueueFocus(input.snapshot);
  const hasNewWork = results + brief.summary.goalContinuations + attention > 0;
  const headline = attention > 0
    ? 'La relève est prête, avec un point à regarder'
    : results > 0
      ? 'J’ai avancé pendant ton absence'
      : brief.summary.observedTicks > 0
        ? 'J’ai veillé, tout est resté calme'
        : 'La relève est prête';
  const summary = `${brief.summary.observedTicks} passage${brief.summary.observedTicks === 1 ? '' : 's'} de la boucle, ${brief.summary.completed} tâche${brief.summary.completed === 1 ? '' : 's'} terminée${brief.summary.completed === 1 ? '' : 's'} et ${brief.summary.selfImproved} amélioration${brief.summary.selfImproved === 1 ? '' : 's'} retenue${brief.summary.selfImproved === 1 ? '' : 's'}.`;
  const spokenText = `${greetingFor(input.now)}. ${headline}. ${summary}${nextFocus ? ` Prochaine intention sûre : ${nextFocus.title}.` : ''}`;

  return {
    greeting: greetingFor(input.now),
    headline,
    summary,
    sourceLabel: `Relève probante · ${brief.briefingDate}`,
    daemonLabel: input.daemonRunning === null ? 'Relève chargée' : input.daemonRunning ? `Boucle active · ${agents} agent${agents === 1 ? '' : 's'}` : 'Boucle en pause',
    daemonTone: input.daemonRunning === false ? 'paused' : input.daemonRunning ? 'live' : 'unknown',
    stats: [
      { label: 'Terminées', value: brief.summary.completed, tone: brief.summary.completed > 0 ? 'success' : 'default' },
      { label: 'Évolutions', value: brief.summary.selfImproved, tone: brief.summary.selfImproved > 0 ? 'success' : 'default' },
      { label: 'En cours', value: brief.queue.inProgress, tone: 'default' },
      { label: 'Payant', value: brief.summary.paidModelRuns, tone: brief.summary.paidModelRuns > 0 ? 'warning' : 'default' },
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
  const base = input.artifact ? artifactModel(input, input.artifact) : fallbackModel(input);
  const maisonCue = buildMaisonBriefingCue(input.maison);
  return maisonCue
    ? { ...base, maisonCue, spokenText: `${base.spokenText} ${maisonCue.spokenText}` }
    : base;
}
