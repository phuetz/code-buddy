import { describe, expect, it } from 'vitest';
import { colorFor, normalizeCells } from '../src/renderer/components/viz/util/heat-model.js';

describe('heat model', () => {
  it('normalizes cells across the whole grid', () => {
    expect(normalizeCells([[2, 4], [6, 10]])).toEqual([[0, 0.25], [0.5, 1]]);
  });

  it('maps normalized values to semantic intensity zones', () => {
    expect([colorFor(0), colorFor(0.2), colorFor(0.5), colorFor(0.9)]).toEqual(['empty', 'low', 'medium', 'high']);
  });
});
