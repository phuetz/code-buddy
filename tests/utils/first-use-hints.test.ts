/** P4 (optional part) — first-use hints: shown once per profile, persisted, concurrency-safe, opt-out. */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_USE_HINTS, takeFirstUseHint } from '../../src/utils/first-use-hints.js';

describe('first-use hints (P4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hints-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns the tip once, then never again in the same profile (0600 marker)', () => {
    expect(takeFirstUseHint('message_queued', 'en', dir)).toBe(FIRST_USE_HINTS.message_queued.en);
    expect(takeFirstUseHint('message_queued', 'en', dir)).toBeNull();
    expect(takeFirstUseHint('message_queued', 'fr', dir)).toBeNull();
    expect(takeFirstUseHint('restore_context', 'fr', dir)).toBe(FIRST_USE_HINTS.restore_context.fr);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(dir, 'message_queued')).mode & 0o777).toBe(0o600);
  });

  it('CODEBUDDY_HINTS=off shows nothing and writes nothing; an unwritable profile shows nothing', () => {
    vi.stubEnv('CODEBUDDY_HINTS', 'off');
    expect(takeFirstUseHint('surface_unavailable', 'fr', dir)).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
    vi.unstubAllEnvs();
    const file = path.join(dir, 'not-a-dir');
    fs.writeFileSync(file, '');
    expect(takeFirstUseHint('surface_unavailable', 'fr', file)).toBeNull();
    expect(takeFirstUseHint('surface_unavailable', 'fr', file)).toBeNull();
  });

  it('eight concurrent processes show the tip exactly once', async () => {
    const moduleUrl = JSON.stringify(path.resolve('src/utils/first-use-hints.ts'));
    const script = [
      `import { takeFirstUseHint } from ${moduleUrl};`,
      `const shown = takeFirstUseHint('surface_unavailable', 'en', ${JSON.stringify(dir)});`,
      `process.stdout.write(shown ? 'SHOWN' : 'no');`,
    ].join('\n');
    const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
    const outputs = await Promise.all(Array.from({ length: 8 }, () => new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [tsx, '--eval', script], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => resolve(out));
    })));
    expect(outputs.filter((o) => o === 'SHOWN')).toHaveLength(1);
    expect(outputs.filter((o) => o === 'no')).toHaveLength(7);
  }, 60_000);
});
