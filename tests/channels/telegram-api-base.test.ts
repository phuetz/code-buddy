/**
 * GK10 — TELEGRAM_API_BASE must be honoured so a local fake Bot API can
 * replace api.telegram.org. The production default stays the public API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import { sendTelegramAlert, sendTelegramVoice } from '../../src/sensory/alert.js';
import { resolveTelegramApiBase } from '../../src/utils/telegram-api-base.js';

const FAKE_BASE = 'http://127.0.0.1:18765';
const TOKEN = '123456:gk10-fake-token';

function jsonResponse(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result }),
  } as Response;
}

describe('TELEGRAM_API_BASE', () => {
  const previousBase = process.env.TELEGRAM_API_BASE;
  const previousAlertToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  const previousAlertChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    delete process.env.TELEGRAM_API_BASE;
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (previousBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = previousBase;
    if (previousAlertToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousAlertToken;
    if (previousAlertChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousAlertChat;
  });

  it('defaults to the public Telegram Bot API', () => {
    expect(resolveTelegramApiBase({})).toBe('https://api.telegram.org');
    expect(resolveTelegramApiBase({ TELEGRAM_API_BASE: '   ' })).toBe('https://api.telegram.org');
  });

  it('strips trailing slashes from TELEGRAM_API_BASE', () => {
    expect(resolveTelegramApiBase({ TELEGRAM_API_BASE: `${FAKE_BASE}/` })).toBe(FAKE_BASE);
  });

  it('routes TelegramChannel getMe/getUpdates to TELEGRAM_API_BASE, never api.telegram.org', async () => {
    process.env.TELEGRAM_API_BASE = FAKE_BASE;
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const method = String(input).split('/').at(-1);
      if (method === 'getMe') {
        return jsonResponse({ id: 123456, is_bot: true, first_name: 'Lisa', username: 'lisa_bot' });
      }
      return jsonResponse(method === 'getUpdates' ? [] : true);
    }) as typeof fetch;

    const channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 1,
      enhancedCommands: false,
    });
    channel.on('error', () => undefined);

    await channel.connect();
    await channel.disconnect();

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith(`${FAKE_BASE}/bot${TOKEN}/`))).toBe(true);
    expect(urls.some((url) => url.includes('/getMe'))).toBe(true);
    expect(urls.some((url) => url.includes('api.telegram.org'))).toBe(false);
  });

  it('routes sendTelegramVoice and sendTelegramAlert to TELEGRAM_API_BASE', async () => {
    process.env.TELEGRAM_API_BASE = `${FAKE_BASE}/`;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = TOKEN;
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '4242';
    const urls: string[] = [];

    const voiceOk = await sendTelegramVoice('bonjour', {
      synthesize: async () => {
        throw new Error('synthesis skipped');
      },
      post: async (url) => {
        urls.push(url);
        return { ok: true };
      },
      fallback: async () => false,
    });
    expect(voiceOk).toBe(false);

    const alertOk = await sendTelegramAlert('alerte', undefined, {
      fetch: async (url) => {
        urls.push(url);
        return { ok: true };
      },
    });
    expect(alertOk).toBe(true);

    expect(urls).toEqual([
      `${FAKE_BASE}/bot${TOKEN}/sendMessage`,
    ]);
    expect(urls.some((url) => url.includes('api.telegram.org'))).toBe(false);
  });

  it('sendTelegramVoice posts to TELEGRAM_API_BASE/sendVoice when synthesis succeeds', async () => {
    process.env.TELEGRAM_API_BASE = FAKE_BASE;
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = TOKEN;
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '4242';
    const urls: string[] = [];
    const ogg = Buffer.from('OggS');

    const ok = await sendTelegramVoice('note vocale', {
      synthesize: async () => {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const file = path.join(process.cwd(), '_qa', 'gk10', 'artifacts', 'voice-note.ogg');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, ogg);
        return file;
      },
      post: async (url) => {
        urls.push(url);
        return { ok: true };
      },
    });

    expect(ok).toBe(true);
    expect(urls).toEqual([`${FAKE_BASE}/bot${TOKEN}/sendVoice`]);
  });
});
