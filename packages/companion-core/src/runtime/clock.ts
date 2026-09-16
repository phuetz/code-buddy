/**
 * Injectable time. The core never calls `Date.now()` on its own: a host passes a
 * `Clock`, and every wall-clock gate goes through `resolveCivilClock` so the
 * cadence follows the USER's timezone, not the process one.
 *
 * @module runtime/clock
 */

/** Epoch milliseconds. Injected so every test is deterministic. */
export type Clock = () => number;

/** A frozen clock — the test seam. */
export function fixedClock(epochMs: number): Clock {
  return () => epochMs;
}

/** Civil (wall-clock) view of an instant in a given timezone. */
export interface CivilClock {
  /** The instant, epoch ms. */
  now: number;
  /** IANA timezone actually used. */
  timeZone: string;
  /** YYYY-MM-DD in that timezone. */
  localDate: string;
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
  /** hour * 60 + minute. */
  minutesOfDay: number;
}

function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve an instant into its civil parts. Falls back to UTC when the timezone
 * is unknown or the platform has no ICU data — never throws.
 */
export function resolveCivilClock(epochMs: number, timeZone?: string): CivilClock {
  const wanted = timeZone && timeZone.trim() ? timeZone.trim() : hostTimeZone();
  const build = (zone: string): CivilClock => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epochMs));
    const at = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const hour = Number(at('hour'));
    const minute = Number(at('minute'));
    return {
      now: epochMs,
      timeZone: zone,
      localDate: `${at('year')}-${at('month')}-${at('day')}`,
      hour,
      minute,
      minutesOfDay: hour * 60 + minute,
    };
  };
  try {
    return build(wanted);
  } catch {
    return build('UTC');
  }
}
