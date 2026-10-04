/**
 * Contract test against the REAL `lm-resizer` binary (skipped when absent).
 *
 * Why it exists: the unit tests inject a fake spawn, so they only prove Code
 * Buddy against the contract Code Buddy imagines. On 2026-10-04 the published
 * 0.2.4 rejected `tool-output --request-json` (exit 2) and every fake-based
 * test stayed green. This test drives the real executable end to end.
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyToolOutputHelp,
  optimizeToolOutputWithLmResizer,
  resetLmResizerCircuitBreakers,
  resolveLmResizerBin,
} from '../../src/context/lm-resizer-compressor.js';

const run = promisify(execFile);
const bin = resolveLmResizerBin();
const hasBin = bin.includes('/') && existsSync(bin);

describe.skipIf(!hasBin)('lm-resizer contract (real binary)', () => {
  let dir: string;
  let compatible = false;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lmr-contract-'));
    const help = (await run(bin, ['tool-output', '--help'])).stdout;
    compatible = classifyToolOutputHelp(help) !== 'unsupported';
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  beforeEach(() => resetLmResizerCircuitBreakers());

  it('compresses a 20 000-line log and the original stays recoverable', async () => {
    expect(compatible, `${bin} exposes neither --command nor --request-json`).toBe(true);
    const lines: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      lines.push(i === 10_000
        ? 'ERROR: connexion refusee vers db-7 (code 111)'
        : `2026-10-04T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z INFO worker-${i % 8} requete ok duree=${10 + (i * 7) % 90}ms`);
    }
    const original = `${lines.join('\n')}\n`;
    const store = join(dir, 'ccr.db');

    const result = await optimizeToolOutputWithLmResizer({
      content: original,
      toolName: 'bash',
      // `cat` is deliberately kept literal by lm-resizer; a log reader is filtered.
      command: 'journalctl -u service',
      exitCode: 0,
      minSavingsBytes: 1,
    }, { httpUrl: null, bin, storePath: store, timeoutMs: 30_000 });

    expect(result).not.toBeNull();
    expect(result!.transport).toBe('cli');
    expect(result!.accepted).toBe(true);
    expect(result!.originalBytes).toBe(Buffer.byteLength(original));
    expect(result!.compressedBytes).toBeLessThan(result!.originalBytes / 100);
    expect(result!.compressed).toContain('ERROR: connexion refusee vers db-7');
    expect(result!.hash).toBeTruthy();

    const recovered = await run(bin, ['retrieve', '--store', store, result!.hash!], {
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(recovered.stdout).toBe(original);
  }, 60_000);

  describe('HTTP sidecar (`lm-resizer serve` on a free port, never the robot\'s 8787)', () => {
    let server: ChildProcess | undefined;
    let url = '';

    beforeAll(async () => {
      const port = await new Promise<number>((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
          const { port: free } = probe.address() as { port: number };
          probe.close(() => resolve(free));
        });
      });
      url = `http://127.0.0.1:${port}`;
      server = spawn(bin, ['serve', '--bind', `127.0.0.1:${port}`, '--store', join(dir, 'serve.db')], { stdio: 'ignore' });
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(`${url}/health`)).ok) return;
        } catch { /* not listening yet */ }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('lm-resizer serve did not come up');
    }, 20_000);
    afterAll(() => { server?.kill('SIGTERM'); });

    it('is used although /health carries no capability list (0.2.4: {"ok":true})', async () => {
      const original = JSON.stringify(Array.from({ length: 5_000 }, (_, i) => ({ id: i, name: 'xxxxxxxxxx', status: 'ok', v: i % 3 })));
      const result = await optimizeToolOutputWithLmResizer({
        content: original, toolName: 'bash', command: 'curl api', minSavingsBytes: 1,
      }, {
        httpUrl: url,
        // No usable CLI: forces the HTTP transport.
        bin: join(dir, 'absent-lm-resizer'),
        timeoutMs: 20_000,
        httpTimeoutMs: 20_000,
      });
      expect(result).not.toBeNull();
      expect(result!.transport).toBe('http');
      expect(result!.accepted).toBe(true);
      expect(result!.compressedBytes).toBeLessThan(result!.originalBytes / 2);
      expect(result!.hash).toBeTruthy();
      const back = await (await fetch(`${url}/retrieve/${result!.hash}`)).json() as { content: string };
      expect(back.content).toBe(original);
    }, 60_000);
  });
});
