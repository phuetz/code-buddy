import { describe, expect, it } from 'vitest';
import { barWidths, maxValue } from '../src/renderer/components/viz/util/bar-model.js';

describe('bar model', () => {
  it('uses one as a safe max for empty or zero data', () => {
    expect(maxValue([])).toBe(1);
    expect(maxValue([{ label: 'a', value: 0 }])).toBe(1);
  });

  it('sorts bars and computes relative widths', () => {
    expect(barWidths([{ label: 'b', value: 5 }, { label: 'a', value: 10 }])).toEqual([
      { label: 'a', value: 10, widthPct: 100, rank: 1 },
      { label: 'b', value: 5, widthPct: 50, rank: 2 },
    ]);
  });
});
