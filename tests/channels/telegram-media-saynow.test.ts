/**
 * GK10 — photo/voice must not crash, and sayNow must reach the fake Bot API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/voice/local-whisper.js', () => ({
  localWhisperAvailable: () => false,
  transcribeFile: async () => '',
}));

import { TelegramChannel } from '../../src/channels/telegram/index.js';
import { sendTelegramVoice } from '../../src/sensory/alert.js';
import {
  listenFakeTelegram,
  pushPhotoMessage,
  pushVoiceMessage,
} from '../../_qa/gk10/fake-telegram.mjs';

const TOKEN = '123456:gk10-fake-token';
const QA_HOME_ROOT = path.join(process.cwd(), '_qa', 'gk10', 'home');

async function waitForOutbound(
  base: string,
  predicate: (row: { method?: string; text?: string; caption?: string }) => boolean,
  timeoutMs = 4_000,
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetch(`${base}/_qa/outbound`).then((r) => r.json()) as {
      outbound: Array<{ method?: string; text?: string; caption?: string }>;
    };
    if (payload.outbound.some(predicate)) return payload.outbound;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return (await fetch(`${base}/_qa/outbound`).then((r) => r.json())).outbound;
}

describe('Telegram media and sayNow against the fake Bot API', () => {
  const previous = {
    HOME: process.env.HOME,
    BASE: process.env.TELEGRAM_API_BASE,
    OFFSET: process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR,
    VOICE: process.env.CODEBUDDY_VOICE_TO_TELEGRAM,
    ALERT_TOKEN: process.env.CODEBUDDY_SENSORY_ALERT_TOKEN,
    ALERT_CHAT: process.env.CODEBUDDY_SENSORY_ALERT_CHAT,
    BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  };
  let home: string;
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;
  let channel: TelegramChannel | undefined;

  beforeEach(() => {
    fs.mkdirSync(QA_HOME_ROOT, { recursive: true });
    home = fs.mkdtempSync(path.join(QA_HOME_ROOT, 'media-'));
    process.env.HOME = home;
    process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = home;
  });

  afterEach(async () => {
    await channel?.disconnect();
    channel = undefined;
    await fake?.close();
    fake = undefined;
    restore('HOME', previous.HOME);
    restore('TELEGRAM_API_BASE', previous.BASE);
    restore('CODEBUDDY_TELEGRAM_OFFSET_DIR', previous.OFFSET);
    restore('CODEBUDDY_VOICE_TO_TELEGRAM', previous.VOICE);
    restore('CODEBUDDY_SENSORY_ALERT_TOKEN', previous.ALERT_TOKEN);
    restore('CODEBUDDY_SENSORY_ALERT_CHAT', previous.ALERT_CHAT);
    restore('TELEGRAM_BOT_TOKEN', previous.BOT_TOKEN);
  });

  function restore(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  async function startBot() {
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 5,
      enhancedCommands: false,
    });
    channel.on('error', () => undefined);
    await channel.connect();
    return fake;
  }

  it('answers a voice note with an honest French apology when STT is unavailable', async () => {
    const server = await startBot();
    pushVoiceMessage(server.state);
    const outbound = await waitForOutbound(server.base, (row) =>
      row.method === 'sendMessage' && Boolean(row.text && /transcri/i.test(row.text)),
    );
    const reply = outbound.find((row: { text?: string }) => /transcri/i.test(row.text || ''));
    expect(reply?.text).toMatch(/Je n'ai pas pu transcrire/i);
    expect(JSON.stringify(outbound)).not.toContain(TOKEN);
  });

  it('accepts a photo without crashing and keeps it actionable', async () => {
    const server = await startBot();
    const seen = new Promise<string>((resolve) => {
      channel!.on('message', (message: { content?: string }) => resolve(String(message.content || '')));
    });
    pushPhotoMessage(server.state, { caption: 'Qu’est-ce que c’est ?' });
    await expect(seen).resolves.toBe('Qu’est-ce que c’est ?');
  });

  it('posts a voice note to TELEGRAM_API_BASE using TELEGRAM_BOT_TOKEN as fallback', async () => {
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '4242';

    const ogg = path.join(home, 'saynow.ogg');
    fs.writeFileSync(ogg, Buffer.from('OggS'));

    const sent = await sendTelegramVoice('Annonce GK10', {
      synthesize: async () => ogg,
    });
    expect(sent).toBe(true);

    const outbound = await fetch(`${fake.base}/_qa/outbound`).then((r) => r.json());
    expect(outbound.outbound.some((row: { method?: string }) => row.method === 'sendVoice')).toBe(true);
    expect(JSON.stringify(outbound)).not.toContain(TOKEN);
  });
});
