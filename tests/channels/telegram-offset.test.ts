/**
 * GK10 — restart must not re-answer old Telegram updates.
 * lastUpdateId has to survive process death (offset file under HOME).
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelegramChannel } from '../../src/channels/telegram/index.js';
import { listenFakeTelegram, pushTextMessage } from '../../_qa/gk10/fake-telegram.mjs';

const TOKEN = '123456:gk10-fake-token';
const QA_HOME_ROOT = path.join(process.cwd(), '_qa', 'gk10', 'home');

describe('Telegram polling offset persistence', () => {
  const previousHome = process.env.HOME;
  const previousBase = process.env.TELEGRAM_API_BASE;
  let home: string;
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;

  beforeEach(() => {
    fs.mkdirSync(QA_HOME_ROOT, { recursive: true });
    home = fs.mkdtempSync(path.join(QA_HOME_ROOT, 'e3-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = previousBase;
  });

  it('does not re-emit an already handled message after restart', async () => {
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;

    const first = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 5,
      enhancedCommands: false,
    });
    first.on('error', () => undefined);

    const firstMessages: string[] = [];
    const seen = new Promise<void>((resolve) => {
      first.on('message', (message: { content?: string }) => {
        firstMessages.push(String(message.content || ''));
        resolve();
      });
    });

    const second = new TelegramChannel({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
      pollingTimeout: 1,
      enhancedCommands: false,
    });
    second.on('error', () => undefined);
    const secondMessages: string[] = [];
    second.on('message', (message: { content?: string }) => {
      secondMessages.push(String(message.content || ''));
    });

    try {
      await first.connect();
      pushTextMessage(fake.state, { text: 'ne me duplique pas' });
      await seen;
      await first.disconnect();

      expect(firstMessages).toEqual(['ne me duplique pas']);

      await second.connect();
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(secondMessages).toEqual([]);

      const next = new Promise<void>((resolve) => {
        second.on('message', () => resolve());
      });
      pushTextMessage(fake.state, { text: 'nouveau message' });
      await next;
      expect(secondMessages).toEqual(['nouveau message']);
    } finally {
      await first.disconnect();
      await second.disconnect();
    }
  });
});
