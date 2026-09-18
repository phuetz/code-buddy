import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerQuickAskAppshot } from '../src/main/quickask-appshot-ipc';
import { setMainWindow } from '../src/main/window-management';

class FakeWebContents {
  events: Array<{ channel: string; payload: unknown }> = [];
  send(channel: string, payload: unknown) {
    this.events.push({ channel, payload });
  }
}

class FakeBrowserWindow {
  destroyed = false;
  shown = false;
  hidden = false;
  focused = false;
  webContents = new FakeWebContents();
  setAlwaysOnTop() {}
  on(_event: string, _cb: () => void) {}
  setPosition() {}
  show() {
    this.shown = true;
    this.hidden = false;
  }
  hide() {
    this.shown = false;
    this.hidden = true;
  }
  focus() {
    this.focused = true;
  }
  async loadURL(_url: string) {
    return Promise.resolve();
  }
  isDestroyed() {
    return this.destroyed;
  }
  close() {
    this.destroyed = true;
  }
}

function stubRuntime(overrides: {
  register?: ReturnType<typeof vi.fn>;
  unregister?: ReturnType<typeof vi.fn>;
  removeHandler?: ReturnType<typeof vi.fn>;
  logWarn?: ReturnType<typeof vi.fn>;
  getActiveSessionId?: () => Promise<string | null>;
  desktopCapturerSources?: Array<{
    id: string;
    name: string;
    thumbnail: { isEmpty: () => boolean; toPNG: () => Buffer };
  }>;
}) {
  const register = overrides.register ?? vi.fn(() => true);
  const unregister = overrides.unregister ?? vi.fn();
  const removeHandler = overrides.removeHandler ?? vi.fn();
  const logWarn = overrides.logWarn ?? vi.fn();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const userData = mkdtempSync(join(tmpdir(), 'qa-ipc-'));

  const handles = registerQuickAskAppshot({
    BrowserWindow: FakeBrowserWindow as never,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 100, height: 100 } }),
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      },
      removeHandler,
    } as never,
    globalShortcut: { register, unregister },
    desktopCapturer: {
      getSources: async () =>
        overrides.desktopCapturerSources ?? [
          {
            id: 'win-1',
            name: 'Firefox',
            thumbnail: {
              isEmpty: () => false,
              toPNG: () => Buffer.from('fake-png-data'),
            },
          },
        ],
    },
    preloadPath: '/tmp/preload.js',
    dirname: '/tmp',
    userData,
    logWarn,
    getActiveSessionId: overrides.getActiveSessionId ?? (async () => 'session-1'),
  });

  return {
    handles,
    register,
    unregister,
    removeHandler,
    logWarn,
    handlers,
    userData,
    cleanup: () => {
      handles.dispose();
      try {
        rmSync(userData, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

describe('registerQuickAskAppshot shortcuts', () => {
  it('logs a warning and does not register when Quick Ask collides with panic', () => {
    const previous = process.env.COWORK_QUICKASK_SHORTCUT;
    process.env.COWORK_QUICKASK_SHORTCUT = 'CommandOrControl+Alt+S';
    try {
      const { register, logWarn, cleanup } = stubRuntime({});
      expect(register).not.toHaveBeenCalledWith('CommandOrControl+Alt+S', expect.any(Function));
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Quick Ask shortcut unavailable: CommandOrControl+Alt+S conflicts with panic'),
      );
      cleanup();
    } finally {
      if (previous === undefined) delete process.env.COWORK_QUICKASK_SHORTCUT;
      else process.env.COWORK_QUICKASK_SHORTCUT = previous;
    }
  });

  it('logs a warning and does not register when Appshot collides with dictation', () => {
    const previous = process.env.COWORK_APPSHOT_SHORTCUT;
    process.env.COWORK_APPSHOT_SHORTCUT = 'CommandOrControl+Shift+Space';
    try {
      const { register, logWarn, cleanup } = stubRuntime({});
      expect(register).not.toHaveBeenCalledWith('CommandOrControl+Shift+Space', expect.any(Function));
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Appshot shortcut unavailable: CommandOrControl+Shift+Space conflicts with dictation'),
      );
      cleanup();
    } finally {
      if (previous === undefined) delete process.env.COWORK_APPSHOT_SHORTCUT;
      else process.env.COWORK_APPSHOT_SHORTCUT = previous;
    }
  });

  it('unregisters shortcuts and all IPC handlers on dispose', () => {
    const { register, unregister, removeHandler, cleanup } = stubRuntime({});
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function));
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+A', expect.any(Function));
    cleanup();
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Alt+Space');
    expect(unregister).toHaveBeenCalledWith('CommandOrControl+Alt+A');
    expect(removeHandler).toHaveBeenCalledWith('quickask.hide');
    expect(removeHandler).toHaveBeenCalledWith('quickask.submit');
    expect(removeHandler).toHaveBeenCalledWith('quickask.publish-tasks');
    expect(removeHandler).toHaveBeenCalledWith('quickask.get-tasks');
    expect(removeHandler).toHaveBeenCalledWith('appshot.capture');
    expect(removeHandler).toHaveBeenCalledWith('appshot.confirm');
    expect(removeHandler).toHaveBeenCalledWith('appshot.cancel');
  });
});

describe('QuickAsk and Appshot IPC handlers real invocation', () => {
  let mainWin: FakeBrowserWindow;

  afterEach(() => {
    setMainWindow(null);
  });

  it('quickask.hide hides the floating window', async () => {
    const { handlers, handles, cleanup } = stubRuntime({});
    await handles.quickAsk.show();
    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;
    expect(win.shown).toBe(true);

    const hideHandler = handlers.get('quickask.hide')!;
    const res = (await hideHandler({})) as { ok: boolean };
    expect(res).toEqual({ ok: true });
    expect(win.hidden).toBe(true);
    cleanup();
  });

  it('quickask.submit validates input, rejects when no active session, and sends to main when active', async () => {
    let activeSession: string | null = null;
    const { handlers, handles, cleanup } = stubRuntime({
      getActiveSessionId: async () => activeSession,
    });

    mainWin = new FakeBrowserWindow();
    setMainWindow(mainWin as never);

    const submitHandler = handlers.get('quickask.submit')!;

    // 1. Empty string rejected
    const resEmpty = (await submitHandler({}, '   ')) as { ok: boolean; error?: string };
    expect(resEmpty).toEqual({ ok: false, error: 'empty' });

    // 2. No active session rejected
    const resNoSession = (await submitHandler({}, 'How to deploy?')) as { ok: boolean; error?: string };
    expect(resNoSession).toEqual({ ok: false, error: 'no_active_session' });
    expect(mainWin.webContents.events).toHaveLength(0);

    // 3. Active session succeeds and sends to main
    activeSession = 'sess-42';
    await handles.quickAsk.show();
    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;

    const resOk = (await submitHandler({}, 'How to deploy?')) as { ok: boolean };
    expect(resOk).toEqual({ ok: true });
    expect(mainWin.webContents.events).toContainEqual({
      channel: 'quickask:submit',
      payload: { text: 'How to deploy?' },
    });
    expect(win.hidden).toBe(true);
    cleanup();
  });

  it('caches tasks via publish-tasks and provides them via get-tasks and window show()', async () => {
    const { handlers, handles, cleanup } = stubRuntime({});
    const publishHandler = handlers.get('quickask.publish-tasks')!;
    const getTasksHandler = handlers.get('quickask.get-tasks')!;

    const tasks = [{ id: 't1', label: 'Building index' }];
    await publishHandler({}, tasks);

    // Tasks are pullable even if window was not open
    const pulled = (await getTasksHandler({})) as Array<{ id: string; label: string }>;
    expect(pulled).toEqual(tasks);

    // When the window is opened, onShow automatically syncs the cached tasks
    await handles.quickAsk.show();
    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;
    expect(win.webContents.events).toContainEqual({
      channel: 'quickask:tasks',
      payload: tasks,
    });
    cleanup();
  });

  it('appshot.capture ensures window is created and shown before sending preview event', async () => {
    const { handlers, handles, cleanup } = stubRuntime({});
    expect(handles.quickAsk.getWindow()).toBeNull();

    const captureHandler = handlers.get('appshot.capture')!;
    const captureResult = (await captureHandler({})) as { ok: boolean; windowName: string };

    expect(captureResult.ok).toBe(true);
    expect(captureResult.windowName).toBe('Firefox');

    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;
    expect(win).not.toBeNull();
    expect(win.shown).toBe(true);

    // Preview event was received by the window
    const previewEvent = win.webContents.events.find((e) => e.channel === 'appshot:preview');
    expect(previewEvent).toBeDefined();
    expect((previewEvent?.payload as { windowName: string }).windowName).toBe('Firefox');
    cleanup();
  });

  it('full cycle: capture -> preview -> confirm (rejects without session, succeeds with session, resets preview, allows 2nd use)', async () => {
    let activeSession: string | null = null;
    const { handlers, handles, cleanup } = stubRuntime({
      getActiveSessionId: async () => activeSession,
    });

    mainWin = new FakeBrowserWindow();
    setMainWindow(mainWin as never);

    const captureHandler = handlers.get('appshot.capture')!;
    const confirmHandler = handlers.get('appshot.confirm')!;
    const submitHandler = handlers.get('quickask.submit')!;

    // Cycle 1 - Step 1: capture
    await captureHandler({});
    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;
    expect(win.shown).toBe(true);

    // Cycle 1 - Step 2: confirm without active session returns error without consuming capture
    const confirmNoSession = (await confirmHandler({})) as { ok: boolean; error?: string };
    expect(confirmNoSession).toEqual({ ok: false, error: 'no_active_session' });
    expect(handles.staging.getPending()).not.toBeNull();

    // Cycle 1 - Step 3: confirm with active session succeeds, consumes capture, resets preview, hides window
    activeSession = 'sess-valid';
    const confirmOk = (await confirmHandler({})) as { ok: boolean; filePath: string };
    expect(confirmOk.ok).toBe(true);
    expect(handles.staging.getPending()).toBeNull();

    // Main window received the attachment
    expect(mainWin.webContents.events).toContainEqual({
      channel: 'appshot:attach',
      payload: expect.objectContaining({
        windowName: 'Firefox',
        sessionId: 'sess-valid',
      }),
    });

    // QuickAsk window received a reset event (null)
    expect(win.webContents.events).toContainEqual({
      channel: 'appshot:preview',
      payload: null,
    });
    expect(win.hidden).toBe(true);

    // Verifying that immediate second confirm throws/fails because capture is consumed
    await expect(async () => {
      await confirmHandler({});
    }).rejects.toThrow(/confirmation required/i);

    // Cycle 2 (Second use / Réouverture):
    // The window can be reopened and used for text question
    await handles.quickAsk.show();
    const submitRes = (await submitHandler({}, 'Second question')) as { ok: boolean };
    expect(submitRes.ok).toBe(true);
    expect(mainWin.webContents.events).toContainEqual({
      channel: 'quickask:submit',
      payload: { text: 'Second question' },
    });

    // Or a second capture can be taken and confirmed without error
    await captureHandler({});
    expect(handles.staging.getPending()).not.toBeNull();
    const confirm2 = (await confirmHandler({})) as { ok: boolean; filePath: string };
    expect(confirm2.ok).toBe(true);

    cleanup();
  });

  it('appshot.cancel resets staging and sends preview null to QuickAsk window', async () => {
    const { handlers, handles, cleanup } = stubRuntime({});
    const captureHandler = handlers.get('appshot.capture')!;
    const cancelHandler = handlers.get('appshot.cancel')!;

    await captureHandler({});
    expect(handles.staging.getPending()).not.toBeNull();

    const cancelRes = (await cancelHandler({})) as { ok: boolean };
    expect(cancelRes).toEqual({ ok: true });
    expect(handles.staging.getPending()).toBeNull();

    const win = handles.quickAsk.getWindow() as unknown as FakeBrowserWindow;
    expect(win.webContents.events).toContainEqual({
      channel: 'appshot:preview',
      payload: null,
    });
    cleanup();
  });
});
