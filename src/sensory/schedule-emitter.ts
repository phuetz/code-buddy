/**
 * Schedule emitter — the autonomous wall-clock trigger for the nervous system.
 *
 * Each heartbeat pass emits ONE `time/tick` percept carrying the current local time
 * (hhmm, weekday, iso, minuteOfDay). A declarative rule can then fire at a time of day
 * with `match.kind:'tick'` plus a `between` window or a `filters:{hhmm:'04:20'}` guard —
 * no busy loop, no wall-clock cron: the heartbeat is the clock, one emission per pass.
 *
 * This reuses `reminder-runner.ts`'s "read the clock, act once per tick" shape but WITHOUT
 * its own interval — the heartbeat scheduler paces it, and its per-organ `inFlight` lock
 * guarantees a pass never overlaps itself. Clock + emit are injectable so the whole thing
 * is deterministically testable. Never throws.
 *
 * @module sensory/schedule-emitter
 */
import { getGlobalEventBus } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

/** The fields a `time/tick` percept carries in its payload. */
export interface TickPayload {
  /** Local time of day, 'HH:MM'. */
  hhmm: string;
  /** Day of week, 0 = Sunday … 6 = Saturday (matches `Date.getDay()` / reminders `days`). */
  weekday: number;
  /** Full local ISO-ish timestamp of the tick. */
  iso: string;
  /** Minutes since local midnight (0–1439) — handy for numeric-threshold rules. */
  minuteOfDay: number;
}

export interface ScheduleEmitterDeps {
  /** Current wall-clock time. Default: `new Date()`. */
  now?: () => Date;
  /** Emit a tick percept. Default: direct `getGlobalEventBus().emit('sensory:perception', …)`. */
  emit?: (payload: TickPayload) => void;
}

/** Compute the tick payload from a Date (pure). */
export function tickPayloadOf(now: Date): TickPayload {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    hhmm: `${hh}:${mm}`,
    weekday: now.getDay(),
    iso: now.toString(),
    minuteOfDay: now.getHours() * 60 + now.getMinutes(),
  };
}

function defaultEmit(payload: TickPayload): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'schedule',
    metadata: {
      modality: 'time',
      kind: 'tick',
      // Low salience: a tick is a clock pulse, not an alert; rules gate on hhmm/between.
      salience: 1,
      payload,
    },
  });
}

/**
 * One schedule pass: emit a single `time/tick` percept for the current local time.
 * Returns the payload emitted (for tests/observability), or null on failure. Never throws.
 */
export function runSchedulePass(deps: ScheduleEmitterDeps = {}): TickPayload | null {
  try {
    const now = (deps.now ?? (() => new Date()))();
    const payload = tickPayloadOf(now);
    (deps.emit ?? defaultEmit)(payload);
    return payload;
  } catch (err) {
    logger.warn(
      `[schedule] tick pass failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
