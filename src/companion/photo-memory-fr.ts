/**
 * French memory line for a shared photo.
 *
 * Local VLMs (moondream) caption in English. The rolling `photos:recent` block
 * and the album sidecar `descriptionLisa` must stay in Lisa's voice — one short
 * French sentence — so `<recent_photos>` never carries raw English.
 *
 * Prefer a one-shot call to the current companion model; if it is missing or
 * returns English, fall back to a deterministic 30-word color/shape/place map.
 *
 * @module companion/photo-memory-fr
 */

import { logger } from '../utils/logger.js';

/** Hard cap on the spoken souvenir (body, after « tu m'as montré »). */
export const PHOTO_FR_MAX_WORDS = 25;

/** Timeout for the companion-model summary. Fail open to the lexicon. */
const PHOTO_FR_LLM_TIMEOUT_MS = 5_000;

const EN_FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'with',
  'of',
  'on',
  'in',
  'at',
  'to',
  'from',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'large',
  'small',
  'big',
  'little',
  'showing',
  'shows',
  'image',
  'picture',
  'there',
  'here',
  'some',
  'under',
  'over',
  'near',
]);

const FR_FUNCTION_WORDS = new Set([
  'un',
  'une',
  'le',
  'la',
  'les',
  'des',
  'du',
  'de',
  'au',
  'aux',
  'et',
  'est',
  'sur',
  'dans',
  'avec',
  'cette',
  'ce',
  'ces',
  'photo',
]);

interface PlaceLexeme {
  fr: string;
  prep: 'sur' | 'dans';
  art: 'le' | 'la';
}

/** 11 colors. `grey` is an alias of `gray`, not a 12th entry. */
const COLOR_FR: Readonly<Record<string, string>> = {
  red: 'rouge',
  blue: 'bleu',
  green: 'vert',
  yellow: 'jaune',
  orange: 'orange',
  pink: 'rose',
  purple: 'violet',
  black: 'noir',
  white: 'blanc',
  gray: 'gris',
  grey: 'gris',
  brown: 'brun',
};

/** 6 shapes. */
const SHAPE_FR: Readonly<Record<string, string>> = {
  circle: 'cercle',
  square: 'carré',
  rectangle: 'rectangle',
  triangle: 'triangle',
  oval: 'ovale',
  star: 'étoile',
};

/** 13 places (color + shape + place = 30 canonical English keys, grey excluded). */
const PLACE_FR: Readonly<Record<string, PlaceLexeme>> = {
  sky: { fr: 'ciel', prep: 'dans', art: 'le' },
  sea: { fr: 'mer', prep: 'dans', art: 'la' },
  lake: { fr: 'lac', prep: 'sur', art: 'le' },
  beach: { fr: 'plage', prep: 'sur', art: 'la' },
  mountain: { fr: 'montagne', prep: 'sur', art: 'la' },
  forest: { fr: 'forêt', prep: 'dans', art: 'la' },
  street: { fr: 'rue', prep: 'dans', art: 'la' },
  room: { fr: 'pièce', prep: 'dans', art: 'la' },
  table: { fr: 'table', prep: 'sur', art: 'la' },
  garden: { fr: 'jardin', prep: 'dans', art: 'le' },
  park: { fr: 'parc', prep: 'dans', art: 'le' },
  city: { fr: 'ville', prep: 'dans', art: 'la' },
  house: { fr: 'maison', prep: 'dans', art: 'la' },
};

const CANONICAL_EN_KEYS = [
  ...Object.keys(COLOR_FR).filter((key) => key !== 'grey'),
  ...Object.keys(SHAPE_FR),
  ...Object.keys(PLACE_FR),
] as const;

/** Exactly 30 English color/shape/place lemmas (grey is an alias). */
export const PHOTO_FR_LEXICON_SIZE = CANONICAL_EN_KEYS.length;

export type PhotoFrSummarizer = (description: string) => Promise<string | null>;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^a-zàâäéèêëïîôùûüç]+/iu)
    .filter(Boolean);
}

function lemma(token: string): string {
  if (COLOR_FR[token] || SHAPE_FR[token] || PLACE_FR[token]) return token;
  if (token.length > 3 && token.endsWith('s')) {
    const singular = token.slice(0, -1);
    if (COLOR_FR[singular] || SHAPE_FR[singular] || PLACE_FR[singular]) return singular;
  }
  return token;
}

/** True when the caption looks English (VLM output), not already French. */
export function looksLikeEnglishPhotoDescription(text: string): boolean {
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;
  let en = 0;
  let fr = 0;
  for (const token of tokens) {
    const key = lemma(token);
    if (EN_FUNCTION_WORDS.has(token) || COLOR_FR[key] || SHAPE_FR[key] || PLACE_FR[key]) en += 1;
    if (FR_FUNCTION_WORDS.has(token) || /[àâäéèêëïîôùûüç]/iu.test(token)) fr += 1;
  }
  return en > fr;
}

/** True when a token is an English lemma whose French translation differs. */
function isEnglishOnlyLemma(token: string): boolean {
  const key = lemma(token);
  if (EN_FUNCTION_WORDS.has(token)) return true;
  const color = COLOR_FR[key];
  if (color && color !== key) return true;
  const shape = SHAPE_FR[key];
  if (shape && shape !== key) return true;
  const place = PLACE_FR[key];
  if (place && place.fr !== key) return true;
  return false;
}

function containsEnglishLemma(text: string): boolean {
  return tokenize(text).some((token) => isEnglishOnlyLemma(token));
}

/**
 * Deterministic souvenir when the companion model is missing. Translates the
 * 30 color/shape/place lemmas and drops leftover English tokens.
 */
export function fallbackFrenchPhotoDescription(text: string): string {
  const tokens = tokenize(text).map(lemma);
  let color: string | undefined;
  let shape: string | undefined;
  let place: PlaceLexeme | undefined;
  for (const token of tokens) {
    if (!color && COLOR_FR[token]) color = COLOR_FR[token];
    if (!shape && SHAPE_FR[token]) shape = SHAPE_FR[token];
    if (!place && PLACE_FR[token]) place = PLACE_FR[token];
  }
  const parts: string[] = [];
  if (shape) parts.push(color ? `un ${shape} ${color}` : `un ${shape}`);
  else if (color) parts.push(`quelque chose de ${color}`);
  if (place) parts.push(`${place.prep} ${place.art} ${place.fr}`);
  return parts.join(' ') || 'une photo';
}

const TU_MAS_MONTRE = /^tu m['’]as montré\s+/iu;

export function stripLisaPhotoPrefix(text: string): string {
  return text.replace(TU_MAS_MONTRE, '').trim();
}

function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/u);
  return (match?.[1] ?? trimmed).replace(/[.!?]+$/u, '').trim();
}

function capWords(text: string, max: number): string {
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ');
}

/** Keep a model summary only when it is a short French sentence. */
export function sanitizeFrenchPhotoSummary(raw: string): string | null {
  const cleaned = firstSentence(
    String(raw ?? '')
      .replace(/^["«»]+|["«»]+$/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!cleaned) return null;
  const body = capWords(stripLisaPhotoPrefix(cleaned), PHOTO_FR_MAX_WORDS);
  if (!body) return null;
  if (looksLikeEnglishPhotoDescription(body) || containsEnglishLemma(body)) return null;
  return body;
}

const PHOTO_FR_SYSTEM = [
  "Tu es Lisa. On vient de te montrer une photo.",
  "Résume la description en UNE phrase française, au plus 25 mots.",
  "Première personne : commence par « tu m'as montré ».",
  "Pas d'anglais, pas de jargon, pas de guillemets, pas d'emoji.",
  'Réponds uniquement par cette phrase.',
].join(' ');

async function defaultCompanionSummarizer(description: string): Promise<string | null> {
  try {
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    const resolved = resolveCommandProvider();
    if (!resolved) return null;
    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    const client = new CodeBuddyClient(
      resolved.apiKey || 'ollama',
      resolved.model || 'qwen3:4b-instruct',
      resolved.baseURL,
    );
    const chat = client.chat(
      [
        { role: 'system', content: PHOTO_FR_SYSTEM },
        { role: 'user', content: description },
      ] as never,
      [],
      { maxTokens: 80, temperature: 0.2 },
    );
    const timed = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), PHOTO_FR_LLM_TIMEOUT_MS).unref();
    });
    const resp = await Promise.race([chat, timed]);
    if (!resp) return null;
    const content = resp.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  } catch (error) {
    logger.debug('[photo-memory-fr] companion summary skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface ToFrenchPhotoMemoryOptions {
  /** Test seam — production talks to the current companion model. */
  summarizeFr?: PhotoFrSummarizer;
}

/**
 * French body of the souvenir (no date, no « tu m'as montré » prefix).
 * Already-French captions pass through. English VLM captions are summarized.
 */
export async function toFrenchPhotoMemory(
  description: string,
  options: ToFrenchPhotoMemoryOptions = {},
): Promise<string> {
  const source = String(description ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '';
  if (!looksLikeEnglishPhotoDescription(source)) return stripLisaPhotoPrefix(source);

  const summarize = options.summarizeFr ?? defaultCompanionSummarizer;
  try {
    const raw = await summarize(source);
    const sanitized = raw ? sanitizeFrenchPhotoSummary(raw) : null;
    if (sanitized) return sanitized;
  } catch (error) {
    logger.debug('[photo-memory-fr] summarizer failed, using lexicon', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return fallbackFrenchPhotoDescription(source);
}
