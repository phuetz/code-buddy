import { describe, expect, it } from 'vitest';
import { niceScale, pathFromValues, pointsFromValues } from '../src/renderer/components/viz/util/scale.js';

describe('sparkline scale utilities', () => {
  it('pads a flat series so it can still render', () => {
    expect(niceScale([5, 5]).span).toBeGreaterThan(0);
  });

  it('builds deterministic SVG path coordinates', () => {
    expect(pathFromValues([0, 5, 10], 100, 20)).toBe('M 0.00 18.62 L 50.00 10.00 L 100.00 1.38');
    expect(pointsFromValues([1], 80, 20)[0]).toMatchObject({ x: 0, value: 1 });
  });
});
