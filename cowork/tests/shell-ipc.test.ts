import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn<(channel: string, handler: (...args: unknown[]) => unknown) => void>(),
    getPath: vi.fn<(name: string) => string>(),
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  };
});

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      callback: (error: Error | null, stdout?: string, stderr?: string) => void
    ) => callback(null, '', '')
  ),
}));

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath },
  ipcMain: { handle: electronMock.handle },
  shell: {
    openExternal: electronMock.openExternal,
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder,
  },
}));
vi.mock('child_process', () => ({ execFile: childProcessMock.execFile }));
vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import {
  createRevealFileInFolder,
  registerShellIpcHandlers,
} from '../src/main/ipc/shell-ipc';

function call<T>(channel: string, ...args: unknown[]): T | Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, ...args) as T | Promise<T>;
}

describe('shell IPC handlers', () => {
  let root: string;
  let reveal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cowork-shell-ipc-'));
    electronMock.handlers.clear();
    electronMock.handle.mockImplementation((channel, handler) => {
      electronMock.handlers.set(channel, handler);
    });
    electronMock.getPath.mockImplementation((name) =>
      name === 'userData' ? root : root
    );
    electronMock.openExternal.mockResolvedValue(undefined);
    electronMock.openPath.mockResolvedValue('');
    reveal = vi.fn(async () => true);
    registerShellIpcHandlers({ revealFileInFolder: reveal });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('registers both shell channels exactly once', () => {
    expect([...electronMock.handlers.keys()]).toEqual([
      'shell.openExternal',
      'shell.showItemInFolder',
    ]);
    expect(electronMock.handle).toHaveBeenCalledTimes(2);
  });

  it('blocks unsafe URLs and forwards allowed URLs', async () => {
    await expect(call('shell.openExternal', 'file:///tmp/secret')).resolves.toBe(false);
    expect(electronMock.openExternal).not.toHaveBeenCalled();

    await expect(call('shell.openExternal', 'https://example.test/docs')).resolves.toBeUndefined();
    expect(electronMock.openExternal).toHaveBeenCalledWith('https://example.test/docs');
  });

  it('delegates showItemInFolder to the shared revealer', async () => {
    await expect(call('shell.showItemInFolder', 'artifact.png', '/workspace')).resolves.toBe(true);
    expect(reveal).toHaveBeenCalledWith('artifact.png', '/workspace');
  });

  it('discovers a stale file asynchronously through the shared factory', async () => {
    const generatedDir = join(root, 'generated');
    mkdirSync(generatedDir);
    const discoveredPath = join(generatedDir, 'artifact.png');
    writeFileSync(discoveredPath, 'image');

    const revealFileInFolder = createRevealFileInFolder({ getWorkingDir: () => root });
    await expect(
      revealFileInFolder(join(root, 'stale', 'artifact.png'), root)
    ).resolves.toBe(true);

    if (process.platform === 'darwin') {
      expect(childProcessMock.execFile).toHaveBeenCalledWith(
        'open',
        ['-R', discoveredPath],
        expect.any(Function)
      );
    } else {
      expect(electronMock.showItemInFolder).toHaveBeenCalledWith(discoveredPath);
    }
  });
});
