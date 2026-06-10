/**
 * `liveLauncher.*` IPC — pilot `buddy research` / `buddy flow` live from
 * the GUI. Thin layer over {@link LiveLauncherBridge}; progress streams
 * separately as `liveLauncher.event` ServerEvents.
 *
 * @module main/ipc/live-launcher-ipc
 */

import { ipcMain } from 'electron';
import { LiveLauncherBridge } from '../launcher/live-launcher-bridge';
import type { LiveLauncherStartInput } from '../../shared/live-launcher-types';

export function registerLiveLauncherIpcHandlers(bridge: LiveLauncherBridge = new LiveLauncherBridge()): void {
  ipcMain.handle('liveLauncher.start', async (_event, input: LiveLauncherStartInput) => bridge.start(input));

  ipcMain.handle('liveLauncher.cancel', async (_event, runId: string) => bridge.cancel(runId));

  ipcMain.handle('liveLauncher.status', async (_event, runId: string) => bridge.status(runId));

  ipcMain.handle('liveLauncher.list', async () => bridge.list());
}
