import type { IpcMain } from 'electron';
import { createFile, deleteEntry, listProjectTree, readProjectFile, renameEntry, writeProjectFile } from './studio-files';
import { assertTrustedRoot, isForbiddenProjectRoot } from './studio-versions-service';

export const STUDIO_FILE_CHANNELS = {
  read: 'studio.files.read',
  write: 'studio.files.write',
  tree: 'studio.files.tree',
  create: 'studio.files.create',
  rename: 'studio.files.rename',
  delete: 'studio.files.delete',
} as const;

export function registerStudioFilesIpc(ipcMain: Pick<IpcMain, 'handle'>, options: { trustedRoots: () => string[] }): void {
  const wrap = async <T>(root: string, fn: (real: string) => Promise<{ ok: boolean; data?: T; error?: string }>) => {
    try {
      const real = await assertTrustedRoot(root, options.trustedRoots);
      if (isForbiddenProjectRoot(real)) {
        return { ok: false, error: 'refusing to version a system or home directory' };
      }
      return await fn(real);
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  ipcMain.handle(STUDIO_FILE_CHANNELS.read, (_event, root: string, relPath: string) => wrap(root, (real) => readProjectFile(real, relPath)));
  ipcMain.handle(STUDIO_FILE_CHANNELS.write, (_event, root: string, relPath: string, content: string) => wrap(root, (real) => writeProjectFile(real, relPath, content)));
  ipcMain.handle(STUDIO_FILE_CHANNELS.tree, (_event, root: string) => wrap(root, (real) => listProjectTree(real)));
  ipcMain.handle(STUDIO_FILE_CHANNELS.create, (_event, root: string, relPath: string) => wrap(root, (real) => createFile(real, relPath)));
  ipcMain.handle(STUDIO_FILE_CHANNELS.rename, (_event, root: string, from: string, to: string) => wrap(root, (real) => renameEntry(real, from, to)));
  ipcMain.handle(STUDIO_FILE_CHANNELS.delete, (_event, root: string, relPath: string) => wrap(root, (real) => deleteEntry(real, relPath)));
}
