/**
 * IPC registration for App Studio's one-click GitHub push (G3).
 *
 * @module main/studio/github-ipc
 */

import type { IpcMain } from 'electron';
import { GithubService, type GithubPushRequest } from './github-service.js';

export const GITHUB_CHANNELS = {
  push: 'studio.github.push',
} as const;

export function registerGithubIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service = new GithubService()
): void {
  ipcMain.handle(GITHUB_CHANNELS.push, async (_event, request: GithubPushRequest) => {
    return service.push(request);
  });
}
