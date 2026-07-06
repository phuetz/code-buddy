/**
 * session-prune — Hermes-parity filter semantics: age + folded title match,
 * pinned/archived never matched, zero-days matches all ages, age span.
 */
import { describe, expect, it } from 'vitest';
import { previewPrune, type PrunableSession } from './session-prune.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function s(id: string, daysAgo: number, extra: Partial<PrunableSession> = {}): PrunableSession {
  return { id, title: `session ${id}`, updatedAt: NOW - daysAgo * DAY, ...extra };
}

describe('previewPrune', () => {
  it('matches by age, never pinned/archived, and reports the age span', () => {
    const preview = previewPrune(
      [
        s('recent', 1),
        s('old', 10),
        s('older', 30),
        s('pinned-old', 40, { pinned: true }),
        s('archived-old', 50, { archived: true }),
      ],
      { olderThanDays: 7 },
      NOW,
    );
    expect(preview.matches.map((m) => m.id)).toEqual(['old', 'older']);
    expect(preview.ageSpan).toEqual({ oldest: NOW - 30 * DAY, newest: NOW - 10 * DAY });
  });

  it('zero/undefined days matches all ages (Hermes: any filter matches all ages)', () => {
    const preview = previewPrune([s('a', 0), s('b', 100)], { olderThanDays: 0, titleMatch: 'session' }, NOW);
    expect(preview.matches).toHaveLength(2);
  });

  it('title match folds case and diacritics', () => {
    const preview = previewPrune(
      [s('v1', 10, { title: 'Crée une VIDÉO sharpei' }), s('v2', 10, { title: 'autre chose' })],
      { olderThanDays: 0, titleMatch: 'video' },
      NOW,
    );
    expect(preview.matches.map((m) => m.id)).toEqual(['v1']);
  });

  it('empty result → null age span', () => {
    expect(previewPrune([s('a', 1)], { olderThanDays: 30 }, NOW)).toEqual({ matches: [], ageSpan: null });
  });
});
