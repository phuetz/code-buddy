/**
 * TypeScript heartbeat fallback — a wall-clock pacemaker that emits the same
 * `vital/heartbeat` percept the Rust `buddy-sense` daemon emits, so system
 * vitals / schedule ticks / dreaming keep running when the daemon is absent.
 *
 * Opt-in (`CODEBUDDY_HEARTBEAT_FALLBACK=true`). Default OFF = no timer, no
 * listener, byte-identical. When a REAL beat arrives on the bus (any source
 * other than this module), the interval is cleared immediately; it is re-armed
 * only after `CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS` (default 15 s) without a
 * real beat. The two clocks never emit at the same time.
 *
 * The interval is `unref()`'d so it cannot keep a process alive; `stop()`
 * clears timers and the bus listener (wired into `sensoryTeardown`).
 *
 * @module sensory/heartbeat-fallback
 */

import { loadavg } from 'node:os';
import { getGlobalEventBus } from '../events/event-bus.js';
import type { BaseEvent } from '../events/types.js';
import { logger } from '../utils/logger.js';

/** Event `source` stamped on fallback beats — anything else is treated as real. */
export const FALLBACK_HEARTBEAT_SOURCE = 'heartbeat-fallback';

export type HeartbeatSource = 'rust' | 'fallback' | 'none';

export interface HeartbeatFallbackHandle {
  stop(): void;
  getSource(): HeartbeatSource;
  lastBeatAt(): number | null;
  lastRealBeatAt(): number | null;
}

export interface HeartbeatFallbackDeps {
  /** Force enable (tests). Default: `CODEBUDDY_HEARTBEAT_FALLBACK === 'true'`. */
  enabled?: boolean;
  periodMs?: number;
  silenceMs?: number;
  now?: () => number;
  emit?: (event: Omit<BaseEvent, 'type' | 'timestamp'>) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Load average carried in the payload (mirrors vital.rs). */
  load1?: () => number | null;
}

const DEFAULT_PERIOD_MS = 1000;
const DEFAULT_SILENCE_MS = 15_000;

export function isHeartbeatFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_HEARTBEAT_FALLBACK === 'true';
}

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function unrefTimer(timer: { unref?: () => void } | number | undefined): void {
  if (timer && typeof timer === 'object' && typeof timer.unref === 'function') {
    timer.unref();
  }
}

function isVitalHeartbeat(evt: BaseEvent): boolean {
  const m = evt.metadata as { modality?: string; kind?: string } | undefined;
  return m?.modality === 'vital' && m?.kind === 'heartbeat';
}

function defaultLoad1(): number | null {
  try {
    const [one] = loadavg();
    return typeof one === 'number' && Number.isFinite(one) ? one : null;
  } catch {
    return null;
  }
}

/**
 * Start the fallback pacemaker. No-op (and no bus listener) when the opt-in
 * flag is off — the call is safe to make unconditionally from the server.
 */
export function startHeartbeatFallback(deps: HeartbeatFallbackDeps = {}): HeartbeatFallbackHandle {
  const enabled = deps.enabled ?? isHeartbeatFallbackEnabled();
  if (!enabled) {
    return {
      stop() {},
      getSource: () => 'none',
      lastBeatAt: () => null,
      lastRealBeatAt: () => null,
    };
  }

  const periodMs = deps.periodMs ?? envMs('CODEBUDDY_HEARTBEAT_FALLBACK_MS', DEFAULT_PERIOD_MS);
  const silenceMs = deps.silenceMs ?? envMs('CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS', DEFAULT_SILENCE_MS);
  const now = deps.now ?? Date.now;
  const bus = getGlobalEventBus();
  const emit =
    deps.emit ??
    ((event: Omit<BaseEvent, 'type' | 'timestamp'>) => {
      bus.emit('sensory:perception', event);
    });
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const load1 = deps.load1 ?? defaultLoad1;

  const startedAt = now();
  let beat = 0;
  let source: HeartbeatSource = 'none';
  let lastBeatMs: number | null = null;
  let lastRealMs: number | null = null;
  let fallbackActive = false;
  let emitTimer: ReturnType<typeof setInterval> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const emitFallbackBeat = (): void => {
    if (stopped || !fallbackActive) return;
    beat += 1;
    lastBeatMs = now();
    source = 'fallback';
    emit({
      source: FALLBACK_HEARTBEAT_SOURCE,
      metadata: {
        modality: 'vital',
        kind: 'heartbeat',
        salience: 5,
        payload: {
          beat,
          uptime_ms: Math.max(0, lastBeatMs - startedAt),
          load1: load1(),
          interval_ms: periodMs,
        },
      },
    });
  };

  const stopEmitClock = (): void => {
    fallbackActive = false;
    if (emitTimer !== undefined) {
      clearIntervalFn(emitTimer);
      emitTimer = undefined;
    }
  };

  const clearSilence = (): void => {
    if (silenceTimer !== undefined) {
      clearTimeoutFn(silenceTimer);
      silenceTimer = undefined;
    }
  };

  const startEmitClock = (): void => {
    if (stopped || fallbackActive) return;
    clearSilence();
    fallbackActive = true;
    source = 'fallback';
    emitFallbackBeat();
    emitTimer = setIntervalFn(emitFallbackBeat, periodMs);
    unrefTimer(emitTimer);
  };

  const armSilence = (): void => {
    clearSilence();
    silenceTimer = setTimeoutFn(() => {
      silenceTimer = undefined;
      if (stopped) return;
      startEmitClock();
    }, silenceMs);
    unrefTimer(silenceTimer);
  };

  const listenerId = bus.on('sensory:perception', (evt: BaseEvent) => {
    if (stopped || !isVitalHeartbeat(evt)) return;
    if (evt.source === FALLBACK_HEARTBEAT_SOURCE) {
      lastBeatMs = now();
      return;
    }
    // Real pacemaker (buddy-sense, tests, anything that isn't us).
    lastRealMs = now();
    lastBeatMs = lastRealMs;
    source = 'rust';
    stopEmitClock();
    armSilence();
  });

  startEmitClock();
  logger.info(
    `[heartbeat-fallback] TypeScript pacemaker enabled (period ${periodMs}ms, silence ${silenceMs}ms) — ` +
      `disabled automatically when buddy-sense beats`,
  );

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      stopEmitClock();
      clearSilence();
      bus.off(listenerId);
      source = 'none';
    },
    getSource: () => (stopped ? 'none' : source),
    lastBeatAt: () => lastBeatMs,
    lastRealBeatAt: () => lastRealMs,
  };
}
