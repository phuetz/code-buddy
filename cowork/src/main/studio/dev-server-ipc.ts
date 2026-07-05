/**
 * IPC registration for the App Studio dev-server surface.
 *
 * This module is side-effect free: the integrator calls `registerDevServerIpc`
 * from the main-process composition root.
 *
 * @module main/studio/dev-server-ipc
 */

import type { IpcMain, WebContents } from 'electron';
import type { StudioDevServer, StudioDevServerStartInput } from './dev-server-service.js';

export const DEV_SERVER_CHANNELS = {
  start: 'studio.dev.start',
  stop: 'studio.dev.stop',
  status: 'studio.dev.status',
  logs: 'studio.dev.logs',
  log: 'studio.dev.log',
} as const;

export function registerDevServerIpc(ipcMain: Pick<IpcMain, 'handle'>, service: StudioDevServer): void {
  ipcMain.handle(DEV_SERVER_CHANNELS.start, async (_event, input: StudioDevServerStartInput) => {
    return service.start(input);
  });

  ipcMain.handle(DEV_SERVER_CHANNELS.stop, async (_event, pid: number) => {
    return service.stop(pid);
  });

  ipcMain.handle(DEV_SERVER_CHANNELS.status, async () => {
    return service.status();
  });

  ipcMain.handle(DEV_SERVER_CHANNELS.logs, async (_event, pid: number, lines?: number) => {
    return service.logs(pid, lines);
  });
}

export function pushDevLogs(webContents: Pick<WebContents, 'send'>, pid: number, lines: string[]): void {
  webContents.send(DEV_SERVER_CHANNELS.log, { pid, lines });
}
