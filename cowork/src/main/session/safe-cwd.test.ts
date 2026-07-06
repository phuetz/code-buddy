/**
 * safe-cwd — a relative session cwd must anchor under the safe base, never the
 * process cwd (the "famille cwd embarqué" defense); absolute paths pass through.
 */
import { describe, expect, it } from 'vitest';
import { resolveSafeCwd } from './safe-cwd.js';

const BASE = '/home/pat/.config/Electron/default_working_dir';

describe('resolveSafeCwd', () => {
  it('passes absolute paths through untouched', () => {
    expect(resolveSafeCwd('/tmp/e2e-yoga', BASE)).toBe('/tmp/e2e-yoga');
  });

  it('anchors a bare relative slug under the safe base', () => {
    expect(resolveSafeCwd('cree-une-page-vitrine-yoga', BASE)).toBe(`${BASE}/cree-une-page-vitrine-yoga`);
  });

  it('strips leading ./ and ../ so it cannot escape the base', () => {
    expect(resolveSafeCwd('../../etc/passwd', BASE)).toBe(`${BASE}/etc/passwd`);
    expect(resolveSafeCwd('./sub/app', BASE)).toBe(`${BASE}/sub/app`);
  });

  it('returns undefined for empty/whitespace', () => {
    expect(resolveSafeCwd('', BASE)).toBeUndefined();
    expect(resolveSafeCwd('   ', BASE)).toBeUndefined();
    expect(resolveSafeCwd(undefined, BASE)).toBeUndefined();
  });
});
