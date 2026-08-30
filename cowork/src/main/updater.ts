/**
 * Auto-Updater Module
 *
 * Initializes electron-updater for automatic app updates.
 * Exposes IPC handlers for update checking, downloading, and installing.
 */
import { ipcMain, type BrowserWindow } from 'electron';
import { log, logError } from './utils/logger';
import { getMainWindow } from './window-management';

let autoUpdater: {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
} | null = null;

/**
 * Initialize the auto-updater. Call once after app.whenReady().
 */
export function initUpdater(mainWindow: BrowserWindow): void {
  const currentWindow = (): BrowserWindow | null => {
    const activeWindow = getMainWindow();
    if (activeWindow && !activeWindow.isDestroyed()) return activeWindow;
    return mainWindow.isDestroyed() ? null : mainWindow;
  };
  const sendToCurrentWindow = (event: unknown): void => {
    currentWindow()?.webContents.send('server-event', event);
  };
  try {
     
    const { autoUpdater: updater } = require('electron-updater');
    autoUpdater = updater;

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;

    updater.on('update-available', (info: { version?: string; releaseNotes?: string }) => {
      log('[Updater] Update available:', info.version);
      sendToCurrentWindow({
        type: 'update.available',
        payload: {
          available: true,
          version: info.version,
          releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
          downloaded: false,
        },
      });
    });

    updater.on('download-progress', (progress: { percent?: number }) => {
      sendToCurrentWindow({
        type: 'update.progress',
        payload: { percent: progress.percent || 0 },
      });
    });

    updater.on('update-downloaded', (info: { version?: string }) => {
      log('[Updater] Update downloaded:', info.version);
      sendToCurrentWindow({
        type: 'update.downloaded',
        payload: {
          available: true,
          version: info.version,
          downloaded: true,
        },
      });
    });

    updater.on('error', (err: Error) => {
      logError('[Updater] Error:', err);
    });

    // Register IPC handlers
    ipcMain.handle('update.check', async () => {
      if (!autoUpdater) return null;
      try {
        return await autoUpdater.checkForUpdates();
      } catch (err) {
        logError('[Updater] Check failed:', err);
        return null;
      }
    });

    ipcMain.handle('update.download', async () => {
      if (!autoUpdater) return;
      try {
        await autoUpdater.downloadUpdate();
      } catch (err) {
        logError('[Updater] Download failed:', err);
      }
    });

    ipcMain.handle('update.install', () => {
      if (!autoUpdater) return;
      autoUpdater.quitAndInstall();
    });

    // Check for updates on startup (after 5 seconds)
    setTimeout(() => {
      updater.checkForUpdates().catch(() => {
        // Silent — no network or no updates
      });
    }, 5000);

    log('[Updater] Initialized');
  } catch (err) {
    log('[Updater] electron-updater not available, skipping auto-update');
  }
}
