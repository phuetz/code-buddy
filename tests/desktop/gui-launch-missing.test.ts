import { afterEach, describe, expect, it, vi } from 'vitest';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ spawn }));
vi.mock('fs', () => ({ existsSync: () => false }));
vi.mock('../../src/desktop/electron-paths.js', () => ({
  getElectronBaseDirs: () => [],
  hasElectronBinary: () => false,
  resolveElectronBinaryPath: () => '',
}));
import { launchDesktop } from '../../src/desktop/launcher.js';

describe('desktop launch without Cowork', () => {
  afterEach(() => vi.restoreAllMocks());
  it('returns an actionable failure before starting Electron', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true; });
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('unexpected process.exit'); });
    expect(await launchDesktop()).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('source checkout');
  });
});
