import { expect, it, vi, afterEach } from 'vitest';
const run = vi.hoisted(() => vi.fn());
const probe = vi.hoisted(() => vi.fn());
vi.mock('util', () => ({ promisify: () => run }));
vi.mock('../../src/context/lm-resizer-compressor.js', () => ({
  resolveLmResizerBin: () => '/fixture/lm-resizer', isLmResizerEnabled: () => true,
  probeLmResizerToolOutput: probe,
}));
import { diagnoseLmResizer } from '../../src/context/lm-resizer-diagnostics.js';
afterEach(() => { run.mockReset(); probe.mockReset(); });
it('reports an old executable as available but incompatible', async () => {
  run.mockResolvedValueOnce({ stdout: 'Usage: lm-resizer' }).mockRejectedValue(new Error('unknown option'));
  probe.mockResolvedValue(false);
  expect(await diagnoseLmResizer()).toMatchObject({ available: true, toolOutputSupported: false, warning: expect.stringContaining('keeps raw') });
});
it('requires actual tool-output protocol support', async () => {
  run.mockResolvedValueOnce({ stdout: 'Usage' }).mockResolvedValueOnce({ stdout: 'lm-resizer 0.2.4' });
  probe.mockResolvedValue(true);
  expect(await diagnoseLmResizer()).toMatchObject({ available: true, toolOutputSupported: true, version: 'lm-resizer 0.2.4' });
});
it('reports a missing host executable without claiming sandbox availability', async () => {
  run.mockRejectedValue(new Error('ENOENT'));
  expect(await diagnoseLmResizer()).toMatchObject({ available: false, toolOutputSupported: false, warning: expect.stringContaining('host') });
});
