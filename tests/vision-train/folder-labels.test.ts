import { describe, expect, it } from 'vitest';

import {
  formatMissingGroundTruthWarning,
  selectLabeledFolderScenes,
} from '../../src/vision-train/folder-labels.js';

describe('selectLabeledFolderScenes', () => {
  it('keeps explicit empty-scene labels and excludes images missing ground truth', () => {
    const selection = selectLabeledFolderScenes(
      ['empty.jpg', 'labeled.jpg', 'missing.jpg'],
      {
        'empty.jpg': {},
        'labeled.jpg': { person: 1 },
      },
    );

    expect(selection.specs.map((spec) => spec.id)).toEqual(['empty.jpg', 'labeled.jpg']);
    expect(selection.specs[0]?.expect.counts).toEqual({});
    expect(selection.specs[1]?.expect.counts).toEqual({ person: 1 });
    expect(selection.missingFiles).toEqual(['missing.jpg']);
  });

  it('formats one aggregate warning rather than one warning per file', () => {
    expect(formatMissingGroundTruthWarning(2)).toBe('2 images ignored — no ground-truth labels.');
  });
});
