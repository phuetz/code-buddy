/**
 * Capped initiative planning — when a companion may write FIRST, and how often.
 *
 * Ported from the robot's away mode and proactive engine, minus every delivery
 * concern: no messaging API, no scheduler, no side effect. The planner answers
 * one question — « may I send something right now, and which line » — and the
 * host decides how to deliver it.
 *
 * The caps are the feature: at most N a day, one line per angle, inside a wall
 * clock window, silent while a thread is warm, and a 24 h stop the moment the
 * user asks. Nothing here can shame the user into answering.
 *
 * @module initiative/planner
 */

import type { CompanionProfile, Initiative, InitiativeAngle } from '../types.js';
import type { CivilClock } from '../runtime/clock.js';
import type { Rng } from '../runtime/rng.js';
import { pickLine } from '../persona/registry.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The cadence a host may tune. Every default is the conservative one. */
export interface InitiativePolicy {
  /** Hard cap of initiatives per civil day. */
  maxPerDay: number;
  /** Window start, minutes from midnight (local). */
  windowStartMinute: number;
  /** Window end, exclusive. A start after the end means the window crosses midnight. */
  windowEndMinute: number;
  /** How long a reply keeps the companion quiet. */
  hotThreadMs: number;
  /** How long a « stop » silences initiatives. */
  pauseMs: number;
}

export const DEFAULT_INITIATIVE_POLICY: InitiativePolicy = {
  maxPerDay: 3,
  windowStartMinute: 8 * 60 + 30,
  windowEndMinute: 22 * 60,
  hotThreadMs: 30 * 60 * 1000,
  pauseMs: DAY_MS,
};

/** What the planner remembers between calls. Plain data — the host persists it. */
export interface InitiativeState {
  /** Civil date (YYYY-MM-DD) the counters belong to. */
  date?: string;
  /** Angles already spent today. */
  sent: InitiativeAngle[];
  /** Epoch ms until which initiatives are paused. */
  pauseUntil?: number;
  /** Epoch ms of the last inbound message. */
  lastInboundAt?: number;
  /** The last line sent — never repeated back to back. */
  lastLine?: string;
}

export type PlanRefusal = 'paused' | 'hot-thread' | 'window' | 'cap' | 'angle' | 'pool';

export type InitiativePlan =
  | { ok: true; initiative: Initiative; state: InitiativeState }
  | { ok: false; reason: PlanRefusal; state: InitiativeState };

export function emptyInitiativeState(): InitiativeState {
  return { sent: [] };
}

/** Coerce untrusted state. Never throws. */
export function normalizeInitiativeState(input: unknown): InitiativeState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return emptyInitiativeState();
  const record = input as Record<string, unknown>;
  const state: InitiativeState = {
    sent: Array.isArray(record.sent)
      ? record.sent.filter(
          (angle): angle is InitiativeAngle =>
            angle === 'morning' || angle === 'thought' || angle === 'evening',
        )
      : [],
  };
  if (typeof record.date === 'string') state.date = record.date;
  if (typeof record.pauseUntil === 'number') state.pauseUntil = record.pauseUntil;
  if (typeof record.lastInboundAt === 'number') state.lastInboundAt = record.lastInboundAt;
  if (typeof record.lastLine === 'string') state.lastLine = record.lastLine;
  return state;
}

/** Reset the per-day counters when the civil date changed. Pause and last line survive. */
export function rollInitiativeDay(state: InitiativeState, localDate: string): InitiativeState {
  if (state.date === localDate) return state;
  const rolled: InitiativeState = { date: localDate, sent: [] };
  if (state.pauseUntil != null) rolled.pauseUntil = state.pauseUntil;
  if (state.lastInboundAt != null) rolled.lastInboundAt = state.lastInboundAt;
  // The last line outlives midnight: two identical « bonjour » on consecutive
  // days is exactly the repetition the ring exists to prevent.
  if (state.lastLine != null) rolled.lastLine = state.lastLine;
  return rolled;
}

export function isPaused(state: InitiativeState, now: number): boolean {
  return (state.pauseUntil ?? 0) > now;
}

export function isHotThread(state: InitiativeState, now: number, hotThreadMs: number): boolean {
  const last = state.lastInboundAt;
  return last != null && now - last < hotThreadMs;
}

/** True when the local minute falls inside the window (midnight-crossing allowed). */
export function inWindow(minutesOfDay: number, policy: InitiativePolicy): boolean {
  const { windowStartMinute: start, windowEndMinute: end } = policy;
  if (start === end) return false;
  return start < end
    ? minutesOfDay >= start && minutesOfDay < end
    : minutesOfDay >= start || minutesOfDay < end;
}

/** The angle a given hour calls for. */
export function angleForHour(hour: number): InitiativeAngle {
  if (hour < 12) return 'morning';
  if (hour < 18) return 'thought';
  return 'evening';
}

/** The angle still available at this hour, or null when it is already spent. */
export function nextAngle(
  hour: number,
  sent: readonly InitiativeAngle[],
): InitiativeAngle | null {
  const wanted = angleForHour(hour);
  return sent.includes(wanted) ? null : wanted;
}

/**
 * A whole-message « stop » / « pas maintenant ». Deliberately conservative, so
 * « arrête ce test » or « stop the server » never silences the companion by accident.
 */
export function isPauseRequest(text: string): boolean {
  const n = (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!n) return false;
  return /^(stop|arrete(?: toi)?|pas maintenant|not now|leave me alone)(?: svp| s il te plait| please)?$/.test(n);
}

/** Register an inbound message: it warms the thread, and may request a pause. */
export function noteInbound(
  state: InitiativeState,
  text: string,
  now: number,
  policy: InitiativePolicy = DEFAULT_INITIATIVE_POLICY,
): InitiativeState {
  const next: InitiativeState = { ...state, lastInboundAt: now };
  if (isPauseRequest(text)) next.pauseUntil = now + policy.pauseMs;
  return next;
}

/** Silence initiatives for the policy's pause window. */
export function pauseInitiatives(
  state: InitiativeState,
  now: number,
  policy: InitiativePolicy = DEFAULT_INITIATIVE_POLICY,
): InitiativeState {
  return { ...state, pauseUntil: now + policy.pauseMs };
}

export interface PlanInput {
  state: InitiativeState;
  clock: CivilClock;
  profile: CompanionProfile;
  policy?: InitiativePolicy;
  rng?: Rng;
  /** Openers said recently on any channel — those lines are avoided. */
  avoid?: readonly string[];
  /** Name for the `{{name}}` slot. */
  name?: string | null;
}

/**
 * Decide whether to reach out, and with which line. Pure: it returns the plan and
 * the state to persist, and performs no delivery.
 */
export function planInitiative(input: PlanInput): InitiativePlan {
  const policy = input.policy ?? DEFAULT_INITIATIVE_POLICY;
  const state = rollInitiativeDay(input.state, input.clock.localDate);
  if (isPaused(state, input.clock.now)) return { ok: false, reason: 'paused', state };
  if (isHotThread(state, input.clock.now, policy.hotThreadMs)) {
    return { ok: false, reason: 'hot-thread', state };
  }
  if (!inWindow(input.clock.minutesOfDay, policy)) return { ok: false, reason: 'window', state };
  if (state.sent.length >= policy.maxPerDay) return { ok: false, reason: 'cap', state };
  const angle = nextAngle(input.clock.hour, state.sent);
  if (!angle) return { ok: false, reason: 'angle', state };

  const avoid = [...(input.avoid ?? [])];
  if (state.lastLine) avoid.push(state.lastLine);
  const line = pickLine(input.profile.away[angle], {
    ...(input.rng ? { rng: input.rng } : {}),
    avoid,
    name: input.name ?? null,
  });
  if (!line) return { ok: false, reason: 'pool', state };

  const initiative: Initiative = { angle, line, at: input.clock.now };
  return { ok: true, initiative, state: recordInitiative(state, initiative, input.clock.localDate) };
}

/** Book an initiative against the day's budget. */
export function recordInitiative(
  state: InitiativeState,
  initiative: Initiative,
  localDate: string,
): InitiativeState {
  const rolled = rollInitiativeDay(state, localDate);
  return {
    ...rolled,
    date: localDate,
    sent: rolled.sent.includes(initiative.angle) ? rolled.sent : [...rolled.sent, initiative.angle],
    lastLine: initiative.line,
  };
}

/**
 * A line that shames the user into answering: a day count, a « you ignore me »,
 * a fear of missing out. The planner refuses to emit one, whatever wrote it.
 */
const SHAME =
  /(ca fait \d+ jours|sans te (voir|croiser)|tu me manques|tu m ignores|tes amis a ta place|you ignore me|it s been \d+ days)/;

export function isShameLine(text: string): boolean {
  return SHAME.test(
    (text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' '),
  );
}
