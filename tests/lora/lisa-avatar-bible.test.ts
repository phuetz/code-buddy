import { describe, expect, it } from 'vitest';
import {
  buildLisaAvatarPrompt,
  formatAvatarCatalog,
  getAvatarProfile,
  listAvatarProfiles,
  listAvatarStyles,
  LISA_AVATAR_IDENTITY,
  LISA_AVATAR_TRIGGER,
  resolveAvatarStyle,
} from '../../src/lora/lisa-avatar-bible.js';
import { buildLisaTrainingPrompts, LISA_IDENTITY_BLOCK } from '../../src/lora/generate-training-set.js';
import { buildLisaSelfiePrompt } from '../../src/companion/lisa-selfie.js';

describe('lisa-avatar-bible (multi-style + brunette muse)', () => {
  it('default lisa is the dark brunette muse from the Krea video', () => {
    const lisa = getAvatarProfile('lisa');
    expect(lisa.trigger).toBe('ohwx lisa');
    expect(lisa.identity).toMatch(/brunette|dark brown eyes|olive/i);
    expect(LISA_AVATAR_TRIGGER).toBe('ohwx lisa');
    expect(LISA_IDENTITY_BLOCK).toBe(LISA_AVATAR_IDENTITY);
    expect(LISA_AVATAR_IDENTITY).toMatch(/brunette|olive|dark brown eyes|single face/i);
  });

  it('exposes multiple presentation styles like the video grid', () => {
    const styles = listAvatarStyles('lisa');
    for (const need of ['studio', 'wet-selfie', 'street-rain', 'neon-skate', 'soft-editorial']) {
      expect(styles).toContain(need);
    }
    expect(resolveAvatarStyle('street')).toBe('street-rain');
    expect(resolveAvatarStyle('wet')).toBe('wet-selfie');
    expect(resolveAvatarStyle('neon')).toBe('neon-skate');
  });

  it('lists at least two avatar profiles (multi-avatar)', () => {
    const all = listAvatarProfiles();
    expect(all.map((a) => a.id).sort()).toEqual(['lisa', 'lisa-classic'].sort());
    expect(formatAvatarCatalog()).toMatch(/wet-selfie|street-rain/);
  });

  it('builds style-specific prompts with locked face', () => {
    const studio = buildLisaAvatarPrompt({ style: 'studio', forWhom: 'Patrice' });
    const street = buildLisaAvatarPrompt({ style: 'street-rain', forWhom: 'Patrice' });
    expect(studio.startsWith('ohwx lisa')).toBe(true);
    expect(studio).toMatch(/studio beauty|wet-look dark hair/i);
    expect(street).toMatch(/black.*coat|rainy/i);
    expect(studio).toMatch(/Patrice/);
    // Same identity block in both
    expect(studio).toMatch(/locked identity|single face/i);
    expect(street).toMatch(/locked identity|single face/i);
    // trigger once at start
    expect(studio.startsWith('ohwx lisa')).toBe(true);
    expect(studio.indexOf('ohwx lisa')).toBe(studio.lastIndexOf('ohwx lisa'));
  });

  it('training curriculum covers multi-style variety', () => {
    const specs = buildLisaTrainingPrompts(24, undefined, 'lisa');
    const joined = specs.map((s) => s.prompt).join('\n');
    expect(specs.every((s) => s.prompt.startsWith('ohwx lisa'))).toBe(true);
    expect(joined).toMatch(/coat|selfie|studio|neon|blouse/i);
  });

  it('lisa-selfie uses brunette identity + style', () => {
    const p = buildLisaSelfiePrompt({
      trigger: 'ohwx lisa',
      mood: 'studio',
      style: 'soft-editorial',
      userName: 'Patrice',
    });
    expect(p.startsWith('ohwx lisa')).toBe(true);
    expect(p).toMatch(/white blouse|editorial|brunette|olive/i);
    expect(p).toContain('Patrice');
  });
});
