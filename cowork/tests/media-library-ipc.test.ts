import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseInstance } from '../src/main/db/database';
import type { SessionManager } from '../src/main/session/session-manager';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn<(channel: string, handler: (...args: unknown[]) => unknown) => void>(),
    getPath: vi.fn<(name: string) => string>(),
    writeImage: vi.fn(),
    writeText: vi.fn(),
    createFromPath: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  };
});

const mediaLibraryMock = vi.hoisted(() => ({
  scanMediaLibrary: vi.fn(),
  kindOf: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: electronMock.getPath },
  clipboard: {
    writeImage: electronMock.writeImage,
    writeText: electronMock.writeText,
  },
  dialog: {
    showOpenDialog: electronMock.showOpenDialog,
    showSaveDialog: electronMock.showSaveDialog,
  },
  ipcMain: { handle: electronMock.handle },
  nativeImage: { createFromPath: electronMock.createFromPath },
}));

vi.mock('../src/main/media-library', () => mediaLibraryMock);
vi.mock('../src/main/utils/logger', () => ({
  logWarn: vi.fn(),
}));

import { registerMediaLibraryIpcHandlers } from '../src/main/ipc/media-library-ipc';

function call<T>(channel: string, ...args: unknown[]): T | Promise<T> {
  const handler = electronMock.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, ...args) as T | Promise<T>;
}

describe('media library IPC handlers', () => {
  let getMessages: ReturnType<typeof vi.fn>;
  let prepare: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.handle.mockImplementation((channel, handler) => {
      electronMock.handlers.set(channel, handler);
    });
    electronMock.getPath.mockImplementation((name) =>
      name === 'userData' ? '/user-data' : '/home/test'
    );
    electronMock.createFromPath.mockReturnValue({ isEmpty: () => false });
    mediaLibraryMock.scanMediaLibrary.mockImplementation(() => [
      {
        path: '/workspace/.codebuddy/media-generation/images/generated-123.png',
        kind: 'image',
        size: 10,
        mtimeMs: 1,
        root: '/workspace',
      },
    ]);
    mediaLibraryMock.kindOf.mockImplementation((path: string) =>
      path.endsWith('.png') ? 'image' : path.endsWith('.mp4') ? 'video' : null
    );

    getMessages = vi.fn();
    const sessionManager = {
      listSessions: vi.fn(() => [{ id: 'session-1', cwd: '/workspace' }]),
      getMessages,
    } as unknown as SessionManager;
    prepare = vi.fn(() => ({
      all: () => [
        {
          session_id: 'session-1',
          content: '[{"type":"tool_result","content":"MEDIA:/tmp/generated-123.png"}]',
        },
      ],
    }));
    const database = {
      raw: { prepare },
    } as unknown as Pick<DatabaseInstance, 'raw'>;

    registerMediaLibraryIpcHandlers({
      getSessionManager: () => sessionManager,
      getDatabase: () => database,
      getMainWindow: () => null,
    });
  });

  it('registers the complete media surface exactly once', () => {
    expect([...electronMock.handlers.keys()]).toEqual([
      'media.list',
      'media.copyToClipboard',
      'media.exportMany',
      'media.export',
    ]);
    expect(electronMock.handle).toHaveBeenCalledTimes(4);
  });

  it('links media through the targeted database query without hydrating sessions', async () => {
    const items = await call<Array<{ path: string; sessionId?: string }>>('media.list');

    expect(mediaLibraryMock.scanMediaLibrary).toHaveBeenCalledWith([
      '/user-data/default_working_dir',
      '/workspace',
    ]);
    expect(items[0]?.sessionId).toBe('session-1');
    expect(getMessages).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[0]).toContain("role = 'assistant'");
  });

  it('keeps image and non-image clipboard behavior unchanged', async () => {
    await expect(
      call('media.copyToClipboard', { sourcePath: '/tmp/generated.png' })
    ).resolves.toEqual({ ok: true, mode: 'image' });
    expect(electronMock.writeImage).toHaveBeenCalledTimes(1);

    await expect(
      call('media.copyToClipboard', { sourcePath: '/tmp/generated.mp4' })
    ).resolves.toEqual({ ok: true, mode: 'path' });
    expect(electronMock.writeText).toHaveBeenCalledWith('/tmp/generated.mp4');
  });
});
