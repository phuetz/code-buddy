/**
 * Opt-in two-speed speech policy: short/urgent conversational segments use the
 * low-latency local Kyutai renderer, while long continuations keep Lisa's
 * configured ElevenLabs voice. With the flag unset this module returns the
 * established route without changing any synthesis behavior.
 */

export const DEFAULT_TTS_SHORT_MAX_CHARS = 80;
const MAX_TTS_SHORT_MAX_CHARS = 2_000;

export type TwoSpeedTtsRoute = 'default' | 'local' | 'elevenlabs';
export type TwoSpeedTtsRouteHint =
  | 'backchannel'
  | 'opening'
  | 'reminder'
  | 'conv3-first';

export interface TwoSpeedTtsDecision {
  route: TwoSpeedTtsRoute;
  reason: string;
}

/** Exact opt-in: every value other than `true` preserves the previous path. */
export function twoSpeedTtsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_TTS_TWO_SPEED?.trim().toLowerCase() === 'true';
}

/** Bound the local/long cutoff while preserving the documented 80-char default. */
export function resolveTwoSpeedShortMaxChars(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.CODEBUDDY_TTS_SHORT_MAX_CHARS?.trim();
  if (!raw) return DEFAULT_TTS_SHORT_MAX_CHARS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTS_SHORT_MAX_CHARS;
  return Math.max(1, Math.min(MAX_TTS_SHORT_MAX_CHARS, Math.floor(parsed)));
}

/** Pure per-segment routing decision, shared by stream and WAV paths. */
export function selectTwoSpeedTtsRoute(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  hint?: TwoSpeedTtsRouteHint,
): TwoSpeedTtsDecision {
  if (!twoSpeedTtsEnabled(env)) {
    return { route: 'default', reason: 'feature-disabled' };
  }
  if (hint) return { route: 'local', reason: hint };

  const phrase = text.trim();
  if (/^pardon\b/iu.test(phrase)) {
    return { route: 'local', reason: 'repair' };
  }
  const maximum = resolveTwoSpeedShortMaxChars(env);
  if (phrase.length <= maximum) {
    return { route: 'local', reason: `short<=${maximum}` };
  }
  return { route: 'elevenlabs', reason: `long>${maximum}` };
}
