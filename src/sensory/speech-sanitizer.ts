/**
 * Speech sanitizer — the gate before ANY text is synthesized and sent to the speakers.
 *
 * The companion occasionally produces text that is fine to LOG but wrong to SPEAK:
 *   - leaked model control tokens / thinking blocks (`<think>`, `<|im_start|>`, GLM full-width…);
 *   - foreign-script contamination: a local model drifts mid-reply into CJK/Hangul — often a
 *     self-instruction it should never have emitted. Observed live, a French reply ending in
 *     "…tu peux<CJK>" ("…extend the sentence to make it more fluent"). A French Piper voice cannot
 *     pronounce that run, so the speaker plays garbage.
 *
 * `prepareSpeech()` strips both, then applies a "does this still say something?" floor (some
 * Latin letters or digits must remain). It returns the cleaned line, or `null` to stay silent.
 *
 * It deliberately does NOT try to catch *well-formed* nonsense (grammatical but hallucinated) —
 * that needs an LLM and per-utterance latency; this gate is deterministic and $0. Err toward
 * speaking: for a companion a rare artifact is less bad than a wrongly-muted real reply, so only
 * clearly-unpronounceable scripts (CJK/Hangul) are stripped, not every non-Latin script.
 *
 * @module sensory/speech-sanitizer
 */
import { sanitizeModelOutput, stripInvisibleChars } from '../utils/output-sanitizer.js';

/**
 * Runs of scripts a Latin-script (FR/EN) TTS voice cannot pronounce — in practice LLM
 * contamination rather than intended content: Han / Hiragana / Katakana / Hangul letters plus
 * CJK & full-width punctuation (U+3000–303F and U+FF00–FFEF, e.g. the full-width comma/period a
 * leaked Chinese clause carries). Stripped run-wise so the surrounding Latin text survives.
 */
const NON_LATIN_SCRIPT_RUN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]+/gu;

/** The floor for "this still says something speakable": at least one letter or digit. */
const HAS_SPEAKABLE_CONTENT = /[\p{L}\p{N}]/u;
const EMOJI_RUN = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

const SMALL_NUMBERS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
] as const;
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'] as const;

function underHundred(value: number): string {
  if (value < SMALL_NUMBERS.length) return SMALL_NUMBERS[value] ?? '';
  if (value < 20) return `dix-${SMALL_NUMBERS[value - 10]}`;
  if (value < 70) {
    const tens = Math.floor(value / 10);
    const unit = value % 10;
    if (unit === 0) return TENS[tens] ?? '';
    return `${TENS[tens]}${unit === 1 ? ' et un' : `-${SMALL_NUMBERS[unit]}`}`;
  }
  if (value < 80) {
    const remainder = value - 60;
    return remainder === 11
      ? 'soixante et onze'
      : `soixante-${underHundred(remainder)}`;
  }
  const remainder = value - 80;
  if (remainder === 0) return 'quatre-vingts';
  return `quatre-vingt-${underHundred(remainder)}`;
}

/** Canonical French cardinal for the integer range supported by the TTS sanitizer. */
export function frenchIntegerToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9_999) return String(value);
  if (value < 100) return underHundred(value);
  if (value < 1_000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    const head = hundreds === 1 ? 'cent' : `${SMALL_NUMBERS[hundreds]} cent${remainder === 0 ? 's' : ''}`;
    return remainder === 0 ? head : `${head} ${underHundred(remainder)}`;
  }
  const thousands = Math.floor(value / 1_000);
  const remainder = value % 1_000;
  const head = thousands === 1 ? 'mille' : `${underHundred(thousands)} mille`;
  return remainder === 0 ? head : `${head} ${frenchIntegerToWords(remainder)}`;
}

/** Normalize the bounded numeric forms that French local voices pronounce inconsistently. */
export function normalizeFrenchNumbers(text: string): string {
  let output = text;
  output = output.replace(/\b(\d{1,2})\s*h\s*(\d{1,2})\b/giu, (_match, hour: string, minute: string) => {
    const hourValue = Number(hour);
    const minuteValue = Number(minute);
    if (hourValue > 23 || minuteValue > 59) return _match;
    return `${frenchIntegerToWords(hourValue)} heure${hourValue === 1 ? '' : 's'} ${frenchIntegerToWords(minuteValue)}`;
  });
  output = output.replace(/\b1(?:er|re)\b/giu, (match) =>
    match.toLocaleLowerCase('fr-FR').endsWith('re') ? 'première' : 'premier');
  output = output.replace(/\b2(?:e|ème)\b/giu, 'deuxième');
  output = output.replace(/(?<![\d.,])(\d{1,4})\s*%/gu, (_match, digits: string) =>
    `${frenchIntegerToWords(Number(digits))} pour cent`);
  output = output.replace(/(?<![\d.,])(\d{1,4})(?![\d.,])/gu, (_match, digits: string) =>
    frenchIntegerToWords(Number(digits)));
  return output;
}

function stripSpeechMarkdown(text: string): string {
  let output = text.replace(/```[\w-]*\n?/gu, '').replace(/```/gu, '');
  output = output.replace(/`([^`]+)`/gu, '$1');
  output = output.replace(/\*\*([^*]+)\*\*/gu, '$1').replace(/\*([^*]+)\*/gu, '$1');
  output = output.replace(/__([^_]+)__/gu, '$1').replace(/_([^_]+)_/gu, '$1');
  output = output.replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1');
  output = output.replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1');
  output = output.replace(/^\s{0,3}#{1,6}\s+/gmu, '');
  output = output.replace(/^\s*>\s?/gmu, '');
  output = output.replace(/[*_`#>~]/gu, '');
  return output;
}

/** Remove runs of unpronounceable (for a Latin voice) foreign script, leaving a space behind. */
export function stripForeignScript(text: string): string {
  return text.replace(NON_LATIN_SCRIPT_RUN, ' ');
}

/**
 * Clean a line for TTS. Returns the speakable text, or `null` when nothing meaningful remains
 * (empty, only punctuation/symbols/emoji, or only foreign-script / leaked-token residue) so the
 * caller can stay silent.
 */
export function prepareSpeech(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let t = sanitizeModelOutput(raw);
  t = stripInvisibleChars(t);
  t = t.replace(/^\s*(?:[-*+•▪◦‣]|\d+[.)])\s+/gmu, ', ');
  t = stripSpeechMarkdown(t);
  t = t.replace(EMOJI_RUN, ' ');
  // Keep the ellipsis and attack interjections generated as text-level prosody controls. Pocket
  // TTS uses this punctuation to produce a real suspension rather than a plain sentence stop.
  t = t.replace(/!+/gu, '!').replace(/\?+/gu, '?');
  // Lists and standalone dashes become pauses, without breaking compounds such
  // as "peut-être" or the hyphens produced by French number words.
  t = t.replace(/\s+[–—-]\s+/gu, ', ');
  t = t.replace(/\s*\n\s*,\s*/gu, ', ');
  t = t.replace(/\n+/gu, '. ');
  // Replace foreign runs with a space (never ''), so Latin words on either side don't get glued
  // ("bonjour，patrice"), then collapse the doubles. We deliberately do NOT rewrite spacing around
  // punctuation: French keeps a space before ! ? : ; and touching it would mutate every clean reply.
  t = stripForeignScript(t);
  t = normalizeFrenchNumbers(t);
  t = t.replace(/\b([A-ZÀ-ÖØ-Þ]{2,4})\b/gu, (sigle) => [...sigle].join(' '));
  t = t.replace(/\s{2,}/gu, ' ').replace(/^\s*[,.;:]+\s*/u, '').trim();
  if (!t) return null;
  if (!HAS_SPEAKABLE_CONTENT.test(t)) return null;
  return t;
}
