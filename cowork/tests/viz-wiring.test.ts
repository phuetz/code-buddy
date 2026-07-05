import { describe, expect, it } from 'vitest';
import { vizWiring } from '../src/renderer/components/viz/viz-wiring.js';

describe('viz wiring manifest', () => {
  it('lists every delivered shared viz slice', () => {
    expect(vizWiring.map((entry) => entry.id)).toEqual([
      'sparkline',
      'bar-chart',
      'donut',
      'heatmap',
      'timeline-chart',
      'gauge-meter',
      'stacked-bar',
    ]);
  });

  it('is data-only and points to files for Fable wiring', () => {
    expect(vizWiring.every((entry) => entry.componentFile.endsWith('.tsx') && entry.mount === 'shared-viz')).toBe(true);
    expect(vizWiring.every((entry) => entry.needsData.length > 0)).toBe(true);
  });
});
