import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const resolution = vi.hoisted(() => ({
  resolveExecutable: vi.fn<(executable: string) => string | undefined>(),
}));

vi.mock('../../src/utils/command-exists.js', () => ({
  resolveExecutable: resolution.resolveExecutable,
}));

const originalComSpec = process.env.ComSpec;

async function loadShellConfiguration() {
  return import('../../src/utils/shell-configuration.js');
}

beforeEach(() => {
  vi.resetModules();
  resolution.resolveExecutable.mockReset();
  delete process.env.ComSpec;
});

afterAll(() => {
  if (originalComSpec === undefined) {
    delete process.env.ComSpec;
  } else {
    process.env.ComSpec = originalComSpec;
  }
});

describe('getShellConfiguration', () => {
  it('selects Bash for an injected Unix platform without probing executables', async () => {
    const { getShellConfiguration } = await loadShellConfiguration();

    expect(getShellConfiguration('linux')).toEqual({
      executable: 'bash',
      argsPrefix: ['-c'],
      shell: 'bash',
    });
    expect(resolution.resolveExecutable).not.toHaveBeenCalled();
  });

  it('keeps ComSpec when it points to PowerShell', async () => {
    process.env.ComSpec = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const { getShellConfiguration } = await loadShellConfiguration();

    expect(getShellConfiguration('win32')).toEqual({
      executable: process.env.ComSpec,
      argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'],
      shell: 'powershell',
    });
    expect(resolution.resolveExecutable).not.toHaveBeenCalled();
  });

  it('prefers a resolved PowerShell 7 when ComSpec is not PowerShell', async () => {
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    resolution.resolveExecutable.mockReturnValue('C:\\Program Files\\PowerShell\\7\\pwsh.exe');
    const { getShellConfiguration } = await loadShellConfiguration();

    expect(getShellConfiguration('win32')).toEqual({
      executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'],
      shell: 'powershell',
    });
    expect(resolution.resolveExecutable).toHaveBeenCalledWith('pwsh.exe', {
      platform: 'win32',
    });
  });

  it('falls back to Windows PowerShell 5.1 when PowerShell 7 is absent', async () => {
    resolution.resolveExecutable.mockReturnValue(undefined);
    const { getShellConfiguration } = await loadShellConfiguration();

    expect(getShellConfiguration('win32')).toEqual({
      executable: 'powershell.exe',
      argsPrefix: ['-NoProfile', '-NonInteractive', '-Command'],
      shell: 'powershell',
    });
  });

  it('caches executable resolution per platform', async () => {
    resolution.resolveExecutable.mockReturnValue('C:\\Tools\\pwsh.exe');
    const { getShellConfiguration } = await loadShellConfiguration();

    expect(getShellConfiguration('win32')).toEqual(getShellConfiguration('win32'));
    expect(resolution.resolveExecutable).toHaveBeenCalledTimes(1);
  });
});
