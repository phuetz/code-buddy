import { logger } from '../utils/logger.js';
import type {
  DayContext,
  DayKind,
  HolidayLookupResult,
  HomeModeState,
  PresenceSnapshot,
  PublicHolidayProvider,
} from './types.js';

export interface HomeModeReader {
  getCurrent(): Promise<HomeModeState>;
}

export interface BuildDayContextOptions {
  timeZone: string;
  instant?: Date;
  holidayProvider?: PublicHolidayProvider;
  homeMode?: HomeModeState;
  homeModeStore?: HomeModeReader;
  presence?: PresenceSnapshot;
}

export interface ZonedDateTimeParts {
  timeZone: string;
  localDate: string;
  localTime: string;
  weekday: number;
  isoWeekday: number;
  utcOffsetMinutes: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function requirePart(parts: Record<string, string>, name: string): number {
  const raw = parts[name];
  if (raw === undefined) {
    throw new Error(`Intl.DateTimeFormat did not return '${name}'`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`Intl.DateTimeFormat returned an invalid '${name}': ${raw}`);
  }
  return value;
}

/** Validate and canonicalize an IANA timezone with the runtime's ICU data. */
export function canonicalizeTimeZone(timeZone: string): string {
  const candidate = timeZone.trim();
  if (!candidate) throw new RangeError('timeZone must not be empty');
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch {
    throw new RangeError(`Invalid IANA timeZone: ${timeZone}`);
  }
}

/**
 * Resolve an instant into local civil time using Intl/ICU. No fixed offset is
 * retained, so calls on either side of a daylight-saving transition use the
 * correct offset for that exact instant.
 */
export function resolveZonedDateTime(
  instant: Date,
  timeZone: string,
): ZonedDateTimeParts {
  if (Number.isNaN(instant.getTime())) throw new RangeError('instant must be a valid Date');
  const canonicalTimeZone = canonicalizeTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
    timeZone: canonicalTimeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const year = requirePart(values, 'year');
  const month = requirePart(values, 'month');
  const day = requirePart(values, 'day');
  const hour = requirePart(values, 'hour');
  const minute = requirePart(values, 'minute');
  const second = requirePart(values, 'second');
  const localDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const localTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;

  // The weekday depends only on the local civil date. UTC is used here solely
  // as a Gregorian calendar calculator, not as the household timezone.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const isoWeekday = weekday === 0 ? 7 : weekday;
  const wholeSecondInstant = Math.trunc(instant.getTime() / 1_000) * 1_000;
  const localFieldsAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const utcOffsetMinutes = (localFieldsAsUtc - wholeSecondInstant) / 60_000;

  return {
    timeZone: canonicalTimeZone,
    localDate,
    localTime,
    weekday,
    isoWeekday,
    utcOffsetMinutes,
  };
}

function unavailableHoliday(date: string, checkedAt: Date, message?: string): HolidayLookupResult {
  const match = ISO_DATE_RE.exec(date);
  const year = match?.[1] === undefined ? 0 : Number(match[1]);
  return {
    date,
    available: false,
    holiday: null,
    provenance: {
      provider: 'none',
      source: 'unavailable',
      freshness: 'unavailable',
      checkedAt: checkedAt.toISOString(),
      year,
    },
    ...(message ? { error: message } : {}),
  };
}

function defaultHomeMode(instant: Date): HomeModeState {
  return {
    mode: 'normal',
    setAt: instant.toISOString(),
    source: 'default',
  };
}

function normalizeHomeMode(state: HomeModeState, instant: Date): HomeModeState {
  if (!state.expiresAt) return state;
  const expiresAt = new Date(state.expiresAt);
  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= instant.getTime()) {
    return {
      mode: 'normal',
      setAt: instant.toISOString(),
      source: 'expired',
      previousMode: state.mode,
    };
  }
  return state;
}

function normalizePresence(presence?: PresenceSnapshot): PresenceSnapshot {
  if (!presence) return { status: 'unknown', source: 'none' };
  if (
    presence.confidence !== undefined &&
    (!Number.isFinite(presence.confidence) || presence.confidence < 0 || presence.confidence > 1)
  ) {
    throw new RangeError('presence.confidence must be between 0 and 1');
  }
  if (presence.observedAt && Number.isNaN(new Date(presence.observedAt).getTime())) {
    throw new RangeError('presence.observedAt must be an ISO-compatible timestamp');
  }
  return { ...presence };
}

async function resolveHomeMode(
  options: BuildDayContextOptions,
  instant: Date,
): Promise<HomeModeState> {
  if (options.homeMode) return normalizeHomeMode(options.homeMode, instant);
  if (!options.homeModeStore) return defaultHomeMode(instant);
  try {
    return normalizeHomeMode(await options.homeModeStore.getCurrent(), instant);
  } catch (error) {
    logger.warn('[life-rhythm] home mode unavailable; using normal', {
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultHomeMode(instant);
  }
}

async function resolveHoliday(
  provider: PublicHolidayProvider | undefined,
  localDate: string,
  checkedAt: Date,
): Promise<HolidayLookupResult> {
  if (!provider) return unavailableHoliday(localDate, checkedAt);
  try {
    const result = await provider.lookup(localDate);
    if (result.date !== localDate || (result.holiday && result.holiday.date !== localDate)) {
      throw new Error(`Holiday provider returned a mismatched date for ${localDate}`);
    }
    if (!result.available && result.holiday) {
      throw new Error(`Holiday provider returned data while marking ${localDate} unavailable`);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[life-rhythm] holiday lookup failed softly', { localDate, error: message });
    return unavailableHoliday(localDate, checkedAt, message);
  }
}

function resolveDayKind(
  weekday: number,
  isPublicHoliday: boolean,
  holidayCalendarAvailable: boolean,
): DayKind {
  if (isPublicHoliday) return 'public_holiday';
  if (weekday === 0 || weekday === 6) return 'weekend';
  if (!holidayCalendarAvailable) return 'unknown';
  return 'workday';
}

/** Build the immutable daily context for one exact instant. */
export async function buildDayContext(options: BuildDayContextOptions): Promise<DayContext> {
  const instant = options.instant ? new Date(options.instant.getTime()) : new Date();
  if (Number.isNaN(instant.getTime())) throw new RangeError('instant must be a valid Date');
  const zoned = resolveZonedDateTime(instant, options.timeZone);
  const [holiday, homeMode] = await Promise.all([
    resolveHoliday(options.holidayProvider, zoned.localDate, instant),
    resolveHomeMode(options, instant),
  ]);
  const publicHoliday = holiday.holiday;

  return {
    schemaVersion: 1,
    instant: instant.toISOString(),
    timeZone: zoned.timeZone,
    localDate: zoned.localDate,
    localTime: zoned.localTime,
    weekday: zoned.weekday,
    isoWeekday: zoned.isoWeekday,
    utcOffsetMinutes: zoned.utcOffsetMinutes,
    dayKind: resolveDayKind(zoned.weekday, publicHoliday !== null, holiday.available),
    publicHoliday,
    holidayProvenance: holiday.provenance,
    homeMode,
    presence: normalizePresence(options.presence),
  };
}
