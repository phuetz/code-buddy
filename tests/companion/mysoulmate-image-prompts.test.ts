import { describe, expect, it } from 'vitest';

import { AVATAR_STYLE_IDS } from '../../src/lora/lisa-avatar-bible.js';
import {
  buildMySoulmateMomentPrompt,
  listMySoulmateImageMoments,
  MYSOULMATE_IMAGE_MOMENTS,
  resolveMySoulmateImageMoment,
} from '../../src/companion/mysoulmate-image-prompts.js';

describe('MySoulmate image prompt catalog', () => {
  it('provides two original moments for every Lisa style', () => {
    expect(MYSOULMATE_IMAGE_MOMENTS).toHaveLength(24);
    expect(new Set(MYSOULMATE_IMAGE_MOMENTS.map((moment) => moment.id)).size).toBe(24);
    for (const style of AVATAR_STYLE_IDS) {
      expect(listMySoulmateImageMoments(style), style).toHaveLength(2);
      expect(resolveMySoulmateImageMoment(style, 3).id)
        .toBe(resolveMySoulmateImageMoment(style, 1).id);
    }
  });

  it('builds concise natural-language prompts in a stable semantic order', () => {
    const moment = resolveMySoulmateImageMoment('tender', 1);
    const prompt = buildMySoulmateMomentPrompt(moment, 'safe');

    expect(prompt.indexOf(moment.action)).toBeLessThan(prompt.indexOf(moment.setting));
    expect(prompt.indexOf(moment.setting)).toBeLessThan(prompt.indexOf(moment.safeOutfit));
    expect(prompt.indexOf(moment.safeOutfit)).toBeLessThan(prompt.indexOf(moment.framing));
    expect(prompt).toContain('gentle early-morning window light');
  });

  it('keeps sensual variants adult, covered, and free of competitor branding', () => {
    for (const moment of MYSOULMATE_IMAGE_MOMENTS) {
      const prompt = buildMySoulmateMomentPrompt(moment, 'sensual');
      expect(prompt.toLowerCase()).toMatch(/fully covered|intimate areas fully covered/);
      expect(prompt.toLowerCase()).not.toMatch(/replika|nomi|kindroid|candy\.ai/);
    }
  });
});
