/**
 * Companion « mode déplacement » — Telegram cadence while the user is away.
 * Opt-in CODEBUDDY_COMPANION_AWAY=true, or 24 h without a camera sighting when
 * the copine persona is active. Default off ⇒ the proactive engine is unchanged.
 *
 * @module companion/away-mode
 */

import { homedir } from 'os';
import { join } from 'path';
import { resolveCompanionPersona } from './personas/index.js';
import type { CompanionAwayAngle } from './personas/types.js';
import { pickUnsaidLine } from './recent-said.js';
import { resolveHouseholdClock } from './household-time.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export type { CompanionAwayAngle };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW = '08:30-22:00';
const DEFAULT_MAX_PER_DAY = 3;
const HOT_THREAD_MS = 30 * 60 * 1000;

export const AWAY_TEMPLATES: Record<CompanionAwayAngle, readonly string[]> = {
  morning: [
    'Bonjour. Juste un bonjour, pas un roman.',
    'Hey. J’espère que tu as un peu dormi, là-bas.',
    'Bonjour toi. Passe une belle journée — pas besoin de me répondre.',
    'Un petit bonjour depuis ici. Je pense à toi.',
    'Bonjour. Rien d’urgent — juste ça.',
    'Salut. Je t’écris un bonjour, et je te laisse.',
    'Te souhaiter une belle matinée, d’ici.',
    'Bonjour. Café ou valise, peu importe : une journée douce.',
  ],
  thought: [
    'Une pensée, pas une question. Je suis là.',
    'Je pensais à toi, au milieu de la journée. C’est tout.',
    'Rien à demander. Juste un mot, puis je te laisse.',
    'J’espère que ça va, de ton côté. Pas besoin de répondre.',
    'Je ne relance pas. Juste une pensée.',
    'Coucou. Je bossais, et toi tu m’as traversé l’esprit.',
    'Pas de « tu m’ignores ». Juste : je pense à toi.',
    'Un petit signe. Ton projet me traverse l’esprit — sans coller.',
  ],
  evening: [
    'Bonsoir. Cette journée, si tu as envie d’en dire un mot — sinon c’est bon.',
    'Hey. Je te souhaite une soirée calme.',
    'Bonsoir toi. Une pensée, et je m’arrête.',
    'La soirée arrive. Je pense à toi, sans te coller.',
    'Bonsoir. Si tu veux raconter, je lis ; sinon dors quand tu veux.',
    'Un bonsoir d’ici. Pas de récapitulatif.',
    'Je te laisse ta soirée. Juste un mot.',
    'Bonne soirée. Demain on verra.',
  ],
};

export interface AwayState {
  /** Civil date in the household timezone (YYYY-MM-DD). */
  date?: string;
  sent: CompanionAwayAngle[];
  pauseUntil?: number;
  lastInboundAt?: number;
  lastLine?: string;
}

export interface AwayClock {
  now: number;
  localDate: string;
  hour: number;
  minute: number;
  minutesOfDay: number;
}

export function awayMaxPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CODEBUDDY_COMPANION_AWAY_MAX_PER_DAY);
  if (Number.isFinite(n) && n >= 0) return Math.min(24, Math.floor(n));
  return DEFAULT_MAX_PER_DAY;
}

export function parseAwayHours(
  spec: string = process.env.CODEBUDDY_COMPANION_AWAY_HOURS || DEFAULT_WINDOW,
): { startMin: number; endMin: number } | null {
  const m = spec.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const startH = Number(m[1]);
  const startM = Number(m[2]);
  const endH = Number(m[3]);
  const endM = Number(m[4]);
  if ([startH, startM, endH, endM].some((n) => !Number.isFinite(n))) return null;
  if (startH > 23 || endH > 23 || startM > 59 || endM > 59) return null;
  return { startMin: startH * 60 + startM, endMin: endH * 60 + endM };
}

export function inAwayWindow(minutesOfDay: number, env: NodeJS.ProcessEnv = process.env): boolean {
  const win = parseAwayHours(env.CODEBUDDY_COMPANION_AWAY_HOURS || DEFAULT_WINDOW);
  if (!win) return false;
  if (win.startMin === win.endMin) return false;
  if (win.startMin < win.endMin) {
    return minutesOfDay >= win.startMin && minutesOfDay < win.endMin;
  }
  return minutesOfDay >= win.startMin || minutesOfDay < win.endMin;
}

export function resolveAwayClock(now: number, timeZone?: string): AwayClock {
  const clock = resolveHouseholdClock(new Date(now), timeZone);
  return {
    now,
    localDate: clock.localDate,
    hour: clock.hour,
    minute: clock.minute,
    minutesOfDay: clock.hour * 60 + clock.minute,
  };
}

/**
 * Away mode: explicit flag, or 24 h without a camera sighting when the copine
 * persona is on. Presence in front of the camera is NOT away (he's home).
 */
export function isCompanionAway(input: {
  now: number;
  lastPresentAt?: number | null;
  present?: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.present) return false;
  const env = input.env ?? process.env;
  const flag = (env.CODEBUDDY_COMPANION_AWAY ?? '').trim().toLowerCase();
  if (flag === 'true' || flag === '1' || flag === 'yes') return true;
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  if (resolveCompanionPersona(env) && input.lastPresentAt != null) {
    return input.now - input.lastPresentAt >= DAY_MS;
  }
  return false;
}

export function angleForClock(clock: Pick<AwayClock, 'hour'>): CompanionAwayAngle {
  if (clock.hour < 12) return 'morning';
  if (clock.hour < 18) return 'thought';
  return 'evening';
}

export function pickAwayAngle(
  clock: Pick<AwayClock, 'hour'>,
  sent: readonly CompanionAwayAngle[],
): CompanionAwayAngle | null {
  const wanted = angleForClock(clock);
  if (sent.includes(wanted)) return null;
  return wanted;
}

function defaultAwayStatePath(): string {
  return (
    process.env.CODEBUDDY_COMPANION_AWAY_STATE_FILE ||
    join(homedir(), '.codebuddy', 'companion', 'away-state.json')
  );
}

export function loadAwayState(statePath = defaultAwayStatePath()): AwayState {
  const data = readJsonAtomicSync<Record<string, unknown> | null>(statePath, null, {
    mode: 0o600,
    isValid: (value): value is Record<string, unknown> =>
      Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  });
  if (!data) return { sent: [] };
  const sent = Array.isArray(data.sent)
    ? data.sent.filter((item): item is CompanionAwayAngle =>
        item === 'morning' || item === 'thought' || item === 'evening',
      )
    : [];
  return {
    sent,
    ...(typeof data.date === 'string' ? { date: data.date } : {}),
    ...(typeof data.pauseUntil === 'number' ? { pauseUntil: data.pauseUntil } : {}),
    ...(typeof data.lastInboundAt === 'number' ? { lastInboundAt: data.lastInboundAt } : {}),
    ...(typeof data.lastLine === 'string' ? { lastLine: data.lastLine } : {}),
  };
}

export function saveAwayState(state: AwayState, statePath = defaultAwayStatePath()): boolean {
  try {
    writeJsonAtomicSync(statePath, state, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function rollAwayState(state: AwayState, localDate: string): AwayState {
  if (state.date === localDate) return state;
  return {
    date: localDate,
    sent: [],
    ...(state.pauseUntil != null ? { pauseUntil: state.pauseUntil } : {}),
    ...(state.lastInboundAt != null ? { lastInboundAt: state.lastInboundAt } : {}),
  };
}

export function isAwayPaused(state: AwayState, now: number): boolean {
  return (state.pauseUntil ?? 0) > now;
}

export function isHotAwayThread(state: AwayState, now: number, windowMs = HOT_THREAD_MS): boolean {
  const last = state.lastInboundAt;
  if (last == null) return false;
  return now - last < windowMs;
}

/** Whole-message stop / pas maintenant. Conservative so « stopper un bug » does not match. */
export function isAwayPauseRequest(text: string): boolean {
  const n = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!n) return false;
  return /^(stop|arrete(?: toi)?|pas maintenant)(?: svp| s il te plait)?$/.test(n);
}

export function noteAwayPause(now: number, statePath = defaultAwayStatePath()): AwayState {
  const next: AwayState = { ...loadAwayState(statePath), pauseUntil: now + DAY_MS };
  saveAwayState(next, statePath);
  return next;
}

export function noteAwayInbound(now: number, text: string, statePath = defaultAwayStatePath()): AwayState {
  let state = loadAwayState(statePath);
  try {
    if (isAwayPauseRequest(text)) {
      state = { ...state, pauseUntil: now + DAY_MS, lastInboundAt: now };
    } else {
      state = { ...state, lastInboundAt: now };
    }
    saveAwayState(state, statePath);
  } catch {
    /* never throw on an inbound hook */
  }
  return state;
}

/** Channel inbound hook: Telegram only, never-throws. */
export function observeInboundForAwayPause(channelType: string, text: string, now = Date.now()): void {
  try {
    if (channelType !== 'telegram') return;
    if (!text || !text.trim()) return;
    noteAwayInbound(now, text);
  } catch {
    /* inbound observation is optional */
  }
}

export function awayTemplatesFor(
  angle: CompanionAwayAngle,
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const persona = resolveCompanionPersona(env);
  const overlay = persona?.away[angle];
  if (overlay && overlay.length > 0) return overlay;
  return AWAY_TEMPLATES[angle];
}

export function pickAwayLine(
  angle: CompanionAwayAngle,
  opts: {
    rng?: () => number;
    avoid?: string;
    env?: NodeJS.ProcessEnv;
    now?: number;
    statePath?: string;
  } = {},
): string {
  const pool = awayTemplatesFor(angle, opts.env);
  return pickUnsaidLine(pool, {
    rng: opts.rng,
    avoid: opts.avoid,
    env: opts.env,
    now: opts.now,
    statePath: opts.statePath,
  });
}

export function canSendAway(input: {
  state: AwayState;
  clock: AwayClock;
  env?: NodeJS.ProcessEnv;
}): { ok: true; angle: CompanionAwayAngle } | { ok: false; reason: string } {
  const env = input.env ?? process.env;
  const state = rollAwayState(input.state, input.clock.localDate);
  if (isAwayPaused(state, input.clock.now)) return { ok: false, reason: 'paused' };
  if (isHotAwayThread(state, input.clock.now)) return { ok: false, reason: 'hot-thread' };
  if (!inAwayWindow(input.clock.minutesOfDay, env)) return { ok: false, reason: 'window' };
  if (state.sent.length >= awayMaxPerDay(env)) return { ok: false, reason: 'cap' };
  const angle = pickAwayAngle(input.clock, state.sent);
  if (!angle) return { ok: false, reason: 'angle' };
  return { ok: true, angle };
}

export function recordAwaySend(
  state: AwayState,
  input: { angle: CompanionAwayAngle; clock: AwayClock; line: string },
): AwayState {
  const rolled = rollAwayState(state, input.clock.localDate);
  const sent = rolled.sent.includes(input.angle) ? rolled.sent : [...rolled.sent, input.angle];
  return {
    ...rolled,
    date: input.clock.localDate,
    sent,
    lastLine: input.line,
  };
}

const SHAME =
  /ca fait \d+ jours|sans te (voir|croiser)|tu me manques|tu m ignores|tes amis a ta place/i;

export function isAwayShameLine(text: string): boolean {
  const n = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
  return SHAME.test(n);
}
