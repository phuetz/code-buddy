/**
 * vision-train COCO bridge — real tests (no mocks): converting a standard COCO
 * annotations object into the {filename: {label: count}} ground truth that
 * `buddy vision-train --labels` consumes. This is the simulate→perceive seam:
 * a BlenderProc/Kubric scene whose geometry is known → exact self-labeled GT.
 */
import { describe, expect, it } from 'vitest';
import { cocoToVisionTrainLabels, type CocoDataset } from '../../src/vision-train/coco-to-labels.js';

const COCO: CocoDataset = {
  images: [
    { id: 1, file_name: 'renders/scene-001.png' },
    { id: 2, file_name: 'renders/scene-002.png' },
    { id: 3, file_name: 'renders/scene-003.png' }, // empty room (no annotations)
  ],
  categories: [
    { id: 10, name: 'person' },
    { id: 20, name: 'chair' },
  ],
  annotations: [
    { image_id: 1, category_id: 10 }, // scene-001: 2 persons + 1 chair
    { image_id: 1, category_id: 10 },
    { image_id: 1, category_id: 20 },
    { image_id: 2, category_id: 10 }, // scene-002: 1 person
  ],
};

describe('cocoToVisionTrainLabels', () => {
  it('counts annotations per (image, category) keyed by basename', () => {
    const labels = cocoToVisionTrainLabels(COCO);
    expect(labels['scene-001.png']).toEqual({ person: 2, chair: 1 });
    expect(labels['scene-002.png']).toEqual({ person: 1 });
  });

  it('emits empty scenes as {} (the false-positive ground truth)', () => {
    const labels = cocoToVisionTrainLabels(COCO);
    expect(labels['scene-003.png']).toEqual({});
  });

  it('keeps the full path when basename is disabled', () => {
    const labels = cocoToVisionTrainLabels(COCO, { basename: false });
    expect(labels['renders/scene-001.png']).toEqual({ person: 2, chair: 1 });
    expect(labels['scene-001.png']).toBeUndefined();
  });

  it('renames sim categories to the perceiver class names before counting', () => {
    const coco: CocoDataset = {
      images: [{ id: 1, file_name: 'a.png' }],
      categories: [{ id: 1, name: 'human' }],
      annotations: [{ image_id: 1, category_id: 1 }],
    };
    const labels = cocoToVisionTrainLabels(coco, { rename: { human: 'person' } });
    expect(labels['a.png']).toEqual({ person: 1 });
  });

  it('drops categories outside the keep list', () => {
    const labels = cocoToVisionTrainLabels(COCO, { keep: ['person'] });
    expect(labels['scene-001.png']).toEqual({ person: 2 });
    expect(labels['scene-001.png']?.chair).toBeUndefined();
  });

  it('is defensive: unresolved image_id/category_id are skipped, never throws', () => {
    const coco: CocoDataset = {
      images: [{ id: 1, file_name: 'a.png' }],
      categories: [{ id: 1, name: 'person' }],
      annotations: [
        { image_id: 1, category_id: 1 },
        { image_id: 999, category_id: 1 }, // unknown image
        { image_id: 1, category_id: 999 }, // unknown category
      ],
    };
    const labels = cocoToVisionTrainLabels(coco);
    expect(labels['a.png']).toEqual({ person: 1 });
  });

  it('handles an empty/partial dataset without throwing', () => {
    expect(cocoToVisionTrainLabels({})).toEqual({});
    expect(cocoToVisionTrainLabels({ images: [{ id: 1, file_name: 'x.png' }] })).toEqual({ 'x.png': {} });
  });
});
