import { describe, expect, it } from 'vitest';
import { evaluateHomeInteractionPolicy } from '../../src/companion/home-interaction-policy.js';

describe('home interaction policy', () => {
  it.each(['silent', 'focus', 'rest', 'guests'] as const)(
    'suppresses spontaneous presence in %s mode',
    (mode) => {
      expect(evaluateHomeInteractionPolicy({
        mode,
        dayKind: 'workday',
        surface: 'presence',
      }).allowed).toBe(false);
    }
  );

  it('keeps private context hidden while guests are present', () => {
    const decision = evaluateHomeInteractionPolicy({
      mode: 'guests',
      dayKind: 'weekend',
      surface: 'proactive-local',
    });
    expect(decision.privateContentAllowed).toBe(false);
    expect(decision.allowed).toBe(false);
  });

  it('permits remote contact but never local speech in away mode', () => {
    expect(evaluateHomeInteractionPolicy({
      mode: 'away',
      dayKind: 'workday',
      surface: 'presence',
    }).allowed).toBe(false);
    expect(evaluateHomeInteractionPolicy({
      mode: 'away',
      dayKind: 'workday',
      surface: 'proactive-remote',
    }).allowed).toBe(true);
  });

  it('caps a weekend or explicit free day at two gentle initiatives', () => {
    expect(evaluateHomeInteractionPolicy({
      mode: 'normal',
      dayKind: 'weekend',
      surface: 'presence',
    }).spontaneousDailyLimit).toBe(2);
    expect(evaluateHomeInteractionPolicy({
      mode: 'free-day',
      dayKind: 'workday',
      surface: 'presence',
    }).spontaneousDailyLimit).toBe(2);
  });

  it('allows silent background work without spending an interruption budget', () => {
    const decision = evaluateHomeInteractionPolicy({
      mode: 'silent',
      dayKind: 'public_holiday',
      surface: 'idle',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.spontaneousDailyLimit).toBe(0);
  });
});
