import { describe, expect, it } from 'vitest';

import {
  buildFashionScenePrompt,
  FASHION_SCENE_CATALOG,
  PILOT_FASHION_SCENES,
  type FashionPoseFamilyId,
} from '../../src/companion/fashion-scene-catalog.js';

const EXPECTED_FAMILIES: FashionPoseFamilyId[] = [
  'hair-touch-and-step',
  'three-quarter-hip-shift',
  'over-shoulder-turn',
  'dress-twirl',
  'slow-runway-walk',
  'staircase-walk-away',
  'balustrade-pose',
  'bag-carry-city-walk',
];

describe('fashion scene catalog', () => {
  it('contains every normative pose family with actionable guidance', () => {
    expect(Object.keys(FASHION_SCENE_CATALOG)).toEqual(EXPECTED_FAMILIES);
    for (const id of EXPECTED_FAMILIES) {
      const family = FASHION_SCENE_CATALOG[id];
      expect(family.id).toBe(id);
      expect(family.actionBeats.length).toBeGreaterThanOrEqual(2);
      expect(family.actionBeats.length).toBeLessThanOrEqual(4);
      expect(['fixed camera', 'slow tracking camera']).toContain(family.cameraGuidance);
      expect(family.stabilityRisks.length).toBeGreaterThan(0);
    }
  });

  it('declares every compatibility symmetrically', () => {
    for (const family of Object.values(FASHION_SCENE_CATALOG)) {
      for (const compatibleId of family.compatibleWith) {
        expect(FASHION_SCENE_CATALOG[compatibleId].compatibleWith).toContain(family.id);
      }
    }
  });

  it('rejects more than two or incompatible pose families', () => {
    expect(() => buildFashionScenePrompt({
      families: ['hair-touch-and-step', 'three-quarter-hip-shift', 'over-shoulder-turn'],
      outfit: 'black dress',
      setting: 'terrace',
      tier: 'safe',
    })).toThrow('at most two');
    expect(() => buildFashionScenePrompt({
      families: ['hair-touch-and-step', 'dress-twirl'],
      outfit: 'black dress',
      setting: 'terrace',
      tier: 'safe',
    })).toThrow('Incompatible');
  });

  it('keeps sensual prompts adult, covered and non-explicit', () => {
    const prompt = buildFashionScenePrompt({
      families: ['three-quarter-hip-shift'],
      outfit: 'fitted evening dress',
      setting: 'softly lit studio',
      tier: 'sensual',
    });
    expect(prompt).toContain('adult woman');
    expect(prompt).toContain('fully covered');
    expect(prompt).toContain('tasteful non-explicit');
    expect(prompt).not.toMatch(/\b(?:nude|naked|porn|sex|genitals?)\b/iu);
  });

  it('is deterministic and always requests native deliberate vertical framing', () => {
    const options = {
      families: ['slow-runway-walk'] as [FashionPoseFamilyId],
      outfit: 'tailored suit',
      setting: 'original city arcade',
      tier: 'safe' as const,
      trigger: 'ohwx lisa',
    };
    expect(buildFashionScenePrompt(options)).toBe(buildFashionScenePrompt(options));
    expect(buildFashionScenePrompt(options)).toMatch(/near full-body.*native vertical.*deliberately slow/iu);
    expect(buildFashionScenePrompt(options)).not.toMatch(/vietsy|youtube|reference (?:person|brand|channel)/iu);
  });

  it('exports both mandatory safe twelve-second pilots', () => {
    expect(PILOT_FASHION_SCENES.map((scene) => scene.sceneId)).toEqual([
      'pilot-black-dress-turn',
      'pilot-floral-staircase',
    ]);
    for (const scene of PILOT_FASHION_SCENES) {
      expect(scene.targetDurationSeconds).toBe(12);
      expect(scene.tier).toBe('safe');
      expect(scene.prompt).toBe(buildFashionScenePrompt({
        families: [...scene.families],
        outfit: scene.outfit,
        setting: scene.setting,
        tier: scene.tier,
      }));
    }
  });
});
