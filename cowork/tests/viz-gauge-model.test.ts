import { describe, expect, it } from 'vitest';
import { angleFor, zoneOf } from '../src/renderer/components/viz/util/gauge-model.js';

describe('gauge model', () => {
  it('maps values to half-circle angles', () => {
    expect(angleFor(0, 100)).toBe(-90);
    expect(angleFor(50, 100)).toBe(0);
    expect(angleFor(100, 100)).toBe(90);
  });

  it('classifies health zones', () => {
    expect([zoneOf(0, 100), zoneOf(50, 100), zoneOf(80, 100), zoneOf(95, 100)]).toEqual(['empty', 'good', 'warn', 'bad']);
  });
});
