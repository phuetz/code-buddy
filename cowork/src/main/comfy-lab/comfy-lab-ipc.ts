import type { IpcMain } from 'electron';
import {
  COMFY_LAB_CHANNELS,
  type ComfyLabActionResult,
  type ComfyLabSnapshotResult,
  type ComfyLabUseCaseId,
} from '../../shared/comfy-lab';
import { ComfyLabService } from './comfy-lab-service';

const USE_CASE_IDS = new Set<ComfyLabUseCaseId>([
  'book-visuals',
  'wan-animatic',
  'character-consistency',
  'ace-music',
  'avatar',
  'three-d',
]);

/** Register the read-only ComfyUI audit and its two explicit safe actions. */
export function registerComfyLabIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: ComfyLabService,
): void {
  ipcMain.handle(COMFY_LAB_CHANNELS.inspect, async (): Promise<ComfyLabSnapshotResult> => {
    try {
      return { ok: true, snapshot: await service.inspect() };
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  });
  ipcMain.handle(COMFY_LAB_CHANNELS.openComfyUi, async (): Promise<ComfyLabActionResult> => {
    try {
      return await service.openComfyUi();
    } catch (error) {
      return { ok: false, error: cleanError(error) };
    }
  });
  ipcMain.handle(
    COMFY_LAB_CHANNELS.copyPlan,
    async (_event, input?: { useCaseId?: unknown }): Promise<ComfyLabActionResult> => {
      if (typeof input?.useCaseId !== 'string' || !USE_CASE_IDS.has(input.useCaseId as ComfyLabUseCaseId)) {
        return { ok: false, error: 'Cas d’usage ComfyUI invalide.' };
      }
      try {
        return await service.copyPlan(input.useCaseId as ComfyLabUseCaseId);
      } catch (error) {
        return { ok: false, error: cleanError(error) };
      }
    },
  );
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').slice(0, 500);
}
