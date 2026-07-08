/**
 * Voice guidance — a tiny, bounded store of self-authored "how to reply better"
 * lines that the voice-assistant improvement loop learns from recent
 * conversations (see voice-improvement-loop.ts) and that get injected into
 * Lisa's spoken replies via `buildRelationalContext`.
 *
 * MySoulmate-inspired: the companion adapts its communication style over time.
 * Unlike user FACTS (privacy-screened, human-review-gated in user-model.ts),
 * these are low-stakes BEHAVIOURAL nudges ("keep replies to one or two
 * sentences", "he prefers you get to the point") — so they can be applied
 * automatically, but stay bounded (most-recent N) and fully reversible (a plain
 * JSON list the user can edit or clear).
 *
 * Pure/never-throws, mirrors the file-I/O style of relationship-state.ts.
 *
 * @module companion/voice-guidance
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface VoiceGuidanceItem {
  /** The one-line guidance, imperative and short. */
  text: string;
  /** When it was learned (ms epoch). */
  at: number;
}

/** Keep the store small so the injected block stays cheap and current. */
export const MAX_VOICE_GUIDANCE = 5;

export function defaultVoiceGuidancePath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CODEBUDDY_VOICE_GUIDANCE_FILE?.trim() ||
    join(homedir(), '.codebuddy', 'companion', 'voice-guidance.json')
  );
}

/** Load the guidance list (never throws; missing/corrupt → []). */
export function loadVoiceGuidance(path: string = defaultVoiceGuidancePath()): VoiceGuidanceItem[] {
  try {
    if (!existsSync(path)) return [];
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (x): x is VoiceGuidanceItem =>
          !!x &&
          typeof (x as VoiceGuidanceItem).text === 'string' &&
          (x as VoiceGuidanceItem).text.trim().length > 0
      )
      .map((x) => ({ text: x.text.trim(), at: Number(x.at) || 0 }));
  } catch {
    return [];
  }
}

/** Save the list (never throws; creates the dir). */
export function saveVoiceGuidance(
  items: VoiceGuidanceItem[],
  path: string = defaultVoiceGuidancePath()
): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(items, null, 2));
  } catch {
    /* best-effort */
  }
}

/**
 * Add a guidance line: dedup (case-insensitive), newest first, capped at
 * MAX_VOICE_GUIDANCE. Returns the new list (pure on the input array). An empty
 * or whitespace line is a no-op.
 */
export function addVoiceGuidance(
  text: string,
  now: number,
  existing: VoiceGuidanceItem[] = []
): VoiceGuidanceItem[] {
  const t = (text ?? '').trim();
  if (!t) return existing;
  const norm = t.toLowerCase();
  const kept = existing.filter((x) => x.text.toLowerCase() !== norm);
  return [{ text: t, at: now }, ...kept].slice(0, MAX_VOICE_GUIDANCE);
}

/** Format the guidance as a `<voice_guidance>` block for the reply system prompt (null when empty). */
export function formatVoiceGuidance(items: VoiceGuidanceItem[]): string | null {
  const lines = items
    .map((x) => x.text.trim())
    .filter(Boolean)
    .slice(0, MAX_VOICE_GUIDANCE);
  if (lines.length === 0) return null;
  return `<voice_guidance>\nCe que j'ai appris sur la meilleure façon de lui parler :\n${lines
    .map((l) => `- ${l}`)
    .join('\n')}\n</voice_guidance>`;
}
