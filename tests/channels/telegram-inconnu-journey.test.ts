/**
 * GK10 — stranger journey against the local fake Bot API + local Ollama.
 * HOME stays inside the clone. api.telegram.org is never contacted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/voice/local-whisper.js', () => ({
  localWhisperAvailable: () => false,
  transcribeFile: async () => '',
}));
import {
  __resetChannelAIHandlerForTests,
  startConfiguredChannels,
} from '../../src/commands/handlers/channel-handlers.js';
import { getChannelManager, resetChannelManager } from '../../src/channels/index.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import {
  listenFakeTelegram,
  pushPhotoMessage,
  pushTextMessage,
  pushVoiceMessage,
} from '../../_qa/gk10/fake-telegram.mjs';
import { sendTelegramVoice } from '../../src/sensory/alert.js';

const TOKEN = '123456:gk10-fake-token';
const MODEL = 'qwen2.5:1.5b-instruct';
const QA_HOME_ROOT = path.join(process.cwd(), '_qa', 'gk10', 'home');

async function ollamaReady(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json() as { models?: Array<{ name?: string }> };
    return (body.models ?? []).some((model) => model.name?.startsWith(MODEL));
  } catch {
    return false;
  }
}

async function readOutbound(base: string): Promise<Array<{ method?: string; text?: string }>> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const payload = await fetch(`${base}/_qa/outbound`).then((r) => r.json()) as {
        outbound: Array<{ method?: string; text?: string }>;
      };
      return payload.outbound;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return [];
}

async function waitForOutbound(
  base: string,
  predicate: (row: { method?: string; text?: string }) => boolean,
  timeoutMs: number,
) {
  const started = Date.now();
  let outbound: Array<{ method?: string; text?: string }> = [];
  while (Date.now() - started < timeoutMs) {
    outbound = await readOutbound(base);
    if (outbound.some(predicate)) return outbound;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return outbound;
}

describe('GK10 stranger Telegram journey', () => {
  const previous = { ...process.env };
  let home: string;
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;

  beforeEach(() => {
    fs.mkdirSync(QA_HOME_ROOT, { recursive: true });
    home = fs.mkdtempSync(path.join(QA_HOME_ROOT, 'journey-'));
    process.env.HOME = home;
    process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = home;
    process.env.CODEBUDDY_DISABLE_MCP = 'true';
    process.env.CODEBUDDY_PROVIDER = 'ollama';
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    process.env.CODEBUDDY_PEER_MODEL = MODEL;
    process.env.CODEBUDDY_CHANNEL_CONVERSATION = 'false';
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
    __resetChannelAIHandlerForTests();
    getPermissionModeManager().setMode('plan');
  });

  afterEach(async () => {
    await getChannelManager().disconnectAll().catch(() => undefined);
    resetChannelManager();
    __resetChannelAIHandlerForTests();
    await fake?.close();
    fake = undefined;
    for (const key of ['HOME', 'CODEBUDDY_TELEGRAM_OFFSET_DIR', 'CODEBUDDY_DISABLE_MCP', 'CODEBUDDY_PROVIDER', 'OLLAMA_HOST', 'CODEBUDDY_PEER_MODEL', 'CODEBUDDY_CHANNEL_CONVERSATION', 'TELEGRAM_API_BASE', 'TELEGRAM_BOT_TOKEN', 'CODEBUDDY_CHANNEL_CONFIG', 'CODEBUDDY_VOICE_TO_TELEGRAM', 'CODEBUDDY_SENSORY_ALERT_CHAT']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('configures from the documented env, answers text via Ollama, runs /help, handles photo/voice, and does not duplicate after restart', async () => {
    if (!await ollamaReady()) {
      throw new Error(`Ollama local model ${MODEL} is required for GK10`);
    }
    await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt: 'pong',
        stream: false,
        options: { num_predict: 4 },
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);

    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    process.env.CODEBUDDY_SENSORY_ALERT_CHAT = '4242';

    const configPath = path.join(home, 'channels.json');
    fs.writeFileSync(configPath, JSON.stringify({
      channels: [{
        type: 'telegram',
        enabled: true,
        token: TOKEN,
        options: { model: MODEL, pollingTimeout: 2 },
      }],
    }), 'utf8');
    process.env.CODEBUDDY_CHANNEL_CONFIG = configPath;

    const started = await startConfiguredChannels(configPath, 'telegram');
    expect(started.registered).toEqual(['telegram']);
    expect(started.failed).toEqual([]);

    pushTextMessage(fake.state, { text: 'Réponds uniquement par le mot PONG.' });
    const afterText = await waitForOutbound(
      fake.base,
      (row) => row.method === 'sendMessage' && Boolean(row.text && row.text.trim().length > 0 && !row.text.startsWith('/')),
      150_000,
    );
    const llmReply = afterText.find((row) => row.method === 'sendMessage' && (row.text || '').trim() && !row.text?.startsWith('/'));
    if (!llmReply?.text?.trim()) {
      const journal = await fetch(`${fake.base}/_qa/log`).then((r) => r.json()).catch(() => null);
      throw new Error(`no LLM Telegram reply after 150s outbound=${JSON.stringify(afterText)} journal=${JSON.stringify(journal)}`);
    }

    pushTextMessage(fake.state, { text: '/help' });
    const afterHelp = await waitForOutbound(
      fake.base,
      (row) => Boolean(row.text?.includes('/repo')),
      8_000,
    );
    expect(afterHelp.some((row) => row.text?.includes('/repo'))).toBe(true);

    pushTextMessage(fake.state, { text: '/pins' });
    const afterPins = await waitForOutbound(
      fake.base,
      (row) => Boolean(row.text?.toLowerCase().includes('pin')),
      8_000,
    );
    expect(afterPins.some((row) => row.text?.toLowerCase().includes('pin'))).toBe(true);

    pushPhotoMessage(fake.state, { caption: 'Analyse cette photo.' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    pushVoiceMessage(fake.state);
    const afterVoice = await waitForOutbound(
      fake.base,
      (row) => Boolean(row.text && /transcri/i.test(row.text)),
      15_000,
    );
    expect(afterVoice.some((row) => /transcri/i.test(row.text || ''))).toBe(true);

    const ogg = path.join(home, 'journey-voice.ogg');
    fs.writeFileSync(ogg, Buffer.from('OggS'));
    await sendTelegramVoice('Annonce GK10', { synthesize: async () => ogg });
    const afterVoiceNote = { outbound: await readOutbound(fake.base) };
    expect(afterVoiceNote.outbound.some((row) => row.method === 'sendVoice')).toBe(true);

    const pingCountBeforeRestart = afterVoiceNote.outbound.filter(
      (row) => row.text === llmReply?.text,
    ).length;

    await getChannelManager().disconnectAll();
    resetChannelManager();
    __resetChannelAIHandlerForTests();

    const restarted = await startConfiguredChannels(configPath, 'telegram');
    expect(restarted.registered).toEqual(['telegram']);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const afterRestart = await readOutbound(fake.base);
    const pingCountAfterRestart = afterRestart.filter((row) => row.text === llmReply?.text).length;
    expect(pingCountAfterRestart).toBe(pingCountBeforeRestart);

    expect(JSON.stringify(afterRestart)).not.toContain(TOKEN);
  }, 240_000);
});
