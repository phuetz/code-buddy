import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript QA utility has no declaration file.
import { runAllSmokeTests, runSmokeCommand } from '../../scripts/qa/package-install-smoke.mjs';

describe('installed package smoke checks', () => {
  let homeDir: string;
  let binPath: string;
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'package-smoke-test-'));
    binPath = join(homeDir, 'fixture.mjs');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('captures the actual exit and does not inherit credentials or Node options', () => {
    vi.stubEnv('OPENAI_API_KEY', 'parent-fixture-secret');
    vi.stubEnv('NODE_OPTIONS', '--definitely-invalid-node-option');
    writeFileSync(binPath, `process.stdout.write(JSON.stringify({home:process.env.HOME,key:process.env.OPENAI_API_KEY,options:process.env.NODE_OPTIONS})); process.stderr.write('fixture error'); process.exitCode=42;`);
    const result = runSmokeCommand([], { binPath, homeDir });
    expect(result.exitCode).toBe(42);
    expect(JSON.parse(result.stdout)).toEqual({ home: homeDir });
    expect(result.stderr).toBe('fixture error');
  });

  it('bounds a stuck Node process', () => {
    writeFileSync(binPath, 'setInterval(() => {}, 1000);');
    const result = runSmokeCommand([], { binPath, homeDir, timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  it('rejects an executable that exits zero but never prints the expected diagnostics', () => {
    writeFileSync(binPath, "process.stdout.write('not the requested application');");
    expect(runAllSmokeTests({ binPath }).passed).toBe(false);
  });

  it('accepts expected non-zero setup statuses and rejects crashes', () => {
    writeFileSync(binPath, `const a=process.argv.slice(2).join(' ');
const responses={'--version':[0,'2.0.0'],'--help':[0,'Usage: buddy'],'login --help':[0,'Usage: buddy login'],'whoami':[0,'ChatGPT: not connected'],'login --no-browser':[1,'interactive terminal and a browser'],'doctor':[1,'Code Buddy Doctor']};
const [code,text]=responses[a];process.stdout.write(text);process.exitCode=code;`);
    expect(runAllSmokeTests({ binPath }).passed).toBe(true);
    writeFileSync(binPath, "throw new Error('fixture crash');");
    expect(runAllSmokeTests({ binPath }).passed).toBe(false);
  });

  it('returns a failing CLI exit when the package cannot be started', () => {
    const runner = fileURLToPath(new URL('../../scripts/qa/package-install-smoke.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [runner, join(homeDir, 'absent.mjs')], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).passed).toBe(false);
  });
});
