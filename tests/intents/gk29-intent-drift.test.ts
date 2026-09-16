import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntentsCommand } from '../../src/commands/intents.js';
import { IntentStore } from '../../src/intents/intent-store.js';
import { logger } from '../../src/utils/logger.js';

describe('GK29 intent ledger drift', () => {
  let rootDir: string;
  let previousFlag: string | undefined;
  const infos: string[] = [];
  const errors: string[] = [];

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'gk29-intents-'));
    previousFlag = process.env.CODEBUDDY_INTENTS;
    process.env.CODEBUDDY_INTENTS = 'true';
    process.exitCode = 0;
    infos.length = 0;
    errors.length = 0;
    vi.spyOn(logger, 'info').mockImplementation((message: unknown) => {
      infos.push(String(message ?? ''));
      return logger;
    });
    vi.spyOn(logger, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message ?? ''));
      return logger;
    });
    await mkdir(path.join(rootDir, 'tests'), { recursive: true });
    await writeFile(path.join(rootDir, 'sum.js'), 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n');
    await writeFile(
      path.join(rootDir, 'tests/sum.test.js'),
      "const { test } = require('node:test');\nconst assert = require('node:assert/strict');\nconst { add } = require('../sum.js');\ntest('add', () => { assert.equal(add(1, 2), 3); });\n",
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (previousFlag === undefined) delete process.env.CODEBUDDY_INTENTS;
    else process.env.CODEBUDDY_INTENTS = previousFlag;
    process.exitCode = 0;
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('fails closed without the env var and reports drift when a done criterion breaks', async () => {
    delete process.env.CODEBUDDY_INTENTS;
    const generate = vi.fn(async () => ({
      title: 'Must not run',
      files: ['sum.js'],
      criteria: [{ desc: 'add test passes', cmd: 'node --test tests/sum.test.js', expectExit: 0 }],
    }));
    await createIntentsCommand({ rootDir, generate })
      .exitOverride()
      .parseAsync(['new', 'the add test passes'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(generate).not.toHaveBeenCalled();
    expect(existsSync(path.join(rootDir, '.codebuddy', 'intents'))).toBe(false);

    process.env.CODEBUDDY_INTENTS = 'true';
    process.exitCode = 0;
    const store = new IntentStore({
      rootDir,
      idFactory: () => 'add-test-passes',
    });
    await createIntentsCommand({
      store,
      generate: async () => ({
        title: 'The add test passes',
        files: ['sum.js', 'tests/sum.test.js'],
        criteria: [{ desc: 'add test passes', cmd: 'node --test tests/sum.test.js', expectExit: 0 }],
      }),
    })
      .exitOverride()
      .parseAsync(['new', 'the add test passes'], { from: 'user' });

    await createIntentsCommand({ store })
      .exitOverride()
      .parseAsync(['check', 'add-test-passes'], { from: 'user' });
    expect(process.exitCode).toBe(0);
    expect(infos.some((line) => line.includes('Intent add-test-passes: PASS'))).toBe(true);

    await createIntentsCommand({ store })
      .exitOverride()
      .parseAsync(['done', 'add-test-passes'], { from: 'user' });

    await writeFile(path.join(rootDir, 'sum.js'), 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n');
    process.exitCode = 0;
    errors.length = 0;
    await createIntentsCommand({ store })
      .exitOverride()
      .parseAsync(['drift'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/DRIFT/);
    expect(errors.join('\n')).toMatch(/add test passes/);
    const ledger = await readFile(path.join(rootDir, '.codebuddy', 'intents', 'ledger.jsonl'), 'utf8');
    expect(ledger).toMatch(/"type":"drifted"/);
  });
});
