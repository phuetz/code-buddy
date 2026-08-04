/**
 * Pure helpers shared by localized video renderers.
 *
 * The helpers deliberately fail closed: a locale, narration slot, caption cue
 * or cache identity must be valid before any GPU or publication work starts.
 */

import { createHash } from 'crypto';

export interface AudioFitPolicy {
  slotDurationMs: number;
  leadInMs: number;
  tailOutMs: number;
  maxSpeedup: number;
  toleranceMs?: number;
}

export type AudioFitResult =
  | { status: 'fits'; playbackRate: 1; availableSpeechMs: number }
  | { status: 'speedup'; playbackRate: number; availableSpeechMs: number }
  | {
      status: 'overflow';
      requiredRate: number;
      availableSpeechMs: number;
      overflowMs: number;
    };

export interface WebVttCue {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface RenderCacheIdentity {
  rendererVersion: string;
  sourceSha256: string;
  motionPrompt: string;
  locale: string;
  voiceProfileId: string;
  voiceProfileRevision: string;
  voiceLine: string;
  clipDurationMs: number;
  visualSpeechMode: 'neutral-voiceover' | 'localized-lipsync';
}

export function canonicalizeLocale(input: string, supportedLocales?: readonly string[]): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes('_') || /-(?:u|t|x)-/iu.test(trimmed)) {
    throw new Error(`Invalid or unsupported locale tag: ${input}`);
  }
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(trimmed);
  } catch {
    throw new Error(`Invalid or unsupported locale tag: ${input}`);
  }
  if (!canonical || canonical.toLowerCase() === 'und' || !new Intl.Locale(canonical).language) {
    throw new Error(`Invalid or unsupported locale tag: ${input}`);
  }
  if (supportedLocales) {
    const supported = supportedLocales.map((locale) => canonicalizeLocale(locale));
    if (!supported.includes(canonical)) {
      throw new Error(`Locale ${canonical} is not enabled for this render`);
    }
  }
  return canonical;
}

export function localePathSlug(locale: string): string {
  return canonicalizeLocale(locale).toLowerCase();
}

export function assessAudioFit(narrationDurationMs: number, policy: AudioFitPolicy): AudioFitResult {
  const values = [
    narrationDurationMs,
    policy.slotDurationMs,
    policy.leadInMs,
    policy.tailOutMs,
    policy.maxSpeedup,
  ];
  if (values.some((value) => !Number.isFinite(value)) || narrationDurationMs <= 0) {
    throw new Error('Audio fit values must be finite and narration duration must be positive');
  }
  if (
    policy.slotDurationMs <= 0 ||
    policy.leadInMs < 0 ||
    policy.tailOutMs < 0 ||
    policy.maxSpeedup < 1
  ) {
    throw new Error('Invalid audio fit policy');
  }
  const availableSpeechMs = policy.slotDurationMs - policy.leadInMs - policy.tailOutMs;
  if (availableSpeechMs <= 0) throw new Error('Audio fit policy leaves no room for speech');
  const toleranceMs = Math.max(0, policy.toleranceMs ?? 20);
  if (narrationDurationMs <= availableSpeechMs + toleranceMs) {
    return { status: 'fits', playbackRate: 1, availableSpeechMs };
  }
  const requiredRate = narrationDurationMs / availableSpeechMs;
  if (requiredRate <= policy.maxSpeedup) {
    return {
      status: 'speedup',
      playbackRate: Math.ceil(requiredRate * 10_000) / 10_000,
      availableSpeechMs,
    };
  }
  return {
    status: 'overflow',
    requiredRate: Math.ceil(requiredRate * 10_000) / 10_000,
    availableSpeechMs,
    overflowMs: Math.ceil(narrationDurationMs - availableSpeechMs * policy.maxSpeedup),
  };
}

export function formatWebVttTimestamp(milliseconds: number): string {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) {
    throw new Error('WebVTT timestamps must be non-negative integer milliseconds');
  }
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function escapeWebVttText(text: string): string {
  if (text.includes('\0')) throw new Error('WebVTT cue text cannot contain NUL bytes');
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

export function buildWebVtt(cues: readonly WebVttCue[], mediaDurationMs: number): string {
  if (!Number.isInteger(mediaDurationMs) || mediaDurationMs <= 0) {
    throw new Error('WebVTT media duration must be positive integer milliseconds');
  }
  let previousEndMs = 0;
  const blocks = cues.map((cue, index) => {
    if (
      !Number.isInteger(cue.startMs) ||
      !Number.isInteger(cue.endMs) ||
      cue.startMs < 0 ||
      cue.endMs <= cue.startMs ||
      cue.endMs > mediaDurationMs
    ) {
      throw new Error(`Invalid WebVTT cue ${index + 1}`);
    }
    if (index > 0 && cue.startMs < previousEndMs) {
      throw new Error(`WebVTT cue ${index + 1} overlaps the previous cue`);
    }
    previousEndMs = cue.endMs;
    const id = cue.id ? `${escapeWebVttText(cue.id)}\n` : '';
    return `${id}${formatWebVttTimestamp(cue.startMs)} --> ${formatWebVttTimestamp(cue.endMs)}\n${escapeWebVttText(cue.text)}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}${blocks.length ? '\n' : ''}`;
}

export function renderCacheKey(identity: RenderCacheIdentity): string {
  const locale = canonicalizeLocale(identity.locale);
  if (!/^[a-f0-9]{64}$/u.test(identity.sourceSha256)) {
    throw new Error('Render cache identity requires a SHA-256 source digest');
  }
  if (
    !identity.rendererVersion.trim() ||
    !identity.voiceProfileId.trim() ||
    !identity.voiceProfileRevision.trim()
  ) {
    throw new Error('Render cache identity is incomplete');
  }
  return createHash('sha256')
    .update(JSON.stringify({ ...identity, locale }))
    .digest('hex');
}
