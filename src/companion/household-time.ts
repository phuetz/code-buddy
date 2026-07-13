import { resolveZonedDateTime } from '../life-rhythm/day-context.js';

export interface HouseholdClock {
  timeZone: string;
  localDate: string;
  localTime: string;
  hour: number;
  minute: number;
}

/** Resolve companion wall-clock gates in the household timezone, never host TZ. */
export function resolveHouseholdClock(
  instant: Date,
  timeZone = process.env.CODEBUDDY_TIMEZONE
    || Intl.DateTimeFormat().resolvedOptions().timeZone
): HouseholdClock {
  const zoned = resolveZonedDateTime(instant, timeZone);
  const [hour, minute] = zoned.localTime.split(':').map(Number);
  return {
    timeZone: zoned.timeZone,
    localDate: zoned.localDate,
    localTime: zoned.localTime,
    hour: hour!,
    minute: minute!,
  };
}
