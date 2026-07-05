import { describe, expect, it } from 'vitest';
import { percentages, toArcs } from '../src/renderer/components/viz/util/donut-model.js';

describe('donut model', () => {
  it('computes normalized percentages', () => {
    expect(percentages([{ label: 'a', value: 1 }, { label: 'b', value: 3 }])).toEqual([0.25, 0.75]);
  });

  it('creates arc paths with large arc flags', () => {
    const arcs = toArcs([{ label: 'a', value: 1 }, { label: 'b', value: 3 }]);
    expect(arcs[0]?.endAngle).toBe(90);
    expect(arcs[1]?.largeArc).toBe(1);
    expect(arcs[0]?.path.startsWith('M 50.00 14.00 A 36 36')).toBe(true);
  });
});
