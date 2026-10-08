/**
 * Le sidecar ne doit jamais empêcher la sortie du processus (défaut 04/10/2026 :
 * `buddy research ingest` ne se terminait jamais, enfant buddy-memory vivant).
 * Tests sur de VRAIS processus Node, avec un faux sidecar JSON-RPC.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const runner = join(root, 'tests', 'memory', 'fixtures', 'client-runner.mjs');
const fake = join(root, 'tests', 'memory', 'fixtures', 'fake-sidecar.mjs');

function makeBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bm-exit-'));
  const bin = join(dir, 'buddy-memory');
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function run(env: Record<string, string>, limitMs: number) {
  return new Promise<{ code: number | null; out: string; timedOut: boolean; ms: number }>((res) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ['--import', 'tsx', runner], {
      cwd: root,
      env: { ...process.env, LEDGER: join(tmpdir(), 'bm-exit-ledger.jsonl'), CODEBUDDY_BUDDY_MEMORY_BIN: makeBin(), ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGKILL');
    }, limitMs);
    p.on('exit', (code) => {
      clearTimeout(timer);
      res({ code, out, timedOut, ms: Date.now() - t0 });
    });
  });
}

describe('BuddyMemoryClient : sortie du processus', () => {
  it('sort seul (sans close) après un appel', async () => {
    const r = await run({}, 15_000);
    expect(r.out).toContain('RESULT {"ok":true');
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
  }, 20_000);

  it('une requête lente en cours n\'est pas coupée par le unref', async () => {
    const r = await run({ FAKE_DELAY_MS: '1500' }, 15_000);
    expect(r.out).toContain('RESULT {"ok":true');
    expect(r.code).toBe(0);
    expect(r.ms).toBeGreaterThanOrEqual(1500);
  }, 20_000);

  it('close() explicite sort aussi', async () => {
    const r = await run({ CLOSE: '1' }, 15_000);
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
  }, 20_000);
});
