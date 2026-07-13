import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';
import {
  ETALAB_HOLIDAY_ZONES,
  type EtalabHolidayZone,
  type HolidayFreshness,
  type HolidayLookupResult,
  type HolidayProvenance,
  type HolidayResultSource,
  type HolidayYearResult,
  type PublicHoliday,
  type PublicHolidayProvider,
} from './types.js';

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_BASE_URL = 'https://calendrier.api.gouv.fr/jours-feries/';
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 8_000;

/** Defensive bounds for the year-specific Etalab endpoint. */
export const MIN_HOLIDAY_YEAR = 1900;
export const MAX_HOLIDAY_YEAR = 2200;

interface HolidayCacheEntry {
  zone: EtalabHolidayZone;
  year: number;
  endpoint: string;
  fetchedAt: string;
  holidays: PublicHoliday[];
}

interface HolidayCacheEnvelope {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  entries: Record<string, HolidayCacheEntry>;
}

export interface EtalabHolidayProviderOptions {
  zone?: EtalabHolidayZone;
  baseUrl?: string;
  cachePath?: string;
  cacheTtlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isEtalabHolidayZone(value: unknown): value is EtalabHolidayZone {
  return typeof value === 'string' &&
    (ETALAB_HOLIDAY_ZONES as readonly string[]).includes(value);
}

export function assertEtalabHolidayZone(value: unknown): asserts value is EtalabHolidayZone {
  if (!isEtalabHolidayZone(value)) {
    throw new RangeError(
      `Invalid Etalab holiday zone '${String(value)}'. Expected one of: ${ETALAB_HOLIDAY_ZONES.join(', ')}`,
    );
  }
}

export function assertHolidayYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_HOLIDAY_YEAR || year > MAX_HOLIDAY_YEAR) {
    throw new RangeError(
      `Holiday year must be an integer between ${MIN_HOLIDAY_YEAR} and ${MAX_HOLIDAY_YEAR}`,
    );
  }
}

function parseIsoDate(value: string, expectedYear?: number): { year: number; month: number; day: number } {
  const match = ISO_DATE_RE.exec(value);
  if (!match) throw new RangeError(`Invalid ISO calendar date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  assertHolidayYear(year);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid ISO calendar date: ${value}`);
  }
  if (expectedYear !== undefined && year !== expectedYear) {
    throw new Error(`Holiday date ${value} does not belong to requested year ${expectedYear}`);
  }
  return { year, month, day };
}

function validateDuration(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RangeError('Etalab holiday baseUrl must use HTTP or HTTPS');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function defaultCachePath(): string {
  return path.join(os.homedir(), '.codebuddy', 'life-rhythm', 'holidays.json');
}

function emptyCache(): HolidayCacheEnvelope {
  return { schemaVersion: CACHE_SCHEMA_VERSION, entries: {} };
}

function cacheKey(zone: EtalabHolidayZone, year: number): string {
  return `${zone}:${year}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseApiPayload(
  value: unknown,
  zone: EtalabHolidayZone,
  year: number,
): PublicHoliday[] {
  if (!isRecord(value)) throw new Error('Etalab holiday response must be a JSON object');
  const holidays: PublicHoliday[] = [];
  for (const [date, name] of Object.entries(value)) {
    parseIsoDate(date, year);
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`Etalab holiday '${date}' has an invalid name`);
    }
    holidays.push({ date, name: name.trim(), zone });
  }
  if (holidays.length === 0) {
    throw new Error(`Etalab holiday response for ${zone}/${year} is unexpectedly empty`);
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

function parseCachedEntry(value: unknown): HolidayCacheEntry | null {
  if (!isRecord(value)) return null;
  const zone = value.zone;
  const year = value.year;
  const endpoint = value.endpoint;
  const fetchedAt = value.fetchedAt;
  if (
    !isEtalabHolidayZone(zone) ||
    typeof year !== 'number' ||
    typeof endpoint !== 'string' ||
    typeof fetchedAt !== 'string' ||
    Number.isNaN(new Date(fetchedAt).getTime()) ||
    !Array.isArray(value.holidays)
  ) {
    return null;
  }
  try {
    assertHolidayYear(year);
    const payload: Record<string, unknown> = {};
    for (const holiday of value.holidays) {
      if (!isRecord(holiday) || holiday.zone !== zone) return null;
      payload[String(holiday.date)] = holiday.name;
    }
    return {
      zone,
      year,
      endpoint,
      fetchedAt,
      holidays: parseApiPayload(payload, zone, year),
    };
  } catch {
    return null;
  }
}

/**
 * Persistent, fail-soft provider for Etalab's official French public-holiday
 * endpoint. Valid cache remains usable when the network is unavailable; stale
 * cache is explicitly labelled rather than silently presented as fresh.
 */
export class EtalabHolidayProvider implements PublicHolidayProvider {
  readonly zone: EtalabHolidayZone;
  private readonly baseUrl: string;
  private readonly cachePath: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly now: () => Date;

  constructor(options: EtalabHolidayProviderOptions = {}) {
    const zone: unknown = options.zone ?? 'metropole';
    assertEtalabHolidayZone(zone);
    this.zone = zone;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.cachePath = path.resolve(options.cachePath ?? defaultCachePath());
    this.cacheTtlMs = validateDuration(
      options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      'cacheTtlMs',
    );
    this.timeoutMs = validateDuration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async lookup(date: string): Promise<HolidayLookupResult> {
    const { year } = parseIsoDate(date);
    const result = await this.getHolidays(year);
    return {
      date,
      available: result.available,
      holiday: result.holidays.find((holiday) => holiday.date === date) ?? null,
      provenance: result.provenance,
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async getHolidays(year: number): Promise<HolidayYearResult> {
    assertHolidayYear(year);
    const checkedAt = this.currentTime();
    const endpoint = new URL(`${this.zone}/${year}.json`, this.baseUrl).toString();
    const cache = await this.readCache();
    const cached = cache.entries[cacheKey(this.zone, year)];
    if (cached && this.cacheAge(cached, checkedAt) <= this.cacheTtlMs) {
      return this.resultFromEntry(cached, 'cache', 'fresh', checkedAt);
    }

    try {
      if (!this.fetchImpl) throw new Error('fetch is unavailable in this runtime');
      const response = await this.fetchWithTimeout(endpoint);
      if (!response.ok) {
        throw new Error(`Etalab holiday API returned HTTP ${response.status}`);
      }
      const holidays = parseApiPayload(await response.json(), this.zone, year);
      const entry: HolidayCacheEntry = {
        zone: this.zone,
        year,
        endpoint,
        fetchedAt: checkedAt.toISOString(),
        holidays,
      };
      cache.entries[cacheKey(this.zone, year)] = entry;
      await this.writeCache(cache);
      return this.resultFromEntry(entry, 'network', 'fresh', checkedAt);
    } catch (error) {
      const message = errorMessage(error);
      logger.warn('[life-rhythm] Etalab holiday fetch failed softly', {
        zone: this.zone,
        year,
        error: message,
      });
      if (cached) {
        return this.resultFromEntry(cached, 'cache', 'stale', checkedAt, message);
      }
      return {
        available: false,
        holidays: [],
        provenance: this.provenance({
          source: 'unavailable',
          freshness: 'unavailable',
          checkedAt,
          year,
          endpoint,
        }),
        error: message,
      };
    }
  }

  private currentTime(): Date {
    const value = this.now();
    if (Number.isNaN(value.getTime())) throw new RangeError('now() returned an invalid Date');
    return new Date(value.getTime());
  }

  private async fetchWithTimeout(endpoint: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl!(endpoint, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private cacheAge(entry: HolidayCacheEntry, checkedAt: Date): number {
    return Math.max(0, checkedAt.getTime() - new Date(entry.fetchedAt).getTime());
  }

  private resultFromEntry(
    entry: HolidayCacheEntry,
    source: HolidayResultSource,
    freshness: HolidayFreshness,
    checkedAt: Date,
    error?: string,
  ): HolidayYearResult {
    return {
      available: true,
      holidays: entry.holidays.map((holiday) => ({ ...holiday })),
      provenance: this.provenance({
        source,
        freshness,
        checkedAt,
        year: entry.year,
        endpoint: entry.endpoint,
        fetchedAt: entry.fetchedAt,
        ageMs: this.cacheAge(entry, checkedAt),
      }),
      ...(error ? { error } : {}),
    };
  }

  private provenance(input: {
    source: HolidayResultSource;
    freshness: HolidayFreshness;
    checkedAt: Date;
    year: number;
    endpoint: string;
    fetchedAt?: string;
    ageMs?: number;
  }): HolidayProvenance {
    return {
      provider: 'etalab-calendrier-api-gouv-fr',
      source: input.source,
      freshness: input.freshness,
      checkedAt: input.checkedAt.toISOString(),
      year: input.year,
      zone: this.zone,
      endpoint: input.endpoint,
      cacheTtlMs: this.cacheTtlMs,
      ...(input.fetchedAt ? { fetchedAt: input.fetchedAt } : {}),
      ...(input.ageMs !== undefined ? { ageMs: input.ageMs } : {}),
    };
  }

  private async readCache(): Promise<HolidayCacheEnvelope> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.cachePath, 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('[life-rhythm] holiday cache unreadable; starting empty', {
          cachePath: this.cachePath,
          error: errorMessage(error),
        });
      }
      return emptyCache();
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== CACHE_SCHEMA_VERSION || !isRecord(parsed.entries)) {
      logger.warn('[life-rhythm] holiday cache schema invalid; starting empty', {
        cachePath: this.cachePath,
      });
      return emptyCache();
    }
    const entries: Record<string, HolidayCacheEntry> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      const entry = parseCachedEntry(value);
      if (entry && key === cacheKey(entry.zone, entry.year)) entries[key] = entry;
    }
    return { schemaVersion: CACHE_SCHEMA_VERSION, entries };
  }

  private async writeCache(cache: HolidayCacheEnvelope): Promise<void> {
    const directory = path.dirname(this.cachePath);
    const temporary = `${this.cachePath}.tmp.${process.pid}.${randomUUID()}`;
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporary, this.cachePath);
      if (process.platform !== 'win32') await fs.chmod(this.cachePath, 0o600);
    } catch (error) {
      logger.warn('[life-rhythm] holiday cache write failed softly', {
        cachePath: this.cachePath,
        error: errorMessage(error),
      });
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
