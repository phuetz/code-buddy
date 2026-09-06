/**
 * C3 — humeur cohérente sur la journée : inertie, plafond de saut, reset doux.
 * 20 tours contrastés doivent tracer une pente, pas un sismographe.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_MOOD_STEP_PER_TURN,
  MOOD_BASELINE,
  evolveTraits,
  evolveTraitsWithDayInertia,
  moodBand,
  personalityOf,
  type RelationalSignal,
  type RelationshipState,
} from '../../src/companion/relationship-state.js';

function fresh(): RelationshipState {
  return { celebratedMilestones: [] };
}

const CONTRAST: RelationalSignal[] = Array.from({ length: 20 }, (_, i) =>
  i % 2 === 0 ? 'affection' : 'frustration',
);

function run(signals: RelationalSignal[], fn: (s: RelationshipState, sig: RelationalSignal) => RelationshipState) {
  let s = fresh();
  const moods: number[] = [personalityOf(s).mood];
  for (const sig of signals) {
    s = fn(s, sig);
    moods.push(personalityOf(s).mood);
  }
  const deltas = moods.slice(1).map((m, i) => m - moods[i]!);
  const peakToPeak = Math.max(...moods) - Math.min(...moods);
  const bands = new Set(moods.map((m) => moodBand(m)));
  return { moods, deltas, peakToPeak, bands, maxAbsDelta: Math.max(...deltas.map((d) => Math.abs(d))) };
}

describe('C3 mood inertia', () => {
  it('raw evolveTraits stays available (default path byte-identical)', () => {
    const raw = personalityOf(evolveTraits(fresh(), 'affection')).mood;
    expect(raw).toBeGreaterThan(MOOD_BASELINE);
  });

  it('never jumps more than MAX_MOOD_STEP_PER_TURN', () => {
    const inertial = run(CONTRAST, (s, sig) =>
      evolveTraitsWithDayInertia(s, sig, { localDate: '2026-07-02' }),
    );
    expect(inertial.maxAbsDelta).toBeLessThanOrEqual(MAX_MOOD_STEP_PER_TURN + 1e-9);
  });

  it('20 contrasted turns follow a slope, not a seismograph', () => {
    const raw = run(CONTRAST, (s, sig) => evolveTraits(s, sig));
    const inertial = run(CONTRAST, (s, sig) =>
      evolveTraitsWithDayInertia(s, sig, { localDate: '2026-07-02' }),
    );
    expect(inertial.peakToPeak).toBeLessThan(raw.peakToPeak);
    expect(inertial.bands.size).toBeLessThanOrEqual(2);
    expect(inertial.bands.has('radieuse') && inertial.bands.has('lasse')).toBe(false);
  });

  it('wake reset pulls toward baseline without a seismograph jump', () => {
    const high: RelationshipState = { celebratedMilestones: [], mood: 80, moodLocalDate: '2026-07-01' };
    const sameDay = evolveTraitsWithDayInertia(high, 'neutral', { localDate: '2026-07-01' });
    const nextDay = evolveTraitsWithDayInertia(high, 'neutral', { localDate: '2026-07-02' });
    const mood = personalityOf(nextDay).mood;
    expect(mood).toBeLessThan(80);
    expect(mood).toBeLessThan(personalityOf(sameDay).mood);
    expect(Math.abs(mood - 80)).toBeLessThanOrEqual(MAX_MOOD_STEP_PER_TURN * 2 + 1e-9);
    expect(nextDay.moodLocalDate).toBe('2026-07-02');
  });
});
