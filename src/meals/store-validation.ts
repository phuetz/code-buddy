import {
  FOOD_PROVENANCE_SOURCES,
  type FoodProvenance,
} from './types.js';

const PROVENANCE_SOURCE_SET = new Set<string>(FOOD_PROVENANCE_SOURCES);
const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_RE = /^(\d{2}):(\d{2})$/;
const OFFSET_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFoodProvenance(value: unknown): FoodProvenance | null {
  if (!isRecord(value)
    || typeof value.source !== 'string'
    || !PROVENANCE_SOURCE_SET.has(value.source)
    || typeof value.sourceId !== 'string'
    || value.sourceId.trim().length === 0
    || value.sourceId !== value.sourceId.trim()
    || typeof value.recordedAt !== 'string'
    || Number.isNaN(Date.parse(value.recordedAt))
    || (value.status !== 'confirmed' && value.status !== 'unknown')
    || (value.uri !== undefined && typeof value.uri !== 'string')
    || (value.contentHash !== undefined && typeof value.contentHash !== 'string')) {
    return null;
  }
  return {
    source: value.source as FoodProvenance['source'],
    sourceId: value.sourceId,
    recordedAt: value.recordedAt,
    status: value.status,
    ...(typeof value.uri === 'string' ? { uri: value.uri } : {}),
    ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
  };
}

export function requireFoodProvenance(value: unknown): FoodProvenance {
  const provenance = parseFoodProvenance(value);
  if (!provenance) throw new RangeError('A valid explicit food provenance is required.');
  return provenance;
}

export function cloneFoodProvenance(value: FoodProvenance): FoodProvenance {
  return { ...value };
}

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = LOCAL_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() + 1 === month
    && candidate.getUTCDate() === day;
}

export function requireLocalDate(value: unknown): string {
  if (!isValidLocalDate(value)) {
    throw new RangeError('localDate must be an existing Gregorian date in YYYY-MM-DD form.');
  }
  return value;
}

export function parseLocalTime(value: unknown): { value: string; hour: number; minute: number } | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_TIME_RE.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { value, hour, minute };
}

export function requireLocalTime(value: unknown): { value: string; hour: number; minute: number } {
  const parsed = parseLocalTime(value);
  if (!parsed) throw new RangeError('localTime must be a valid 24-hour minute in HH:mm form.');
  return parsed;
}

/** Require an unambiguous absolute timestamp; date-only strings are rejected. */
export function isOffsetTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && OFFSET_TIMESTAMP_RE.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function requireOffsetTimestamp(value: unknown, field: string): string {
  if (!isOffsetTimestamp(value)) {
    throw new RangeError(`${field} must be an ISO timestamp with Z or an explicit UTC offset.`);
  }
  return value;
}

export function requireNonEmptyText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) throw new RangeError(`${field} must not be empty.`);
  if (normalized.length > maxLength) throw new RangeError(`${field} must not exceed ${maxLength} characters.`);
  return normalized;
}
