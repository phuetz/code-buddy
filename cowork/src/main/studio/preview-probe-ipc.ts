/**
 * IPC registration for the App Studio preview probe (see preview-probe-service).
 *
 * @module main/studio/preview-probe-ipc
 */

import type { IpcMain } from 'electron';
import type { PreviewProbeInput, PreviewProbeService } from './preview-probe-service.js';

export const PREVIEW_PROBE_CHANNELS = {
  probe: 'studio.preview.probe',
} as const;

export function registerPreviewProbeIpc(ipcMain: Pick<IpcMain, 'handle'>, service: PreviewProbeService): void {
  ipcMain.handle(PREVIEW_PROBE_CHANNELS.probe, async (_event, input: PreviewProbeInput) => {
    return service.probe(input);
  });
}
