/** Native-shell IPC registration and file-reveal path resolution. */
import { app, ipcMain, shell } from 'electron';
import { execFile } from 'child_process';
import { stat } from 'fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';
import {
  decodePathSafely,
  isUncPath,
  isWindowsDrivePath,
  localPathFromFileUrl,
} from '../../shared/local-file-path';
import { log, logError, logWarn } from '../utils/logger';
import { findFileByName } from './shell-file-discovery';

const execFileAsync = promisify(execFile);

export type RevealFileInFolder = (filePath: string, cwd?: string) => Promise<boolean>;

export interface FileRevealDeps {
  getWorkingDir: () => string | null;
}

export interface ShellIpcDeps {
  revealFileInFolder: RevealFileInFolder;
}

export function createRevealFileInFolder(deps: FileRevealDeps): RevealFileInFolder {
  const { getWorkingDir } = deps;

  return async (filePath: string, cwd?: string): Promise<boolean> => {
    if (!filePath) return false;

    const trimInput = filePath.trim();
    if (!trimInput) return false;

    let normalizedPath = decodePathSafely(trimInput);
    if (normalizedPath.startsWith('file://')) {
      const localPath = localPathFromFileUrl(normalizedPath);
      if (!localPath) {
        logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
        return false;
      }
      normalizedPath = localPath;
    }

    const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
    if (
      !isAbsolute(normalizedPath) &&
      !isWindowsDrivePath(normalizedPath) &&
      !isUncPath(normalizedPath)
    ) {
      normalizedPath = resolve(baseDir, normalizedPath);
    }

    if (
      normalizedPath.startsWith('/workspace/') ||
      /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
    ) {
      const relativePart = normalizedPath.startsWith('/workspace/')
        ? normalizedPath.slice('/workspace/'.length)
        : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
      normalizedPath = resolve(baseDir, relativePart);
    }

    if (!isUncPath(normalizedPath)) normalizedPath = resolve(normalizedPath);
    log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

    try {
      const targetStat = await stat(normalizedPath).catch(() => null);
      if (targetStat) {
        if (targetStat.isDirectory()) {
          const openDirResult = await shell.openPath(normalizedPath);
          if (openDirResult) {
            logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
          }
        } else if (process.platform === 'darwin') {
          try {
            await execFileAsync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
        return true;
      }

      const discoveredPath = await findFileByName(basename(normalizedPath), [
        cwd || '',
        getWorkingDir() || '',
        join(app.getPath('userData'), 'default_working_dir'),
      ]);
      if (discoveredPath) {
        logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
          requested: normalizedPath,
          discoveredPath,
        });
        if (process.platform === 'darwin') {
          try {
            await execFileAsync('open', ['-R', discoveredPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(discoveredPath);
          }
        } else {
          shell.showItemInFolder(discoveredPath);
        }
        return true;
      }

      const parentDir = dirname(normalizedPath);
      const parentStat = parentDir
        ? await stat(parentDir).catch(() => null)
        : null;
      if (parentStat?.isDirectory()) {
        logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
        const openParentResult = await shell.openPath(parentDir);
        if (openParentResult) {
          logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
        }
        return true;
      }

      logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
      return false;
    } catch (error) {
      logError('[shell.showItemInFolder] failed:', error);
      return false;
    }
  };
}

export function registerShellIpcHandlers(deps: ShellIpcDeps): void {
  ipcMain.handle('shell.openExternal', async (_event, url: string) => {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
        return false;
      }
    } catch {
      logWarn('[shell.openExternal] Blocked invalid URL:', url);
      return false;
    }

    return shell.openExternal(url);
  });

  ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
    return deps.revealFileInFolder(filePath, cwd);
  });
}
