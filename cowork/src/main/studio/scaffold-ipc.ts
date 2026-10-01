/**
 * IPC registration for App Studio scaffolding.
 *
 * @module main/studio/scaffold-ipc
 */

import type { IpcMain } from 'electron';
import type { ScaffoldProjectInput, ScaffoldService } from './scaffold-service.js';

export const SCAFFOLD_CHANNELS = {
  list: 'studio.scaffold.list',
  generate: 'studio.scaffold.generate',
} as const;

export function registerScaffoldIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: ScaffoldService,
  onCreated?: (projectDir: string) => Promise<void>,
): void {
  ipcMain.handle(SCAFFOLD_CHANNELS.list, async () => {
    return service.listTemplates();
  });

  ipcMain.handle(SCAFFOLD_CHANNELS.generate, async (_event, input: ScaffoldProjectInput) => {
    const result = await service.scaffoldProject(input);
    if (result.ok) await onCreated?.(result.data.projectDir);
    return result;
  });
}
