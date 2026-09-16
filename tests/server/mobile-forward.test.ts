import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { mobilePwaRouter } from '../../src/server/mobile/index.js';
import {
  forwardMobileTextToTelegram,
  isTelegramForwardConfigured,
} from '../../src/server/mobile/telegram-forward.js';

describe('mobile Telegram forward (lot 1)', () => {
  const previousToken = process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  const previousChat = process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  const previousBot = process.env.TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (previousToken === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    else process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    else process.env.CODEBUDDY_SENSORY_ALERT_CHAT = previousChat;
    if (previousBot === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousBot;
  });

  it('is hidden when the alert channel is unset', () => {
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(isTelegramForwardConfigured()).toBe(false);
  });

  it('returns 404 without calling send when Telegram is not configured', async () => {
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const send = async () => {
      throw new Error('should not send');
    };
    const result = await forwardMobileTextToTelegram('hello', { send });
    expect(result).toEqual({ ok: false, status: 404, error: 'Telegram not configured' });
  });

  it('forwards trimmed text through the injected transport', async () => {
    process.env.CODEBUDDY_SENSORY_ALERT_TOKEN = 'tok';
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = 'chat';
    const seen: string[] = [];
    const result = await forwardMobileTextToTelegram('  bonjour  ', {
      send: async (caption) => {
        seen.push(caption);
        return true;
      },
    });
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(['bonjour']);
  });

  it('POST /forward answers 404 when the channel is absent (loopback)', async () => {
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const app = express();
    app.use('/__codebuddy__/mobile', mobilePwaRouter);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected a TCP port');
      const res = await fetch(`http://127.0.0.1:${address.port}/__codebuddy__/mobile/forward`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
