import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, nextStep } from './onboarding-tour-model.js';

describe('onboarding tour model', () => {
  it('defines seven onboarding steps', () => {
    expect(TOUR_STEPS).toHaveLength(7);
  });

  it('uses unique step ids', () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps navigation bounded', () => {
    const total = TOUR_STEPS.length;

    expect(nextStep(0, total, 'prev')).toBe(0);
    expect(nextStep(0, total, 'next')).toBe(1);
    expect(nextStep(total - 1, total, 'next')).toBe(total - 1);
    expect(nextStep(total - 1, total, 'prev')).toBe(total - 2);
    expect(nextStep(0, 0, 'next')).toBe(0);
  });
});
