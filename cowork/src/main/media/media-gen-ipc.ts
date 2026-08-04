/**
 * IPC surface for the media generation service. Side-effect free: the integrator
 * calls `registerMediaGenIpc` from the main entry after creating the service.
 */
import type { IpcMain } from 'electron';
import type { AssembleVideoRequest, ImageEditRequest, MediaGenRequest, MediaGenService, VideoGenRequest } from './media-gen-service.js';

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
const MAX_ASSET_ID_CHARS = 300;

function validOptionalString(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === 'string' && value.length <= max && !value.includes('\0'));
}

function validateGenerationRequest(value: unknown, video: boolean): MediaGenRequest | VideoGenRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== 'string' || input.prompt.length === 0 || input.prompt.length > MAX_EDIT_PROMPT_CHARS) return null;
  if (!validOptionalString(input.aspect, 20) || !validOptionalString(input.provider, 160) || !validOptionalString(input.model, 160)) return null;
  const base: MediaGenRequest = {
    prompt: input.prompt,
    ...(typeof input.aspect === 'string' ? { aspect: input.aspect } : {}),
    ...(typeof input.provider === 'string' ? { provider: input.provider } : {}),
    ...(typeof input.model === 'string' ? { model: input.model } : {}),
  };
  if (!video) return base;
  if (!validOptionalString(input.imagePath, MAX_EDIT_PATH_CHARS) || !validOptionalString(input.imageAssetId, MAX_ASSET_ID_CHARS)) return null;
  if (input.duration !== undefined && (typeof input.duration !== 'number' || !Number.isFinite(input.duration) || input.duration < 1 || input.duration > 30)) return null;
  if (input.audio !== undefined && typeof input.audio !== 'boolean') return null;
  const paths = input.referenceImagePaths;
  const ids = input.referenceAssetIds;
  if (paths !== undefined && (!Array.isArray(paths) || paths.length > 3 || paths.some((path) => !validOptionalString(path, MAX_EDIT_PATH_CHARS) || path === undefined))) return null;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 3 || ids.some((id) => !validOptionalString(id, MAX_ASSET_ID_CHARS) || id === undefined))) return null;
  return {
    ...base,
    ...(typeof input.duration === 'number' ? { duration: input.duration } : {}),
    ...(typeof input.audio === 'boolean' ? { audio: input.audio } : {}),
    ...(typeof input.imagePath === 'string' ? { imagePath: input.imagePath } : {}),
    ...(typeof input.imageAssetId === 'string' ? { imageAssetId: input.imageAssetId } : {}),
    ...(Array.isArray(paths) ? { referenceImagePaths: paths as string[] } : {}),
    ...(Array.isArray(ids) ? { referenceAssetIds: ids as string[] } : {}),
  };
}

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
  if (!validOptionalString(input.imagePath, MAX_EDIT_PATH_CHARS)
    || !validOptionalString(input.imageAssetId, MAX_ASSET_ID_CHARS)
    || (typeof input.imagePath !== 'string' && typeof input.imageAssetId !== 'string')) {
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
      ...(typeof input.imagePath === 'string' ? { imagePath: input.imagePath } : {}),
      ...(typeof input.imageAssetId === 'string' ? { imageAssetId: input.imageAssetId } : {}),
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

function validateAssembleRequest(value: unknown): AssembleVideoRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.clips) || input.clips.length < 2 || input.clips.length > 50
    || input.clips.some((clip) => typeof clip !== 'string' || clip.length === 0 || clip.length > MAX_EDIT_PATH_CHARS || clip.includes('\0'))) return null;
  if (input.aspect !== undefined && !['1:1', '16:9', '9:16'].includes(String(input.aspect))) return null;
  if (!validOptionalString(input.name, 200)) return null;
  const request: AssembleVideoRequest = {
    clips: input.clips as string[],
    ...(typeof input.aspect === 'string' ? { aspect: input.aspect } : {}),
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
  };
  if (input.editorial === undefined) return request;
  if (!input.editorial || typeof input.editorial !== 'object' || Array.isArray(input.editorial)) return null;
  const editorial = input.editorial as Record<string, unknown>;
  if (typeof editorial.title !== 'string' || editorial.title.length > 100
    || typeof editorial.description !== 'string' || editorial.description.length > 1_000
    || !validOptionalString(editorial.series, 80)
    || typeof editorial.syntheticMediaDisclosure !== 'boolean'
    || typeof editorial.prompt !== 'string' || editorial.prompt.length > 20_000
    || !Array.isArray(editorial.assetIds) || editorial.assetIds.length > 100
    || editorial.assetIds.some((id) => typeof id !== 'string' || id.length < 8 || id.length > 300)
    || (editorial.previousPrompts !== undefined && (!Array.isArray(editorial.previousPrompts)
      || editorial.previousPrompts.length > 100
      || editorial.previousPrompts.some((prompt) => typeof prompt !== 'string' || prompt.length > 20_000)))) return null;
  return {
    ...request,
    editorial: {
      title: editorial.title,
      description: editorial.description,
      ...(typeof editorial.series === 'string' ? { series: editorial.series } : {}),
      syntheticMediaDisclosure: editorial.syntheticMediaDisclosure,
      prompt: editorial.prompt,
      assetIds: [...new Set(editorial.assetIds as string[])],
      ...(Array.isArray(editorial.previousPrompts) ? { previousPrompts: editorial.previousPrompts as string[] } : {}),
    },
  };
}

export function registerMediaGenIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: MediaGenService,
): void {
  ipcMain.handle(MEDIA_GEN_CHANNELS.generateImage, async (_event, req: unknown) => {
    const validated = validateGenerationRequest(req, false) as MediaGenRequest | null;
    return validated ? service.generateImage(validated) : { ok: false, error: 'invalid image generation request' };
  });
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
  ipcMain.handle(MEDIA_GEN_CHANNELS.generateVideo, async (_event, req: unknown) => {
    const validated = validateGenerationRequest(req, true) as VideoGenRequest | null;
    return validated ? service.generateVideo(validated) : { ok: false, error: 'invalid video generation request' };
  });
  ipcMain.handle(MEDIA_GEN_CHANNELS.capabilities, async () => service.getCapabilities());
  ipcMain.handle(MEDIA_GEN_CHANNELS.assembleVideo, async (_event, req: unknown) => {
    const validated = validateAssembleRequest(req);
    return validated ? service.assembleVideo(validated) : { ok: false, error: 'invalid film assembly request' };
  });
}
