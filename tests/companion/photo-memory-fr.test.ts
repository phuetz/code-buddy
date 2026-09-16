import { describe, expect, it } from 'vitest';
import {
  PHOTO_FR_LEXICON_SIZE,
  PHOTO_FR_MAX_WORDS,
  fallbackFrenchPhotoDescription,
  looksLikeEnglishPhotoDescription,
  sanitizeFrenchPhotoSummary,
  toFrenchPhotoMemory,
} from '../../src/companion/photo-memory-fr.js';

describe('photo memory French souvenir', () => {
  it('maps exactly 30 color/shape/place lemmas', () => {
    expect(PHOTO_FR_LEXICON_SIZE).toBe(30);
  });

  it('detects English VLM captions and keeps French ones', () => {
    expect(looksLikeEnglishPhotoDescription('a large red circle on a table')).toBe(true);
    expect(looksLikeEnglishPhotoDescription('un lac au coucher du soleil')).toBe(false);
  });

  it('falls back without leftover English function words', () => {
    const fr = fallbackFrenchPhotoDescription('a large red circle on a table under a blue sky');
    expect(fr).toContain('cercle');
    expect(fr).toContain('rouge');
    expect(fr).toContain('table');
    expect(fr).not.toMatch(/\b(a|an|the|large|red|circle|on|under|blue|sky)\b/i);
  });

  it('keeps a companion-model summary that is already French and short', () => {
    const body = sanitizeFrenchPhotoSummary(
      "tu m'as montré un grand cercle rouge sur une table.",
    );
    expect(body).toBe('un grand cercle rouge sur une table');
    expect(body!.split(/\s+/).length).toBeLessThanOrEqual(PHOTO_FR_MAX_WORDS);
  });

  it('rejects an English model dump so the lexicon can take over', () => {
    expect(sanitizeFrenchPhotoSummary('a large red circle on a table')).toBeNull();
  });

  it('uses the companion model when it answers in French', async () => {
    const body = await toFrenchPhotoMemory('a large red circle on a table', {
      summarizeFr: async () => "tu m'as montré un cercle rouge sur la table",
    });
    expect(body).toBe('un cercle rouge sur la table');
  });

  it('uses the lexicon when the companion model is absent', async () => {
    const body = await toFrenchPhotoMemory('a large red circle on a table', {
      summarizeFr: async () => {
        throw new Error('no companion model');
      },
    });
    expect(body).toContain('cercle');
    expect(body).toContain('rouge');
    expect(body).not.toMatch(/\b(a|large|red|circle|on)\b/i);
  });

  it('leaves an already-French caption untouched', async () => {
    const body = await toFrenchPhotoMemory('un lac au coucher du soleil', {
      summarizeFr: async () => {
        throw new Error('must not be called');
      },
    });
    expect(body).toBe('un lac au coucher du soleil');
  });
});
