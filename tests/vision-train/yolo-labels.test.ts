import { describe, expect, it } from 'vitest';
import {
  cocoClassFor,
  remapCountsToExpected,
  yoloClassesFromExpected,
} from '../../src/vision-train/yolo-labels.js';
import { buildCurriculum } from '../../src/vision-train/curriculum.js';

describe('yolo-labels — curriculum names must not crash Ultralytics', () => {
  it('maps desk (default curriculum prop) onto the COCO dining table class', () => {
    expect(cocoClassFor('desk')).toBe('dining table');
    expect(yoloClassesFromExpected({ person: 1, desk: 1 })).toEqual(['person', 'dining table']);
  });

  it('remaps YOLO dining table detections back onto expected desk counts', () => {
    expect(
      remapCountsToExpected(
        { person: 1, 'dining table': 1 },
        { person: 1, desk: 1 },
      ),
    ).toEqual({ person: 1, desk: 1 });
  });

  it('never asks YOLO for a class name absent from COCO for the default curriculum', () => {
    const coco = new Set([
      'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
      'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
      'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
      'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
      'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
      'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
      'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
      'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
      'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
      'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
      'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
      'hair drier', 'toothbrush',
    ]);
    const specs = buildCurriculum({ count: 12, prop: 'desk' });
    for (const spec of specs) {
      for (const cls of yoloClassesFromExpected(spec.expect.counts)) {
        expect(coco.has(cls), `curriculum asked YOLO for unknown class "${cls}"`).toBe(true);
      }
    }
  });
});
