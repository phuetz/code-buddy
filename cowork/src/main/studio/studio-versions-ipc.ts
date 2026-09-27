/**
 * IPC des versions locales et des verrous d'un projet App Studio
 * (voir studio-versions-service).
 *
 * @module main/studio/studio-versions-ipc
 */

import type { IpcMain } from 'electron';
import type { StudioVersionsService } from './studio-versions-service.js';

export const STUDIO_VERSIONS_CHANNELS = {
  snapshot: 'studio.versions.snapshot',
  list: 'studio.versions.list',
  restore: 'studio.versions.restore',
  revertPaths: 'studio.versions.revertPaths',
  changedSince: 'studio.versions.changedSince',
  getLocks: 'studio.locks.get',
  setLocks: 'studio.locks.set',
} as const;

export function registerStudioVersionsIpc(ipcMain: Pick<IpcMain, 'handle'>, service: StudioVersionsService): void {
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.snapshot, (_e, root: unknown, label: unknown) => service.snapshot(root, label));
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.list, (_e, root: unknown) => service.list(root));
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.restore, (_e, root: unknown, id: unknown) => service.restore(root, id));
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.revertPaths, (_e, root: unknown, id: unknown, paths: unknown) =>
    service.revertPaths(root, id, paths),
  );
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.changedSince, (_e, root: unknown, id: unknown) => service.changedSince(root, id));
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.getLocks, (_e, root: unknown) => service.getLocks(root));
  ipcMain.handle(STUDIO_VERSIONS_CHANNELS.setLocks, (_e, root: unknown, paths: unknown) => service.setLocks(root, paths));
}
