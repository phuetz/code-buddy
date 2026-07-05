import { describe, expect, it } from 'vitest';
import { layoutEvents, timeRange } from '../src/renderer/components/viz/util/timeline-model.js';

describe('timeline model', () => {
  it('computes a stable time range', () => {
    expect(timeRange([{ t: 10, label: 'b' }, { t: 5, label: 'a' }])).toEqual({ start: 5, end: 10, span: 5 });
  });

  it('sorts and lays out events on two lanes', () => {
    expect(layoutEvents([{ t: 10, label: 'b' }, { t: 5, label: 'a' }]).map((event) => [event.label, event.xPct, event.lane])).toEqual([
      ['a', 0, 0],
      ['b', 100, 1],
    ]);
  });
});
