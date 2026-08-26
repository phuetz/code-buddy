import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentsCommand } from '../../src/commands/intents.js';
import { IntentStore } from '../../src/intents/intent-store.js';
import { logger } from '../../src/utils/logger.js';

describe('buddy intents', () => {
  const previousFlag = process.env.CODEBUDDY_INTENTS;
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'intents-cli-'));
    delete process.env.CODEBUDDY_INTENTS;
    process.exitCode = 0;
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.CODEBUDDY_INTENTS;
    else process.env.CODEBUDDY_INTENTS = previousFlag;
    process.exitCode = 0;
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('fails closed with exit 1 and performs no generation without the env flag', async () => {
    const generate = vi.fn(async () => ({
      title: 'Must not be generated',
      files: [],
      criteria: [{ desc: 'True', cmd: 'true', expectExit: 0 }],
      body: '',
    }));
    const command = createIntentsCommand({ rootDir, generate });
    command.exitOverride();

    await command.parseAsync(['new', 'do something'], { from: 'user' });

    expect(process.exitCode).toBe(1);
    expect(generate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('CODEBUDDY_INTENTS=true'));
    expect(await new IntentStore({ rootDir }).list()).toEqual([]);
  });

  it('exposes every P0 subcommand in Commander help', () => {
    const help = createIntentsCommand({ rootDir }).helpInformation();
    for (const name of ['new', 'list', 'show', 'check', 'drift', 'done', 'archive']) {
      expect(help).toContain(name);
    }
  });

  it('creates and transitions an intent when explicitly enabled', async () => {
    process.env.CODEBUDDY_INTENTS = 'true';
    const store = new IntentStore({ rootDir, idFactory: () => 'cli-contract' });
    const generate = vi.fn(async () => ({
      title: 'CLI contract',
      files: [],
      criteria: [{ desc: 'True', cmd: 'true', expectExit: 0 }],
      body: 'Generated context',
    }));
    await createIntentsCommand({ store, generate })
      .exitOverride()
      .parseAsync(['new', 'make a contract'], { from: 'user' });
    await createIntentsCommand({ store })
      .exitOverride()
      .parseAsync(['done', 'cli-contract'], { from: 'user' });

    expect(generate).toHaveBeenCalledOnce();
    expect(await store.get('cli-contract')).toMatchObject({ status: 'done', title: 'CLI contract' });
  });
});
