import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { compressWithLmResizer, resolveLmResizerBin, isLmResizerEnabled } from '../../src/context/lm-resizer-compressor.js';

describe('lm-resizer compressor', () => {
  it('returns null (graceful) when the binary is missing — caller falls back', async () => {
    const r = await compressWithLmResizer('some output', '', { bin: '/nonexistent/lm-resizer-xyz' });
    expect(r).toBeNull();
  });

  it('isLmResizerEnabled reflects the env flag (off by default)', () => {
    const prev = process.env.CODEBUDDY_LM_RESIZER;
    delete process.env.CODEBUDDY_LM_RESIZER;
    expect(isLmResizerEnabled()).toBe(false);
    process.env.CODEBUDDY_LM_RESIZER = 'true';
    expect(isLmResizerEnabled()).toBe(true);
    if (prev === undefined) delete process.env.CODEBUDDY_LM_RESIZER;
    else process.env.CODEBUDDY_LM_RESIZER = prev;
  });

  // Real binary path (Patrice's machine / wherever lm-resizer is built). Skips cleanly elsewhere.
  describe('with the real lm-resizer binary', () => {
    const bin = resolveLmResizerBin();
    const hasBin = bin.includes('/') && existsSync(bin);
    let dir: string;
    let prevStore: string | undefined;

    beforeAll(() => {
      if (!hasBin) return;
      dir = mkdtempSync(join(tmpdir(), 'lmr-'));
      prevStore = process.env.CODEBUDDY_LM_RESIZER_STORE;
      process.env.CODEBUDDY_LM_RESIZER_STORE = join(dir, 'ccr.db');
    });
    afterAll(() => {
      if (!hasBin) return;
      if (prevStore === undefined) delete process.env.CODEBUDDY_LM_RESIZER_STORE;
      else process.env.CODEBUDDY_LM_RESIZER_STORE = prevStore;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it.skipIf(!hasBin)('compresses noisy output, preserves the real error, exposes a recovery hash', async () => {
      const noisy =
        Array.from({ length: 40 }, () => 'compiling...').join('\n') +
        '\n' +
        Array.from({ length: 30 }, () => 'warning: unused var x').join('\n') +
        '\nERROR: test failed at foo.ts:42 expected 3 got 2\n' +
        Array.from({ length: 20 }, () => 'ok 1 - passes').join('\n');
      const r = await compressWithLmResizer(noisy, 'why did the test fail', {
        bin,
        httpUrl: null,
      });
      expect(r).not.toBeNull();
      expect(r!.compressed.length).toBeLessThan(noisy.length); // shrank
      expect(r!.compressed).toContain('ERROR: test failed at foo.ts:42'); // signal preserved
      expect(r!.bytesSaved).toBeGreaterThan(0);
      expect(typeof r!.hash === 'string' && r!.hash.length > 0).toBe(true); // recoverable
    }, 30000);
  });
});
