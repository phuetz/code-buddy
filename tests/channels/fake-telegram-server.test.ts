/**
 * GK10 — local fake Telegram Bot API.
 * These tests speak HTTP to 127.0.0.1 only. They must never call api.telegram.org.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import {
  listenFakeTelegram,
  pushTextMessage,
} from '../../_qa/gk10/fake-telegram.mjs';

const TOKEN = '123456:gk10-fake-token';

describe('fake Telegram Bot API (_qa/gk10/fake-telegram.mjs)', () => {
  const previousBase = process.env.TELEGRAM_API_BASE;
  const previousHome = process.env.HOME;
  const previousOffsetDir = process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR;
  const qaHomeRoot = path.join(process.cwd(), '_qa', 'gk10', 'home');
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;
  let originalFetch: typeof fetch;

  afterEach(async () => {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (previousBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = previousBase;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousOffsetDir === undefined) delete process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR;
    else process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = previousOffsetDir;
    await fake?.close();
    fake = undefined;
  });

  async function start() {
    originalFetch = globalThis.fetch;
    fs.mkdirSync(qaHomeRoot, { recursive: true });
    const home = fs.mkdtempSync(path.join(qaHomeRoot, 'fake-'));
    process.env.HOME = home;
    process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = home;
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    return fake;
  }

  it('implements getMe, sendMessage, sendVoice, sendPhoto, answerCallbackQuery', async () => {
    const server = await start();
    const botUrl = `${server.base}/bot${TOKEN}`;

    const me = await fetch(`${botUrl}/getMe`, { method: 'POST' }).then((r) => r.json());
    expect(me).toMatchObject({ ok: true, result: { is_bot: true, username: 'lisa_gk10_bot' } });

    const sent = await fetch(`${botUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: 4242, text: 'bonjour' }),
    }).then((r) => r.json());
    expect(sent.ok).toBe(true);
    expect(sent.result.text).toBe('bonjour');

    const voiceForm = new FormData();
    voiceForm.append('chat_id', '4242');
    voiceForm.append('voice', new Blob([Buffer.from('OggS')], { type: 'audio/ogg' }), 'note.ogg');
    const voice = await fetch(`${botUrl}/sendVoice`, { method: 'POST', body: voiceForm }).then((r) => r.json());
    expect(voice.ok).toBe(true);

    const photoForm = new FormData();
    photoForm.append('chat_id', '4242');
    photoForm.append('photo', new Blob([Buffer.from([0xff, 0xd8])], { type: 'image/jpeg' }), 'shot.jpg');
    const photo = await fetch(`${botUrl}/sendPhoto`, { method: 'POST', body: photoForm }).then((r) => r.json());
    expect(photo.ok).toBe(true);

    const callback = await fetch(`${botUrl}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: 'cb-1' }),
    }).then((r) => r.json());
    expect(callback).toEqual({ ok: true, result: true });

    const outbound = await fetch(`${server.base}/_qa/outbound`).then((r) => r.json());
    expect(outbound.outbound.map((row: { method: string }) => row.method)).toEqual([
      'sendMessage',
      'sendVoice',
      'sendPhoto',
      'answerCallbackQuery',
    ]);

    const log = await fetch(`${server.base}/_qa/log`).then((r) => r.json());
    const dumped = JSON.stringify(log);
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).toContain('<redacted-token>');
    expect(dumped).not.toContain('api.telegram.org');
  });

  it('long-polls getUpdates until a message is pushed, then honours offset', async () => {
    const server = await start();
    const botUrl = `${server.base}/bot${TOKEN}`;

    const pending = fetch(`${botUrl}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, timeout: 5 }),
    }).then((r) => r.json());

    await new Promise((resolve) => setTimeout(resolve, 50));
    const pushed = pushTextMessage(server.state, { text: 'premier message' });

    const first = await pending;
    expect(first.ok).toBe(true);
    expect(first.result).toHaveLength(1);
    expect(first.result[0].message.text).toBe('premier message');
    expect(first.result[0].update_id).toBe(pushed.update_id);

    const ack = await fetch(`${botUrl}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: pushed.update_id + 1, timeout: 0 }),
    }).then((r) => r.json());
    expect(ack.result).toEqual([]);
  });

  it('lets TelegramChannel connect and send through TELEGRAM_API_BASE', async () => {
    const server = await start();
    const channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 1,
      enhancedCommands: false,
    });
    channel.on('error', () => undefined);

    await channel.connect();
    expect(channel.getStatus().connected).toBe(true);
    expect(channel.getStatus().info?.botUsername).toBe('lisa_gk10_bot');

    const result = await channel.send({ channelId: '4242', content: 'réponse Lisa' });
    expect(result.success).toBe(true);

    await channel.disconnect();

    const outbound = await fetch(`${server.base}/_qa/outbound`).then((r) => r.json());
    expect(outbound.outbound.some((row: { text?: string }) => row.text === 'réponse Lisa')).toBe(true);

    const log = await fetch(`${server.base}/_qa/log`).then((r) => r.json());
    expect(JSON.stringify(log)).not.toContain(TOKEN);
    expect(log.journal.some((row: { apiMethod?: string }) => row.apiMethod === 'getMe')).toBe(true);
    expect(log.journal.some((row: { apiMethod?: string }) => row.apiMethod === 'getUpdates')).toBe(true);
  });
});
