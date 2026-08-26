// cowork/src/main/window-management.ts
import { app, BrowserWindow, nativeTheme, Tray } from 'electron';
import { join, dirname } from 'path';
import { URL } from 'url';
import { localPathFromAppUrlPathname, localPathFromFileUrl } from '../shared/local-file-path';
import { configStore, type AppTheme } from './config/config-store';
import { log, logWarn, logError } from './utils/logger';

// Renderer communication helper
import { sendToRenderer } from './ipc-main-bridge'; // Will be created later

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

export const DARK_BG = '#171614';
export const LIGHT_BG = '#f5f3ee';

export function setupThemeListeners(): void {
  nativeTheme.on('updated', () => {
    sendToRenderer({
      type: 'native-theme.changed',
      payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
    });
    const mainWindow = getMainWindow();
    if (getSavedThemePreference() === 'system' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
    }
  });
}


export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Allow other modules (notably `main/index.ts` which creates its own
 * BrowserWindow) to register the canonical mainWindow so
 * `sendToRenderer()` (`ipc-main-bridge.ts`) can find it. Without this,
 * `getMainWindow()` returns the local-only `let mainWindow` of this
 * module — which stays null when the actual window is created in
 * `index.ts:515` — and every IPC event is silently dropped.
 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

/**
 * Counterpart of `setMainWindow` for the tray. Same pattern: each
 * module that creates a Tray must register it here so `getTray()`
 * reflects reality.
 */
export function setTray(t: Tray | null): void {
  tray = t;
}

export function getTray(): Tray | null {
  return tray;
}

// NOTE: buildMacMenu/setupTray used to be DUPLICATED here (exported but never
// imported — src/main/index.ts calls its own copies). Two live copies in the
// exact file pair that caused the rc.8 dual-mainWindow regression is how
// drift happens; the dead copies were removed 2026-07-03. index.ts owns the
// menu + tray; this module owns the canonical mainWindow/tray REFS only.

export function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

export function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  // Named custom themes map to a dark/light base for native chrome.
  return theme === 'light' || theme === 'anthropic' ? 'light' : 'dark';
}

export function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : resolveEffectiveTheme(theme);
}

export async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

export function extractLocalPathFromNavigationUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      return localPathFromFileUrl(url);
    }
    // Assume VITE_DEV_SERVER_URL is the only allowed origin for app URLs
    if (process.env.VITE_DEV_SERVER_URL) {
      const devServerOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
      if (parsed.origin === devServerOrigin) {
        return localPathFromAppUrlPathname(parsed.pathname || '');
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowedProtocols = new Set<string>(['file:', 'devtools:']);
    if (allowedProtocols.has(parsed.protocol)) {
      return false;
    }
    if (process.env.VITE_DEV_SERVER_URL) {
      const devServerOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
      if (parsed.origin === devServerOrigin) {
        return false;
      }
    }
    return true; // It's not a known internal or allowed URL
  } catch {
    return true; // Malformed URL, treat as external
  }
}

export async function revealFileInFolder(localPath: string): Promise<boolean> {
  try {
    const shell = (await import('electron')).shell; // Dynamically import shell
    shell.showItemInFolder(localPath);
    return true;
  } catch (error) {
    logError(`Failed to reveal file in folder: ${localPath}`, error);
    return false;
  }
}


export function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: DARK_BG,
          titleBar: DARK_BG,
          titleBarSymbol: '#f1ece4',
        }
      : {
          background: LIGHT_BG,
          titleBar: LIGHT_BG,
          titleBarSymbol: '#1a1a1a',
        };

  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      const windowIconName = isMac ? 'icon.icns' : isWindows ? 'icon.ico' : 'icon.png';
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (isMac) {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    windowOptions.frame = false;
  } else {
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealFileInFolder(localPath);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void import('electron').then(({ shell }) => shell.openExternal(url));
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealFileInFolder(localPath);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void import('electron').then(({ shell }) => shell.openExternal(url));
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
  } else {
    mainWindow.loadFile(join(dirname(__dirname), '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAllRedacted(),
      },
    });

    // Send current working directory to renderer
    // This assumes currentWorkingDir is accessible or passed
    // For now, will pass an empty string, will be refactored later
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: '' }, // Placeholder, will be replaced with actual currentWorkingDir
    });

    // Start sandbox bootstrap after window is loaded
    // This assumes startSandboxBootstrap is accessible or called elsewhere
    // For now, this will be handled in the main index.ts
  });
}
