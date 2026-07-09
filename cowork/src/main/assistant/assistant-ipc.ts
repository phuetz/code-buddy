/**
 * IPC surface for the Assistant settings panel. Side-effect free: the main
 * entry calls `registerAssistantIpc` after creating the service.
 */
import type { IpcMain } from 'electron';
import type { AssistantService } from './assistant-service.js';

export const ASSISTANT_CHANNELS = {
  get: 'assistant.get',
  save: 'assistant.save',
  voices: 'assistant.voices',
  preview: 'assistant.preview',
  restart: 'assistant.restart',
  getVolume: 'assistant.getVolume',
  setVolume: 'assistant.setVolume',
} as const;

export function registerAssistantIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: AssistantService
): void {
  ipcMain.handle(ASSISTANT_CHANNELS.get, async () => service.getConfig());
  ipcMain.handle(ASSISTANT_CHANNELS.save, async (_event, updates: Record<string, string>) =>
    service.save(updates ?? {})
  );
  ipcMain.handle(ASSISTANT_CHANNELS.voices, async () => service.voices());
  ipcMain.handle(ASSISTANT_CHANNELS.preview, async (_event, name: string, text?: string) =>
    service.preview(name ?? '', text)
  );
  ipcMain.handle(ASSISTANT_CHANNELS.restart, async () => service.restart());
  ipcMain.handle(ASSISTANT_CHANNELS.getVolume, async () => service.getVolume());
  ipcMain.handle(ASSISTANT_CHANNELS.setVolume, async (_event, percent: number) =>
    service.setVolume(percent)
  );
}
