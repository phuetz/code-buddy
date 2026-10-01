import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  exec: vi.fn(),
  electron: vi.fn(),
}));
vi.mock('fs', () => ({ existsSync: mocks.exists, readFileSync: vi.fn() }));
vi.mock('child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('../../src/desktop/electron-paths.js', () => ({ hasElectronBinary: mocks.electron }));
import { installGUI } from '../../src/desktop/installer.js';

describe('GUI installer reports the usable application', () => {
  const initialExitCode = process.exitCode;
  let output: string;
  beforeEach(() => {
    vi.clearAllMocks();
    output = '';
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation((...args) => { output += args.join(' '); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mocks.exec.mockReturnValue(Buffer.alloc(0));
    mocks.electron.mockReturnValue(true);
  });
  afterEach(() => {
    process.exitCode = initialExitCode;
    vi.restoreAllMocks();
  });

  it('fails before installing anything when the npm package has no Cowork sources', async () => {
    mocks.exists.mockReturnValue(false);
    await installGUI();
    expect(process.exitCode).toBe(1);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(output).not.toContain('installed successfully');
  });

  it('fails when the native rebuild fails instead of announcing success', async () => {
    mocks.exists.mockImplementation((file: string) => file.endsWith('package.json'));
    mocks.exec.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rebuild') || args.includes('electron-rebuild')) throw new Error('ABI rebuild failed');
      return Buffer.alloc(0);
    });
    await installGUI();
    expect(process.exitCode).toBe(1);
    expect(output).not.toContain('installed successfully');
  });

  it('fails when the build exits zero but no application entry point exists', async () => {
    mocks.exists.mockImplementation((file: string) => file.endsWith('package.json'));
    await installGUI();
    expect(process.exitCode).toBe(1);
    expect(output).not.toContain('installed successfully');
  });

  it('succeeds with a rebuilt Electron runtime and an existing application entry point', async () => {
    mocks.exists.mockReturnValue(true);
    await installGUI();
    expect(process.exitCode).toBe(0);
    expect(output).toContain('installed successfully');
    expect(mocks.exec).toHaveBeenCalledWith(expect.any(String), ['run', 'rebuild'], expect.objectContaining({ cwd: expect.stringMatching(/cowork$/) }));
  });
});
