// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    BrowserWindow: vi.fn(),
    handlers,
    handle: vi.fn<(channel: string, handler: (...args: unknown[]) => unknown) => void>(),
    showSaveDialog: vi.fn(),
  };
});

const windowMock = vi.hoisted(() => ({
  getMainWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: electronMock.BrowserWindow,
  dialog: { showSaveDialog: electronMock.showSaveDialog },
  ipcMain: { handle: electronMock.handle },
}));

vi.mock('../src/main/window-management', () => ({
  getMainWindow: windowMock.getMainWindow,
}));

vi.mock('../src/main/utils/logger', () => ({
  logWarn: vi.fn(),
}));

import { registerSessionExportIpcHandlers } from '../src/main/ipc/session-export-ipc';

const fakeEvent = {} as unknown;

function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = electronMock.handlers.get(channel);
  if (!registered) throw new Error(`No handler registered for ${channel}`);
  return registered;
}

function register(deps?: {
  getSessionManager?: () => unknown;
  getSessionExportService?: () => unknown;
}): void {
  registerSessionExportIpcHandlers({
    getSessionManager: (deps?.getSessionManager ?? (() => null)) as never,
    getSessionExportService: (deps?.getSessionExportService ?? (() => null)) as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.handlers.clear();
  electronMock.handle.mockImplementation((channel, registered) => {
    electronMock.handlers.set(channel, registered);
  });
  electronMock.showSaveDialog.mockResolvedValue({ canceled: true });
  windowMock.getMainWindow.mockReturnValue(null);
});

describe('session-export-ipc registration', () => {
  it('registers the six session prune/export channels exactly once', () => {
    register();

    const expected = [
      'session.prunePreview',
      'session.pruneApply',
      'session.export',
      'session.exportFull',
      'session.exportPdf',
      'session.exportToFile',
    ];
    const channels = electronMock.handle.mock.calls.map(([channel]) => channel);

    expect(channels).toEqual(expected);
    expect(new Set(channels).size).toBe(expected.length);
  });
});

describe('session-export-ipc handlers', () => {
  it('reads the session manager lazily after registration', async () => {
    let sessionManager: unknown = null;
    const getSessionManager = vi.fn(() => sessionManager);
    register({ getSessionManager });

    await expect(handler('session.export')(fakeEvent, 'session-1', 'md')).resolves.toBeNull();

    const getMessages = vi.fn(() => [{ role: 'assistant', content: [] }]);
    sessionManager = { getMessages };

    await expect(handler('session.export')(fakeEvent, 'session-1', 'md')).resolves.toEqual({
      messages: [{ role: 'assistant', content: [] }],
      format: 'md',
    });
    expect(getMessages).toHaveBeenCalledWith('session-1');
    expect(getSessionManager).toHaveBeenCalledTimes(2);
  });

  it('previews only matching, unprotected sessions and excludes the active id', async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const listSessions = vi.fn(() => [
      {
        id: 'match',
        title: 'Café planning',
        pinned: false,
        archived: false,
        updatedAt: now - 10 * day,
      },
      {
        id: 'active',
        title: 'Café active',
        pinned: false,
        archived: false,
        updatedAt: now - 20 * day,
      },
      {
        id: 'pinned',
        title: 'Café pinned',
        pinned: true,
        archived: false,
        updatedAt: now - 20 * day,
      },
      {
        id: 'recent',
        title: 'Café recent',
        pinned: false,
        archived: false,
        updatedAt: now - day,
      },
    ]);
    register({ getSessionManager: () => ({ listSessions }) });

    const result = await handler('session.prunePreview')(fakeEvent, {
      olderThanDays: 5,
      titleMatch: 'cafe',
      excludeId: 'active',
    });

    expect(result).toEqual({
      matches: [
        {
          id: 'match',
          title: 'Café planning',
          updatedAt: now - 10 * day,
        },
      ],
      ageSpan: { oldest: now - 10 * day, newest: now - 10 * day },
    });
  });

  it('archives every requested session and reports only successful updates', async () => {
    const updateSessionSettings = vi.fn((id: string) => id !== 'missing');
    register({ getSessionManager: () => ({ updateSessionSettings }) });

    await expect(
      handler('session.pruneApply')(fakeEvent, { ids: ['one', 'missing', 'two'] })
    ).resolves.toEqual({ ok: true, archived: 2 });
    expect(updateSessionSettings.mock.calls).toEqual([
      ['one', { archived: true }],
      ['missing', { archived: true }],
      ['two', { archived: true }],
    ]);
  });

  it('reads the export service lazily and forwards full-export options', async () => {
    let exportService: unknown = null;
    register({ getSessionExportService: () => exportService });
    const options = {
      format: 'html' as const,
      redactSecrets: true,
      includeCheckpoints: false,
    };

    await expect(
      handler('session.exportFull')(fakeEvent, 'session-2', options)
    ).resolves.toEqual({
      success: false,
      content: '',
      filename: '',
      error: 'Export service unavailable',
    });

    const exportSession = vi.fn(() => ({
      success: true,
      content: '<html></html>',
      filename: 'session.html',
    }));
    exportService = { exportSession };

    await expect(
      handler('session.exportFull')(fakeEvent, 'session-2', options)
    ).resolves.toEqual({
      success: true,
      content: '<html></html>',
      filename: 'session.html',
    });
    expect(exportSession).toHaveBeenCalledWith('session-2', options);
  });

  it('exports formatted content to the path selected by the user', async () => {
    const exportSession = vi.fn(() => ({
      success: true,
      content: '# Session',
      filename: 'session.md',
    }));
    const saveToFile = vi.fn(() => ({ success: true }));
    electronMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/session.md',
    });
    register({
      getSessionExportService: () => ({ exportSession, saveToFile }),
    });
    const options = { format: 'markdown' as const, redactSecrets: true };

    await expect(
      handler('session.exportToFile')(fakeEvent, 'session-3', options)
    ).resolves.toMatchObject({
      success: true,
      path: '/tmp/session.md',
    });
    expect(exportSession).toHaveBeenCalledWith('session-3', options);
    expect(saveToFile).toHaveBeenCalledWith('/tmp/session.md', '# Session');
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith({
      title: 'Export session',
      defaultPath: 'session.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
  });

  it('builds the PDF export and exits cleanly when the save dialog is cancelled', async () => {
    const mainWindow = { id: 'main-window' };
    windowMock.getMainWindow.mockReturnValue(mainWindow);
    electronMock.showSaveDialog.mockResolvedValue({ canceled: true });
    const listSessions = vi.fn(() => [
      { id: 'session-pdf', title: 'Roadmap / Q3', model: 'gpt-test' },
    ]);
    const getMessages = vi.fn(() => [
      {
        role: 'user',
        timestamp: 1,
        content: [{ type: 'text', text: 'Plan the release' }],
      },
      {
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'text', text: 'Here is the plan' }],
      },
      { role: 'system', timestamp: 3, content: [{ type: 'text', text: 'hidden' }] },
    ]);
    register({ getSessionManager: () => ({ listSessions, getMessages }) });

    await expect(
      handler('session.exportPdf')(fakeEvent, 'session-pdf')
    ).resolves.toEqual({ success: false, canceled: true });
    expect(getMessages).toHaveBeenCalledWith('session-pdf');
    expect(electronMock.showSaveDialog).toHaveBeenCalledWith(mainWindow, {
      title: 'Exporter la conversation en PDF',
      defaultPath: 'Roadmap  Q3.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    expect(electronMock.BrowserWindow).not.toHaveBeenCalled();
  });
});
