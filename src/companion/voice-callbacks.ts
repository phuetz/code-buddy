/**
 * Pure selection and frequency helpers for occasional spoken callbacks to the latest consolidated
 * conversation episode. Callers own persistence/session state; this module never reads or writes.
 */
import { createHash } from 'node:crypto';
import type { EpisodeSummary } from '../sensory/episodic-journal.js';

export const DEFAULT_VOICE_CALLBACK_GAP_MS = 2 * 60 * 60 * 1_000;

export type VoiceCallbackEpisode = Pick<
  EpisodeSummary,
  'openLoops' | 'commitments' | 'lastUserPoint'
> | string | null | undefined;

function cleanMemoryText(value: string | undefined): string {
  return (value ?? '')
    .replace(/[<>]/gu, (character) => (character === '<' ? '‹' : '›'))
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?…]+$/u, '')
    .slice(0, 240)
    .trim();
}

function fieldFromEpisodeLine(line: string, label: string): string {
  const marker = `${label} :`;
  const start = line.indexOf(marker);
  if (start < 0) return '';
  const tail = line.slice(start + marker.length);
  const nextMarkers = [
    "Dernier point de l'utilisateur :",
    'Dernière position de Lisa :',
    'Correction à respecter :',
    'Engagement ou prochaine étape :',
    'Point encore ouvert :',
  ];
  const next = nextMarkers
    .map((candidate) => tail.indexOf(candidate))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cleanMemoryText(next === undefined ? tail : tail.slice(0, next));
}

function callbackCandidates(episode: VoiceCallbackEpisode): string[] {
  if (!episode) return [];
  if (typeof episode === 'string') {
    const openLoop = fieldFromEpisodeLine(episode, 'Point encore ouvert');
    const commitment = fieldFromEpisodeLine(episode, 'Engagement ou prochaine étape');
    const lastUserPoint = fieldFromEpisodeLine(episode, "Dernier point de l'utilisateur");
    return [
      openLoop ? `Au fait, tu me parlais de « ${openLoop} ».` : '',
      commitment ? `Tu devais « ${commitment} ». Où en es-tu ?` : '',
      lastUserPoint ? `Au fait, tu me parlais de « ${lastUserPoint} ».` : '',
    ].filter(Boolean);
  }

  const openLoop = cleanMemoryText(episode.openLoops?.at(-1));
  const commitment = cleanMemoryText(episode.commitments?.at(-1));
  const lastUserPoint = cleanMemoryText(episode.lastUserPoint);
  return [
    openLoop ? `Au fait, tu me parlais de « ${openLoop} ».` : '',
    commitment ? `Tu devais « ${commitment} ». Où en es-tu ?` : '',
    lastUserPoint ? `Au fait, tu me parlais de « ${lastUserPoint} ».` : '',
  ].filter(Boolean);
}

/** Stable deduplication key; no original memory text is retained in callback state. */
export function memoryCallbackHash(callback: string): string {
  return createHash('sha256').update(callback).digest('hex').slice(0, 20);
}

/** Select the first real journal cue not already offered. Never synthesizes missing detail. */
export function buildMemoryCallback(
  episode: VoiceCallbackEpisode,
  previouslyOffered: ReadonlySet<string> = new Set(),
): string | null {
  for (const candidate of callbackCandidates(episode)) {
    if (!previouslyOffered.has(memoryCallbackHash(candidate))) return candidate;
  }
  return null;
}

function callbackGapMs(env: NodeJS.ProcessEnv): number {
  const configured = env.CODEBUDDY_VOICE_CALLBACK_GAP_MS?.trim();
  if (!configured) return DEFAULT_VOICE_CALLBACK_GAP_MS;
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VOICE_CALLBACK_GAP_MS;
}

/** True at most once per configured gap. Pure; the caller records a successful offer timestamp. */
export function shouldOfferCallback(
  now: number,
  lastCallbackAt: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!Number.isFinite(now)) return false;
  if (lastCallbackAt === undefined) return true;
  return now >= lastCallbackAt && now - lastCallbackAt >= callbackGapMs(env);
}
