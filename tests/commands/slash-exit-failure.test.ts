/**
 * Échecs slash qui sortaient encore en succès headless.
 * Ces tests appellent les gestionnaires. Ils ne lancent pas la CLI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/config-mutator.js', () => ({
  setConfigValue: vi.fn(),
  setConfigBatch: vi.fn(),
}));

vi.mock('../../src/utils/config-validator.js', () => ({
  handleConfigValidateCommand: vi.fn(),
  getZodConfigValidator: vi.fn(),
  ZOD_SCHEMAS: {},
}));

import { setConfigBatch, setConfigValue } from '../../src/config/config-mutator.js';
import { handleConfigValidateCommand } from '../../src/utils/config-validator.js';
import { handleFCS } from '../../src/commands/handlers/fcs-handlers.js';
import { handleScript } from '../../src/commands/handlers/script-handlers.js';
import { handleTrigger } from '../../src/commands/handlers/trigger-handlers.js';
import { handleConfig } from '../../src/commands/handlers/vibe-handlers.js';
import { handleWorktree } from '../../src/commands/handlers/worktree-handlers.js';

const TYPE_ERROR = 'Type mismatch for "middleware.max_turns": Expected number, got non-numeric string "not-a-number"';

function textOf(result: { entry?: { content?: string } }): string {
  return result.entry?.content ?? '';
}

describe('échecs slash signalés au processus headless', () => {
  beforeEach(() => {
    vi.mocked(setConfigValue).mockReset();
    vi.mocked(setConfigBatch).mockReset();
    vi.mocked(handleConfigValidateCommand).mockReset();
  });

  it('/config set --json --dry-run : type refusé, failed et success false', async () => {
    vi.mocked(setConfigValue).mockResolvedValue({
      success: false,
      key: 'middleware.max_turns',
      oldValue: 100,
      newValue: 'not-a-number',
      dryRun: true,
      error: TYPE_ERROR,
    });
    const result = await handleConfig(['set', '--json', '--dry-run', 'middleware.max_turns', 'not-a-number']);
    const text = textOf(result);
    expect(text, text).toContain('"success": false');
    expect(result.failed, text).toBe(true);
    expect(text, text).toContain('Type mismatch');
    expect(vi.mocked(setConfigValue).mock.calls[0]?.[2]).toEqual({ dryRun: true, json: true });
  });

  it('/config set --dry-run sans --json : le même type refusé pose failed', async () => {
    vi.mocked(setConfigValue).mockResolvedValue({
      success: false,
      key: 'middleware.max_turns',
      oldValue: 100,
      newValue: 'not-a-number',
      dryRun: true,
      error: TYPE_ERROR,
    });
    const result = await handleConfig(['set', '--dry-run', 'middleware.max_turns', 'not-a-number']);
    const text = textOf(result);
    expect(text, text).toContain('Config Set Failed');
    expect(text, text).toContain(TYPE_ERROR);
    expect(result.failed, text).toBe(true);
  });

  it('/config set --json [] : batch vide refusé, aucune écriture', async () => {
    vi.mocked(setConfigBatch).mockResolvedValue([]);
    const result = await handleConfig(['set', '--json', '[]']);
    const text = textOf(result);
    expect(result.failed, text).toBe(true);
    expect(text, text).toContain('non-empty object');
    expect(vi.mocked(setConfigBatch)).not.toHaveBeenCalled();
  });

  it('/config set --json {} : objet vide refusé', async () => {
    vi.mocked(setConfigBatch).mockResolvedValue([]);
    const result = await handleConfig(['set', '--json', '{}']);
    const text = textOf(result);
    expect(result.failed, text).toBe(true);
    expect(text, text).toContain('non-empty object');
    expect(vi.mocked(setConfigBatch)).not.toHaveBeenCalled();
  });

  it('/config validate : un rapport [ERROR] pose failed', async () => {
    vi.mocked(handleConfigValidateCommand).mockResolvedValue(
      '[ERROR] Configuration validation failed\n',
    );
    const result = await handleConfig(['validate']);
    const text = textOf(result);
    expect(text, text).toContain('[ERROR] Configuration validation failed');
    expect(result.failed, text).toBe(true);
  });

  it('/config validate : un rapport valide ne pose pas failed', async () => {
    vi.mocked(handleConfigValidateCommand).mockResolvedValue(
      '[OK] All configuration files are valid\n',
    );
    const result = await handleConfig(['validate']);
    expect(result.failed, textOf(result)).toBeUndefined();
  });

  it('/trigger add sans --source : failed et le message exact', async () => {
    const result = await handleTrigger(['add']);
    const text = textOf(result);
    expect(text, text).toBe('Error: --source is required (github, gitlab, slack, linear, pagerduty, generic)');
    expect(result.failed, text).toBe(true);
  });

  it('/worktree add sans chemin : failed et Usage', () => {
    const result = handleWorktree(['add']);
    const text = textOf(result);
    expect(text, text).toContain('Usage: /worktree add <path> [branch]');
    expect(result.failed, text).toBe(true);
  });

  it('/worktree sans action : l aide reste un succès', () => {
    const result = handleWorktree([]);
    const text = textOf(result);
    expect(text, text).toContain('Git Worktrees');
    expect(result.failed, text).toBeUndefined();
  });

  it('/script run fichier absent : failed et Script not found, sans promesse', () => {
    const result = handleScript(['run', 'slash-exit-missing.bs']);
    expect(result, 'le fichier absent ne doit pas être une promesse').not.toBeInstanceOf(Promise);
    if (result instanceof Promise) return;
    const text = textOf(result);
    expect(text, text).toContain('Script not found:');
    expect(text, text).toContain('slash-exit-missing.bs');
    expect(result.failed, text).toBe(true);
  });

  it('/script run headless : throw pose failed et le message, sans attente longue', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-exit-script-'));
    const file = path.join(dir, 'bad.bs');
    fs.writeFileSync(file, 'throw "slash-exit-boom"\n');
    const previousHeadless = process.env.CODEBUDDY_HEADLESS;
    const previousTimeout = process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS;
    process.env.CODEBUDDY_HEADLESS = 'true';
    process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS = '1000';
    try {
      const started = Date.now();
      const raced = await Promise.race([
        handleScript(['run', file]),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('attente non bornee')), 2000);
          timer.unref();
        }),
      ]);
      const text = textOf(raced);
      expect(raced.failed, text).toBe(true);
      expect(text, text).toContain('slash-exit-boom');
      expect(Date.now() - started, text).toBeLessThan(2000);
    } finally {
      if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
      else process.env.CODEBUDDY_HEADLESS = previousHeadless;
      if (previousTimeout === undefined) delete process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS;
      else process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS = previousTimeout;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('/script run headless : une boucle infinie échoue avant une seconde', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slash-exit-loop-'));
    const file = path.join(dir, 'loop.bs');
    fs.writeFileSync(file, 'while true {\n  let x = 1\n}\n');
    const previousHeadless = process.env.CODEBUDDY_HEADLESS;
    const previousTimeout = process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS;
    process.env.CODEBUDDY_HEADLESS = 'true';
    process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS = '200';
    try {
      const started = Date.now();
      const raced = await Promise.race([
        handleScript(['run', file]),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('attente non bornee')), 1000);
          timer.unref();
        }),
      ]);
      const text = textOf(raced);
      expect(raced.failed, text).toBe(true);
      expect(text, text).toMatch(/timed out|timeout/i);
      expect(Date.now() - started, text).toBeLessThan(1000);
    } finally {
      if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
      else process.env.CODEBUDDY_HEADLESS = previousHeadless;
      if (previousTimeout === undefined) delete process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS;
      else process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS = previousTimeout;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('/fcs run fichier absent : failed', () => {
    const result = handleFCS(['run', 'slash-exit-missing.fcs']);
    expect(result, 'le fichier absent ne doit pas être une promesse').not.toBeInstanceOf(Promise);
    if (result instanceof Promise) return;
    const text = textOf(result);
    expect(text, text).toContain('Script not found:');
    expect(result.failed, text).toBe(true);
  });
});
