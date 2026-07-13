/**
 * `media.*` IPC handlers for the generated-media library.
 *
 * The session manager and database are initialized asynchronously during app
 * boot, so both are injected as accessors and resolved only when `media.list`
 * is invoked.
 */
import {
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  type BrowserWindow,
} from 'electron';
import { copyFile } from 'fs/promises';
import { basename, join } from 'path';
import type { DatabaseInstance } from '../db/database';
import { kindOf, scanMediaLibrary } from '../media-library';
import type { SessionManager } from '../session/session-manager';
import { queryMediaMessageBlobs } from '../session/media-message-query';
import { basenameOf, buildMediaSessionIndex } from '../session/media-session-index';
import { logWarn } from '../utils/logger';

export interface MediaLibraryIpcDeps {
  getSessionManager: () => SessionManager | null;
  getDatabase: () => Pick<DatabaseInstance, 'raw'>;
  getMainWindow: () => BrowserWindow | null;
}

export function registerMediaLibraryIpcHandlers(deps: MediaLibraryIpcDeps): void {
  const { getSessionManager, getDatabase, getMainWindow } = deps;

  ipcMain.handle('media.list', async () => {
    try {
      const sessionManager = getSessionManager();
      const roots = new Set<string>();
      roots.add(join(app.getPath('userData'), 'default_working_dir'));
      if (sessionManager) {
        for (const session of sessionManager.listSessions()) {
          if (session.cwd) roots.add(session.cwd);
        }
      }

      const items = scanMediaLibrary([...roots]);
      // Generated tools echo a unique MEDIA:<path> marker into an assistant
      // message. Query only those rows rather than hydrating every session.
      if (sessionManager && items.length > 0) {
        const index = buildMediaSessionIndex(queryMediaMessageBlobs(getDatabase()));
        for (const item of items) {
          const sessionId = index.get(basenameOf(item.path));
          if (sessionId) item.sessionId = sessionId;
        }
      }

      return items;
    } catch (err) {
      logWarn('[media.list] failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'media.copyToClipboard',
    async (_event, { sourcePath }: { sourcePath: string }) => {
      try {
        const kind = kindOf(sourcePath);
        if (kind === 'image') {
          const image = nativeImage.createFromPath(sourcePath);
          if (image.isEmpty()) return { ok: false, error: 'image illisible' };
          clipboard.writeImage(image);
          return { ok: true, mode: 'image' as const };
        }
        // Video/audio clipboards are not portable across desktop platforms.
        clipboard.writeText(sourcePath);
        return { ok: true, mode: 'path' as const };
      } catch (err) {
        logWarn('[media.copyToClipboard] failed:', err);
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle('media.exportMany', async (_event, { paths }: { paths: string[] }) => {
    try {
      const valid = (paths ?? []).filter((path) => kindOf(path));
      if (valid.length === 0) return { ok: false, error: 'no media selected' };
      const mainWindow = getMainWindow();
      const picked = mainWindow
        ? await dialog.showOpenDialog(mainWindow, {
            title: 'Exporter la sélection vers…',
            properties: ['openDirectory', 'createDirectory'],
          })
        : await dialog.showOpenDialog({
            title: 'Exporter la sélection vers…',
            properties: ['openDirectory', 'createDirectory'],
          });
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, canceled: true };
      }

      const destDir = picked.filePaths[0];
      let copied = 0;
      for (const sourcePath of valid) {
        try {
          await copyFile(sourcePath, join(destDir, basename(sourcePath)));
          copied += 1;
        } catch (err) {
          logWarn('[media.exportMany] copy failed:', sourcePath, err);
        }
      }
      return { ok: true, copied, destDir };
    } catch (err) {
      logWarn('[media.exportMany] failed:', err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('media.export', async (_event, { sourcePath }: { sourcePath: string }) => {
    try {
      if (!kindOf(sourcePath)) return { ok: false, error: 'not a media file' };
      const mainWindow = getMainWindow();
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, {
            defaultPath: basename(sourcePath),
            title: 'Exporter le média',
          })
        : await dialog.showSaveDialog({
            defaultPath: basename(sourcePath),
            title: 'Exporter le média',
          });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await copyFile(sourcePath, result.filePath);
      return { ok: true, savedTo: result.filePath };
    } catch (err) {
      logWarn('[media.export] failed:', err);
      return { ok: false, error: String(err) };
    }
  });
}
