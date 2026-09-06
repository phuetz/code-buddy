/**
 * A photo sent on Telegram must arrive as bytes Lisa can react to — downloaded
 * through `getFile`, bounded, authenticated by magic numbers and never by the
 * extension a file name claims — and an album must produce ONE reaction.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TELEGRAM_MEDIA_GROUP_MS,
  telegramMediaGroupWindowMs,
} from '../../src/channels/telegram/client.js';
import {
  isDownloadableUrl,
  loadChannelPhotos,
} from '../../src/companion/companion-photo-intake.js';
import { prepareCompanionPhotos } from '../../src/companion/companion-photo.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function okResponse(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

describe('the album window', () => {
  it('defaults to 1.5 s so a slow uplink still gets one reaction', () => {
    expect(DEFAULT_TELEGRAM_MEDIA_GROUP_MS).toBe(1_500);
    expect(telegramMediaGroupWindowMs({} as NodeJS.ProcessEnv)).toBe(1_500);
  });

  it('is overridable and bounded', () => {
    const env = (value: string) =>
      ({ CODEBUDDY_TELEGRAM_MEDIA_GROUP_MS: value }) as unknown as NodeJS.ProcessEnv;
    expect(telegramMediaGroupWindowMs(env('300'))).toBe(300);
    expect(telegramMediaGroupWindowMs(env('1'))).toBe(50);
    expect(telegramMediaGroupWindowMs(env('999999'))).toBe(10_000);
    expect(telegramMediaGroupWindowMs(env('nope'))).toBe(1_500);
  });
});

describe('downloading a Telegram photo', () => {
  it('resolves the file_id through getFile and returns the bytes', async () => {
    const resolveUrl = vi.fn(async (fileId: string) => `https://api.telegram.test/file/${fileId}.jpg`);
    const fetchImpl = vi.fn(async () => okResponse(PNG_1X1));
    const loaded = await loadChannelPhotos([{ type: 'image', url: 'AgACAgQAAx' }], {
      resolveUrl,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(resolveUrl).toHaveBeenCalledWith('AgACAgQAAx');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.bytes!.equals(PNG_1X1)).toBe(true);
  });

  it('refuses a non-https, non-loopback URL', async () => {
    const fetchImpl = vi.fn(async () => okResponse(PNG_1X1));
    const loaded = await loadChannelPhotos([{ type: 'image', url: 'x' }], {
      resolveUrl: async () => 'http://evil.example.com/a.jpg',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(loaded).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows loopback http for a local test server', () => {
    expect(isDownloadableUrl('http://127.0.0.1:4601/file/a.jpg')).toBe(true);
    expect(isDownloadableUrl('https://api.telegram.org/file/a.jpg')).toBe(true);
    expect(isDownloadableUrl('http://10.0.0.5/a.jpg')).toBe(false);
    expect(isDownloadableUrl('file:///etc/passwd')).toBe(false);
    expect(isDownloadableUrl('nonsense')).toBe(false);
  });

  it('stops at the byte ceiling even when content-length lies', async () => {
    const big = Buffer.alloc(600);
    const fetchImpl = vi.fn(async () => okResponse(big, { 'content-length': '10' }));
    const loaded = await loadChannelPhotos([{ type: 'image', url: 'x' }], {
      resolveUrl: async () => 'https://api.telegram.test/big.jpg',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxBytes: 200,
    });
    expect(loaded).toHaveLength(0);
  });

  it('rejects a declared oversize before downloading a byte', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(PNG_1X1, { 'content-length': String(50 * 1024 * 1024) }),
    );
    const loaded = await loadChannelPhotos([{ type: 'image', url: 'x' }], {
      resolveUrl: async () => 'https://api.telegram.test/huge.jpg',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(loaded).toHaveLength(0);
  });

  it('keeps the good photos of an album when one is broken', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error('network reset');
      return okResponse(PNG_1X1);
    });
    const loaded = await loadChannelPhotos(
      [
        { type: 'image', url: 'a' },
        { type: 'image', url: 'b' },
        { type: 'image', url: 'c' },
      ],
      {
        resolveUrl: async (id) => `https://api.telegram.test/${id}.jpg`,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    expect(loaded).toHaveLength(2);
  });

  it('ignores non-image attachments', async () => {
    const loaded = await loadChannelPhotos([{ type: 'audio', url: 'voice' }], {
      resolveUrl: async () => 'https://api.telegram.test/voice.ogg',
      fetchImpl: (async () => okResponse(PNG_1X1)) as unknown as typeof fetch,
    });
    expect(loaded).toHaveLength(0);
  });
});

describe('a Telegram album reaches the companion turn as one batch', () => {
  it('prepares every photo of the album for a single reaction', async () => {
    const fetchImpl = vi.fn(async () => okResponse(PNG_1X1));
    const loaded = await loadChannelPhotos(
      [
        { type: 'image', url: 'front' },
        { type: 'image', url: 'back' },
      ],
      {
        resolveUrl: async (id) => `https://api.telegram.test/${id}.jpg`,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    const prepared = await prepareCompanionPhotos(loaded, {
      env: { CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' } as unknown as NodeJS.ProcessEnv,
      caption: 'nos vacances',
    });
    expect(prepared!.photos).toHaveLength(2);
    expect(prepared!.userText).toBe('nos vacances');
  });

  it('refuses a payload whose bytes are not an image, whatever the name claims', async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse(Buffer.from('#!/bin/sh\nrm -rf /'), { 'content-type': 'image/jpeg' }),
    );
    const loaded = await loadChannelPhotos([{ type: 'image', url: 'evil.jpg' }], {
      resolveUrl: async () => 'https://api.telegram.test/evil.jpg',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(loaded).toHaveLength(1);
    const prepared = await prepareCompanionPhotos(loaded, {
      env: { CODEBUDDY_COMPANION_PHOTO_VISION: 'cloud' } as unknown as NodeJS.ProcessEnv,
    });
    expect(prepared!.photos).toHaveLength(0);
    expect(prepared!.rejected).toContain('attachment is not an image');
  });
});
