/**
 * Pure helpers for handing a long voice request to Cowork's persisted Mission
 * Orchestrator.  This module deliberately knows nothing about Electron, React,
 * or the mission store so both the main process and renderer can use the same
 * classification and display rules.
 */

export type VoiceMissionDisplayStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface VoiceBackgroundMissionInput {
  prompt: string;
  title?: string;
  cwd?: string;
  projectId?: string;
}

export interface VoiceMissionAssessment {
  recommended: boolean;
  score: number;
  reasons: string[];
  externalActionDetected: boolean;
}

interface VoiceMissionEventLike {
  type: string;
  message?: string;
  data?: unknown;
}

interface VoiceMissionSubTaskLike {
  result?: unknown;
}

export interface VoiceMissionLike {
  id: string;
  title: string;
  description: string;
  status: string;
  progress: number;
  updatedAt: string;
  events: VoiceMissionEventLike[];
  subTasks?: VoiceMissionSubTaskLike[];
  error?: string;
}

export interface VoiceMissionListItem {
  id: string;
  title: string;
  description: string;
  status: VoiceMissionDisplayStatus;
  progress: number;
  updatedAt: string;
  sessionId?: string;
  resultPreview?: string;
  error?: string;
}

export const VOICE_MISSION_EVENT = {
  queued: 'voice_background_queued',
  sessionStarted: 'voice_background_session_started',
  completed: 'voice_background_completed',
  failed: 'voice_background_failed',
} as const;

const LONG_TASK_PATTERNS: Array<{ pattern: RegExp; reason: string; weight: number }> = [
  {
    pattern: /\b(recherche approfondie|deep research|étude complète|analyse approfondie|audit complet)\b/iu,
    reason: 'recherche longue',
    weight: 3,
  },
  {
    pattern: /\b(crée|creer?|génère|genere|prépare|prepare|build|create|generate)\b[\s\S]{0,80}\b(présentation|slides?|rapport|document|site|application|vidéo|video|podcast|storyboard|livre)\b/iu,
    reason: 'livrable à produire',
    weight: 3,
  },
  {
    pattern: /\b(plusieurs|multiple|en parallèle|parallèle|étapes?|phases?|puis|ensuite|et enfin)\b/iu,
    reason: 'travail multi-étapes',
    weight: 2,
  },
  {
    pattern: /\b(toute la nuit|en arrière[- ]plan|background|longue durée|prends ton temps|continue de façon autonome)\b/iu,
    reason: 'exécution autonome demandée',
    weight: 4,
  },
];

const EXTERNAL_ACTION_PATTERN =
  /\b(envoie|envoyer|publie|publier|poste|poster|commande|acheter|achète|appelle|réserve|réserver|send|publish|post|purchase|buy|call|book)\b/iu;

/** Recommend a background mission without ever selecting it for the user. */
export function assessVoiceMissionIntent(text: string): VoiceMissionAssessment {
  const normalized = text.trim();
  const reasons: string[] = [];
  let score = 0;

  for (const rule of LONG_TASK_PATTERNS) {
    if (!rule.pattern.test(normalized)) continue;
    score += rule.weight;
    reasons.push(rule.reason);
  }

  const words = normalized.split(/\s+/u).filter(Boolean).length;
  if (words >= 35 || normalized.length >= 260) {
    score += 2;
    reasons.push('demande détaillée');
  }

  return {
    recommended: score >= 3,
    score,
    reasons: [...new Set(reasons)],
    externalActionDetected: EXTERNAL_ACTION_PATTERN.test(normalized),
  };
}

export function buildVoiceMissionTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/gu, ' ').trim();
  if (!compact) return 'Mission vocale';
  const firstSentence = compact.split(/(?<=[.!?])\s/u, 1)[0] ?? compact;
  const shortened = firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trimEnd()}…` : firstSentence;
  return shortened || 'Mission vocale';
}

/**
 * The delegation is not consent for a side effect.  Existing tool permission
 * gates remain authoritative and the worker is told to stop for confirmation
 * before communication, publication, purchases, calls, or remote mutations.
 */
export function buildVoiceMissionAgentPrompt(prompt: string): string {
  return [
    '<voice_background_mission>',
    'Travaille sur cette mission en arrière-plan et produis un résultat vérifiable dans la session.',
    '',
    '<user_request>',
    prompt.trim(),
    '</user_request>',
    '',
    '<external_action_policy>',
    "La délégation en arrière-plan n'est PAS une autorisation d'agir à l'extérieur.",
    'Avant tout envoi, publication, achat, appel, réservation ou mutation d’un service distant,',
    "utilise la confirmation explicite existante. Si elle n'est pas disponible, prépare un brouillon",
    'et arrête-toi en indiquant précisément ce qui attend la validation humaine.',
    '</external_action_policy>',
    '</voice_background_mission>',
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isVoiceBackgroundMission(mission: VoiceMissionLike): boolean {
  return mission.events.some((event) => event.type === VOICE_MISSION_EVENT.queued);
}

export function voiceMissionSessionId(mission: VoiceMissionLike): string | undefined {
  for (let index = mission.events.length - 1; index >= 0; index -= 1) {
    const event = mission.events[index];
    if (event?.type !== VOICE_MISSION_EVENT.sessionStarted) continue;
    const sessionId = asRecord(event.data)?.sessionId;
    if (typeof sessionId === 'string' && sessionId.trim()) return sessionId;
  }

  for (const subTask of mission.subTasks ?? []) {
    const sessionId = asRecord(subTask.result)?.sessionId;
    if (typeof sessionId === 'string' && sessionId.trim()) return sessionId;
  }
  return undefined;
}

export function voiceMissionResultPreview(mission: VoiceMissionLike): string | undefined {
  for (let index = mission.events.length - 1; index >= 0; index -= 1) {
    const event = mission.events[index];
    if (event?.type !== VOICE_MISSION_EVENT.completed) continue;
    const preview = asRecord(event.data)?.resultPreview;
    if (typeof preview === 'string' && preview.trim()) return preview.trim();
  }
  return undefined;
}

export function voiceMissionError(mission: VoiceMissionLike): string | undefined {
  for (let index = mission.events.length - 1; index >= 0; index -= 1) {
    const event = mission.events[index];
    if (event?.type !== VOICE_MISSION_EVENT.failed) continue;
    const error = asRecord(event.data)?.error;
    if (typeof error === 'string' && error.trim()) return error.trim();
    if (event.message?.trim()) return event.message.trim();
  }
  return mission.error?.trim() || undefined;
}

export function toVoiceMissionDisplayStatus(status: string): VoiceMissionDisplayStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'running' || status === 'waiting_approval') return 'running';
  return 'queued';
}

export function toVoiceMissionListItem(mission: VoiceMissionLike): VoiceMissionListItem | null {
  if (!isVoiceBackgroundMission(mission)) return null;
  const sessionId = voiceMissionSessionId(mission);
  const resultPreview = voiceMissionResultPreview(mission);
  const error = voiceMissionError(mission);
  const status = toVoiceMissionDisplayStatus(mission.status);
  const rawProgress = Math.max(
    0,
    Math.min(100, Number.isFinite(mission.progress) ? mission.progress : 0),
  );
  const progress = status === 'completed' ? 100 : status === 'running' ? Math.max(10, rawProgress) : rawProgress;
  return {
    id: mission.id,
    title: mission.title,
    description: mission.description,
    status,
    progress,
    updatedAt: mission.updatedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(resultPreview ? { resultPreview } : {}),
    ...(error ? { error } : {}),
  };
}
