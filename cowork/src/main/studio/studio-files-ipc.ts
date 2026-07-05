import type { IpcMain } from 'electron';
import { createFile, deleteEntry, listProjectTree, readProjectFile, renameEntry, writeProjectFile } from './studio-files';

export const STUDIO_FILE_CHANNELS = {
  read: 'studio.files.read',
  write: 'studio.files.write',
  tree: 'studio.files.tree',
  create: 'studio.files.create',
  rename: 'studio.files.rename',
  delete: 'studio.files.delete',
} as const;

export function registerStudioFilesIpc(ipcMain: Pick<IpcMain, 'handle'>): void {
  ipcMain.handle(STUDIO_FILE_CHANNELS.read, (_event, root: string, relPath: string) => readProjectFile(root, relPath));
  ipcMain.handle(STUDIO_FILE_CHANNELS.write, (_event, root: string, relPath: string, content: string) => writeProjectFile(root, relPath, content));
  ipcMain.handle(STUDIO_FILE_CHANNELS.tree, (_event, root: string) => listProjectTree(root));
  ipcMain.handle(STUDIO_FILE_CHANNELS.create, (_event, root: string, relPath: string) => createFile(root, relPath));
  ipcMain.handle(STUDIO_FILE_CHANNELS.rename, (_event, root: string, from: string, to: string) => renameEntry(root, from, to));
  ipcMain.handle(STUDIO_FILE_CHANNELS.delete, (_event, root: string, relPath: string) => deleteEntry(root, relPath));
}
