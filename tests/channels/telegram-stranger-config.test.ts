/**
 * GK10 — documented stranger path: TELEGRAM_BOT_TOKEN, settings.json object
 * shape, and `buddy --channel telegram`. HOME is a clone-local directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetChannelAIHandlerForTests,
  loadChannelConfig,
  startConfiguredChannels,
} from '../../src/commands/handlers/channel-handlers.js';
import { getChannelManager, resetChannelManager } from '../../src/channels/index.js';
import { listenFakeTelegram } from '../../_qa/gk10/fake-telegram.mjs';

const TOKEN = '123456:gk10-fake-token';
const QA_HOME_ROOT = path.join(process.cwd(), '_qa', 'gk10', 'home');

function runCliHelp(): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';
  env.CODEBUDDY_DISABLE_MCP = 'true';
  env.CI = '1';
  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/tsx/dist/cli.mjs'), 'src/index.ts', '--help'],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });
}

describe('documented Telegram setup for a stranger', () => {
  const previousHome = process.env.HOME;
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousBase = process.env.TELEGRAM_API_BASE;
  const previousChannelConfig = process.env.CODEBUDDY_CHANNEL_CONFIG;
  let home: string;
  let fake: Awaited<ReturnType<typeof listenFakeTelegram>> | undefined;

  beforeEach(() => {
    fs.mkdirSync(QA_HOME_ROOT, { recursive: true });
    home = fs.mkdtempSync(path.join(QA_HOME_ROOT, 'e2-'));
    process.env.HOME = home;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.CODEBUDDY_CHANNEL_CONFIG;
    __resetChannelAIHandlerForTests();
  });

  afterEach(async () => {
    await getChannelManager().disconnectAll().catch(() => undefined);
    resetChannelManager();
    __resetChannelAIHandlerForTests();
    await fake?.close();
    fake = undefined;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = previousBase;
    if (previousChannelConfig === undefined) delete process.env.CODEBUDDY_CHANNEL_CONFIG;
    else process.env.CODEBUDDY_CHANNEL_CONFIG = previousChannelConfig;
  });

  it('reads TELEGRAM_BOT_TOKEN when no channels.json exists', () => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    const config = loadChannelConfig();
    expect(config?.channels).toEqual([
      expect.objectContaining({ type: 'telegram', enabled: true, token: TOKEN }),
    ]);
  });

  it('loads the documented .codebuddy/settings.json object shape', () => {
    const dir = path.join(home, '.codebuddy');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
      channels: {
        telegram: {
          type: 'telegram',
          token: TOKEN,
          adminUsers: ['4242'],
        },
      },
    }), 'utf8');

    const config = loadChannelConfig();
    expect(config?.channels).toHaveLength(1);
    expect(config?.channels[0]).toMatchObject({
      type: 'telegram',
      enabled: true,
      token: TOKEN,
    });
    expect(config?.channels[0]?.options).toMatchObject({ adminUsers: ['4242'] });
  });

  it('starts Telegram from TELEGRAM_BOT_TOKEN against the local fake Bot API', async () => {
    fake = await listenFakeTelegram({ token: TOKEN, port: 0 });
    process.env.TELEGRAM_API_BASE = fake.base;
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;

    const result = await startConfiguredChannels(undefined, 'telegram');
    expect(result.noConfig).toBe(false);
    expect(result.failed).toEqual([]);
    expect(result.registered).toEqual(['telegram']);

    const log = await fetch(`${fake.base}/_qa/log`).then((r) => r.json());
    expect(log.journal.some((row: { apiMethod?: string }) => row.apiMethod === 'getMe')).toBe(true);
    expect(JSON.stringify(log)).not.toContain(TOKEN);
  });
});

describe('buddy --channel help (documented start flag)', () => {
  it('advertises --channel <name> on the root CLI', async () => {
    const result = await runCliHelp();
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/--channel <name>/);
    expect(text.toLowerCase()).toMatch(/messaging channel/);
  }, 25_000);
});
