/**
 * GK10 — /help and other BotFather-advertised commands must answer locally,
 * not fall through as opaque LLM prompts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import { listenFakeTelegram, pushTextMessage } from '../../_qa/gk10/fake-telegram.mjs';

const TOKEN = '123456:gk10-fake-token';

async function waitForOutbound(
  base: string,
  predicate: (row: { method?: string; text?: string }) => boolean,
  timeoutMs = 3_000,
): Promise<Array<{ method?: string; text?: string }>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetch(`${base}/_qa/outbound`).then((r) => r.json()) as {
      outbound: Array<{ method?: string; text?: string }>;
    };
    if (payload.outbound.some(predicate)) return payload.outbound;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const payload = await fetch(`${base}/_qa/outbound`).then((r) => r.json()) as {
    outbound: Array<{ method?: string; text?: string }>;
  };
  return payload.outbound;
}

describe('Telegram documented slash commands', () => {
  const previousBase = process.env.TELEGRAM_API_BASE;
  const previousHome = process.env.HOME;
  const previousOffsetDir = process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR;
  const qaHomeRoot = path.join(process.cwd(), '_qa', 'gk10', 'home');
  let home: string;
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;
  let channel: TelegramChannel | undefined;

  beforeEach(() => {
    fs.mkdirSync(qaHomeRoot, { recursive: true });
    home = fs.mkdtempSync(path.join(qaHomeRoot, 'e4-'));
    process.env.HOME = home;
    process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = home;
  });

  afterEach(async () => {
    await channel?.disconnect();
    channel = undefined;
    await fake?.close();
    fake = undefined;
    if (previousBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = previousBase;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousOffsetDir === undefined) delete process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR;
    else process.env.CODEBUDDY_TELEGRAM_OFFSET_DIR = previousOffsetDir;
  });

  async function startBot() {
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    channel = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 5,
    });
    channel.on('error', () => undefined);
    await channel.connect();
    return fake;
  }

  it('answers /help with the advertised command list', async () => {
    const server = await startBot();
    const llmFallback = vi.fn();
    channel!.on('message', llmFallback);

    pushTextMessage(server.state, { text: '/help' });
    const outbound = await waitForOutbound(server.base, (row) =>
      row.method === 'sendMessage' && Boolean(row.text?.includes('/repo')),
    );

    const help = outbound.find((row) => row.method === 'sendMessage' && row.text?.includes('/repo'));
    expect(help?.text).toMatch(/\/help/i);
    expect(help?.text).toMatch(/\/repo/);
    expect(help?.text).toMatch(/\/status/);
    expect(llmFallback).not.toHaveBeenCalled();
  });

  it('answers /pins and /status without involving the LLM path', async () => {
    const server = await startBot();
    const llmFallback = vi.fn();
    channel!.on('message', llmFallback);

    pushTextMessage(server.state, { text: '/pins' });
    await waitForOutbound(server.base, (row) =>
      row.method === 'sendMessage' && Boolean(row.text?.toLowerCase().includes('pin')),
    );

    pushTextMessage(server.state, { text: '/status' });
    const outbound = await waitForOutbound(server.base, (row) =>
      row.method === 'sendMessage' && Boolean(row.text?.toLowerCase().includes('online')),
    );

    expect(outbound.some((row) => row.text?.toLowerCase().includes('pin'))).toBe(true);
    expect(outbound.some((row) => row.text?.toLowerCase().includes('online'))).toBe(true);
    expect(llmFallback).not.toHaveBeenCalled();
  });
});
