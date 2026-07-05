import { describe, expect, it } from 'vitest';
import { stackParts, totalValue } from '../src/renderer/components/viz/util/stacked-model.js';

describe('stacked model', () => {
  it('uses a safe total for empty bars', () => {
    expect(totalValue([])).toBe(1);
  });

  it('computes segment offsets and widths', () => {
    expect(stackParts([{ label: 'a', value: 1, tone: 'primary' }, { label: 'b', value: 3, tone: 'success' }])).toEqual([
      { label: 'a', value: 1, tone: 'primary', startPct: 0, widthPct: 25, percent: 0.25 },
      { label: 'b', value: 3, tone: 'success', startPct: 25, widthPct: 75, percent: 0.75 },
    ]);
  });
});
