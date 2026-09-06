/**
 * A photo shared with Lisa must be authenticated by its bytes, routed by an
 * explicit privacy posture, and must reach the model as something she can react
 * to — never as "je ne peux pas voir les images".
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANION_PHOTO_GUIDANCE,
  COMPANION_PHOTO_MAX_COUNT,
  attachPhotoParts,
  buildUserText,
  decideCompanionPhotoMode,
  looksLikeVisionRefusal,
  modelAcceptsImages,
  normalizeCompanionPhoto,
  photoMemoryLine,
  prepareCompanionPhotos,
  resolveCompanionPhotoVision,
  sniffImageMime,
  type PreparedCompanionPhoto,
} from '../../src/companion/companion-photo.js';

/** 1x1 PNG, generated here — never a real image checked into the repo. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** Minimal JPEG framing — SOI, APP0, EOI. */
const JPEG_STUB = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF', 'ascii'),
  Buffer.from([0x00, 0xff, 0xd9]),
]);

const env = (extra: Record<string, string> = {}) => extra as unknown as NodeJS.ProcessEnv;

describe('magic-byte authentication', () => {
  it('recognises real image bytes and rejects everything else', () => {
    expect(sniffImageMime(PNG_1X1)).toBe('image/png');
    expect(sniffImageMime(JPEG_STUB)).toBe('image/jpeg');
    expect(
      sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('GIF89a-rest'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('<?php system($_GET[0]); ?>'))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });

  it('never trusts a declared MIME type over the bytes', async () => {
    const prepared = await prepareCompanionPhotos(
      [{ mimeType: 'image/jpeg', data: Buffer.from('not an image at all').toString('base64') }],
      { env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }) },
    );
    expect(prepared!.photos).toHaveLength(0);
    expect(prepared!.rejected).toContain('attachment is not an image');
  });
});

describe('privacy posture', () => {
  it('reads the three documented values and falls back to auto', () => {
    expect(resolveCompanionPhotoVision(env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'local' }))).toBe('local');
    expect(resolveCompanionPhotoVision(env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'CLOUD' }))).toBe('cloud');
    expect(resolveCompanionPhotoVision(env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'wat' }))).toBe('auto');
    expect(resolveCompanionPhotoVision(env())).toBe('auto');
  });

  it('auto sends the image only to a model declared multimodal', () => {
    expect(modelAcceptsImages('gemini-3.7-flash')).toBe(true);
    expect(modelAcceptsImages('qwen3:4b-instruct')).toBe(false);
    expect(modelAcceptsImages('anything', 'https://generativelanguage.googleapis.com/v1beta')).toBe(true);
    expect(decideCompanionPhotoMode({ env: env(), model: 'gemini-3.7-flash' })).toBe('cloud');
    expect(decideCompanionPhotoMode({ env: env(), model: 'qwen3:4b-instruct' })).toBe('local');
  });

  it('local is a hard guarantee: the bytes never reach a message part', async () => {
    const prepared = await prepareCompanionPhotos([{ bytes: PNG_1X1 }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'local' }),
      // Even with a multimodal model resolved, `local` wins.
      model: 'gemini-3.7-flash',
      caption: 'regarde ce que j’ai vu',
      describe: async () => ['un ciel orange au-dessus d’un lac'],
    });
    expect(prepared!.mode).toBe('local');
    expect(prepared!.userText).toContain('[Photo envoyée : un ciel orange au-dessus d’un lac]');

    const messages = [{ role: 'user', content: prepared!.userText }];
    // Local mode never attaches parts: `attachPhotoParts` is simply not called
    // by the turn, and the assembled message stays a plain string.
    expect(typeof messages[0]!.content).toBe('string');
    expect(JSON.stringify(messages)).not.toContain('base64');
  });

  it('cloud mode carries the image as an image_url part on the last user message', async () => {
    const prepared = await prepareCompanionPhotos([{ bytes: PNG_1X1 }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }),
      caption: 'regarde',
    });
    expect(prepared!.mode).toBe('cloud');
    const messages = attachPhotoParts(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: prepared!.userText },
      ],
      prepared!.photos,
    );
    expect(messages[0]!.content).toBe('sys');
    const parts = messages[1]!.content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: 'regarde' });
    expect(parts[1]!.type).toBe('image_url');
    expect(String((parts[1]!.image_url as { url: string }).url)).toMatch(/^data:image\/(png|jpeg);base64,/);
  });

  it('leaves the messages untouched when there is no photo', () => {
    const messages = [{ role: 'user', content: 'coucou' }];
    expect(attachPhotoParts(messages, [])).toBe(messages);
  });
});

describe('the reaction contract', () => {
  it('asks her to look, to feel, to ask back, and forbids the blindness line', () => {
    expect(COMPANION_PHOTO_GUIDANCE).toContain('détail concret');
    expect(COMPANION_PHOTO_GUIDANCE).toContain('UNE question');
    expect(COMPANION_PHOTO_GUIDANCE).toMatch(/ne dis jamais que tu ne peux pas voir/i);
  });

  it('detects a reply that admits blindness, in both languages', () => {
    expect(looksLikeVisionRefusal('Désolée, je ne peux pas voir les images.')).toBe(true);
    expect(looksLikeVisionRefusal("Je n’ai pas accès aux images que tu envoies.")).toBe(true);
    expect(looksLikeVisionRefusal("I can't see the image you sent.")).toBe(true);
    expect(looksLikeVisionRefusal('Oh le ciel est magnifique, tu étais où ?')).toBe(false);
  });

  it('states honestly that the description is missing rather than staying silent', () => {
    expect(buildUserText('', 'local', [], 1)).toContain('description indisponible');
    expect(buildUserText('coucou', 'cloud', [], 1)).toBe('coucou');
    expect(buildUserText('', 'cloud', [], 2)).toBe('Regarde ces photos.');
  });
});

describe('normalization and bounds', () => {
  it('keeps a small JPEG untouched', async () => {
    const result = await normalizeCompanionPhoto(JPEG_STUB, 'image/jpeg');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.bytes.equals(JPEG_STUB)).toBe(true);
  });

  it('strips GPS EXIF and a trailing HTML payload from a small JPEG', async () => {
    const sharpMod = await import('sharp');
    const jpeg = await sharpMod.default({
      create: { width: 16, height: 16, channels: 3, background: { r: 4, g: 5, b: 6 } },
    })
      .jpeg({ quality: 80 })
      .toBuffer();
    const marker = Buffer.from('HOUSEGPS');
    const app1 = Buffer.alloc(4 + marker.length);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(marker.length + 2, 2);
    marker.copy(app1, 4);
    const poisoned = Buffer.concat([
      jpeg.subarray(0, 2),
      app1,
      jpeg.subarray(2),
      Buffer.from('<html>HOUSEGPS</html>'),
    ]);
    expect(poisoned.includes(marker)).toBe(true);
    const prepared = await prepareCompanionPhotos([{ bytes: poisoned }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }),
    });
    const out = prepared!.photos[0]!.bytes;
    expect(out.includes(marker)).toBe(false);
    expect(out.includes(Buffer.from('<html>'))).toBe(false);
    expect(prepared!.photos[0]!.mimeType).toBe('image/jpeg');
  });

  it('never throws when the optional resizer cannot handle the payload', async () => {
    const result = await normalizeCompanionPhoto(PNG_1X1, 'image/png');
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(['image/png', 'image/jpeg']).toContain(result.mimeType);
  });

  it('refuses an oversized attachment without throwing', async () => {
    const huge = Buffer.concat([PNG_1X1, Buffer.alloc(11 * 1024 * 1024)]);
    const prepared = await prepareCompanionPhotos([{ bytes: huge }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }),
    });
    expect(prepared!.photos).toHaveLength(0);
    expect(prepared!.rejected).toContain('attachment too large');
  });

  it('caps the batch at four photos', async () => {
    const prepared = await prepareCompanionPhotos(
      Array.from({ length: 9 }, () => ({ bytes: PNG_1X1 })),
      { env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }) },
    );
    expect(prepared!.photos.length).toBeLessThanOrEqual(COMPANION_PHOTO_MAX_COUNT);
  });

  it('returns null when there is nothing to prepare', async () => {
    expect(await prepareCompanionPhotos([], {})).toBeNull();
    expect(await prepareCompanionPhotos(undefined, {})).toBeNull();
  });

  it('survives a describer that throws', async () => {
    const prepared = await prepareCompanionPhotos([{ bytes: PNG_1X1 }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'local' }),
      describe: async () => {
        throw new Error('vision endpoint down');
      },
    });
    expect(prepared!.mode).toBe('local');
    expect(prepared!.photos).toHaveLength(1);
    expect(prepared!.userText).toContain('description indisponible');
  });
});

describe('the memory hook', () => {
  it('is a dated first-person line, stripped of perception jargon and bounded', () => {
    const line = photoMemoryLine(
      'IMAGE 1/1 TEXTE LISIBLE : rien OBSERVATIONS : un lac au coucher du soleil',
      new Date('2026-09-06T12:00:00Z'),
    );
    expect(line.startsWith("2026-09-06 : tu m'as montré ")).toBe(true);
    expect(line).not.toContain('OBSERVATIONS');
    expect(line).not.toContain('IMAGE 1/1');
    expect(photoMemoryLine('x'.repeat(400), new Date()).length).toBeLessThanOrEqual(150);
  });

  it('degrades to a plain sentence when nothing was described', () => {
    expect(photoMemoryLine('', new Date('2026-09-06T12:00:00Z'))).toBe(
      "2026-09-06 : tu m'as montré une photo",
    );
  });
});

describe('prepared photo shape', () => {
  it('exposes bytes and a data URL that agree', async () => {
    const prepared = await prepareCompanionPhotos([{ data: PNG_1X1.toString('base64') }], {
      env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }),
    });
    const photo = prepared!.photos[0] as PreparedCompanionPhoto;
    const encoded = photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1);
    expect(Buffer.from(encoded, 'base64').equals(photo.bytes)).toBe(true);
  });

  it('accepts a data: prefixed payload', async () => {
    const prepared = await prepareCompanionPhotos(
      [{ data: `data:image/png;base64,${PNG_1X1.toString('base64')}` }],
      { env: env({ CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' }) },
    );
    expect(prepared!.photos).toHaveLength(1);
  });
});
