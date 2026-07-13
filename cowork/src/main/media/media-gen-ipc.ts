/**
 * IPC surface for the media generation service. Side-effect free: the integrator
 * calls `registerMediaGenIpc` from the main entry after creating the service.
 */
import type { IpcMain } from 'electron';
import type { ImageEditRequest, MediaGenRequest, MediaGenService, VideoGenRequest } from './media-gen-service.js';

export const MEDIA_GEN_CHANNELS = {
  generateImage: 'media.generateImage',
  editImage: 'media.editImage',
  imageEditHistory: 'media.imageEditHistory',
  generateVideo: 'media.generateVideo',
  capabilities: 'media.capabilities',
  assembleVideo: 'media.assembleVideo',
} as const;

const MAX_EDIT_PROMPT_CHARS = 20_000;
const MAX_EDIT_PATH_CHARS = 4_096;
const MAX_MASK_DATA_URL_CHARS = 21 * 1024 * 1024;

function validateImageEditRequest(value: unknown):
  | { ok: true; request: ImageEditRequest }
  | { ok: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'invalid image edit request' };
  }
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== 'string' || input.prompt.length > MAX_EDIT_PROMPT_CHARS) {
    return { ok: false, error: 'image edit prompt is invalid' };
  }
  if (typeof input.imagePath !== 'string' || input.imagePath.length > MAX_EDIT_PATH_CHARS || input.imagePath.includes('\0')) {
    return { ok: false, error: 'image edit source path is invalid' };
  }
  if (input.maskDataUrl !== undefined
    && (typeof input.maskDataUrl !== 'string' || input.maskDataUrl.length > MAX_MASK_DATA_URL_CHARS)) {
    return { ok: false, error: 'image edit mask is invalid' };
  }
  if (input.provider !== undefined && (typeof input.provider !== 'string' || input.provider.length > 160)) {
    return { ok: false, error: 'image edit provider is invalid' };
  }
  if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 160)) {
    return { ok: false, error: 'image edit model is invalid' };
  }
  if (input.selections !== undefined && (!Array.isArray(input.selections) || input.selections.length > 20)) {
    return { ok: false, error: 'image edit selections are invalid' };
  }
  const selections = input.selections as unknown[] | undefined;
  if (selections?.some((selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return true;
    const region = selection as Record<string, unknown>;
    return !['x', 'y', 'width', 'height'].every((key) => typeof region[key] === 'number' && Number.isFinite(region[key]));
  })) {
    return { ok: false, error: 'image edit selections are invalid' };
  }

  return {
    ok: true,
    request: {
      prompt: input.prompt,
      imagePath: input.imagePath,
      ...(typeof input.maskDataUrl === 'string' ? { maskDataUrl: input.maskDataUrl } : {}),
      ...(selections ? {
        selections: selections.map((selection) => {
          const region = selection as Record<'x' | 'y' | 'width' | 'height', number>;
          return { x: region.x, y: region.y, width: region.width, height: region.height };
        }),
      } : {}),
      ...(typeof input.provider === 'string' ? { provider: input.provider } : {}),
      ...(typeof input.model === 'string' ? { model: input.model } : {}),
    },
  };
}

export function registerMediaGenIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: MediaGenService,
): void {
  ipcMain.handle(MEDIA_GEN_CHANNELS.generateImage, async (_event, req: MediaGenRequest) =>
    service.generateImage(req ?? { prompt: '' }),
  );
  ipcMain.handle(MEDIA_GEN_CHANNELS.editImage, async (_event, req: unknown) => {
    const validated = validateImageEditRequest(req);
    if (!validated.ok) return { ok: false, error: validated.error };
    return service.editImage(validated.request);
  });
  ipcMain.handle(MEDIA_GEN_CHANNELS.imageEditHistory, async (_event, req: unknown) => {
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return { ok: false, error: 'invalid image edit history request' };
    }
    const imagePath = (req as Record<string, unknown>).imagePath;
    if (typeof imagePath !== 'string' || imagePath.length === 0
      || imagePath.length > MAX_EDIT_PATH_CHARS || imagePath.includes('\0')) {
      return { ok: false, error: 'image edit history source path is invalid' };
    }
    return service.getImageEditHistory(imagePath);
  });
  ipcMain.handle(MEDIA_GEN_CHANNELS.generateVideo, async (_event, req: VideoGenRequest) =>
    service.generateVideo(req ?? { prompt: '' }),
  );
  ipcMain.handle(MEDIA_GEN_CHANNELS.capabilities, async () => service.getCapabilities());
  ipcMain.handle(MEDIA_GEN_CHANNELS.assembleVideo, async (_event, req: { clips?: string[]; aspect?: string; name?: string }) =>
    service.assembleVideo(req ?? {}),
  );
}
