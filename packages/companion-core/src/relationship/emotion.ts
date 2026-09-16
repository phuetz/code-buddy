/**
 * Emotion read — one detector, two consumers: the reply register, and the trait
 * drift above. Pure, accent-insensitive (speech-to-text loses accents) and
 * negation-aware, so « je ne suis pas triste » is not read as sadness.
 *
 * Negative emotions are checked FIRST: a mixed « merci mais je galère » must land
 * on the caring register, not on gratitude.
 *
 * @module relationship/emotion
 */

import type { RelationalSignal } from './state.js';

export type Emotion =
  | 'frustration'
  | 'sadness'
  | 'anxiety'
  | 'tired'
  | 'affection'
  | 'gratitude'
  | 'joy'
  | 'joking'
  | 'deep-talk'
  | 'neutral';

export interface EmotionRead {
  emotion: Emotion;
  intensity: 'normal' | 'high';
  /** 0..1 — marker count, intensity and corroboration. */
  confidence: number;
}

/** Confidence at/above which a read escalates the register on its own. */
export const STRONG_EMOTION_CONFIDENCE = 0.8;

/** Lowercase, strip diacritics, fold punctuation to spaces. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MARKERS: Record<Exclude<Emotion, 'neutral'>, RegExp> = {
  frustration:
    /\b(j en peux plus|marre|ras le bol|galere|bloque|coince|ca marche pas|enerve|s enerve|j y arrive pas|c est dur|trop dur|je craque|a bout|i can t take it|fed up|stuck|not working|doesn t work|i give up|this is hard)\b/,
  sadness:
    /\b(triste|tristesse|cafard|deprime|deprimee|pas le moral|moral (?:vraiment |un peu )?bas|le moral a zero|malheureux|malheureuse|envie de pleurer|ca va pas fort|abattu|abattue|sad|depressed|feeling down|low mood|want to cry)\b/,
  anxiety:
    /\b(stresse|stressee|angoisse|angoissee|anxieux|anxieuse|j ai peur|inquiet|inquiete|panique|ca m angoisse|tendu|tendue|nerveux|nerveuse|stressed|anxious|worried|panicking|scared)\b/,
  tired:
    /\b(fatigue|fatiguee|epuise|epuisee|creve|crevee|vanne|vannee|plus d energie|au bout du rouleau|envie de dormir|tired|exhausted|worn out|no energy)\b/,
  affection:
    /\b(je t aime|tu me manques|bisous|mon amour|je pense a toi|je t embrasse|tu es adorable|love you|miss you|you re adorable)\b/,
  gratitude:
    /\b(merci|c est gentil|trop gentil|reconnaissant|tu m aides beaucoup|thank you|thanks|much appreciated)\b/,
  joy: /\b(genial|trop content|trop contente|c est top|excellent|j ai reussi|heureux|heureuse|trop bien|magnifique|awesome|so happy|i did it)\b/,
  joking: /\b(haha|mdr|lol|ptdr|blague|rigole|drole|marrant|tu deconnes)\b/,
  'deep-talk':
    /\b(je me sens|honnetement|au fond de moi|je doute|je suis perdu|je me sens seul|je me sens seule|i feel|honestly|deep down|i m lost|feel alone)\b/,
};

/** Negatives first, so care is never missed on a mixed message. */
const EMOTION_ORDER: Array<Exclude<Emotion, 'neutral'>> = [
  'frustration',
  'sadness',
  'anxiety',
  'tired',
  'affection',
  'gratitude',
  'joy',
  'joking',
  'deep-talk',
];

const INTENSITY =
  /\b(vraiment|tellement|trop|completement|a bout|plus du tout|grave|hyper|extremement|tres|really|so|totally)\b/;

/** True when the match is immediately scoped by a French or English negation. */
function isNegatedAt(text: string, matchIndex: number): boolean {
  const before = text.slice(Math.max(0, matchIndex - 48), matchIndex).trim();
  return (
    /\b(?:pas|jamais|not|never)(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bne(?:\s+\p{L}+){0,3}\s+plus(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bno\s+longer(?:\s+\p{L}+){0,2}$/u.test(before) ||
    /\bdon\s+t(?:\s+\p{L}+){0,2}$/u.test(before)
  );
}

function countUnnegated(pattern: RegExp, text: string): number {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = global.exec(text)) !== null) {
    if (!isNegatedAt(text, match.index)) count += 1;
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return count;
}

/** Detect the dominant emotion, its intensity and a confidence score. Pure. */
export function detectEmotion(heard: string): EmotionRead {
  const t = normalizeUtterance(heard ?? '');
  if (!t) return { emotion: 'neutral', intensity: 'normal', confidence: 0 };
  const intensityHigh = INTENSITY.test(t);
  const intensity: 'normal' | 'high' = intensityHigh ? 'high' : 'normal';
  for (const emotion of EMOTION_ORDER) {
    const hits = countUnnegated(MARKERS[emotion], t);
    if (hits === 0) continue;
    const confidence = Math.max(
      0,
      Math.min(1, 0.55 + Math.min(2, hits - 1) * 0.15 + (intensityHigh ? 0.2 : 0)),
    );
    return { emotion, intensity, confidence };
  }
  return { emotion: 'neutral', intensity, confidence: 0 };
}

/** Map a fine emotion to the coarse drift signal. Pure. */
export function emotionToSignal(emotion: Emotion): RelationalSignal {
  switch (emotion) {
    case 'frustration':
    case 'anxiety':
    case 'tired':
      return 'frustration';
    case 'sadness':
    case 'deep-talk':
      return 'deep-talk';
    case 'joy':
    case 'joking':
      return 'joking';
    case 'affection':
      return 'affection';
    case 'gratitude':
      return 'gratitude';
    default:
      return 'neutral';
  }
}

/** The drift signal of an utterance, in one call. */
export function detectRelationalSignal(heard: string): RelationalSignal {
  return emotionToSignal(detectEmotion(heard).emotion);
}
