/**
 * Renderer bridge for media generation: wraps the preload `media.generateImage`
 * channel (which delegates to the core image_generate tool). Undefined outside
 * Electron so the UI can degrade gracefully.
 */
import type { MediaAspect } from './media-model.js';

export interface MediaGenApiRequest {
  prompt: string;
  aspect?: MediaAspect;
  /** comfyui | openai | xai — overrides CODEBUDDY_IMAGE_PROVIDER for this call. */
  provider?: string;
  model?: string;
}

export interface MediaEditApiRequest {
  prompt: string;
  imagePath: string;
  maskDataUrl?: string;
  selections?: Array<{ x: number; y: number; width: number; height: number }>;
  provider?: string;
  model?: string;
}

export interface MediaGenApiResponse {
  ok: boolean;
  outputPath?: string;
  url?: string;
  history?: {
    chainId: string;
    headVersionId: string;
    versions: Array<{ id: string; parentId: string | null; path: string; createdAt: number }>;
  };
  error?: string;
}

export interface MediaGenApi {
  generateImage(request: MediaGenApiRequest): Promise<MediaGenApiResponse>;
  editImage(request: MediaEditApiRequest): Promise<MediaGenApiResponse>;
}

interface MediaBridge {
  generateImage?: (request: MediaGenApiRequest) => Promise<MediaGenApiResponse>;
  editImage?: (request: MediaEditApiRequest) => Promise<MediaGenApiResponse>;
}

/** Resolve the media bridge from the preload API, or undefined in a browser. */
export function createMediaGenApi(): MediaGenApi | undefined {
  const bridge = (window as unknown as { electronAPI?: { media?: MediaBridge } }).electronAPI?.media;
  if (!bridge?.generateImage || !bridge.editImage) return undefined;
  const generate = bridge.generateImage.bind(bridge);
  const edit = bridge.editImage.bind(bridge);
  return {
    generateImage: (request) => generate(request),
    editImage: (request) => edit(request),
  };
}
