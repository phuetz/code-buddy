import { ipcMain } from 'electron';
import type { AvatarVideoStagedInput, GpuMediaAdminSubmitInput } from '../../shared/gpu-media-admin';
import { GpuMediaAdminBridge } from '../gpu-media/gpu-media-admin-bridge';

export function registerGpuMediaIpcHandlers(
  bridge: GpuMediaAdminBridge = new GpuMediaAdminBridge()
): GpuMediaAdminBridge {
  ipcMain.handle('gpuMedia.capabilities', () => bridge.capabilities());
  ipcMain.handle('gpuMedia.submit', (_event, input: GpuMediaAdminSubmitInput) =>
    bridge.submit(input)
  );
  ipcMain.handle('gpuMedia.submitAvatar', (_event, input: AvatarVideoStagedInput) => bridge.submitAvatar(input));
  ipcMain.handle('gpuMedia.status', (_event, jobId: string) => bridge.status(jobId));
  ipcMain.handle('gpuMedia.cancel', (_event, jobId: string) => bridge.cancel(jobId));
  ipcMain.handle('gpuMedia.download', (_event, jobId: string) => bridge.download(jobId));
  ipcMain.handle('gpuMedia.materialize', (_event, jobId: string) => bridge.materialize(jobId));
  return bridge;
}
