/**
 * Voice entrainment — derive a bounded delivery profile from the human's last
 * spoken turn. This adapts timing and surface shape without copying an extreme
 * pace or reducing the reasoning/evidence owed by the conversation plan.
 *
 * The profile intentionally contains metrics only. It is safe to attach to a
 * percept or timing record because it never retains transcript text.
 */

export type VoiceDeliveryPace = 'slow' | 'balanced' | 'brisk';
export type VoicePauseStyle = 'reflective' | 'natural' | 'light';
export type VoiceResponseShape = 'compact' | 'balanced' | 'expanded';
export type VoiceEntrainmentConfidence = 'low' | 'medium' | 'high';

export interface VoiceTurnContext {
  /** Correlates capture, cognition, avatar, channel mirror and final outcome. */
  turnId?: string;
  /** Speech-bearing audio duration reported by the capture engine. */
  audioMs?: number;
  /** Whole capture duration, used only when audioMs is unavailable. */
  captureMs?: number;
  speechStartedAtMs?: number;
  speechEndedAtMs?: number;
  /** Optional current user emotion, normalized by the caller from `detectEmotion`. */
  emotion?: { label: string; intensity: number };
  /** Optional companion mood band, for example `radieuse`, `joyeuse` or `lasse`. */
  mood?: string;
}

export interface VoiceDeliveryProfile {
  pace: VoiceDeliveryPace;
  pauseStyle: VoicePauseStyle;
  responseShape: VoiceResponseShape;
  confidence: VoiceEntrainmentConfidence;
  /** Bounded acoustic target. A renderer may use it; text prompts use the band. */
  targetWpm: number;
  humanWordCount: number;
  humanAudioMs?: number;
  humanWpm?: number;
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
const MIN_RELIABLE_AUDIO_MS = 800;
const MAX_RELIABLE_AUDIO_MS = 120_000;
const MIN_RELIABLE_WORDS = 3;
const MIN_PLAUSIBLE_WPM = 55;
const MAX_PLAUSIBLE_WPM = 320;
const NEUTRAL_WPM = 155;
const MIN_TARGET_WPM = 105;
const MAX_TARGET_WPM = 195;

export interface EmotionalVoiceContext {
  emotion?: VoiceTurnContext['emotion'];
  mood?: string;
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim();
}

function boundedTargetWpm(value: number): number {
  return Math.round(Math.max(MIN_TARGET_WPM, Math.min(MAX_TARGET_WPM, value)));
}

/**
 * Add an emotional register to an already-entrained delivery profile. Human pace remains the
 * baseline: emotion and mood only nudge its bounded target and pause style. With no recognized
 * emotional input the original object is returned unchanged.
 */
export function applyEmotionalModulation(
  profile: VoiceDeliveryProfile,
  context: EmotionalVoiceContext,
): VoiceDeliveryProfile {
  const emotion = normalizedLabel(context.emotion?.label);
  const mood = normalizedLabel(context.mood);
  const intensity = Math.max(0, Math.min(1, context.emotion?.intensity ?? 1));

  const isSadOrTired = ['sadness', 'tristesse', 'tired', 'fatigue'].includes(emotion);
  const isJoyful = ['joy', 'joie'].includes(emotion);
  const isFrustrated = ['frustration', 'frustre', 'frustree'].includes(emotion);
  const moodIsLow = mood === 'lasse';
  const moodIsJoyful = mood === 'radieuse' || mood === 'joyeuse';

  // A direct emotional read is more specific than the companion's ambient mood. Mood fills the
  // register only when the utterance itself is neutral or unrecognized.
  if (isSadOrTired || (!emotion || emotion === 'neutral') && moodIsLow) {
    const reduction = isSadOrTired ? 0.15 * intensity : 0.15;
    return {
      ...profile,
      pace: 'slow',
      pauseStyle: 'reflective',
      targetWpm: boundedTargetWpm(profile.targetWpm * (1 - reduction)),
    };
  }
  if (isJoyful || (!emotion || emotion === 'neutral') && moodIsJoyful) {
    const increase = isJoyful ? 0.1 * intensity : 0.1;
    return {
      ...profile,
      pace: 'brisk',
      pauseStyle: 'light',
      targetWpm: boundedTargetWpm(profile.targetWpm * (1 + increase)),
    };
  }
  if (isFrustrated) {
    return {
      ...profile,
      pace: 'slow',
      pauseStyle: 'reflective',
      targetWpm: boundedTargetWpm(profile.targetWpm * (1 - 0.05 * intensity)),
    };
  }
  return profile;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function boundedAudioMs(context: VoiceTurnContext | undefined): number | undefined {
  const direct = finitePositive(context?.audioMs);
  if (direct !== undefined) return direct;
  const capture = finitePositive(context?.captureMs);
  if (capture !== undefined) return capture;
  const startedAt = finitePositive(context?.speechStartedAtMs);
  const endedAt = finitePositive(context?.speechEndedAtMs);
  if (startedAt === undefined || endedAt === undefined || endedAt <= startedAt) return undefined;
  return endedAt - startedAt;
}

function wordCount(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

function responseShapeFor(words: number): VoiceResponseShape {
  if (words <= 6) return 'compact';
  if (words <= 24) return 'balanced';
  return 'expanded';
}

/**
 * Estimate the human's delivery and move Lisa part-way toward it. Extremes are
 * rejected rather than imitated, and short interjections never claim a precise
 * speaking rate.
 */
export function deriveVoiceDeliveryProfile(
  transcript: string,
  context?: VoiceTurnContext,
): VoiceDeliveryProfile {
  const humanWordCount = wordCount(transcript);
  const humanAudioMs = boundedAudioMs(context);
  const candidateWpm = humanAudioMs !== undefined
    ? (humanWordCount * 60_000) / humanAudioMs
    : undefined;
  const humanWpm =
    humanWordCount >= MIN_RELIABLE_WORDS &&
    humanAudioMs !== undefined &&
    humanAudioMs >= MIN_RELIABLE_AUDIO_MS &&
    humanAudioMs <= MAX_RELIABLE_AUDIO_MS &&
    candidateWpm !== undefined &&
    candidateWpm >= MIN_PLAUSIBLE_WPM &&
    candidateWpm <= MAX_PLAUSIBLE_WPM
      ? Math.round(candidateWpm)
      : undefined;

  const pace: VoiceDeliveryPace =
    humanWpm === undefined ? 'balanced' : humanWpm < 115 ? 'slow' : humanWpm > 185 ? 'brisk' : 'balanced';
  const pauseStyle: VoicePauseStyle =
    pace === 'slow' ? 'reflective' : pace === 'brisk' ? 'light' : 'natural';
  const targetWpm = humanWpm === undefined
    ? NEUTRAL_WPM
    : boundedTargetWpm(humanWpm * 0.65 + NEUTRAL_WPM * 0.35);
  const confidence: VoiceEntrainmentConfidence = humanWpm === undefined
    ? 'low'
    : humanWordCount >= 8 && (humanAudioMs ?? 0) >= 2_000
      ? 'high'
      : 'medium';

  const profile: VoiceDeliveryProfile = {
    pace,
    pauseStyle,
    responseShape: responseShapeFor(humanWordCount),
    confidence,
    targetWpm,
    humanWordCount,
    ...(humanAudioMs !== undefined ? { humanAudioMs: Math.round(humanAudioMs) } : {}),
    ...(humanWpm !== undefined ? { humanWpm } : {}),
  };
  return applyEmotionalModulation(profile, {
    emotion: context?.emotion,
    mood: context?.mood,
  });
}

/** Prompt guidance that changes oral delivery while preserving discourse obligations. */
export function voiceDeliveryGuidance(profile: VoiceDeliveryProfile): string {
  const pace = profile.pace === 'slow'
    ? 'Parle posément, avec de vraies respirations entre les idées.'
    : profile.pace === 'brisk'
      ? 'Garde un débit vivant et des transitions rapides, sans précipiter les mots.'
      : 'Garde un débit naturel et régulier.';
  const shape = profile.responseShape === 'compact'
    ? 'Pour un échange simple, ouvre directement et privilégie quelques phrases denses.'
    : profile.responseShape === 'expanded'
      ? 'Le tour humain est développé : réponds avec une progression construite et des transitions explicites.'
      : 'Adopte une longueur orale équilibrée, avec une idée claire par phrase.';

  return [
    '<voice_delivery>',
    `Synchronise la forme orale avec le dernier tour humain : ${pace}`,
    shape,
    'Cette adaptation concerne la cadence et la forme, jamais la qualité du fond. Si la demande exige analyse, actualité, preuves, nuances ou argumentation philosophique, fournis-les complètement, même après un tour humain bref ou rapide.',
    'Utilise la ponctuation comme respiration naturelle ; évite les listes récitées et les phrases artificiellement hachées.',
    '</voice_delivery>',
  ].join('\n');
}

/** Optional expressive-renderer instruction. Kept factual and persona-neutral. */
export function voiceRendererDeliveryInstruction(profile: VoiceDeliveryProfile): string {
  if (profile.pace === 'slow') {
    return `Speak calmly at about ${profile.targetWpm} words per minute, with reflective pauses between ideas.`;
  }
  if (profile.pace === 'brisk') {
    return `Speak with lively, clear pacing at about ${profile.targetWpm} words per minute and light pauses.`;
  }
  return `Speak naturally at about ${profile.targetWpm} words per minute with comfortable pauses.`;
}
