/**
 * Order truncation / compression (2026-10-04). The provider cap (~100 KB) used
 * to cut a tool output in an after-hook BEFORE lm-resizer could see it, so an
 * ERROR line in the middle of a 1.3 MB log was lost. With lm-resizer enabled the
 * hook now lets the output through (memory ceiling only); disabled, nothing changes.
 */
import { execFile } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCurrentProvider,
  registerDefaultHooks,
} from '../../../src/tools/hooks/default-hooks.js';
import { getToolHooksManager, resetToolHooksManager } from '../../../src/tools/hooks/tool-hooks.js';
import { sanitizeResult } from '../../../src/tools/hooks/result-sanitizer.js';
import {
  optimizeToolOutputWithLmResizer,
  resetLmResizerCircuitBreakers,
  resolveLmResizerBin,
} from '../../../src/context/lm-resizer-compressor.js';
import { prepareToolObservationForPrompt } from '../../../src/agent/prompt-tool-observation.js';

const run = promisify(execFile);
const MARKER = 'ERROR: marqueur-9f3a connexion refusee vers db-7 (src/db/pool.ts:412)';

function bigLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 20_000; i++) {
    lines.push(i === 10_000
      ? MARKER
      : `2026-10-04T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z INFO worker-${i % 8} requete ok duree=${10 + (i * 7) % 90}ms`);
  }
  return `${lines.join('\n')}\n`;
}

async function throughHooks(output: string): Promise<string> {
  const after = await getToolHooksManager().executeAfterHooks(
    { toolName: 'bash', originalArgs: {}, args: {}, toolCallId: 'call_1', timestamp: Date.now() },
    { success: true, output },
  );
  return after.output ?? '';
}

describe('truncation vs lm-resizer order', () => {
  const saved = {
    on: process.env.CODEBUDDY_LM_RESIZER,
    max: process.env.CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES,
  };
  const log = bigLog();
  const dirs: string[] = [];

  beforeEach(() => {
    resetToolHooksManager();
    registerDefaultHooks();
    resetLmResizerCircuitBreakers();
    delete process.env.CODEBUDDY_LM_RESIZER;
    delete process.env.CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES;
  });
  afterEach(() => {
    for (const [k, v] of [['CODEBUDDY_LM_RESIZER', saved.on], ['CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES', saved.max]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('disabled (default): byte-for-byte the historical provider truncation', async () => {
    const viaHook = await throughHooks(log);
    const historical = sanitizeResult(getCurrentProvider(), {
      toolCallId: 'call_1', toolName: 'bash', success: true, output: log,
    }).output;
    expect(viaHook).toBe(historical);
    expect(viaHook.length).toBeLessThanOrEqual(100_000);
    expect(viaHook).toContain('[Output truncated...]');
    expect(viaHook).not.toContain('marqueur-9f3a');
  });

  it('enabled: the whole output reaches lm-resizer (marker intact)', async () => {
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    const viaHook = await throughHooks(log);
    expect(viaHook.length).toBe(log.length);
    expect(viaHook).toContain('marqueur-9f3a');
  });

  it('enabled: a memory ceiling still applies (CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES)', async () => {
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    process.env.CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES = '300000';
    const viaHook = await throughHooks(log);
    expect(viaHook.length).toBeLessThanOrEqual(300_000);
    expect(viaHook).toContain('[Output truncated...]');
  });

  it('enabled but lm-resizer unavailable: the unreduced observation gets the provider cap', async () => {
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    const ws = mkdtempSync(join(tmpdir(), 'lmr-order-'));
    dirs.push(ws);
    const obs = await prepareToolObservationForPrompt({
      toolName: 'bash', toolCallId: 'call_fb', content: log, success: true, workspaceRoot: ws,
    });
    expect(obs.optimized).toBe(false);
    expect(obs.content.length).toBeLessThanOrEqual(100_000);
  });

  const bin = resolveLmResizerBin();
  const hasBin = bin.includes('/') && existsSync(bin);
  it.skipIf(!hasBin)('REAL binary: the model-facing text keeps the marker enabled, loses it disabled', async () => {
    const help = (await run(bin, ['tool-output', '--help'])).stdout;
    expect(help).toMatch(/--command|--request-json/);
    const dir = mkdtempSync(join(tmpdir(), 'lmr-order-real-'));
    dirs.push(dir);
    const opts = { httpUrl: null, bin, storePath: join(dir, 'ccr.db'), timeoutMs: 30_000 };
    const request = (content: string) => ({
      content, toolName: 'bash', command: 'journalctl -u service', exitCode: 0, minSavingsBytes: 1,
    });

    process.env.CODEBUDDY_LM_RESIZER = 'true';
    const seenEnabled = await optimizeToolOutputWithLmResizer(request(await throughHooks(log)), opts);
    expect(seenEnabled?.accepted).toBe(true);
    expect(seenEnabled!.compressed).toContain('marqueur-9f3a');
    expect(seenEnabled!.originalBytes).toBe(Buffer.byteLength(log));

    // Same chain with the old order (provider cap first): the marker is gone.
    delete process.env.CODEBUDDY_LM_RESIZER;
    const cut = await throughHooks(log);
    const seenOld = await optimizeToolOutputWithLmResizer(request(cut), opts);
    expect(`${seenOld?.compressed ?? cut}`).not.toContain('marqueur-9f3a');
  }, 60_000);
});
