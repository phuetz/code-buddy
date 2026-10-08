/**
 * Wiring: with lm-resizer on, streaming bash must not bound its output to the
 * 256 KiB head+tail default (the middle of a long log is where the error is).
 * Off: no maxOutputBytes passed, as before. (On hosts with a workspace sandbox
 * the sandbox path is unbounded anyway; this covers the spawn path.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const impl = vi.hoisted(() => vi.fn());
vi.mock('../../src/tools/bash/streaming-executor.js', () => ({ executeStreaming: impl }));

import { BashTool } from '../../src/tools/bash/bash-tool.js';

async function capture(): Promise<Record<string, unknown>> {
  impl.mockImplementation(async function* (_c: string, _t: number, deps: Record<string, unknown>) {
    yield 'x';
    return { success: true, output: JSON.stringify({ max: deps.maxOutputBytes ?? null }) };
  });
  const tool = new BashTool();
  const gen = tool.executeStreaming('echo hi', 1000);
  let n = await gen.next();
  while (!n.done) n = await gen.next();
  const deps = impl.mock.calls.at(-1)![2] as Record<string, unknown>;
  tool.dispose?.();
  return deps;
}

describe('BashTool.executeStreaming output cap', () => {
  const saved = { on: process.env.CODEBUDDY_LM_RESIZER, max: process.env.CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES };
  afterEach(() => {
    for (const [k, v] of [['CODEBUDDY_LM_RESIZER', saved.on], ['CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES', saved.max]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    impl.mockReset();
  });

  it('flag off: default bound untouched', async () => {
    delete process.env.CODEBUDDY_LM_RESIZER;
    expect('maxOutputBytes' in (await capture())).toBe(false);
  });

  it('flag on: the lm-resizer memory ceiling replaces the 256 KiB default', async () => {
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    expect((await capture()).maxOutputBytes).toBe(16 * 1024 * 1024);
    process.env.CODEBUDDY_LM_RESIZER_MAX_INPUT_BYTES = '5000000';
    expect((await capture()).maxOutputBytes).toBe(5_000_000);
  });
});
