import { canonicalizeTimeZone, resolveZonedDateTime } from './day-context.js';

export type ZonedMinuteAdjustment = 'exact' | 'gap-forward';

export interface ZonedMinuteOccurrence {
  /** The next absolute instant, strictly after the supplied `after` instant. */
  instant: Date;
  timeZone: string;
  requestedLocalDate: string;
  requestedLocalTime: string;
  resolvedLocalDate: string;
  resolvedLocalTime: string;
  utcOffsetMinutes: number;
  /** `gap-forward` means the requested wall minute did not exist after a DST jump. */
  adjustment: ZonedMinuteAdjustment;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validateClockMinute(hour: number, minute: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('hour must be an integer between 0 and 23');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError('minute must be an integer between 0 and 59');
  }
}

function parseCivilDate(value: string): CivilDate {
  const match = ISO_DATE_RE.exec(value);
  if (!match) throw new Error(`Invalid civil date: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatCivilDate(value: CivilDate): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function addCivilDays(value: CivilDate, days: number): CivilDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Collect every UTC offset active around a civil date, including both sides of a fold. */
function offsetsAroundDate(value: CivilDate, timeZone: string): number[] {
  const center = Date.UTC(value.year, value.month - 1, value.day, 12, 0, 0, 0);
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 6) {
    offsets.add(
      resolveZonedDateTime(new Date(center + deltaHours * 60 * 60 * 1_000), timeZone)
        .utcOffsetMinutes,
    );
  }
  return [...offsets];
}

/** Return every absolute occurrence of one civil minute (two during a DST fold). */
function exactOccurrences(
  date: CivilDate,
  hour: number,
  minute: number,
  timeZone: string,
  offsets: number[],
): Date[] {
  const localFieldsAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  const expectedDate = formatCivilDate(date);
  const expectedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const instants = new Set<number>();
  for (const offset of offsets) {
    const candidate = new Date(localFieldsAsUtc - offset * 60_000);
    const resolved = resolveZonedDateTime(candidate, timeZone);
    if (resolved.localDate === expectedDate && resolved.localTime.slice(0, 5) === expectedTime) {
      instants.add(candidate.getTime());
    }
  }
  return [...instants].sort((a, b) => a - b).map((instant) => new Date(instant));
}

function occurrenceResult(
  instant: Date,
  timeZone: string,
  requestedDate: CivilDate,
  requestedHour: number,
  requestedMinute: number,
  adjustment: ZonedMinuteAdjustment,
): ZonedMinuteOccurrence {
  const resolved = resolveZonedDateTime(instant, timeZone);
  return {
    instant: new Date(instant.getTime()),
    timeZone,
    requestedLocalDate: formatCivilDate(requestedDate),
    requestedLocalTime: `${String(requestedHour).padStart(2, '0')}:${String(requestedMinute).padStart(2, '0')}`,
    resolvedLocalDate: resolved.localDate,
    resolvedLocalTime: resolved.localTime.slice(0, 5),
    utcOffsetMinutes: resolved.utcOffsetMinutes,
    adjustment,
  };
}

/**
 * Find the next daily civil minute in an IANA timezone, strictly after `after`.
 *
 * DST policy:
 * - missing minute (spring gap): run at the first valid minute after the gap;
 * - repeated minute (autumn fold): use only the first occurrence, preventing a
 *   daily job from firing twice on the same civil date.
 *
 * The search is bounded to eight civil dates and creates no timer or daemon.
 */
export function findNextZonedMinute(
  after: Date,
  timeZone: string,
  hour: number,
  minute: number,
): ZonedMinuteOccurrence {
  if (Number.isNaN(after.getTime())) throw new RangeError('after must be a valid Date');
  validateClockMinute(hour, minute);
  const canonicalTimeZone = canonicalizeTimeZone(timeZone);
  const startingDate = parseCivilDate(
    resolveZonedDateTime(after, canonicalTimeZone).localDate,
  );
  const requestedMinuteOfDay = hour * 60 + minute;

  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidateDate = addCivilDays(startingDate, dayOffset);
    const offsets = offsetsAroundDate(candidateDate, canonicalTimeZone);
    const exact = exactOccurrences(candidateDate, hour, minute, canonicalTimeZone, offsets);
    if (exact.length > 0) {
      // Intentionally select only the first fold occurrence. If it has passed,
      // the next eligible occurrence is tomorrow, never the repeated wall time.
      const first = exact[0]!;
      if (first.getTime() > after.getTime()) {
        return occurrenceResult(
          first,
          canonicalTimeZone,
          candidateDate,
          hour,
          minute,
          'exact',
        );
      }
      continue;
    }

    // The requested minute can be absent during a forward transition. Resolve
    // to the first representable later wall minute on that same civil date.
    for (let minuteOfDay = requestedMinuteOfDay + 1; minuteOfDay < 24 * 60; minuteOfDay++) {
      const adjustedHour = Math.floor(minuteOfDay / 60);
      const adjustedMinute = minuteOfDay % 60;
      const adjusted = exactOccurrences(
        candidateDate,
        adjustedHour,
        adjustedMinute,
        canonicalTimeZone,
        offsets,
      )[0];
      if (adjusted && adjusted.getTime() > after.getTime()) {
        return occurrenceResult(
          adjusted,
          canonicalTimeZone,
          candidateDate,
          hour,
          minute,
          'gap-forward',
        );
      }
    }
  }

  throw new Error(`Unable to resolve ${hour}:${minute} in ${canonicalTimeZone} within eight days`);
}
