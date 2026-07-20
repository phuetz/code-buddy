import { describe, expect, it } from 'vitest';

import {
  createDatasetV3Plan,
  DATASET_V3_TRIGGER,
  type DatasetV3Framing,
} from '../../src/lora/dataset-v3-plan.js';

function countByFraming(plan: ReturnType<typeof createDatasetV3Plan>): Record<DatasetV3Framing, number> {
  return plan.reduce<Record<DatasetV3Framing, number>>((counts, slot) => {
    counts[slot.framing] += 1;
    return counts;
  }, { face: 0, bust: 0, half: 0, full: 0, back: 0 });
}

describe('dataset v3 slot plan', () => {
  it('encodes the exact target composition and over-generation bounds', () => {
    const plan = createDatasetV3Plan();
    expect(plan).toHaveLength(39);
    expect(countByFraming(plan)).toEqual({ face: 11, bust: 9, half: 6, full: 9, back: 4 });
    expect(plan.every((slot) => slot.overgenCount === 3 || slot.overgenCount === 4)).toBe(true);
    expect(plan.reduce((total, slot) => total + slot.overgenCount, 0)).toBe(139);
  });

  it('covers the normative face angles and reserves one third neutral closed-mouth slots', () => {
    const plan = createDatasetV3Plan();
    const faceAngles = plan.filter((slot) => slot.framing === 'face').map((slot) => slot.angle);
    expect(faceAngles.filter((angle) => angle === 'front')).toHaveLength(3);
    expect(faceAngles.filter((angle) => angle.startsWith('threequarter-'))).toHaveLength(4);
    expect(faceAngles.filter((angle) => angle.startsWith('profile-'))).toHaveLength(2);
    expect(faceAngles).toContain('gaze-up');
    expect(faceAngles).toContain('gaze-down');
    expect(plan.filter((slot) => slot.expression === 'neutral-closed')).toHaveLength(12);
    expect(new Set(plan.map((slot) => slot.expression))).toEqual(new Set([
      'neutral-closed', 'smile-closed', 'smile-open', 'pensive', 'laugh',
    ]));
  });

  it('includes profiles, rear views, movement and the required diversity', () => {
    const plan = createDatasetV3Plan();
    expect(plan.some((slot) => slot.angle === 'profile-left')).toBe(true);
    expect(plan.some((slot) => slot.angle === 'profile-right')).toBe(true);
    expect(plan.filter((slot) => slot.framing === 'back')).toHaveLength(4);
    expect(plan.filter((slot) => slot.framing === 'full').map((slot) => slot.slotId)).toEqual(expect.arrayContaining([
      'full-walking-front', 'full-seated-left', 'full-arms-raised-right',
    ]));
    expect(new Set(plan.map((slot) => slot.lighting)).size).toBe(4);
    expect(new Set(plan.map((slot) => slot.settingTag)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(plan.map((slot) => slot.outfitTag)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(plan.map((slot) => slot.focalHint))).toEqual(new Set(['35mm', '50mm', '85mm']));
  });

  it('keeps every prompt trigger-first and free from facial descriptions', () => {
    const forbiddenFaceDescriptions = /(?:eye color|eye shape|nose|lips|jaw|cheekbone|facial proportions|skin tone|hairline)/iu;
    for (const slot of createDatasetV3Plan()) {
      expect(slot.prompt.startsWith(`${DATASET_V3_TRIGGER},`)).toBe(true);
      expect(slot.prompt).not.toMatch(forbiddenFaceDescriptions);
      expect(slot.prompt).toMatch(/no sunglasses, no blur, no filters, no occlusion$/u);
    }
  });

  it('is deterministic and exposes immutable slots', () => {
    const first = createDatasetV3Plan();
    const second = createDatasetV3Plan();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every(Object.isFrozen)).toBe(true);
  });
});
