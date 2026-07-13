import { describe, expect, it } from 'vitest';
import { findNextZonedMinute } from '../../src/life-rhythm/index.js';

describe('findNextZonedMinute', () => {
  it('moves a missing spring-forward minute to the first valid wall minute', () => {
    const next = findNextZonedMinute(
      new Date('2026-03-28T23:00:00.000Z'),
      'Europe/Paris',
      2,
      30,
    );

    expect(next.instant.toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(next.requestedLocalDate).toBe('2026-03-29');
    expect(next.requestedLocalTime).toBe('02:30');
    expect(next.resolvedLocalTime).toBe('03:00');
    expect(next.utcOffsetMinutes).toBe(120);
    expect(next.adjustment).toBe('gap-forward');
  });

  it('selects the first repeated autumn minute', () => {
    const next = findNextZonedMinute(
      new Date('2026-10-24T23:00:00.000Z'),
      'Europe/Paris',
      2,
      30,
    );

    expect(next.instant.toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(next.resolvedLocalTime).toBe('02:30');
    expect(next.utcOffsetMinutes).toBe(120);
    expect(next.adjustment).toBe('exact');
  });

  it('never schedules the second fold occurrence after the first has passed', () => {
    const next = findNextZonedMinute(
      // 02:15 in the second CET occurrence; 02:30 CEST already ran.
      new Date('2026-10-25T01:15:00.000Z'),
      'Europe/Paris',
      2,
      30,
    );

    expect(next.instant.toISOString()).toBe('2026-10-26T01:30:00.000Z');
    expect(next.requestedLocalDate).toBe('2026-10-26');
    expect(next.resolvedLocalTime).toBe('02:30');
    expect(next.utcOffsetMinutes).toBe(60);
  });

  it('returns the next normal civil minute strictly after the input', () => {
    const next = findNextZonedMinute(
      new Date('2026-07-12T20:00:00.000Z'),
      'Europe/Paris',
      8,
      15,
    );
    expect(next.instant.toISOString()).toBe('2026-07-13T06:15:00.000Z');
    expect(next.resolvedLocalDate).toBe('2026-07-13');
    expect(next.resolvedLocalTime).toBe('08:15');
  });
});
