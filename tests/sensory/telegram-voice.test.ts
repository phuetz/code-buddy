import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import { sendTelegramVoice, sendTelegramAlert } from '../../src/sensory/alert.js';

let ogg: string;

beforeEach(async () => {
  ogg = path.join(os.tmpdir(), `cb-voice-test-${process.pid}-${Date.now()}.ogg`);
  await writeFile(ogg, Buffer.from([0x4f, 0x67, 0x67, 0x53])); // "OggS"
});
afterEach(async () => {
  await rm(ogg, { force: true });
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
});

describe('sendTelegramVoice — voice note to the phone', () => {
  it('no-op (false) when the alert token/chat is unconfigured', async () => {
    let posted = false;
    const ok = await sendTelegramVoice('bonjour', {
      synthesize: async () => ogg,
      post: async () => {
        posted = true;
        return { ok: true };
      },
    });
    expect(ok).toBe(false);
    expect(posted).toBe(false); // never even synthesizes/sends
  });

  it('synthesizes to OGG and POSTs sendVoice when configured', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const calls: Array<{ url: string; hasVoice: boolean; chat: unknown }> = [];
    const ok = await sendTelegramVoice("c'est l'heure de tes médicaments", {
      synthesize: async () => ogg,
      post: async (url, form) => {
        calls.push({ url, hasVoice: form.has('voice'), chat: form.get('chat_id') });
        return { ok: true };
      },
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/bottok/sendVoice');
    expect(calls[0]!.hasVoice).toBe(true);
    expect(calls[0]!.chat).toBe('123');
  });

  it('sanitizes the Telegram synthesis entry point with the shared French rules', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    let synthesized = '';

    const ok = await sendTelegramVoice('PDF à 9h30 👍', {
      synthesize: async (text) => {
        synthesized = text;
        return ogg;
      },
      post: async () => ({ ok: true }),
    });

    expect(ok).toBe(true);
    expect(synthesized).toBe('P D F à neuf heures trente');
  });

  it('reports success when synthesis fails but the text fallback is delivered', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    let fallbackText = '';
    await expect(
      sendTelegramVoice('x', {
        synthesize: async () => {
          throw new Error('piper/ffmpeg missing');
        },
        fallback: async (text) => {
          fallbackText = text;
          return true;
        },
      }),
    ).resolves.toBe(true);
    expect(fallbackText).toBe('x');
  });

  it('uses the text fallback when Telegram rejects the voice upload', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const fallback: string[] = [];

    await expect(
      sendTelegramVoice('reste lisible', {
        synthesize: async () => ogg,
        post: async () => ({ ok: false }),
        fallback: async (text) => {
          fallback.push(text);
          return true;
        },
      }),
    ).resolves.toBe(true);
    expect(fallback).toEqual(['reste lisible']);
  });
});

describe('sendTelegramAlert — never drops the notification', () => {
  afterEach(() => {
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  });

  it('no-op when unconfigured', async () => {
    const urls: string[] = [];
    await expect(
      sendTelegramAlert('hi', undefined, { fetch: async (u) => { urls.push(u); return {}; } }),
    ).resolves.toBe(false);
    expect(urls).toEqual([]);
  });

  it('sends a text message when there is no image', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const urls: string[] = [];
    await expect(
      sendTelegramAlert('bonjour', undefined, { fetch: async (u) => { urls.push(u); return {}; } }),
    ).resolves.toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/bottok/sendMessage');
  });

  it('sends a photo when the image reads fine', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const urls: string[] = [];
    await sendTelegramAlert('vu', '/tmp/frame.jpg', {
      readFile: async () => Buffer.from([0xff, 0xd8]),
      fetch: async (u) => { urls.push(u); return {}; },
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/sendPhoto');
  });

  it('FALLS BACK to a text message when the keyframe is unreadable (never a dropped alert)', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '123';
    const urls: string[] = [];
    await sendTelegramAlert('👤 quelqu’un est entré', '/nonexistent/frame.jpg', {
      readFile: async () => { throw new Error('ENOENT'); },
      fetch: async (u) => { urls.push(u); return {}; },
    });
    // Old behaviour: nothing sent. New: a text message so Patrice is still notified.
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/sendMessage');
  });
});
