import { randomUUID } from 'crypto';
import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { getImageGenerationModel } from '../config/agent-defaults.js';
import { resolveToolGatewayRoute } from '../agent/tool-gateway-router.js';

export type ImageAspectRatio = 'landscape' | 'square' | 'portrait';
export type MediaProvider = 'openai' | 'xai' | 'fal' | 'comfyui';

export interface MediaGenerationRuntime {
  rootDir?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
  signal?: AbortSignal;
}

export interface ImageGenerateInput {
  prompt: string;
  aspectRatio?: string;
}

export interface ImageEditSelection {
  /** Normalized coordinates in the source image (0..1). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditInput {
  prompt: string;
  /** Source image as a bounded data URL, or an HTTPS URL for providers that support it (xAI). */
  imageUrl: string;
  /** Optional non-secret local provenance stored in the output sidecar. */
  sourceRef?: string;
  /** Optional PNG data URL whose alpha channel marks the editable area. */
  maskUrl?: string;
  selections?: ImageEditSelection[];
}

export interface ImageGenerateResult {
  kind: 'image_generate_result';
  success: boolean;
  image: string | null;
  mediaPath?: string;
  outputPath?: string;
  provider: MediaProvider;
  model: string;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  generatedAt: string;
  revised_prompt?: string;
  error?: string;
  error_type?: string;
}

export interface ImageEditResult extends Omit<ImageGenerateResult, 'kind' | 'aspect_ratio'> {
  kind: 'image_edit_result';
  source: string;
  masked: boolean;
  maskMode: 'alpha' | 'region-prompt' | 'none';
  selections: ImageEditSelection[];
}

export interface ImageEditCapabilities {
  provider: MediaProvider;
  available: boolean;
  alphaMasking: boolean;
  reason?: string;
}

export interface VideoGenerateInput {
  prompt: string;
  imageUrl?: string;
  referenceImageUrls?: string[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  negativePrompt?: string;
  audio?: boolean;
  seed?: number;
  model?: string;
}

export interface VideoGenerateResult {
  kind: 'video_generate_result';
  success: boolean;
  video: string | null;
  mediaPath?: string;
  outputPath?: string;
  provider: MediaProvider;
  model: string;
  prompt: string;
  modality: 'text' | 'image';
  aspect_ratio: string;
  duration: number;
  generatedAt: string;
  request_id?: string;
  endpoint?: string;
  error?: string;
  error_type?: string;
}

interface ProviderConfig {
  provider: MediaProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface FalVideoFamily {
  textEndpoint: string;
  imageEndpoint: string;
  defaultDuration: number;
  supportsAudio: boolean;
  supportsNegativePrompt: boolean;
}

const IMAGE_SIZES: Record<ImageAspectRatio, string> = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
};

const FAL_VIDEO_FAMILIES: Record<string, FalVideoFamily> = {
  'pixverse-v6': {
    textEndpoint: 'fal-ai/pixverse/v6/text-to-video',
    imageEndpoint: 'fal-ai/pixverse/v6/image-to-video',
    defaultDuration: 5,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
  'ltx-2.3': {
    textEndpoint: 'fal-ai/ltx-2.3-22b/text-to-video',
    imageEndpoint: 'fal-ai/ltx-2.3-22b/image-to-video',
    defaultDuration: 5,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
  'veo3.1': {
    textEndpoint: 'fal-ai/veo3.1',
    imageEndpoint: 'fal-ai/veo3.1/image-to-video',
    defaultDuration: 4,
    supportsAudio: true,
    supportsNegativePrompt: true,
  },
};

export async function generateImage(
  input: ImageGenerateInput,
  runtime: MediaGenerationRuntime = {},
): Promise<ImageGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required for image generation');
  }

  const config = resolveImageProvider(runtime.env ?? process.env);
  const aspect = resolveImageAspect(input.aspectRatio);
  const fetchImpl = runtime.fetch ?? fetch;
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();

  // ComfyUI has a workflow-submit/poll/view API, not /images/generations.
  if (config.provider === 'comfyui') {
    return generateComfyUIImage(prompt, aspect, config, runtime, generatedAt);
  }

  const size = IMAGE_SIZES[aspect];
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    size,
    n: 1,
  };

  if (config.provider === 'openai') {
    body.quality = env(runtime.env, 'CODEBUDDY_IMAGE_QUALITY') ?? 'medium';
  } else if (config.provider === 'xai') {
    body.aspect_ratio = aspectToProviderRatio(aspect);
    body.resolution = env(runtime.env, 'CODEBUDDY_IMAGE_RESOLUTION') ?? '1k';
    delete body.size;
  }

  const response = await postJson(fetchImpl, joinUrl(config.baseUrl, '/images/generations'), {
    headers: authHeaders(config.apiKey),
    body,
  });
  const first = firstDataItem(response);
  const b64 = stringField(first, 'b64_json');
  const remoteUrl = stringField(first, 'url');
  const revisedPrompt = stringField(first, 'revised_prompt');

  let imageRef: string | undefined;
  let outputPath: string | undefined;
  if (b64) {
    const bytes = Buffer.from(b64, 'base64');
    outputPath = await saveGeneratedAsset(bytes, {
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image',
      extension: 'png',
      createId: runtime.createId,
    });
    imageRef = outputPath;
  } else if (remoteUrl) {
    const downloaded = await tryDownloadAsset(remoteUrl, {
      fetchImpl,
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image',
      fallbackExtension: 'png',
      createId: runtime.createId,
      maxBytes: 25 * 1024 * 1024,
    });
    outputPath = downloaded.outputPath;
    imageRef = downloaded.outputPath ?? remoteUrl;
  }

  if (!imageRef) {
    throw new Error('Image provider returned neither b64_json nor url');
  }

  await writeMediaSidecar(outputPath, {
    kind: 'image',
    prompt,
    ...(revisedPrompt ? { revisedPrompt } : {}),
    provider: config.provider,
    model: config.model,
    aspect_ratio: aspect,
    generatedAt,
  });

  return {
    kind: 'image_generate_result',
    success: true,
    image: imageRef,
    ...(outputPath ? { outputPath, mediaPath: `MEDIA:${outputPath}` } : {}),
    provider: config.provider,
    model: config.model,
    prompt,
    aspect_ratio: aspect,
    generatedAt,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}

/**
 * Edit an existing image without overwriting it. OpenAI receives a real PNG
 * alpha mask through `/images/edits`; xAI receives its documented JSON image
 * edit request and a precise normalized-region hint in the prompt. ComfyUI
 * runs only through an explicit, validated API-format inpaint workflow.
 */
export async function editImage(
  input: ImageEditInput,
  runtime: MediaGenerationRuntime = {},
): Promise<ImageEditResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('prompt is required for image editing');
  const imageUrl = validateImageReference(input.imageUrl, 'source image');
  const selections = normalizeEditSelections(input.selections);
  const maskUrl = input.maskUrl ? validateDataImage(input.maskUrl, 'mask') : undefined;
  const config = resolveImageProvider(runtime.env ?? process.env);
  const fetchImpl = runtime.fetch ?? fetch;
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();
  const selectionHint = selections.length > 0
    ? ` Preserve everything outside these normalized regions (x,y,width,height): ${selections
      .map((selection) => `${selection.x.toFixed(4)},${selection.y.toFixed(4)},${selection.width.toFixed(4)},${selection.height.toFixed(4)}`)
      .join('; ')}.`
    : '';
  const effectivePrompt = `${prompt}${selectionHint}`;

  if (config.provider === 'comfyui') {
    return editComfyUIImage({
      prompt,
      effectivePrompt,
      imageUrl,
      maskUrl,
      selections,
      sourceRef: input.sourceRef,
    }, config, runtime, generatedAt);
  }

  let response: Record<string, unknown>;
  if (config.provider === 'xai') {
    response = await postJson(fetchImpl, joinUrl(config.baseUrl, '/images/edits'), {
      headers: authHeaders(config.apiKey),
      body: {
        model: config.model,
        prompt: effectivePrompt,
        image: { url: imageUrl, type: 'image_url' },
      },
    });
  } else {
    if (!imageUrl.startsWith('data:')) {
      throw new Error('OpenAI image edits require a bounded image data URL; HTTPS sources are supported only by xAI');
    }
    const form = new FormData();
    form.append('model', config.model);
    form.append('prompt', effectivePrompt);
    form.append('image[]', dataUrlToBlob(imageUrl, 'source image'), 'source.png');
    if (maskUrl) form.append('mask', dataUrlToBlob(maskUrl, 'mask'), 'mask.png');
    const httpResponse = await fetchWithTimeout(fetchImpl, joinUrl(config.baseUrl, '/images/edits'), {
      method: 'POST',
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      body: form,
    }, 180_000);
    response = await readJsonResponse(httpResponse, joinUrl(config.baseUrl, '/images/edits'));
  }

  const first = firstDataItem(response);
  const b64 = stringField(first, 'b64_json');
  const remoteUrl = stringField(first, 'url');
  const revisedPrompt = stringField(first, 'revised_prompt');
  let outputPath: string | undefined;
  if (b64) {
    outputPath = await saveGeneratedAsset(Buffer.from(b64, 'base64'), {
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image-edit',
      extension: 'png',
      createId: runtime.createId,
    });
  } else if (remoteUrl) {
    outputPath = (await tryDownloadAsset(remoteUrl, {
      fetchImpl,
      rootDir: runtime.rootDir,
      dirName: 'images',
      prefix: 'image-edit',
      fallbackExtension: 'png',
      createId: runtime.createId,
      maxBytes: 50 * 1024 * 1024,
    })).outputPath;
  }
  const image = outputPath ?? remoteUrl;
  if (!image) throw new Error('Image edit provider returned neither b64_json nor url');

  const maskMode: ImageEditResult['maskMode'] = config.provider === 'openai' && maskUrl
    ? 'alpha'
    : selections.length > 0
      ? 'region-prompt'
      : 'none';
  const sourceReference = sanitizeImageSourceReference(input.sourceRef) ?? redactDataUrl(imageUrl);
  await writeMediaSidecar(outputPath, {
    kind: 'image-edit',
    prompt,
    ...(revisedPrompt ? { revisedPrompt } : {}),
    provider: config.provider,
    model: config.model,
    source: sourceReference,
    masked: maskMode === 'alpha',
    maskMode,
    selections,
    generatedAt,
  });

  return {
    kind: 'image_edit_result',
    success: true,
    image,
    ...(outputPath ? { outputPath, mediaPath: `MEDIA:${outputPath}` } : {}),
    provider: config.provider,
    model: config.model,
    prompt,
    generatedAt,
    source: sourceReference,
    masked: maskMode === 'alpha',
    maskMode,
    selections,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}

// ---------------------------------------------------------------------------
// ComfyUI local image backend (offline, GPU). Distinct from the OpenAI-shaped
// providers: it submits a node graph to /prompt, polls /history/{id} until the
// SaveImage node reports outputs, then downloads the PNG from /view. Fail-closed
// on unreachable server / rejected workflow / timeout.
// ---------------------------------------------------------------------------

interface ComfyParams {
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

const COMFY_DIMS: Record<ImageAspectRatio, { width: number; height: number }> = {
  landscape: { width: 1024, height: 768 },
  square: { width: 768, height: 768 },
  portrait: { width: 768, height: 1024 },
};

/** Sampler/step defaults keyed off the checkpoint family (turbo → few-step). */
function comfyParamsForModel(model: string): ComfyParams {
  const m = model.toLowerCase();
  if (m.includes('turbo') || m.includes('lightning') || m.includes('lcm') || m.includes('hyper')) {
    return { steps: 4, cfg: 1.0, sampler: 'euler', scheduler: 'sgm_uniform' };
  }
  if (m.includes('flux')) {
    return { steps: 20, cfg: 1.0, sampler: 'euler', scheduler: 'simple' };
  }
  return { steps: 20, cfg: 7.0, sampler: 'euler', scheduler: 'normal' };
}

function buildComfyWorkflow(
  prompt: string,
  negative: string,
  ckpt: string,
  dims: { width: number; height: number },
  params: ComfyParams,
  seed: number,
): Record<string, unknown> {
  return {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: params.sampler,
        scheduler: params.scheduler,
        denoise: 1.0,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: dims.width, height: dims.height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'codebuddy', images: ['8', 0] } },
  };
}

interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

interface ComfyWorkflowBinding {
  nodeId: string;
  input: string;
}

interface ComfyInpaintBindings {
  source: ComfyWorkflowBinding;
  mask: ComfyWorkflowBinding;
  prompt: ComfyWorkflowBinding;
  negativePrompt?: ComfyWorkflowBinding;
  output: ComfyWorkflowBinding;
}

interface ComfyInpaintTemplate {
  workflow: Record<string, ComfyWorkflowNode>;
  bindings: ComfyInpaintBindings;
}

interface ComfyUploadedImage extends ComfyImageRef {
  workflowPath: string;
}

const COMFY_INPAINT_PLACEHOLDERS = {
  source: '{{CODEBUDDY_SOURCE_IMAGE}}',
  mask: '{{CODEBUDDY_MASK_IMAGE}}',
  prompt: '{{CODEBUDDY_PROMPT}}',
  negativePrompt: '{{CODEBUDDY_NEGATIVE_PROMPT}}',
  output: '{{CODEBUDDY_OUTPUT_PREFIX}}',
} as const;
const MAX_COMFY_WORKFLOW_BYTES = 1024 * 1024;
const MAX_COMFY_WORKFLOW_NODES = 512;
const SAFE_COMFY_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_COMFY_INPUT = /^[A-Za-z0-9_.-]{1,64}$/;

/** First image emitted by any output node in a /history entry, or null. */
function firstComfyImage(outputs: unknown): ComfyImageRef | null {
  if (!outputs || typeof outputs !== 'object') return null;
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const images = (node as { images?: unknown }).images;
    if (Array.isArray(images)) {
      for (const img of images) {
        const filename = stringField(img, 'filename');
        if (filename) {
          return {
            filename,
            subfolder: stringField(img, 'subfolder') ?? '',
            type: stringField(img, 'type') ?? 'output',
          };
        }
      }
    }
  }
  return null;
}

function comfyDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function getImageEditCapabilities(
  runtime: MediaGenerationRuntime = {},
): Promise<ImageEditCapabilities> {
  const config = resolveImageProvider(runtime.env ?? process.env);
  if (config.provider === 'openai') {
    return { provider: config.provider, available: true, alphaMasking: true };
  }
  if (config.provider === 'xai') {
    return { provider: config.provider, available: true, alphaMasking: false };
  }
  if (config.provider !== 'comfyui') {
    return { provider: config.provider, available: false, alphaMasking: false, reason: 'Provider does not support image editing' };
  }
  try {
    await loadComfyInpaintTemplate(runtime);
    return { provider: 'comfyui', available: true, alphaMasking: true };
  } catch (error) {
    return {
      provider: 'comfyui',
      available: false,
      alphaMasking: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function editComfyUIImage(
  input: {
    prompt: string;
    effectivePrompt: string;
    imageUrl: string;
    maskUrl?: string;
    selections: ImageEditSelection[];
    sourceRef?: string;
  },
  config: ProviderConfig,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<ImageEditResult> {
  throwIfAborted(runtime.signal);
  const template = await loadComfyInpaintTemplate(runtime);
  if (!input.imageUrl.startsWith('data:')) {
    throw new Error('ComfyUI inpainting requires a bounded source image data URL');
  }
  if (!input.maskUrl) {
    throw new Error('ComfyUI inpainting requires an explicit PNG alpha mask');
  }
  if (!input.maskUrl.toLowerCase().startsWith('data:image/png;base64,')) {
    throw new Error('ComfyUI inpainting requires a PNG alpha mask');
  }
  if (input.effectivePrompt.length > 20_000) {
    throw new Error('ComfyUI inpainting prompt exceeds 20000 characters');
  }

  const fetchImpl = runtime.fetch ?? fetch;
  const envSource = runtime.env ?? process.env;
  const clientId = sanitizeId(runtime.createId?.() ?? randomUUID()).slice(0, 80);
  const source = await uploadComfyInput({
    baseUrl: config.baseUrl,
    dataUrl: input.imageUrl,
    filename: `codebuddy-source-${clientId}`,
    fetchImpl,
    signal: runtime.signal,
  });
  const mask = await uploadComfyInput({
    baseUrl: config.baseUrl,
    dataUrl: input.maskUrl,
    filename: `codebuddy-mask-${clientId}`,
    fetchImpl,
    signal: runtime.signal,
    maskFor: source,
  });
  const workflow = instantiateComfyInpaintWorkflow(template, {
    source: source.workflowPath,
    mask: mask.workflowPath,
    prompt: input.effectivePrompt,
    negativePrompt: env(envSource, 'CODEBUDDY_IMAGE_NEGATIVE') ?? 'blurry, low quality, deformed, watermark',
    outputPrefix: `codebuddy-inpaint-${clientId}`,
  });

  const submit = await postJson(fetchImpl, joinUrl(config.baseUrl, '/prompt'), {
    headers: { 'Content-Type': 'application/json' },
    body: { prompt: workflow, client_id: clientId },
    timeoutMs: comfyDuration(envSource, 'CODEBUDDY_COMFYUI_SUBMIT_TIMEOUT_MS', 120_000, 1_000, 300_000),
    signal: runtime.signal,
  });
  const promptId = stringField(submit, 'prompt_id');
  if (!promptId || !SAFE_COMFY_ID.test(promptId) || isDangerousKey(promptId)) {
    const detail = submit.error ?? submit.node_errors;
    throw new Error(`ComfyUI rejected the inpaint workflow${detail ? `: ${JSON.stringify(detail).slice(0, 300)}` : ' (no valid prompt_id)'}`);
  }

  const outputRef = await pollComfyOutput({
    baseUrl: config.baseUrl,
    promptId,
    outputNodeId: template.bindings.output.nodeId,
    fetchImpl,
    signal: runtime.signal,
    timeoutMs: comfyDuration(envSource, 'CODEBUDDY_COMFYUI_INPAINT_TIMEOUT_MS',
      comfyDuration(envSource, 'CODEBUDDY_COMFYUI_TIMEOUT_MS', 300_000, 0, 900_000), 0, 900_000),
    intervalMs: comfyDuration(envSource, 'CODEBUDDY_COMFYUI_POLL_MS', 1_500, 10, 10_000),
    now: runtime.now ?? (() => new Date()),
  });
  const viewUrl = joinUrl(config.baseUrl,
    `/view?filename=${encodeURIComponent(outputRef.filename)}&subfolder=${encodeURIComponent(outputRef.subfolder)}&type=output`);
  const viewResponse = await fetchWithTimeout(fetchImpl, viewUrl, {
    headers: { Accept: 'image/png' },
  }, 120_000, runtime.signal);
  if (!viewResponse.ok) {
    throw new Error(`ComfyUI /view returned ${viewResponse.status} for the configured inpaint output`);
  }
  const bytes = await readBoundedResponseBytes(
    viewResponse,
    MAX_EDIT_REFERENCE_BYTES,
    120_000,
    runtime.signal,
    'ComfyUI inpaint output',
  );
  if (bytes.length <= 0 || bytes.length > MAX_EDIT_REFERENCE_BYTES || !isPng(bytes)) {
    throw new Error('ComfyUI inpaint output must be a PNG smaller than 50 MB');
  }
  const outputPath = await saveGeneratedAsset(bytes, {
    rootDir: runtime.rootDir,
    dirName: 'images',
    prefix: 'image-edit',
    extension: 'png',
    createId: runtime.createId,
  });
  const sourceReference = sanitizeImageSourceReference(input.sourceRef) ?? redactDataUrl(input.imageUrl);
  await writeMediaSidecar(outputPath, {
    kind: 'image-edit',
    prompt: input.prompt,
    provider: 'comfyui',
    model: config.model,
    source: sourceReference,
    masked: true,
    maskMode: 'alpha',
    selections: input.selections,
    generatedAt,
  });
  return {
    kind: 'image_edit_result',
    success: true,
    image: outputPath,
    outputPath,
    mediaPath: `MEDIA:${outputPath}`,
    provider: 'comfyui',
    model: config.model,
    prompt: input.prompt,
    generatedAt,
    source: sourceReference,
    masked: true,
    maskMode: 'alpha',
    selections: input.selections,
  };
}

async function loadComfyInpaintTemplate(runtime: MediaGenerationRuntime): Promise<ComfyInpaintTemplate> {
  const envSource = runtime.env ?? process.env;
  const configuredPath = env(envSource, 'CODEBUDDY_COMFYUI_INPAINT_WORKFLOW');
  const inline = env(envSource, 'CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON');
  if (configuredPath && inline) {
    throw new Error('Configure either CODEBUDDY_COMFYUI_INPAINT_WORKFLOW or CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON, not both');
  }
  if (!configuredPath && !inline) {
    throw new Error('ComfyUI image editing requires an explicit inpaint workflow (CODEBUDDY_COMFYUI_INPAINT_WORKFLOW or CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON)');
  }

  let raw: string;
  if (inline) {
    if (Buffer.byteLength(inline) > MAX_COMFY_WORKFLOW_BYTES) throw new Error('ComfyUI inpaint workflow JSON exceeds 1 MB');
    raw = inline;
  } else {
    const requested = configuredPath!;
    if (requested.includes('\0')) throw new Error('ComfyUI inpaint workflow path is invalid');
    const workflowPath = path.resolve(runtime.rootDir ?? process.cwd(), requested);
    const metadata = await fs.lstat(workflowPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_COMFY_WORKFLOW_BYTES) {
      throw new Error('ComfyUI inpaint workflow must be a regular JSON file smaller than 1 MB');
    }
    raw = await fs.readFile(workflowPath, 'utf8');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`ComfyUI inpaint workflow is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isPlainRecord(parsed)) throw new Error('ComfyUI inpaint workflow must be a JSON object');

  let workflowValue: unknown;
  let bindingsValue: unknown;
  if ('workflow' in parsed || 'bindings' in parsed) {
    if (!('workflow' in parsed) || !('bindings' in parsed)) {
      throw new Error('ComfyUI inpaint workflow bundle requires both workflow and bindings');
    }
    if (Object.keys(parsed).some((key) => !['schemaVersion', 'workflow', 'bindings'].includes(key))
      || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)) {
      throw new Error('ComfyUI inpaint workflow bundle contains unsupported fields or schemaVersion');
    }
    workflowValue = parsed.workflow;
    bindingsValue = parsed.bindings;
    if (env(envSource, 'CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON')) {
      throw new Error('Do not combine bundled ComfyUI bindings with CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON');
    }
  } else {
    workflowValue = parsed;
    const bindingsJson = env(envSource, 'CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON');
    if (!bindingsJson || Buffer.byteLength(bindingsJson) > 32_768) {
      throw new Error('A direct ComfyUI API workflow requires bounded CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON');
    }
    try {
      bindingsValue = JSON.parse(bindingsJson) as unknown;
    } catch (error) {
      throw new Error(`ComfyUI inpaint bindings are invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return validateComfyInpaintTemplate(workflowValue, bindingsValue);
}

function validateComfyInpaintTemplate(workflowValue: unknown, bindingsValue: unknown): ComfyInpaintTemplate {
  if (!isPlainRecord(workflowValue)) throw new Error('ComfyUI inpaint workflow graph must be an object');
  const entries = Object.entries(workflowValue);
  if (entries.length === 0 || entries.length > MAX_COMFY_WORKFLOW_NODES) {
    throw new Error(`ComfyUI inpaint workflow must contain 1..${MAX_COMFY_WORKFLOW_NODES} nodes`);
  }
  const workflow: Record<string, ComfyWorkflowNode> = Object.create(null) as Record<string, ComfyWorkflowNode>;
  for (const [nodeId, rawNode] of entries) {
    if (!SAFE_COMFY_ID.test(nodeId) || isDangerousKey(nodeId) || !isPlainRecord(rawNode)
      || typeof rawNode.class_type !== 'string' || !SAFE_COMFY_ID.test(rawNode.class_type) || isDangerousKey(rawNode.class_type)
      || !isPlainRecord(rawNode.inputs)) {
      throw new Error(`ComfyUI inpaint workflow node ${nodeId.slice(0, 80)} is invalid`);
    }
    if (Object.keys(rawNode).some((key) => !['class_type', 'inputs', '_meta'].includes(key))) {
      throw new Error(`ComfyUI inpaint workflow node ${nodeId} contains unsupported fields`);
    }
    validateSafeJson(rawNode.inputs, `node ${nodeId} inputs`, 0);
    if (rawNode._meta !== undefined) {
      if (!isPlainRecord(rawNode._meta)) throw new Error(`ComfyUI node ${nodeId} metadata is invalid`);
      validateSafeJson(rawNode._meta, `node ${nodeId} metadata`, 0);
    }
    workflow[nodeId] = {
      class_type: rawNode.class_type,
      inputs: cloneJsonRecord(rawNode.inputs),
      ...(rawNode._meta ? { _meta: cloneJsonRecord(rawNode._meta) } : {}),
    };
  }
  validateComfyNodeReferences(workflow);
  const bindings = parseComfyBindings(bindingsValue);
  validateComfyBinding(workflow, bindings.source, 'source', 'LoadImage', COMFY_INPAINT_PLACEHOLDERS.source);
  validateComfyBinding(workflow, bindings.mask, 'mask', 'LoadImage', COMFY_INPAINT_PLACEHOLDERS.mask);
  validateComfyBinding(workflow, bindings.prompt, 'prompt', 'CLIPTextEncode', COMFY_INPAINT_PLACEHOLDERS.prompt);
  if (bindings.negativePrompt) {
    validateComfyBinding(workflow, bindings.negativePrompt, 'negativePrompt', 'CLIPTextEncode', COMFY_INPAINT_PLACEHOLDERS.negativePrompt);
  }
  validateComfyBinding(workflow, bindings.output, 'output', 'SaveImage', COMFY_INPAINT_PLACEHOLDERS.output);
  if (bindings.source.nodeId === bindings.mask.nodeId) {
    throw new Error('ComfyUI inpaint source and mask require distinct LoadImage nodes');
  }
  const outputNode = workflow[bindings.output.nodeId]!;
  if (!isComfyNodeReference(outputNode.inputs.images) || !workflow[outputNode.inputs.images[0]]) {
    throw new Error('Configured ComfyUI SaveImage output must reference an existing image-producing node');
  }
  validateComfyInpaintDataflow(workflow, bindings);

  const expected = new Set<string>([
    COMFY_INPAINT_PLACEHOLDERS.source,
    COMFY_INPAINT_PLACEHOLDERS.mask,
    COMFY_INPAINT_PLACEHOLDERS.prompt,
    COMFY_INPAINT_PLACEHOLDERS.output,
    ...(bindings.negativePrompt ? [COMFY_INPAINT_PLACEHOLDERS.negativePrompt] : []),
  ]);
  const placeholders = collectComfyPlaceholders(workflow);
  if (placeholders.length !== expected.size || placeholders.some((placeholder) => !expected.has(placeholder))) {
    throw new Error('ComfyUI inpaint workflow contains missing, duplicate, or unsupported CODEBUDDY placeholders');
  }
  return { workflow, bindings };
}

function parseComfyBindings(value: unknown): ComfyInpaintBindings {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !['source', 'mask', 'prompt', 'negativePrompt', 'output'].includes(key))) {
    throw new Error('ComfyUI inpaint bindings must define only source, mask, prompt, optional negativePrompt, and output');
  }
  return {
    source: parseComfyBinding(value.source, 'source'),
    mask: parseComfyBinding(value.mask, 'mask'),
    prompt: parseComfyBinding(value.prompt, 'prompt'),
    ...(value.negativePrompt !== undefined ? { negativePrompt: parseComfyBinding(value.negativePrompt, 'negativePrompt') } : {}),
    output: parseComfyBinding(value.output, 'output'),
  };
}

function parseComfyBinding(value: unknown, label: string): ComfyWorkflowBinding {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !['nodeId', 'input'].includes(key))
    || typeof value.nodeId !== 'string' || !SAFE_COMFY_ID.test(value.nodeId) || isDangerousKey(value.nodeId)
    || typeof value.input !== 'string' || !SAFE_COMFY_INPUT.test(value.input) || isDangerousKey(value.input)) {
    throw new Error(`ComfyUI ${label} binding must contain safe nodeId and input fields`);
  }
  return { nodeId: value.nodeId, input: value.input };
}

function validateComfyBinding(
  workflow: Record<string, ComfyWorkflowNode>,
  binding: ComfyWorkflowBinding,
  label: string,
  expectedClass: string,
  placeholder: string,
): void {
  const node = workflow[binding.nodeId];
  if (!node || node.class_type !== expectedClass || node.inputs[binding.input] !== placeholder) {
    throw new Error(`ComfyUI ${label} binding must target ${expectedClass}.${binding.input} containing ${placeholder}`);
  }
}

function instantiateComfyInpaintWorkflow(
  template: ComfyInpaintTemplate,
  values: { source: string; mask: string; prompt: string; negativePrompt: string; outputPrefix: string },
): Record<string, unknown> {
  const workflow = cloneJsonRecord(template.workflow) as Record<string, ComfyWorkflowNode>;
  setComfyBinding(workflow, template.bindings.source, values.source);
  setComfyBinding(workflow, template.bindings.mask, values.mask);
  setComfyBinding(workflow, template.bindings.prompt, values.prompt);
  if (template.bindings.negativePrompt) setComfyBinding(workflow, template.bindings.negativePrompt, values.negativePrompt);
  setComfyBinding(workflow, template.bindings.output, values.outputPrefix);
  return workflow;
}

function setComfyBinding(
  workflow: Record<string, ComfyWorkflowNode>,
  binding: ComfyWorkflowBinding,
  value: string,
): void {
  workflow[binding.nodeId]!.inputs[binding.input] = value;
}

async function uploadComfyInput(options: {
  baseUrl: string;
  dataUrl: string;
  filename: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  maskFor?: ComfyUploadedImage;
}): Promise<ComfyUploadedImage> {
  throwIfAborted(options.signal);
  const match = options.dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('ComfyUI upload requires a bounded PNG, JPEG, or WebP data URL');
  const mime = match[1]!.toLowerCase();
  if (options.maskFor && mime !== 'image/png') throw new Error('ComfyUI mask upload requires PNG');
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length <= 0 || bytes.length > MAX_EDIT_REFERENCE_BYTES) throw new Error('ComfyUI upload exceeds 50 MB');
  if (!isImageBytesForMime(bytes, mime)) throw new Error(`ComfyUI upload content does not match ${mime}`);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), `${options.filename}.${extension}`);
  form.append('type', 'input');
  if (options.maskFor) {
    form.append('subfolder', options.maskFor.subfolder);
    form.append('original_ref', JSON.stringify({
      filename: options.maskFor.filename,
      subfolder: options.maskFor.subfolder,
      type: 'input',
    }));
  } else {
    form.append('overwrite', 'false');
  }
  const endpoint = options.maskFor ? '/upload/mask' : '/upload/image';
  const response = await fetchWithTimeout(options.fetchImpl, joinUrl(options.baseUrl, endpoint), {
    method: 'POST',
    body: form,
  }, 120_000, options.signal);
  const body = await readJsonResponse(response, joinUrl(options.baseUrl, endpoint));
  const filename = stringField(body, 'name') ?? stringField(body, 'filename');
  const subfolder = stringField(body, 'subfolder') ?? '';
  const type = stringField(body, 'type') ?? 'input';
  if (!filename || !isSafeComfyFilename(filename) || !isSafeComfySubfolder(subfolder) || type !== 'input') {
    throw new Error(`ComfyUI ${endpoint} returned an unsafe file reference`);
  }
  return {
    filename,
    subfolder,
    type,
    workflowPath: subfolder ? `${subfolder.replace(/\\/g, '/')}/${filename}` : filename,
  };
}

async function pollComfyOutput(options: {
  baseUrl: string;
  promptId: string;
  outputNodeId: string;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
  timeoutMs: number;
  intervalMs: number;
  now: () => Date;
}): Promise<ComfyImageRef> {
  const deadline = options.now().getTime() + options.timeoutMs;
  for (;;) {
    throwIfAborted(options.signal);
    const history = await getJson(options.fetchImpl, joinUrl(options.baseUrl, `/history/${options.promptId}`), {
      Accept: 'application/json',
    }, 60_000, options.signal);
    const entry = history[options.promptId] as { outputs?: unknown; status?: { status_str?: string; completed?: boolean; messages?: unknown } } | undefined;
    const status = entry?.status?.status_str?.toLowerCase();
    if (status && ['error', 'failed', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`ComfyUI inpaint execution failed (${status}): ${JSON.stringify(entry?.status?.messages ?? '').slice(0, 300)}`);
    }
    if (entry?.outputs) {
      const output = (entry.outputs as Record<string, unknown>)[options.outputNodeId];
      if (output !== undefined) {
        const image = firstComfyImage({ [options.outputNodeId]: output });
        if (!image || image.type !== 'output' || !isSafeComfyFilename(image.filename) || !isSafeComfySubfolder(image.subfolder)) {
          throw new Error('Configured ComfyUI inpaint output node finished without a safe SaveImage output');
        }
        return image;
      }
    }
    if (entry?.status?.completed) {
      throw new Error('ComfyUI inpaint completed without the configured SaveImage output');
    }
    if (options.now().getTime() >= deadline) {
      throw new Error(`ComfyUI inpainting timed out after ${options.timeoutMs}ms (prompt ${options.promptId})`);
    }
    await comfyDelay(options.intervalMs, options.signal);
  }
}

function comfyDuration(
  envSource: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env(envSource, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function validateComfyNodeReferences(workflow: Record<string, ComfyWorkflowNode>): void {
  for (const [nodeId, node] of Object.entries(workflow)) {
    const references: Array<[string, number]> = [];
    collectComfyNodeReferences(node.inputs, references);
    for (const [dependency] of references) {
      if (!workflow[dependency]) {
        throw new Error(`ComfyUI node ${nodeId} references missing node ${dependency}`);
      }
    }
  }
}

function validateComfyInpaintDataflow(
  workflow: Record<string, ComfyWorkflowNode>,
  bindings: ComfyInpaintBindings,
): void {
  const reachable = new Set<string>();
  const pending = [bindings.output.nodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = workflow[nodeId];
    if (!node) continue;
    const dependencies: Array<[string, number]> = [];
    collectComfyNodeReferences(node.inputs, dependencies);
    for (const [dependency] of dependencies) {
      if (!reachable.has(dependency)) pending.push(dependency);
    }
  }
  const reachableReferences: Array<[string, number]> = [];
  for (const nodeId of reachable) {
    collectComfyNodeReferences(workflow[nodeId]!.inputs, reachableReferences);
  }
  const required: Array<[string, number, string]> = [
    [bindings.source.nodeId, 0, 'source image'],
    [bindings.mask.nodeId, 1, 'alpha mask'],
    [bindings.prompt.nodeId, 0, 'positive prompt'],
    ...(bindings.negativePrompt ? [[bindings.negativePrompt.nodeId, 0, 'negative prompt'] as [string, number, string]] : []),
  ];
  for (const [nodeId, outputIndex, label] of required) {
    if (!reachableReferences.some(([candidateId, candidateIndex]) => candidateId === nodeId && candidateIndex === outputIndex)) {
      throw new Error(`ComfyUI inpaint ${label} is not connected to the configured SaveImage output`);
    }
  }
}

function collectComfyNodeReferences(value: unknown, output: Array<[string, number]>): void {
  if (isComfyNodeReference(value)) {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectComfyNodeReferences(entry, output);
  } else if (isPlainRecord(value)) {
    for (const entry of Object.values(value)) collectComfyNodeReferences(entry, output);
  }
}

function isComfyNodeReference(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
    && typeof value[1] === 'number' && Number.isInteger(value[1]) && value[1] >= 0;
}

function collectComfyPlaceholders(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    const matches = value.match(/\{\{CODEBUDDY_[A-Z0-9_]+\}\}/g);
    if (matches) output.push(...matches);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectComfyPlaceholders(entry, output);
  } else if (isPlainRecord(value)) {
    for (const entry of Object.values(value)) collectComfyPlaceholders(entry, output);
  }
  return output;
}

function validateSafeJson(value: unknown, label: string, depth: number): void {
  if (depth > 12) throw new Error(`${label} exceeds the maximum nesting depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error(`${label} contains an oversized array`);
    for (const entry of value) validateSafeJson(entry, label, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) throw new Error(`${label} contains a non-JSON value`);
  const keys = Object.keys(value);
  if (keys.length > 10_000 || keys.some((key) => !SAFE_COMFY_INPUT.test(key) || isDangerousKey(key))) {
    throw new Error(`${label} contains an unsafe key`);
  }
  for (const entry of Object.values(value)) validateSafeJson(entry, label, depth + 1);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJsonRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDangerousKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor';
}

function isSafeComfyFilename(value: string): boolean {
  return value.length <= 255 && value !== '.' && value !== '..' && /^[A-Za-z0-9_.-]+$/.test(value);
}

function isSafeComfySubfolder(value: string): boolean {
  if (!value) return true;
  if (value.length > 256 || value.startsWith('/') || value.startsWith('\\')) return false;
  return value.replace(/\\/g, '/').split('/').every((segment) => SAFE_COMFY_ID.test(segment) && segment !== '.' && segment !== '..');
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isImageBytesForMime(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return isPng(bytes);
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return mime === 'image/webp'
    && bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`);
  }
  if (!response.body) throw new Error(`${label} returned an empty body`);
  const reader = response.body.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel(`${label} timed out`);
  }, timeoutMs);
  const onAbort = () => { void reader.cancel('aborted'); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const part = await reader.read();
      throwIfAborted(signal);
      if (timedOut) throw new Error(`${label} body timed out after ${timeoutMs}ms`);
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel(`${label} too large`);
        throw new Error(`${label} exceeds ${Math.round(maxBytes / (1024 * 1024))} MB`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal?: AbortSignal): Error {
  const error = new Error(typeof signal?.reason === 'string' ? signal.reason : 'Media generation aborted');
  error.name = 'AbortError';
  return error;
}

async function generateComfyUIImage(
  prompt: string,
  aspect: ImageAspectRatio,
  config: ProviderConfig,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<ImageGenerateResult> {
  const fetchImpl = runtime.fetch ?? fetch;
  const envSource = runtime.env ?? process.env;
  const now = runtime.now ?? (() => new Date());
  const base = config.baseUrl;
  const negative = (env(envSource, 'CODEBUDDY_IMAGE_NEGATIVE') ?? 'blurry, low quality, deformed, watermark').trim();
  const params = comfyParamsForModel(config.model);
  const dims = COMFY_DIMS[aspect];
  const seed = Math.floor(now().getTime() % 2_000_000_000);
  const clientId = runtime.createId?.() ?? randomUUID();
  const workflow = buildComfyWorkflow(prompt, negative, config.model, dims, params, seed);

  const submit = await postJson(fetchImpl, joinUrl(base, '/prompt'), {
    headers: { 'Content-Type': 'application/json' },
    body: { prompt: workflow, client_id: clientId },
  });
  const promptId = stringField(submit, 'prompt_id');
  if (!promptId) {
    const errNode = submit.error ?? submit.node_errors;
    throw new Error(`ComfyUI rejected the workflow${errNode ? `: ${JSON.stringify(errNode).slice(0, 300)}` : ' (no prompt_id)'}`);
  }

  const timeoutMs = Number(env(envSource, 'CODEBUDDY_COMFYUI_TIMEOUT_MS') ?? '300000');
  const intervalMs = Number(env(envSource, 'CODEBUDDY_COMFYUI_POLL_MS') ?? '1500');
  const deadline = now().getTime() + (Number.isFinite(timeoutMs) ? timeoutMs : 300000);

  let image: ComfyImageRef | null = null;
  for (;;) {
    const history = await getJson(fetchImpl, joinUrl(base, `/history/${promptId}`), {
      Accept: 'application/json',
    });
    const entry = history[promptId] as { outputs?: unknown; status?: { status_str?: string } } | undefined;
    if (entry?.outputs) {
      image = firstComfyImage(entry.outputs);
      if (image) break;
      throw new Error(
        `ComfyUI finished without an image (status: ${entry.status?.status_str ?? 'unknown'})`,
      );
    }
    if (now().getTime() >= deadline) {
      throw new Error(`ComfyUI generation timed out after ${timeoutMs}ms (prompt ${promptId})`);
    }
    await comfyDelay(Number.isFinite(intervalMs) ? intervalMs : 1500);
  }

  const viewUrl = joinUrl(
    base,
    `/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`,
  );
  const viewResponse = await fetchImpl(viewUrl);
  if (!viewResponse.ok) {
    throw new Error(`ComfyUI /view returned ${viewResponse.status} for ${image.filename}`);
  }
  const bytes = Buffer.from(await viewResponse.arrayBuffer());
  const outputPath = await saveGeneratedAsset(bytes, {
    rootDir: runtime.rootDir,
    dirName: 'images',
    prefix: 'image',
    extension: 'png',
    createId: runtime.createId,
  });

  await writeMediaSidecar(outputPath, {
    kind: 'image',
    prompt,
    provider: 'comfyui',
    model: config.model,
    aspect_ratio: aspect,
    generatedAt,
  });

  return {
    kind: 'image_generate_result',
    success: true,
    image: outputPath,
    outputPath,
    mediaPath: `MEDIA:${outputPath}`,
    provider: 'comfyui',
    model: config.model,
    prompt,
    aspect_ratio: aspect,
    generatedAt,
  };
}

export async function generateVideo(
  input: VideoGenerateInput,
  runtime: MediaGenerationRuntime = {},
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error('prompt is required for video generation');
  }

  const config = resolveVideoProvider(input.model, runtime.env ?? process.env);
  const fetchImpl = runtime.fetch ?? fetch;
  const generatedAt = (runtime.now ?? (() => new Date()))().toISOString();

  if (config.provider === 'fal') {
    return generateFalVideo(input, config, fetchImpl, runtime, generatedAt);
  }

  return generateXaiVideo(input, config, fetchImpl, runtime, generatedAt);
}

async function generateXaiVideo(
  input: VideoGenerateInput,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  const duration = clampInt(input.duration, 1, 15) ?? 8;
  const aspectRatio = input.aspectRatio?.trim() || '16:9';
  const resolution = input.resolution?.trim() || '720p';
  const imageUrl = input.imageUrl?.trim();
  const refs = (input.referenceImageUrls ?? []).map((url) => url.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    model: config.model,
    prompt,
    duration,
    aspect_ratio: aspectRatio,
    resolution,
  };
  if (imageUrl) {
    body.image = { url: imageUrl };
  }
  if (refs.length > 0) {
    body.reference_images = refs.map((url) => ({ url }));
  }

  const submit = await postJson(fetchImpl, joinUrl(config.baseUrl, '/videos/generations'), {
    headers: {
      ...authHeaders(config.apiKey),
      'x-idempotency-key': randomUUID(),
    },
    body,
    timeoutMs: 60_000,
  });
  const requestId = stringField(submit, 'request_id') ?? stringField(submit, 'id');
  if (!requestId) {
    const direct = extractVideoUrl(submit);
    if (direct) {
      return materializeVideoResult(direct, {
        runtime,
        fetchImpl,
        provider: config.provider,
        model: config.model,
        prompt,
        modality: imageUrl ? 'image' : 'text',
        aspectRatio,
        duration,
        generatedAt,
      });
    }
    throw new Error('xAI video provider did not return request_id or video URL');
  }

  const pollUrl = joinUrl(config.baseUrl, `/videos/${encodeURIComponent(requestId)}`);
  const result = await pollVideoResult(fetchImpl, pollUrl, {
    headers: authHeaders(config.apiKey),
    timeoutMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_TIMEOUT_MS') ?? 240_000),
    intervalMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_POLL_INTERVAL_MS') ?? 1_000),
  });
  const videoUrl = extractVideoUrl(result);
  if (!videoUrl) {
    throw new Error('xAI video generation completed without a video URL');
  }
  return materializeVideoResult(videoUrl, {
    runtime,
    fetchImpl,
    provider: config.provider,
    model: stringField(result, 'model') ?? config.model,
    prompt,
    modality: imageUrl ? 'image' : 'text',
    aspectRatio,
    duration: numberField(objectField(result, 'video'), 'duration') ?? duration,
    generatedAt,
    requestId,
  });
}

async function generateFalVideo(
  input: VideoGenerateInput,
  config: ProviderConfig,
  fetchImpl: typeof fetch,
  runtime: MediaGenerationRuntime,
  generatedAt: string,
): Promise<VideoGenerateResult> {
  const prompt = input.prompt.trim();
  const familyId = FAL_VIDEO_FAMILIES[config.model] ? config.model : 'pixverse-v6';
  const family = FAL_VIDEO_FAMILIES[familyId];
  if (!family) {
    throw new Error(`Unsupported FAL video model family: ${config.model}`);
  }

  const imageUrl = input.imageUrl?.trim();
  const endpoint = imageUrl ? family.imageEndpoint : family.textEndpoint;
  const duration = clampInt(input.duration, 1, 15) ?? family.defaultDuration;
  const payload: Record<string, unknown> = {
    prompt,
    duration: String(duration),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  if (imageUrl) {
    payload.image_url = imageUrl;
  }
  if (input.aspectRatio?.trim()) {
    payload.aspect_ratio = input.aspectRatio.trim();
  }
  if (input.resolution?.trim()) {
    payload.resolution = input.resolution.trim();
  }
  if (family.supportsAudio && input.audio !== undefined) {
    payload.generate_audio = input.audio;
  }
  if (family.supportsNegativePrompt && input.negativePrompt?.trim()) {
    payload.negative_prompt = input.negativePrompt.trim();
  }

  const submit = await postJson(fetchImpl, joinUrl(config.baseUrl, endpoint), {
    headers: {
      ...authHeaders(config.apiKey, 'Key'),
      'x-idempotency-key': randomUUID(),
    },
    body: payload,
    timeoutMs: 60_000,
  });

  const directVideo = extractVideoUrl(submit);
  const requestId = stringField(submit, 'request_id');
  if (directVideo) {
    return materializeVideoResult(directVideo, {
      runtime,
      fetchImpl,
      provider: 'fal',
      model: familyId,
      prompt,
      modality: imageUrl ? 'image' : 'text',
      aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
      duration,
      generatedAt,
      endpoint,
      requestId,
    });
  }

  const responseUrl = stringField(submit, 'response_url');
  const statusUrl = stringField(submit, 'status_url');
  const queued = statusUrl
    ? await pollVideoResult(fetchImpl, statusUrl, {
      headers: authHeaders(config.apiKey, 'Key'),
      timeoutMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_TIMEOUT_MS') ?? 300_000),
      intervalMs: Number(env(runtime.env, 'CODEBUDDY_VIDEO_POLL_INTERVAL_MS') ?? 1_000),
    })
    : {};
  const queuedVideo = extractVideoUrl(queued);
  const finalResponseUrl = stringField(queued, 'response_url') ?? responseUrl;
  if (queuedVideo) {
    return materializeVideoResult(queuedVideo, {
      runtime,
      fetchImpl,
      provider: 'fal',
      model: familyId,
      prompt,
      modality: imageUrl ? 'image' : 'text',
      aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
      duration,
      generatedAt,
      endpoint,
      requestId,
    });
  }
  if (!finalResponseUrl) {
    throw new Error('FAL video provider returned no video URL or response_url');
  }
  const finalResponse = await getJson(fetchImpl, finalResponseUrl, authHeaders(config.apiKey, 'Key'));
  const finalVideo = extractVideoUrl(finalResponse);
  if (!finalVideo) {
    throw new Error('FAL response_url did not contain a video URL');
  }
  return materializeVideoResult(finalVideo, {
    runtime,
    fetchImpl,
    provider: 'fal',
    model: familyId,
    prompt,
    modality: imageUrl ? 'image' : 'text',
    aspectRatio: stringField(payload, 'aspect_ratio') ?? '',
    duration,
    generatedAt,
    endpoint,
    requestId,
  });
}

async function materializeVideoResult(
  videoUrl: string,
  options: {
    runtime: MediaGenerationRuntime;
    fetchImpl: typeof fetch;
    provider: MediaProvider;
    model: string;
    prompt: string;
    modality: 'text' | 'image';
    aspectRatio: string;
    duration: number;
    generatedAt: string;
    requestId?: string;
    endpoint?: string;
  },
): Promise<VideoGenerateResult> {
  const downloaded = await tryDownloadAsset(videoUrl, {
    fetchImpl: options.fetchImpl,
    rootDir: options.runtime.rootDir,
    dirName: 'videos',
    prefix: 'video',
    fallbackExtension: 'mp4',
    createId: options.runtime.createId,
    maxBytes: 250 * 1024 * 1024,
  });
  const outputPath = downloaded.outputPath;
  const videoRef = outputPath ?? videoUrl;
  await writeMediaSidecar(outputPath, {
    kind: 'video',
    prompt: options.prompt,
    provider: options.provider,
    model: options.model,
    modality: options.modality,
    aspect_ratio: options.aspectRatio,
    duration: options.duration,
  });
  return {
    kind: 'video_generate_result',
    success: true,
    video: videoRef,
    ...(outputPath ? { outputPath, mediaPath: `MEDIA:${outputPath}` } : {}),
    provider: options.provider,
    model: options.model,
    prompt: options.prompt,
    modality: options.modality,
    aspect_ratio: options.aspectRatio,
    duration: options.duration,
    generatedAt: options.generatedAt,
    ...(options.requestId ? { request_id: options.requestId } : {}),
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
  };
}

function resolveImageProvider(envSource: NodeJS.ProcessEnv): ProviderConfig {
  const requested = (envSource.CODEBUDDY_IMAGE_PROVIDER ?? '').trim().toLowerCase();
  // Local ComfyUI backend (offline, GPU) — no API key, workflow-based API.
  if (requested === 'comfyui') {
    const baseUrl = (envSource.COMFYUI_URL
      ?? envSource.CODEBUDDY_IMAGE_BASE_URL
      ?? 'http://127.0.0.1:8188').trim().replace(/\/+$/, '');
    const model = (envSource.CODEBUDDY_IMAGE_MODEL
      ?? envSource.COMFYUI_CHECKPOINT
      ?? 'sd_turbo.safetensors').trim();
    if (!baseUrl) {
      throw new Error('No ComfyUI base URL configured (set COMFYUI_URL)');
    }
    return { provider: 'comfyui', model, baseUrl, apiKey: '' };
  }
  const provider: MediaProvider = requested === 'xai' ? 'xai' : 'openai';
  const baseUrl = (envSource.CODEBUDDY_IMAGE_BASE_URL
    ?? (provider === 'xai' ? envSource.XAI_BASE_URL : envSource.OPENAI_BASE_URL)
    ?? (provider === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')).trim().replace(/\/+$/, '');
  const apiKey = (envSource.CODEBUDDY_IMAGE_API_KEY
    ?? (provider === 'xai' ? envSource.XAI_API_KEY : envSource.OPENAI_API_KEY)
    ?? '').trim();
  const model = (envSource.CODEBUDDY_IMAGE_MODEL
    ?? (provider === 'xai' ? envSource.XAI_IMAGE_MODEL : envSource.OPENAI_IMAGE_MODEL)
    ?? getImageGenerationModel()
    ?? (provider === 'xai' ? 'grok-imagine-image' : 'gpt-image-2')).trim();
  // Route through the Nous Tool Gateway when configured (transparent base-URL +
  // token substitution); otherwise use the direct provider.
  const route = resolveToolGatewayRoute('image_gen', envSource);
  const effectiveBaseUrl = route ? route.baseUrl : baseUrl;
  const effectiveApiKey = route?.token ?? apiKey;
  assertProviderReady(provider, effectiveApiKey, effectiveBaseUrl, 'image');
  return { provider, model, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey };
}

function resolveVideoProvider(modelOverride: string | undefined, envSource: NodeJS.ProcessEnv): ProviderConfig {
  const requested = (envSource.CODEBUDDY_VIDEO_PROVIDER ?? '').trim().toLowerCase();
  const provider: MediaProvider = requested === 'fal' ? 'fal' : 'xai';
  const baseUrl = (envSource.CODEBUDDY_VIDEO_BASE_URL
    ?? (provider === 'fal' ? envSource.FAL_BASE_URL : envSource.XAI_BASE_URL)
    ?? (provider === 'fal' ? 'https://queue.fal.run' : 'https://api.x.ai/v1')).trim().replace(/\/+$/, '');
  const apiKey = (envSource.CODEBUDDY_VIDEO_API_KEY
    ?? (provider === 'fal' ? envSource.FAL_KEY : envSource.XAI_API_KEY)
    ?? '').trim();
  const model = (modelOverride
    ?? envSource.CODEBUDDY_VIDEO_MODEL
    ?? (provider === 'fal' ? envSource.FAL_VIDEO_MODEL : envSource.XAI_VIDEO_MODEL)
    ?? (provider === 'fal' ? 'pixverse-v6' : 'grok-imagine-video')).trim();
  const route = resolveToolGatewayRoute('video_gen', envSource);
  const effectiveBaseUrl = route ? route.baseUrl : baseUrl;
  const effectiveApiKey = route?.token ?? apiKey;
  assertProviderReady(provider, effectiveApiKey, effectiveBaseUrl, 'video');
  return { provider, model, baseUrl: effectiveBaseUrl, apiKey: effectiveApiKey };
}

function assertProviderReady(provider: MediaProvider, apiKey: string, baseUrl: string, kind: string): void {
  if (!baseUrl) {
    throw new Error(`No ${kind} generation base URL configured for provider ${provider}`);
  }
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    throw new Error(`No ${kind} generation credentials configured for provider ${provider}`);
  }
}

function resolveImageAspect(value: string | undefined): ImageAspectRatio {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'square' || normalized === 'portrait' || normalized === 'landscape') {
    return normalized;
  }
  return 'landscape';
}

const MAX_EDIT_REFERENCE_BYTES = 50 * 1024 * 1024;

function validateImageReference(value: string, label: string): string {
  const trimmed = value.trim();
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(trimmed)) {
    validateDataImage(trimmed, label);
    return trimmed;
  }
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  throw new Error(`${label} must be an HTTPS URL or a base64 image data URL`);
}

function validateDataImage(value: string, label: string): string {
  const match = value.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error(`${label} must be a PNG, JPEG, or WebP base64 data URL`);
  const estimatedBytes = Math.floor((match[2]!.length * 3) / 4);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_EDIT_REFERENCE_BYTES) {
    throw new Error(`${label} must be smaller than 50 MB`);
  }
  return value;
}

function dataUrlToBlob(value: string, label: string): Blob {
  validateDataImage(value, label);
  const comma = value.indexOf(',');
  const mime = value.slice(5, value.indexOf(';'));
  const bytes = Buffer.from(value.slice(comma + 1), 'base64');
  return new Blob([bytes], { type: mime });
}

function normalizeEditSelections(value: ImageEditSelection[] | undefined): ImageEditSelection[] {
  return (value ?? []).slice(0, 20).flatMap((selection) => {
    const x = clampUnit(selection?.x);
    const y = clampUnit(selection?.y);
    const width = Math.min(clampUnit(selection?.width), 1 - x);
    const height = Math.min(clampUnit(selection?.height), 1 - y);
    if (width < 0.002 || height < 0.002) return [];
    return [{ x, y, width, height }];
  });
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function redactDataUrl(value: string): string {
  return value.startsWith('data:') ? `[inline image ${Math.round(value.length / 1024)} KiB]` : value;
}

function sanitizeImageSourceReference(value: string | undefined): string | undefined {
  const reference = value?.trim();
  if (!reference || reference.length > 4_096
    || [...reference].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)) {
    return undefined;
  }
  return reference.startsWith('data:') ? undefined : reference;
}

function aspectToProviderRatio(aspect: ImageAspectRatio): string {
  if (aspect === 'square') return '1:1';
  if (aspect === 'portrait') return '9:16';
  return '16:9';
}

function authHeaders(apiKey: string, scheme: 'Bearer' | 'Key' = 'Bearer'): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `${scheme} ${apiKey}` } : {}),
  };
}

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  options: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, url, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(options.body),
  }, options.timeoutMs ?? 120_000, options.signal);
  return readJsonResponse(response, url);
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, url, { headers }, timeoutMs, signal);
  return readJsonResponse(response, url);
}

async function readJsonResponse(response: Response, url: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new Error(`${url} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${url} returned non-object JSON`);
}

async function pollVideoResult(
  fetchImpl: typeof fetch,
  url: string,
  options: { headers: Record<string, string>; timeoutMs: number; intervalMs: number },
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + options.timeoutMs;
  let lastStatus = 'queued';
  while (Date.now() < deadline) {
    const body = await getJson(fetchImpl, url, options.headers);
    lastStatus = (stringField(body, 'status') ?? stringField(body, 'state') ?? lastStatus).toLowerCase();
    if (['done', 'completed', 'succeeded', 'success', 'ready'].includes(lastStatus) || extractVideoUrl(body)) {
      return body;
    }
    if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(lastStatus)) {
      throw new Error(`Video generation failed with status ${lastStatus}: ${JSON.stringify(body).slice(0, 500)}`);
    }
    await sleep(Math.max(100, options.intervalMs));
  }
  throw new Error(`Timed out waiting for video generation after ${options.timeoutMs}ms (last status: ${lastStatus})`);
}

function firstDataItem(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
    return data[0] as Record<string, unknown>;
  }
  return body;
}

function extractVideoUrl(body: Record<string, unknown>): string | undefined {
  const video = objectField(body, 'video');
  return (video ? stringField(video, 'url') : undefined)
    ?? stringField(body, 'video_url')
    ?? stringField(body, 'url')
    ?? stringField(body, 'output_url');
}

async function tryDownloadAsset(
  url: string,
  options: {
    fetchImpl: typeof fetch;
    rootDir?: string;
    dirName: string;
    prefix: string;
    fallbackExtension: string;
    createId?: () => string;
    maxBytes: number;
  },
): Promise<{ outputPath?: string }> {
  if (!/^https?:\/\//i.test(url)) {
    return {};
  }
  const response = await fetchWithTimeout(options.fetchImpl, url, {
    headers: { Accept: '*/*' },
  }, 120_000);
  if (!response.ok) {
    return {};
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > options.maxBytes) {
    return {};
  }
  const extension = inferExtension(response.headers.get('content-type'), url, options.fallbackExtension);
  const outputPath = await saveGeneratedAsset(bytes, {
    rootDir: options.rootDir,
    dirName: options.dirName,
    prefix: options.prefix,
    extension,
    createId: options.createId,
  });
  return { outputPath };
}

/**
 * Sidecar metadata next to a generated asset (`<file>.meta.json`) so the
 * media library can show the ORIGINAL prompt/provider/model (ChatGPT-library
 * parity) and regenerate variants from the real prompt. Fail-open: metadata
 * must never break a successful generation.
 */
export async function writeMediaSidecar(
  outputPath: string | undefined,
  meta: Record<string, unknown>,
): Promise<void> {
  if (!outputPath) return;
  try {
    await fs.writeFile(`${outputPath}.meta.json`, JSON.stringify(meta, null, 1));
  } catch {
    /* sidecar is best-effort */
  }
}

async function saveGeneratedAsset(
  bytes: Buffer,
  options: {
    rootDir?: string;
    dirName: string;
    prefix: string;
    extension: string;
    createId?: () => string;
  },
): Promise<string> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const rootReal = await fs.realpath(rootDir);
  const id = sanitizeId(options.createId?.() ?? `${Date.now()}-${randomUUID()}`);
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(options.dirName)
    || !/^[A-Za-z0-9_.-]{1,64}$/.test(options.prefix)
    || !/^[A-Za-z0-9]{2,5}$/.test(options.extension)) {
    throw new Error('Generated media output configuration is invalid');
  }
  const outputDir = await ensureConfinedMediaDirectory(rootDir, rootReal, [
    '.codebuddy',
    'media-generation',
    options.dirName,
  ]);
  const outputPath = path.join(outputDir, `${options.prefix}-${id}.${options.extension}`);
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(outputPath, flags, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return outputPath;
}

async function ensureConfinedMediaDirectory(
  rootPath: string,
  rootReal: string,
  segments: string[],
): Promise<string> {
  let cursor = rootPath;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    try {
      await fs.mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const metadata = await fs.lstat(cursor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Generated media output directory contains a symbolic link');
    }
    const cursorReal = await fs.realpath(cursor);
    const child = path.relative(rootReal, cursorReal);
    if (child === '..' || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) {
      throw new Error('Generated media output directory escapes its workspace');
    }
  }
  return fs.realpath(cursor);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  if (/^https?:\/\//i.test(suffix)) {
    return suffix;
  }
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedSuffix = suffix.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedSuffix}`;
}

function inferExtension(contentType: string | null, url: string, fallback: string): string {
  const type = (contentType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  const byType: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/mpeg': 'mpeg',
  };
  if (type && byType[type]) {
    return byType[type];
  }
  const urlPath = url.split('?', 1)[0]?.toLowerCase() ?? '';
  const ext = path.extname(urlPath).replace('.', '');
  if (/^[a-z0-9]{2,5}$/.test(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return fallback;
}

function clampInt(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function env(runtimeEnv: NodeJS.ProcessEnv | undefined, key: string): string | undefined {
  const value = runtimeEnv?.[key] ?? process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(data: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function objectField(data: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = data[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeId(id: string): string {
  const sanitized = id.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || randomUUID();
}
