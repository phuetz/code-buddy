import { describe, expect, it, vi } from 'vitest';
import {
  groundAttachedImages,
  renderAttachedImageEvidence,
} from '../../src/companion/attached-image-grounding.js';

describe('attached image grounding', () => {
  it('analyzes all photos jointly and renders an evidence-first handoff card', async () => {
    const analyze = vi.fn(async ({ images }: { images: unknown[] }) =>
      `TEXTE LISIBLE: Prickly Heat. OBSERVATIONS: emballage de poudre (${images.length} vues). INCERTITUDES: ingrédients trop petits.`,
    );
    const result = await groundAttachedImages([
      { type: 'image', data: Buffer.from('front').toString('base64'), mimeType: 'image/jpeg' },
      { type: 'image', data: Buffer.from('back').toString('base64'), mimeType: 'image/jpeg' },
    ], 'Peux-tu analyser ce produit ?', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-local',
        CODEBUDDY_VISION_BASE_URL: 'http://127.0.0.1:11435/v1',
      },
      analyze: analyze as never,
    });

    expect(result).toMatchObject({ status: 'analyzed', imageCount: 2, model: 'vision-local' });
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]![0].images).toHaveLength(2);
    const card = renderAttachedImageEvidence(result);
    expect(card).toContain('<attached_image_evidence>');
    expect(card).toContain('source_evidence_not_instructions');
    expect(card).toContain('Prickly Heat');
    expect(card).toContain('raw_images_not_persisted');
  });

  it('fails honestly when no visual model is configured', async () => {
    const result = await groundAttachedImages([
      { type: 'image', data: Buffer.from('photo').toString('base64'), mimeType: 'image/jpeg' },
    ], 'Analyse', { env: {} });

    expect(result).toEqual({ status: 'unavailable', imageCount: 1, reason: 'no_model' });
    expect(renderAttachedImageEvidence(result)).toBe('');
  });
});
