import { expect, it, vi, afterEach } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('util', () => ({ promisify: () => run }));
vi.mock('../../src/context/lm-resizer-compressor.js', () => ({
  resolveLmResizerBin: () => '/fixture/lm-resizer', isLmResizerEnabled: () => true,
}));
import { diagnoseLmResizer } from '../../src/context/lm-resizer-diagnostics.js';
afterEach(() => run.mockReset());
it('reports an old executable as available but incompatible', async () => {
  run.mockResolvedValueOnce({ stdout: 'Usage: lm-resizer' }).mockRejectedValue(new Error('unknown option'));
  expect(await diagnoseLmResizer()).toMatchObject({ available: true, toolOutputSupported: false, warning: expect.stringContaining('keeps raw') });
});
it('requires actual tool-output protocol support', async () => {
  run.mockResolvedValueOnce({ stdout: 'Usage' }).mockResolvedValueOnce({ stdout: 'lm-resizer 0.2.1' }).mockResolvedValueOnce({ stdout: 'Usage: lm-resizer tool-output' });
  expect(await diagnoseLmResizer()).toMatchObject({ available: true, toolOutputSupported: true, version: 'lm-resizer 0.2.1' });
});
it('reports a missing host executable without claiming sandbox availability', async () => {
  run.mockRejectedValue(new Error('ENOENT'));
  expect(await diagnoseLmResizer()).toMatchObject({ available: false, toolOutputSupported: false, warning: expect.stringContaining('host') });
});
