/**
 * speech-text — pure helpers for the voice surface (no React, so they're trivially
 * unit-testable in node). Two concerns:
 *
 *  - turning an assistant message into something worth SPEAKING (strip markdown,
 *    then condense to a spoken-length summary — a companion that reads a full
 *    markdown answer aloud is unusable);
 *  - the "voice command mode" preference (push-to-talk that EXECUTES the spoken
 *    instruction vs. dictation that just fills the composer), persisted to
 *    localStorage like the TTS toggle.
 *
 * @module renderer/utils/speech-text
 */

/** Strip markdown so it reads naturally aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export interface CondenseOptions {
  /** Hard character cap (default 350). */
  maxChars?: number;
  /** Max sentences kept (default 3). */
  maxSentences?: number;
}

/**
 * Condense an assistant message to a spoken-length summary: clean markdown, take the
 * first paragraph, keep the first few sentences, hard-cap the length. It only needs to
 * be a reasonable spoken digest — the agent's full answer still lives on screen.
 */
export function condenseForSpeech(text: string, opts: CondenseOptions = {}): string {
  const maxChars = opts.maxChars ?? 350;
  const maxSentences = opts.maxSentences ?? 3;
  const clean = cleanForSpeech(text);
  if (!clean) return '';
  // First paragraph only — speech doesn't want a wall of text.
  const firstPara = clean.split(/\n{2,}/)[0]?.trim() || clean;
  // First N sentences (or the whole paragraph if it has no sentence punctuation).
  const sentences = firstPara.match(/[^.!?]+[.!?]+(\s|$)/g);
  let out = sentences
    ? sentences.slice(0, maxSentences).map((s) => s.trim()).join(' ').trim()
    : firstPara;
  if (out.length > maxChars) out = `${out.slice(0, maxChars).trim()}…`;
  return out;
}

const COMMAND_MODE_KEY = 'cowork.voice.command.enabled';

/** True when push-to-talk should EXECUTE the transcript (voice piloting) vs. dictate it.
 *  Cowork defaults to PILOTING — the mic commands the agent; flip the toggle for dictation.
 *  (Only an explicit '0' opts out; unset → piloting on.) */
export function isVoiceCommandMode(): boolean {
  try {
    return localStorage.getItem(COMMAND_MODE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Persist the voice command-mode preference. */
export function setVoiceCommandMode(on: boolean): void {
  try {
    localStorage.setItem(COMMAND_MODE_KEY, on ? '1' : '0');
  } catch {
    /* localStorage unavailable (e.g. tests) — preference simply doesn't persist */
  }
}
