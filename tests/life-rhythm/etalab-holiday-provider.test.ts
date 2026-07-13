import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EtalabHolidayProvider,
  type EtalabHolidayZone,
} from '../../src/life-rhythm/index.js';

let temporaryDirectory: string;
let cachePath: string;

beforeEach(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-life-rhythm-'));
  cachePath = path.join(temporaryDirectory, 'holidays.json');
});

afterEach(async () => {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

describe('EtalabHolidayProvider', () => {
  it('fetches, validates and exposes official provenance', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request): Promise<Response> => {
      urls.push(String(input));
      return new Response(JSON.stringify({
        '2026-01-01': '1er janvier',
        '2026-07-14': '14 juillet',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const provider = new EtalabHolidayProvider({
      zone: 'metropole',
      cachePath,
      fetchImpl,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await provider.getHolidays(2026);
    expect(result.available).toBe(true);
    expect(result.holidays.map((holiday) => holiday.date)).toEqual([
      '2026-01-01',
      '2026-07-14',
    ]);
    expect(result.provenance.source).toBe('network');
    expect(result.provenance.freshness).toBe('fresh');
    expect(result.provenance.zone).toBe('metropole');
    expect(urls).toEqual([
      'https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json',
    ]);
    expect((await provider.lookup('2026-07-14')).holiday?.name).toBe('14 juillet');
    expect(urls).toHaveLength(1); // second lookup is served by fresh persistent cache
  });

  it('falls back to explicitly stale persistent cache while offline', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const online = new EtalabHolidayProvider({
      cachePath,
      cacheTtlMs: 60_000,
      now: () => now,
      fetchImpl: (async (): Promise<Response> => new Response(JSON.stringify({
        '2026-05-01': '1er mai',
      }), { status: 200 })) as typeof fetch,
    });
    expect((await online.getHolidays(2026)).provenance.source).toBe('network');

    now = new Date('2026-01-01T00:02:00.000Z');
    const offline = new EtalabHolidayProvider({
      cachePath,
      cacheTtlMs: 60_000,
      now: () => now,
      fetchImpl: (async (): Promise<Response> => {
        throw new Error('network offline');
      }) as typeof fetch,
    });
    const fallback = await offline.getHolidays(2026);

    expect(fallback.available).toBe(true);
    expect(fallback.holidays[0]?.name).toBe('1er mai');
    expect(fallback.provenance.source).toBe('cache');
    expect(fallback.provenance.freshness).toBe('stale');
    expect(fallback.provenance.ageMs).toBe(120_000);
    expect(fallback.error).toContain('network offline');
  });

  it('fails softly without cache when the service is unavailable', async () => {
    const provider = new EtalabHolidayProvider({
      cachePath,
      fetchImpl: (async (): Promise<Response> => new Response('down', { status: 503 })) as typeof fetch,
    });
    const result = await provider.getHolidays(2026);
    expect(result.available).toBe(false);
    expect(result.holidays).toEqual([]);
    expect(result.provenance.source).toBe('unavailable');
    expect(result.provenance.freshness).toBe('unavailable');
    expect(result.error).toContain('503');
  });

  it('validates zone, year and response-year integrity', async () => {
    expect(() => new EtalabHolidayProvider({
      zone: '../../etc' as EtalabHolidayZone,
      cachePath,
    })).toThrow(/Invalid Etalab holiday zone/);

    const provider = new EtalabHolidayProvider({
      cachePath,
      fetchImpl: (async (): Promise<Response> => new Response(JSON.stringify({
        '2025-12-25': 'Jour de Noël',
      }), { status: 200 })) as typeof fetch,
    });
    await expect(provider.getHolidays(1899)).rejects.toThrow(/between 1900 and 2200/);
    const invalidPayload = await provider.getHolidays(2026);
    expect(invalidPayload.available).toBe(false);
    expect(invalidPayload.error).toContain('does not belong to requested year 2026');
  });
});
