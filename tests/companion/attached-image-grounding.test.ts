import { describe, expect, it, vi } from 'vitest';
import {
  groundAttachedImages,
  renderAttachedImageEvidence,
} from '../../src/companion/attached-image-grounding.js';

describe('attached image grounding', () => {
  it('analyzes all photos jointly and renders an evidence-first handoff card', async () => {
    const analyze = vi.fn(async (input: {
      prompt: string;
      images: Array<{ data: string; source: string }>;
      model: string;
      baseURL: string;
      apiKey: string;
      signal: AbortSignal;
    }) => {
      const payloads = input.images.map((image) =>
        Buffer.from(image.data.slice(image.data.indexOf(',') + 1), 'base64').toString('utf8'));
      expect(input).toMatchObject({
        prompt: 'Peux-tu analyser ce produit ?',
        model: 'vision-local',
        baseURL: 'http://127.0.0.1:11435/v1',
        apiKey: 'ollama',
      });
      expect(input.signal.aborted).toBe(false);
      expect(input.images.map((image) => image.source)).toEqual([
        'channel-attachment',
        'channel-attachment',
      ]);
      expect(payloads).toEqual(['front', 'back']);
      return `TEXTE LISIBLE: Prickly Heat. OBSERVATIONS: ${payloads.join(' + ')}. INCERTITUDES: ingrédients trop petits.`;
    });
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
    expect(card).toContain('front + back');
    expect(card).toContain('raw_images_not_persisted');
  });

  it('fails honestly when no visual model is configured', async () => {
    const result = await groundAttachedImages([
      { type: 'image', data: Buffer.from('photo').toString('base64'), mimeType: 'image/jpeg' },
    ], 'Analyse', { env: {} });

    expect(result).toEqual({ status: 'unavailable', imageCount: 1, reason: 'no_model' });
    expect(renderAttachedImageEvidence(result)).toBe('');
  });

  it('accepts a Telegram JPEG served as application/octet-stream by sniffing its bytes', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const analyze = vi.fn(async ({ images }: { images: Array<{ mimeType: string }> }) =>
      `OBSERVATIONS: image reçue en ${images[0]!.mimeType}.`,
    );
    const result = await groundAttachedImages([
      { type: 'image', url: 'telegram-file-id' },
    ], 'Analyse cette photo', {
      env: {
        CODEBUDDY_VISION_MODEL: 'vision-local',
        CODEBUDDY_VISION_BASE_URL: 'http://127.0.0.1:11435/v1',
      },
      resolveUrl: async () => 'https://api.telegram.org/file/bot-redacted/photos/file.jpg',
      fetchImpl: vi.fn(async () => new Response(jpeg, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })) as never,
      analyze: analyze as never,
    });

    expect(result.status).toBe('analyzed');
    expect(analyze.mock.calls[0]![0].images[0]!.mimeType).toBe('image/jpeg');
  });
});
