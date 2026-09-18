import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow, IpcMain } from 'electron';
import {
  DEFAULT_APPSHOT_ACCELERATOR,
  DEFAULT_DICTATION_ACCELERATOR,
  DEFAULT_QUICKASK_ACCELERATOR,
  PANIC_ACCELERATOR,
  planGlobalAccelerator,
  type ReservedAcceleratorName,
} from './global-accelerators.js';
import { AppshotStaging } from './appshot-capture.js';
import { QuickAskWindow, quickAskLoadTarget } from './quickask-window.js';
import { getMainWindow } from './window-management.js';

export interface QuickAskAppshotRuntime {
  BrowserWindow: typeof import('electron').BrowserWindow;
  screen: typeof import('electron').screen;
  ipcMain: IpcMain;
  globalShortcut: {
    register: (accelerator: string, callback: () => void) => boolean;
    unregister: (accelerator: string) => void;
  };
  desktopCapturer: {
    getSources: (opts: {
      types: Array<'window' | 'screen'>;
      thumbnailSize: { width: number; height: number };
    }) => Promise<
      Array<{
        id: string;
        name: string;
        thumbnail: { isEmpty: () => boolean; toPNG: () => Buffer };
      }>
    >;
  };
  preloadPath: string;
  dirname: string;
  userData: string;
  viteDevServerUrl?: string;
  logWarn: (message: string) => void;
  getActiveSessionId?: () => Promise<string | null>;
}

export interface QuickAskAppshotHandles {
  quickAsk: QuickAskWindow;
  staging: AppshotStaging;
  accelerators: { quickAsk: string; appshot: string };
  dispose: () => void;
}

function linuxActiveWindowName(): string | undefined {
  try {
    const id = execFileSync('xdotool', ['getactivewindow'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!id) return undefined;
    return execFileSync('xdotool', ['getwindowname', id], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

export function registerQuickAskAppshot(runtime: QuickAskAppshotRuntime): QuickAskAppshotHandles {
  const dictation = process.env.COWORK_DICTATION_SHORTCUT?.trim() || DEFAULT_DICTATION_ACCELERATOR;
  const reserved: Partial<Record<ReservedAcceleratorName, string>> = {
    panic: PANIC_ACCELERATOR,
    dictation,
  };

  const quickAskPlan = planGlobalAccelerator({
    envValue: process.env.COWORK_QUICKASK_SHORTCUT,
    fallback: DEFAULT_QUICKASK_ACCELERATOR,
    reserved,
    self: 'quickAsk',
  });
  reserved.quickAsk = quickAskPlan.accelerator;

  const appshotPlan = planGlobalAccelerator({
    envValue: process.env.COWORK_APPSHOT_SHORTCUT,
    fallback: DEFAULT_APPSHOT_ACCELERATOR,
    reserved,
    self: 'appshot',
  });

  const distHtml = join(runtime.dirname, '../../dist/index.html');
  let lastTasks: Array<{ id: string; label: string }> = [];

  const sendToMain = (channel: string, payload: unknown) => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send(channel, payload);
    }
  };

  const sendToQuickAsk = (channel: string, payload: unknown) => {
    const win = quickAsk.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  const syncTasks = () => {
    if (lastTasks.length > 0) {
      sendToQuickAsk('quickask:tasks', lastTasks);
    }
  };

  const quickAsk = new QuickAskWindow({
    BrowserWindow: runtime.BrowserWindow,
    screen: runtime.screen,
    preloadPath: runtime.preloadPath,
    logWarn: runtime.logWarn,
    loadUrl: async (win) => {
      const target = quickAskLoadTarget(runtime.viteDevServerUrl, distHtml);
      if (target.startsWith('http')) {
        await win.loadURL(target);
      } else {
        await win.loadURL(pathToFileURL(distHtml).toString() + '#quickask');
      }
    },
    onShow: () => {
      syncTasks();
    },
  });

  const staging = new AppshotStaging({
    getSources: (opts) => runtime.desktopCapturer.getSources(opts),
    resolveActiveWindowName: process.platform === 'linux' ? linuxActiveWindowName : undefined,
    userData: runtime.userData,
  });

  runtime.ipcMain.handle('quickask.hide', () => {
    quickAsk.hide();
    return { ok: true };
  });
  runtime.ipcMain.handle('quickask.submit', async (_event, text: string) => {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { ok: false, error: 'empty' };
    const sessionId = await runtime.getActiveSessionId?.();
    if (!sessionId) {
      return { ok: false, error: 'no_active_session' };
    }
    sendToMain('quickask:submit', { text: trimmed });
    quickAsk.hide();
    return { ok: true };
  });
  runtime.ipcMain.handle('quickask.publish-tasks', (_event, tasks: unknown) => {
    lastTasks = Array.isArray(tasks) ? (tasks as Array<{ id: string; label: string }>) : [];
    sendToQuickAsk('quickask:tasks', lastTasks);
    return { ok: true };
  });
  runtime.ipcMain.handle('quickask.get-tasks', () => {
    return lastTasks;
  });

  runtime.ipcMain.handle('appshot.capture', async () => {
    const sessionId = (await runtime.getActiveSessionId?.()) ?? 'unattached';
    const pending = await staging.capture(sessionId);
    await quickAsk.show();
    sendToQuickAsk('appshot:preview', {
      dataUrl: pending.dataUrl,
      windowName: pending.windowName,
      filePath: pending.filePath,
    });
    return { ok: true, windowName: pending.windowName };
  });
  runtime.ipcMain.handle('appshot.confirm', async () => {
    const sessionId = await runtime.getActiveSessionId?.();
    if (!sessionId) {
      return { ok: false, error: 'no_active_session' };
    }
    const sent = staging.confirm();
    sendToMain('appshot:attach', {
      filePath: sent.filePath,
      dataUrl: sent.dataUrl,
      windowName: sent.windowName,
      sessionId: sent.sessionId === 'unattached' ? sessionId : sent.sessionId,
    });
    sendToQuickAsk('appshot:preview', null);
    quickAsk.hide();
    return { ok: true, filePath: sent.filePath };
  });
  runtime.ipcMain.handle('appshot.cancel', () => {
    staging.cancel();
    sendToQuickAsk('appshot:preview', null);
    return { ok: true };
  });

  const ipcChannels = [
    'quickask.hide',
    'quickask.submit',
    'quickask.publish-tasks',
    'quickask.get-tasks',
    'appshot.capture',
    'appshot.confirm',
    'appshot.cancel',
  ] as const;

  const tryRegister = (
    plan: { accelerator: string; conflict: ReservedAcceleratorName | null },
    label: string,
    handler: () => void,
  ): boolean => {
    if (plan.conflict) {
      runtime.logWarn(
        `[App] ${label} shortcut unavailable: ${plan.accelerator} conflicts with ${plan.conflict}`,
      );
      return false;
    }
    const registered = runtime.globalShortcut.register(plan.accelerator, handler);
    if (!registered) {
      runtime.logWarn(`[App] ${label} shortcut unavailable: ${plan.accelerator}`);
    }
    return registered;
  };

  const quickAskRegistered = tryRegister(quickAskPlan, 'Quick Ask', () => {
    void quickAsk.toggle();
  });
  const appshotRegistered = tryRegister(appshotPlan, 'Appshot', () => {
    void (async () => {
      try {
        const sessionId = (await runtime.getActiveSessionId?.()) ?? 'unattached';
        const pending = await staging.capture(sessionId);
        await quickAsk.show();
        sendToQuickAsk('appshot:preview', {
          dataUrl: pending.dataUrl,
          windowName: pending.windowName,
          filePath: pending.filePath,
        });
      } catch (error) {
        runtime.logWarn(
          `[App] Appshot capture failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  });

  return {
    quickAsk,
    staging,
    accelerators: { quickAsk: quickAskPlan.accelerator, appshot: appshotPlan.accelerator },
    dispose: () => {
      if (quickAskRegistered) runtime.globalShortcut.unregister(quickAskPlan.accelerator);
      if (appshotRegistered) runtime.globalShortcut.unregister(appshotPlan.accelerator);
      for (const channel of ipcChannels) {
        runtime.ipcMain.removeHandler(channel);
      }
      staging.cancel();
      quickAsk.destroy();
    },
  };
}

export function activeSessionIdFromMainWindow(win: BrowserWindow | null): Promise<string | null> {
  if (!win || win.isDestroyed()) return Promise.resolve(null);
  return win.webContents
    .executeJavaScript(
      `(() => { try { return window.useAppStore?.getState?.()?.activeSessionId ?? null; } catch { return null; } })()`,
    )
    .then((id) => (typeof id === 'string' && id ? id : null))
    .catch(() => null);
}
