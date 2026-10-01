import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), exists: vi.fn(), binary: vi.fn(), info: vi.fn() }));
vi.mock('child_process', () => ({ execFileSync: mocks.exec }));
vi.mock('../../src/utils/logger.js', () => ({ logger: { info: mocks.info } }));
vi.mock('fs', () => ({ existsSync: mocks.exists, readFileSync: vi.fn(() => '{"version":"35.7.5"}') }));
vi.mock('../../src/desktop/electron-paths.js', () => ({ hasElectronBinary: mocks.binary }));
import { installGUI, isGUIInstalled } from '../../src/desktop/installer.js';

describe('desktop installation readiness', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.exists.mockReturnValue(true);
    mocks.binary.mockReturnValue(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process exit'); });
  });
  afterEach(() => vi.restoreAllMocks());

  it('explains that the npm CLI alone has no desktop sources, before installing anything', async () => {
    mocks.exists.mockReturnValue(false);
    await expect(installGUI()).rejects.toThrow(/source checkout/i);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.info).not.toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
  });

  it('installs dependencies in Cowork without altering the root package', async () => {
    mocks.exists.mockImplementation((p: string) => !p.endsWith('node_modules'));
    await installGUI();
    expect(mocks.exec).toHaveBeenCalledWith(expect.any(String), ['install'], expect.objectContaining({ cwd: expect.stringMatching(/cowork$/) }));
    expect(mocks.exec).not.toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['--save-optional']), expect.anything());
  });

  it('builds the desktop bundle without running the installer packager', async () => {
    mocks.exists.mockImplementation((p: string) => !p.endsWith('dist-electron/main/index.js'));
    await expect(installGUI()).rejects.toThrow(/build|bundle/i);
    expect(mocks.exec).toHaveBeenCalledWith(expect.any(String), ['run', 'build:e2e'], expect.objectContaining({ cwd: expect.stringMatching(/cowork$/) }));
    expect(mocks.exec).not.toHaveBeenCalledWith(expect.any(String), ['run', 'build:gui'], expect.anything());
  });

  it('propagates a native rebuild failure instead of announcing success', async () => {
    mocks.exec.mockImplementation((_cmd: string, args: string[]) => { if (args.includes('rebuild')) throw new Error('native rebuild failed'); });
    await expect(installGUI()).rejects.toThrow(/rebuild/i);
    expect(mocks.info).not.toHaveBeenCalledWith(expect.stringContaining('installed successfully'));
  });

  it('requires a desktop entry point as well as the Electron binary', () => {
    mocks.exists.mockReturnValue(false);
    expect(isGUIInstalled()).toBe(false);
  });
});
