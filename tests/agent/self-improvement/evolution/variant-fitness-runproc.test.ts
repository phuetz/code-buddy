import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  runCheckoutCli,
  runProc,
} from '../../../../src/agent/self-improvement/evolution/variant-fitness.js';

const ctx = { checkoutDir: process.cwd(), timeoutMs: 3000 };
const node = (code: string, timeoutMs = 3000) => runProc(process.execPath, ['-e', code], { ...ctx, timeoutMs });

describe('runProc lifecycle', () => {
  it('executes the checkout compiler without an npm shell shim', async () => {
    const result = await runCheckoutCli('typescript/bin/tsc', ['--version'], ctx);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Version \d/);
  });

  it('reports unavailable checkout CLIs as failed evaluations', async () => {
    const result = await runCheckoutCli('cb-missing-cli/cli.js', [], ctx);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cb-missing-cli');
  });

  it('collects successful and nonzero exits without waiting for timeout', async () => {
    expect(await node('console.log("done")')).toMatchObject({ code: 0, stdout: 'done\n', timedOut: false });
    expect(await node('process.exit(7)')).toMatchObject({ code: 7, timedOut: false });
  });
  it('reports asynchronous and synchronous spawn errors', async () => {
    expect(await runProc('cb-nonexistent-audit-command', [], ctx)).toMatchObject({ code: 1, timedOut: false });
    expect(await runProc('\0', [], ctx)).toMatchObject({ code: 1, timedOut: false });
  });
  it('does not spawn a cancelled operation and cancels an active operation', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await runProc('cb-nonexistent-audit-command', [], { ...ctx, signal: cancelled.signal })).toMatchObject({ code: 130, stderr: 'Operation cancelled before spawn', timedOut: false });
    const active = new AbortController();
    const result = runProc(process.execPath, ['-e', 'setTimeout(()=>{},3000)'], { ...ctx, signal: active.signal });
    const timer = setTimeout(() => active.abort(), 100);
    try { expect(await result).toMatchObject({ code: 130, timedOut: false }); }
    finally { clearTimeout(timer); }
  });
  it('bounds both streams and passes the supplied environment', async () => {
    const result = await node('process.stdout.write("x".repeat(1100000)); process.stderr.write("y".repeat(1100000))');
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBe(1000000);
    expect(result.stderr.length).toBe(1000000);
    const env = await runProc(process.execPath, ['-e', 'console.log(process.env.CB_AUDIT_VALUE)'], { ...ctx, env: { ...process.env, CB_AUDIT_VALUE: 'fixture' } });
    expect(env.stdout).toBe('fixture\n');
  });
  it.skipIf(process.platform === 'win32')('escalates for a parent that ignores SIGTERM', async () => {
    const start = Date.now();
    const result = await node('process.on("SIGTERM",()=>{}); setTimeout(()=>{},2500)', 400);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - start).toBeLessThan(2000);
  });
  for (const stdio of ['inherit', 'ignore']) {
    it.skipIf(process.platform === 'win32')(`kills descendants with ${stdio} pipes even after parent exits`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-proc-check-'));
      try {
        const marker = path.join(root, 'survived');
        const descendant = `process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'survived'),1400);`;
        const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:${JSON.stringify(stdio)}});setTimeout(()=>{},2200);`;
        const start = Date.now();
        const result = await node(script, 400);
        expect(result.timedOut).toBe(true);
        expect(Date.now() - start).toBeLessThan(1800);
        await new Promise(resolve => setTimeout(resolve, 1500));
        expect(await fs.access(marker).then(() => true, () => false)).toBe(false);
      } finally { await fs.rm(root, { recursive: true, force: true }); }
    });
  }
});
