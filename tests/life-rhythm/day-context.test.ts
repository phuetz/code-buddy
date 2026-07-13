import { describe, expect, it } from 'vitest';
import {
  buildDayContext,
  canonicalizeTimeZone,
  resolveZonedDateTime,
  type HolidayLookupResult,
  type PublicHolidayProvider,
} from '../../src/life-rhythm/index.js';

function holidayProvider(name: string): PublicHolidayProvider {
  return {
    async lookup(date: string): Promise<HolidayLookupResult> {
      const year = Number(date.slice(0, 4));
      return {
        date,
        available: true,
        holiday: { date, name, zone: 'metropole' },
        provenance: {
          provider: 'etalab-calendrier-api-gouv-fr',
          source: 'network',
          freshness: 'fresh',
          checkedAt: '2026-07-13T20:00:00.000Z',
          fetchedAt: '2026-07-13T20:00:00.000Z',
          ageMs: 0,
          cacheTtlMs: 60_000,
          endpoint: `https://calendrier.api.gouv.fr/jours-feries/metropole/${year}.json`,
          zone: 'metropole',
          year,
        },
      };
    },
  };
}

function noHolidayProvider(): PublicHolidayProvider {
  return {
    async lookup(date: string): Promise<HolidayLookupResult> {
      return {
        date,
        available: true,
        holiday: null,
        provenance: {
          provider: 'etalab-calendrier-api-gouv-fr',
          source: 'cache',
          freshness: 'fresh',
          checkedAt: '2026-07-13T10:00:00.000Z',
          fetchedAt: '2026-07-13T09:00:00.000Z',
          ageMs: 3_600_000,
          cacheTtlMs: 86_400_000,
          endpoint: 'https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json',
          zone: 'metropole',
          year: 2026,
        },
      };
    },
  };
}

describe('life-rhythm DayContext', () => {
  it('uses the correct Europe/Paris offset on both sides of the DST jump', () => {
    const before = resolveZonedDateTime(
      new Date('2026-03-29T00:30:00.000Z'),
      'Europe/Paris',
    );
    const after = resolveZonedDateTime(
      new Date('2026-03-29T01:30:00.000Z'),
      'Europe/Paris',
    );

    expect(before.localDate).toBe('2026-03-29');
    expect(before.localTime).toBe('01:30:00');
    expect(before.utcOffsetMinutes).toBe(60);
    expect(after.localDate).toBe('2026-03-29');
    expect(after.localTime).toBe('03:30:00');
    expect(after.utcOffsetMinutes).toBe(120);
  });

  it('classifies a local Sunday as weekend', async () => {
    const context = await buildDayContext({
      instant: new Date('2026-07-12T10:00:00.000Z'),
      timeZone: 'Europe/Paris',
    });

    expect(context.localDate).toBe('2026-07-12');
    expect(context.weekday).toBe(0);
    expect(context.isoWeekday).toBe(7);
    expect(context.dayKind).toBe('weekend');
    expect(context.publicHoliday).toBeNull();
  });

  it('gives a public holiday priority over weekday/weekend classification', async () => {
    const context = await buildDayContext({
      instant: new Date('2026-07-14T10:00:00.000Z'),
      timeZone: 'Europe/Paris',
      holidayProvider: holidayProvider('14 juillet'),
    });

    expect(context.weekday).toBe(2);
    expect(context.dayKind).toBe('public_holiday');
    expect(context.publicHoliday?.name).toBe('14 juillet');
    expect(context.holidayProvenance.provider).toBe('etalab-calendrier-api-gouv-fr');
  });

  it('keeps explicit home mode and sensed presence independent', async () => {
    const context = await buildDayContext({
      instant: new Date('2026-07-13T10:00:00.000Z'),
      timeZone: 'Europe/Paris',
      holidayProvider: noHolidayProvider(),
      homeMode: {
        mode: 'away',
        setAt: '2026-07-13T08:00:00.000Z',
        source: 'stored',
      },
      presence: {
        status: 'home',
        source: 'home-assistant',
        observedAt: '2026-07-13T09:59:30.000Z',
        confidence: 0.95,
      },
    });

    expect(context.dayKind).toBe('workday');
    expect(context.homeMode.mode).toBe('away');
    expect(context.presence.status).toBe('home');
    expect(context.presence.source).toBe('home-assistant');
  });

  it('does not claim workday when a weekday holiday lookup is unavailable', async () => {
    const provider: PublicHolidayProvider = {
      async lookup(date: string): Promise<HolidayLookupResult> {
        return {
          date,
          available: false,
          holiday: null,
          provenance: {
            provider: 'etalab-calendrier-api-gouv-fr',
            source: 'unavailable',
            freshness: 'unavailable',
            checkedAt: '2026-07-13T10:00:00.000Z',
            year: 2026,
            zone: 'metropole',
          },
          error: 'offline and no cache',
        };
      },
    };
    const context = await buildDayContext({
      instant: new Date('2026-07-13T10:00:00.000Z'),
      timeZone: 'Europe/Paris',
      holidayProvider: provider,
    });

    expect(context.weekday).toBe(1);
    expect(context.dayKind).toBe('unknown');
    expect(context.holidayProvenance.source).toBe('unavailable');
  });

  it('rejects an invalid IANA timezone', () => {
    expect(() => canonicalizeTimeZone('Mars/Olympus_Mons')).toThrow(/Invalid IANA/);
  });
});
