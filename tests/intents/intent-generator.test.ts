import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildIntentGeneratorSystemPrompt,
  generateIntent,
} from '../../src/intents/intent-generator.js';

describe('generateIntent', () => {
  it('normalizes a valid one-shot LLM JSON response', async () => {
    const chat = vi.fn(async () => JSON.stringify({
      title: 'Add focused coverage',
      files: ['src/login.ts', 'tests/login.test.ts'],
      criteria: [
        {
          desc: 'Focused login tests pass',
          cmd: 'npm test -- tests/login.test.ts',
          expectExit: 0,
        },
      ],
    }));

    const generated = await generateIntent('Cover the login regression', {}, { chat });
    expect(generated).toMatchObject({
      title: 'Add focused coverage',
      files: ['src/login.ts', 'tests/login.test.ts'],
      criteria: [{ expectExit: 0 }],
    });
    expect(generated.body).toContain('Cover the login regression');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]?.[0]).toContain('falsifiable');
  });

  it('retries invalid JSON once, then returns a clear error without leaking a parser crash', async () => {
    const chat = vi.fn(async () => 'not-json-at-all');
    await expect(generateIntent('Describe a contract', {}, { chat })).rejects.toThrow(
      /^Unable to generate a valid intent:/,
    );
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1]?.[1]).toContain('previously returned an invalid JSON');
  });

  it('uses the JSON repair retry to recover a valid second response', async () => {
    const chat = vi
      .fn<(system: string, user: string) => Promise<string>>()
      .mockResolvedValueOnce('{ invalid')
      .mockResolvedValueOnce(JSON.stringify({
        title: 'Recovered contract',
        files: [],
        criteria: [{ desc: 'True stays true', cmd: 'true', expectExit: 0 }],
      }));

    await expect(generateIntent('Recover this', {}, { chat })).resolves.toMatchObject({
      title: 'Recovered contract',
    });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('documents non-interactive, no-sudo shell criteria in the model contract', () => {
    const prompt = buildIntentGeneratorSystemPrompt();
    expect(prompt).toContain('non-interactive');
    expect(prompt).toContain('no sudo');
    expect(prompt).toContain('expectExit');
  });

  it('grounds the contract in the repository test runner, never another ecosystem', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cb-intent-repo-'));
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' } }),
      );
      const prompt = buildIntentGeneratorSystemPrompt(repo);
      expect(prompt).toContain('Test runner: vitest');
      expect(prompt).toContain('Available npm scripts: test, typecheck');
      expect(prompt).toContain('no pytest');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('falls back to the general contract when the repository has no package.json', () => {
    const empty = mkdtempSync(join(tmpdir(), 'cb-intent-empty-'));
    try {
      const prompt = buildIntentGeneratorSystemPrompt(empty);
      expect(prompt).not.toContain('THIS repository');
      expect(prompt).toContain('Include at least one criterion.');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
