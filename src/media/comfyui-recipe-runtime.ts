import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  ComfyUIRecipeValidationError,
  isSafeComfyUIAssetReference,
  isSafeComfyUIRelativePath,
  materializeComfyUIWorkflow,
  type ComfyUIRecipe,
  type ComfyUIRecipeRunInputs,
  type ComfyUIRecipeSelector,
  type ComfyUIResourceTier,
} from './comfyui-recipe-contract.js';
import { ComfyUIRecipeRegistry } from './comfyui-recipe-registry.js';

const SAFE_SERVER_ID = /^[A-Za-z0-9_.-]{1,160}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ +()@-]{0,254}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FAILURE_STATUSES = new Set(['error', 'failed', 'cancelled', 'canceled']);
const RESOURCE_TIER_ORDER: Record<ComfyUIResourceTier, number> = {
  low: 0,
  balanced: 1,
  high: 2,
  extreme: 3,
};

const DEFAULT_OUTPUT_LIMITS: Record<ComfyUIRecipe['outputs'][number]['type'], number> = {
  image: 64 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  audio: 512 * 1024 * 1024,
  glb: 1024 * 1024 * 1024,
};

const OUTPUT_MEDIA: Record<
ComfyUIRecipe['outputs'][number]['type'],
Record<string, readonly string[]>
> = {
  image: {
    '.png': ['image/png'],
    '.jpg': ['image/jpeg'],
    '.jpeg': ['image/jpeg'],
    '.webp': ['image/webp'],
    '.gif': ['image/gif'],
  },
  video: {
    '.mp4': ['video/mp4'],
    '.webm': ['video/webm'],
    '.mov': ['video/quicktime'],
    '.mkv': ['video/x-matroska', 'video/webm'],
    '.gif': ['image/gif'],
  },
  audio: {
    '.wav': ['audio/wav', 'audio/x-wav'],
    '.flac': ['audio/flac'],
    '.mp3': ['audio/mpeg'],
    '.ogg': ['audio/ogg', 'application/ogg'],
    '.m4a': ['audio/mp4'],
    '.aac': ['audio/aac'],
  },
  glb: {
    '.glb': ['model/gltf-binary', 'application/octet-stream'],
    '.gltf': ['model/gltf+json', 'application/json'],
  },
};

export type ComfyUIPreflightIssueCode =
  | 'license'
  | 'missing-node'
  | 'models-root'
  | 'missing-model'
  | 'unsafe-model'
  | 'model-too-small'
  | 'model-hash'
  | 'insufficient-vram'
  | 'insufficient-ram'
  | 'resource-tier';

export interface ComfyUIPreflightIssue {
  code: ComfyUIPreflightIssueCode;
  message: string;
  requirement?: string;
}

export interface ComfyUIPreflightResult {
  ok: boolean;
  recipeId: string;
  recipeVersion: string;
  issues: readonly ComfyUIPreflightIssue[];
  checkedNodes: number;
  checkedModels: number;
}

export interface ComfyUIRuntimeResourceLimits {
  availableVramMiB?: number;
  availableRamMiB?: number;
  maxTier?: ComfyUIResourceTier;
}

export interface ComfyUIRecipeRuntimeLimits {
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
  maxRunMs?: number;
  pollIntervalMs?: number;
  maxObjectInfoBytes?: number;
  maxHistoryBytes?: number;
  maxOutputBytes?: number;
  maxTotalOutputBytes?: number;
  maxUploadBytes?: number;
}

export interface ComfyUIRecipeRuntimeOptions {
  registry: ComfyUIRecipeRegistry;
  baseUrl?: string;
  modelsRoot: string;
  outputRoot: string;
  fetchImpl?: typeof fetch;
  trustedOrigins?: readonly string[];
  resources?: ComfyUIRuntimeResourceLimits;
  limits?: ComfyUIRecipeRuntimeLimits;
  commercialUse?: boolean;
  exclusiveServer?: boolean;
  createClientId?: () => string;
  createSeed?: () => number;
}

export interface ComfyUIRecipeRunOptions {
  signal?: AbortSignal;
  allowFallback?: boolean;
  commercialUse?: boolean;
}

export interface ComfyUIOutputReference {
  filename: string;
  subfolder: string;
  type: 'output' | 'temp';
}

export interface ComfyUIRecipeArtifact {
  id: string;
  type: ComfyUIRecipe['outputs'][number]['type'];
  path: string;
  bytes: number;
  sha256: string;
  mimeType: string;
  source: ComfyUIOutputReference;
}

export interface ComfyUIRecipeRunResult {
  requestedRecipeId: string;
  requestedRecipeVersion: string;
  recipeId: string;
  recipeVersion: string;
  fallbackUsed: boolean;
  promptId: string;
  clientId: string;
  seed?: number;
  dimensions?: { width: number; height: number };
  artifacts: readonly ComfyUIRecipeArtifact[];
}

export interface ComfyUIUploadedAsset {
  filename: string;
  subfolder: string;
  type: 'input';
  workflowPath: string;
}

export interface ComfyUIImageUpload {
  bytes: Uint8Array;
  filename: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  subfolder?: string;
}

export interface ComfyUIMaskUpload extends Omit<ComfyUIImageUpload, 'mimeType'> {
  mimeType: 'image/png';
  originalRef: ComfyUIUploadedAsset;
}

export type ComfyUIRecipeRuntimeErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'NETWORK_ERROR'
  | 'NETWORK_TIMEOUT'
  | 'BAD_RESPONSE'
  | 'PREFLIGHT_FAILED'
  | 'RUN_FAILED'
  | 'RUN_TIMEOUT'
  | 'ABORTED'
  | 'UNSAFE_OUTPUT';

export class ComfyUIRecipeRuntimeError extends Error {
  readonly code: ComfyUIRecipeRuntimeErrorCode;
  readonly details?: unknown;

  constructor(code: ComfyUIRecipeRuntimeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ComfyUIRecipeRuntimeError';
    this.code = code;
    this.details = details;
  }
}

interface ResolvedRuntimeLimits {
  requestTimeoutMs: number;
  uploadTimeoutMs: number;
  maxRunMs: number;
  pollIntervalMs: number;
  maxObjectInfoBytes: number;
  maxHistoryBytes: number;
  maxOutputBytes: number;
  maxTotalOutputBytes: number;
  maxUploadBytes: number;
}

interface HistoryOutputReference {
  descriptor: ComfyUIRecipe['outputs'][number];
  reference: ComfyUIOutputReference;
  index: number;
}

interface ModelRootSnapshot {
  configuredPath: string;
  realPath: string;
  stats: Stats;
}

interface FileSnapshot {
  path: string;
  stats: Stats;
}

export class ComfyUIRecipeRuntime {
  private readonly registry: ComfyUIRecipeRegistry;
  private readonly baseUrl: URL;
  private readonly modelsRoot: string;
  private readonly outputRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resources: ComfyUIRuntimeResourceLimits;
  private readonly limits: ResolvedRuntimeLimits;
  private readonly commercialUse: boolean;
  private readonly exclusiveServer: boolean;
  private readonly createClientId: () => string;
  private readonly createSeed: () => number;

  constructor(options: ComfyUIRecipeRuntimeOptions) {
    this.registry = options.registry;
    this.baseUrl = validateBaseUrl(options.baseUrl ?? 'http://127.0.0.1:8188', options.trustedOrigins ?? []);
    this.modelsRoot = requireAbsolutePath(options.modelsRoot, 'modelsRoot');
    this.outputRoot = requireAbsolutePath(options.outputRoot, 'outputRoot');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resources = validateResources(options.resources ?? {});
    this.limits = resolveLimits(options.limits ?? {});
    this.commercialUse = options.commercialUse ?? false;
    this.exclusiveServer = options.exclusiveServer ?? false;
    this.createClientId = options.createClientId ?? randomUUID;
    this.createSeed = options.createSeed ?? defaultSeed;
  }

  async preflight(
    selector: string | ComfyUIRecipeSelector,
    options: Pick<ComfyUIRecipeRunOptions, 'signal' | 'commercialUse'> = {},
  ): Promise<ComfyUIPreflightResult> {
    const recipe = this.registry.get(selector);
    const objectInfo = await this.fetchObjectInfo(options.signal);
    return this.preflightRecipe(recipe, objectInfo, options.commercialUse ?? this.commercialUse, options.signal);
  }

  async run(
    selector: string | ComfyUIRecipeSelector,
    inputs: ComfyUIRecipeRunInputs,
    options: ComfyUIRecipeRunOptions = {},
  ): Promise<ComfyUIRecipeRunResult> {
    throwIfAborted(options.signal);
    const requested = this.registry.get(selector);
    const candidates = options.allowFallback === false
      ? [requested]
      : [...this.registry.resolveFallbackChain({ id: requested.id, version: requested.version })];
    const objectInfo = await this.fetchObjectInfo(options.signal);
    const preflights: ComfyUIPreflightResult[] = [];
    let selected: ComfyUIRecipe | undefined;
    for (const candidate of candidates) {
      const result = await this.preflightRecipe(
        candidate,
        objectInfo,
        options.commercialUse ?? this.commercialUse,
        options.signal,
      );
      preflights.push(result);
      if (result.ok) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      throw new ComfyUIRecipeRuntimeError(
        'PREFLIGHT_FAILED',
        'No registered ComfyUI recipe in the fallback chain passed preflight',
        preflights,
      );
    }

    const materialized = materializeComfyUIWorkflow(selected, inputs, this.createSeed);
    const clientId = this.createClientId();
    if (!SAFE_SERVER_ID.test(clientId)) {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'createClientId returned an unsafe value');
    }
    const body = JSON.stringify({ prompt: materialized.workflow, client_id: clientId });
    if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Materialized workflow exceeds 2 MB');
    }

    let promptId: string | undefined;
    const deadline = Date.now() + this.limits.maxRunMs;
    try {
      const submitted = await this.requestJson('/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
      }, 256 * 1024, this.requestBudget(deadline), options.signal);
      promptId = readString(submitted, 'prompt_id') ?? readString(submitted, 'promptId');
      if (!promptId || !SAFE_SERVER_ID.test(promptId)) {
        throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', 'ComfyUI /prompt returned an unsafe prompt id');
      }

      const historyOutputs = await this.watchPrompt(selected, promptId, deadline, options.signal);
      const artifacts = await this.fetchOutputs(historyOutputs, promptId, deadline, options.signal);
      return {
        requestedRecipeId: requested.id,
        requestedRecipeVersion: requested.version,
        recipeId: selected.id,
        recipeVersion: selected.version,
        fallbackUsed: selected.id !== requested.id || selected.version !== requested.version,
        promptId,
        clientId,
        ...(materialized.seed === undefined ? {} : { seed: materialized.seed }),
        ...(materialized.dimensions === undefined ? {} : { dimensions: materialized.dimensions }),
        artifacts,
      };
    } catch (error) {
      if (promptId) await this.cancel(promptId).catch(() => false);
      throw normalizeRuntimeError(error, options.signal, deadline);
    }
  }

  /** Upload a bounded image. Returned collision-renamed paths are revalidated. */
  async uploadImage(upload: ComfyUIImageUpload, signal?: AbortSignal): Promise<ComfyUIUploadedAsset> {
    validateUpload(upload, this.limits.maxUploadBytes, false);
    return this.upload('/upload/image', upload, undefined, signal);
  }

  /** Upload a PNG mask tied to the exact source reference ComfyUI returned. */
  async uploadMask(upload: ComfyUIMaskUpload, signal?: AbortSignal): Promise<ComfyUIUploadedAsset> {
    validateUpload(upload, this.limits.maxUploadBytes, true);
    validateUploadedAsset(upload.originalRef);
    return this.upload('/upload/mask', upload, upload.originalRef, signal);
  }

  /** Delete only this prompt from the queue; global interrupt is opt-in for an exclusive server. */
  async cancel(promptId: string): Promise<boolean> {
    if (!SAFE_SERVER_ID.test(promptId)) {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Unsafe prompt id');
    }
    const operations: Promise<unknown>[] = [
      this.requestAck('/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      }, Math.min(this.limits.requestTimeoutMs, 5000)),
    ];
    if (this.exclusiveServer) {
      operations.push(this.requestAck('/interrupt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
      }, Math.min(this.limits.requestTimeoutMs, 5000)));
    }
    const results = await Promise.allSettled(operations);
    return results.some((result) => result.status === 'fulfilled');
  }

  private async preflightRecipe(
    recipe: ComfyUIRecipe,
    objectInfo: Record<string, unknown>,
    commercialUse: boolean,
    signal?: AbortSignal,
  ): Promise<ComfyUIPreflightResult> {
    throwIfAborted(signal);
    const issues: ComfyUIPreflightIssue[] = [];
    if (commercialUse && !recipe.commercialAllowed) {
      issues.push({ code: 'license', message: `${recipe.id} does not permit commercial use` });
    }
    for (const requirement of recipe.requirements.nodes) {
      if (!Object.prototype.hasOwnProperty.call(objectInfo, requirement.classType)) {
        issues.push({
          code: 'missing-node',
          requirement: requirement.classType,
          message: `ComfyUI node is unavailable: ${requirement.classType}`,
        });
      }
    }
    this.checkResourceProfile(recipe, issues);

    let modelRoot: ModelRootSnapshot | undefined;
    if (recipe.requirements.models.length > 0) {
      try {
        modelRoot = await inspectModelRoot(this.modelsRoot);
      } catch (error) {
        issues.push({
          code: 'models-root',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (modelRoot) {
      for (const model of recipe.requirements.models) {
        issues.push(...await checkModel(modelRoot, model, signal));
      }
      try {
        await verifyModelRoot(modelRoot);
      } catch (error) {
        issues.push({ code: 'models-root', message: error instanceof Error ? error.message : String(error) });
      }
    }
    return {
      ok: issues.length === 0,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      issues,
      checkedNodes: recipe.requirements.nodes.length,
      checkedModels: recipe.requirements.models.length,
    };
  }

  private checkResourceProfile(recipe: ComfyUIRecipe, issues: ComfyUIPreflightIssue[]): void {
    if (this.resources.availableVramMiB !== undefined
      && this.resources.availableVramMiB < recipe.resources.minVramMiB) {
      issues.push({
        code: 'insufficient-vram',
        message: `Recipe needs ${recipe.resources.minVramMiB} MiB VRAM; ${this.resources.availableVramMiB} MiB declared`,
      });
    }
    if (this.resources.availableRamMiB !== undefined
      && this.resources.availableRamMiB < recipe.resources.minRamMiB) {
      issues.push({
        code: 'insufficient-ram',
        message: `Recipe needs ${recipe.resources.minRamMiB} MiB RAM; ${this.resources.availableRamMiB} MiB declared`,
      });
    }
    if (this.resources.maxTier !== undefined
      && RESOURCE_TIER_ORDER[recipe.resources.tier] > RESOURCE_TIER_ORDER[this.resources.maxTier]) {
      issues.push({
        code: 'resource-tier',
        message: `Recipe tier ${recipe.resources.tier} exceeds configured tier ${this.resources.maxTier}`,
      });
    }
  }

  private async fetchObjectInfo(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const objectInfo = await this.requestJson(
      '/object_info',
      { method: 'GET', headers: { accept: 'application/json' } },
      this.limits.maxObjectInfoBytes,
      this.limits.requestTimeoutMs,
      signal,
    );
    if (!isPlainRecord(objectInfo) || Object.keys(objectInfo).length > 20_000) {
      throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', 'ComfyUI /object_info returned an invalid object');
    }
    return objectInfo;
  }

  private async watchPrompt(
    recipe: ComfyUIRecipe,
    promptId: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<HistoryOutputReference[]> {
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const history = await this.requestJson(
        `/history/${encodeURIComponent(promptId)}`,
        { method: 'GET', headers: { accept: 'application/json' } },
        this.limits.maxHistoryBytes,
        this.requestBudget(deadline),
        signal,
      );
      const entry = historyEntry(history, promptId);
      if (entry) {
        const status = readStatus(entry);
        if (status && FAILURE_STATUSES.has(status)) {
          throw new ComfyUIRecipeRuntimeError(
            'RUN_FAILED',
            `ComfyUI execution failed (${status})`,
            boundedStatusDetails(entry),
          );
        }
        const complete = status === 'success'
          || (isPlainRecord(entry.status) && entry.status.completed === true)
          || (isPlainRecord(entry.outputs) && Object.keys(entry.outputs).length > 0);
        if (complete) return extractHistoryOutputs(recipe, entry);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(this.limits.pollIntervalMs, remaining), signal);
    }
    throw new ComfyUIRecipeRuntimeError('RUN_TIMEOUT', `ComfyUI run exceeded ${this.limits.maxRunMs} ms`);
  }

  private async fetchOutputs(
    outputs: readonly HistoryOutputReference[],
    promptId: string,
    deadline: number,
    signal?: AbortSignal,
  ): Promise<ComfyUIRecipeArtifact[]> {
    const outputDirectory = await createConfinedOutputDirectory(this.outputRoot, promptId);
    const artifacts: ComfyUIRecipeArtifact[] = [];
    let totalBytes = 0;
    for (const output of outputs) {
      throwIfAborted(signal);
      const extension = validatedOutputExtension(output.descriptor.type, output.reference.filename);
      const declaredLimit = output.descriptor.maxBytes ?? DEFAULT_OUTPUT_LIMITS[output.descriptor.type];
      const outputLimit = Math.min(declaredLimit, this.limits.maxOutputBytes);
      const remainingTotal = this.limits.maxTotalOutputBytes - totalBytes;
      if (remainingTotal <= 0) {
        throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'ComfyUI outputs exceed the total byte limit');
      }
      const url = this.endpoint('/view');
      url.searchParams.set('filename', output.reference.filename);
      url.searchParams.set('subfolder', output.reference.subfolder);
      url.searchParams.set('type', output.reference.type);
      const response = await this.requestRaw(
        url,
        { method: 'GET', headers: { accept: acceptedMimeTypes(output.descriptor.type, extension).join(', ') } },
        this.requestBudget(deadline),
        signal,
      );
      assertOk(response, url.toString());
      const limit = Math.min(outputLimit, remainingTotal);
      const bytes = await readResponseBytes(response, limit, this.requestBudget(deadline), signal);
      const mimeType = validateOutputMedia(response, bytes, output.descriptor.type, extension);
      totalBytes += bytes.length;

      const localName = `${output.descriptor.id}-${output.index}${extension}`;
      const outputPath = path.join(outputDirectory, localName);
      assertContained(outputDirectory, outputPath, 'Output file');
      const flags = fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await open(outputPath, flags, 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const realOutput = await realpath(outputPath);
      assertContained(outputDirectory, realOutput, 'Saved output');
      artifacts.push({
        id: output.descriptor.id,
        type: output.descriptor.type,
        path: realOutput,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mimeType,
        source: { ...output.reference },
      });
    }
    return artifacts;
  }

  private async upload(
    endpoint: '/upload/image' | '/upload/mask',
    upload: ComfyUIImageUpload,
    originalRef: ComfyUIUploadedAsset | undefined,
    signal?: AbortSignal,
  ): Promise<ComfyUIUploadedAsset> {
    const form = new FormData();
    const bytes = Uint8Array.from(upload.bytes);
    form.append('image', new Blob([bytes], { type: upload.mimeType }), upload.filename);
    form.append('type', 'input');
    const requestedSubfolder = originalRef?.subfolder ?? upload.subfolder;
    if (originalRef && upload.subfolder !== undefined && upload.subfolder !== originalRef.subfolder) {
      throw new ComfyUIRecipeRuntimeError(
        'INVALID_CONFIGURATION',
        'Mask upload subfolder must match its original image reference',
      );
    }
    if (requestedSubfolder) form.append('subfolder', requestedSubfolder);
    if (originalRef) {
      form.append('original_ref', JSON.stringify({
        filename: originalRef.filename,
        subfolder: originalRef.subfolder,
        type: originalRef.type,
      }));
    } else {
      form.append('overwrite', 'false');
    }
    const response = await this.requestJson(
      endpoint,
      { method: 'POST', headers: { accept: 'application/json' }, body: form },
      256 * 1024,
      this.limits.uploadTimeoutMs,
      signal,
    );
    const filename = readString(response, 'name') ?? readString(response, 'filename');
    const responseSubfolder = readString(response, 'subfolder') ?? '';
    const type = readString(response, 'type') ?? 'input';
    const result = {
      filename: filename ?? '',
      subfolder: responseSubfolder,
      type,
      workflowPath: responseSubfolder ? `${responseSubfolder}/${filename ?? ''}` : filename ?? '',
    };
    validateUploadedAsset(result);
    return { ...result, type: 'input' };
  }

  private async requestJson(
    endpoint: string,
    init: RequestInit,
    maxBytes: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const startedAt = Date.now();
    const url = this.endpoint(endpoint);
    const response = await this.requestRaw(url, init, timeoutMs, signal);
    assertOk(response, url.toString());
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const bytes = await readResponseBytes(response, maxBytes, remaining, signal);
    try {
      return JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', `${url.pathname} returned invalid JSON`);
    }
  }

  private async requestAck(
    endpoint: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<void> {
    const url = this.endpoint(endpoint);
    const response = await this.requestRaw(url, init, timeoutMs);
    assertOk(response, url.toString());
    await response.body?.cancel();
  }

  private requestRaw(
    url: URL,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    return boundedOperation(async (boundedSignal) => {
      try {
        return await this.fetchImpl(url, { ...init, redirect: 'error', signal: boundedSignal });
      } catch (error) {
        if (boundedSignal.aborted) throw abortLikeError(signal, 'NETWORK_TIMEOUT');
        throw new ComfyUIRecipeRuntimeError(
          'NETWORK_ERROR',
          `ComfyUI request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, timeoutMs, signal);
  }

  private endpoint(endpoint: string): URL {
    if (!endpoint.startsWith('/') || endpoint.startsWith('//')) {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'ComfyUI endpoint must be root-relative');
    }
    const url = new URL(this.baseUrl.origin);
    url.pathname = endpoint;
    return url;
  }

  private requestBudget(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ComfyUIRecipeRuntimeError('RUN_TIMEOUT', 'ComfyUI run timed out');
    return Math.max(1, Math.min(this.limits.requestTimeoutMs, remaining));
  }
}

function validateBaseUrl(raw: string, trustedOrigins: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Invalid ComfyUI base URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Unsafe ComfyUI base URL');
  }
  const trusted = new Set<string>();
  for (const origin of trustedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Invalid trusted ComfyUI origin');
    }
    if (parsed.origin !== origin || parsed.protocol !== 'https:') {
      throw new ComfyUIRecipeRuntimeError(
        'INVALID_CONFIGURATION',
        'Trusted remote ComfyUI entries must be exact HTTPS origins',
      );
    }
    trusted.add(parsed.origin);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) && !trusted.has(url.origin)) {
    throw new ComfyUIRecipeRuntimeError(
      'INVALID_CONFIGURATION',
      'Remote ComfyUI origins must be explicitly trusted by core configuration',
    );
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Remote ComfyUI origins must use HTTPS');
  }
  return new URL(`${url.origin}/`);
}

function requireAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value)) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', `${label} must be absolute`);
  }
  return path.resolve(value);
}

function validateResources(resources: ComfyUIRuntimeResourceLimits): ComfyUIRuntimeResourceLimits {
  for (const [name, value] of Object.entries(resources)) {
    if (name !== 'maxTier' && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1024 * 1024)) {
      throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', `Invalid resource limit: ${name}`);
    }
  }
  if (resources.maxTier !== undefined && !(resources.maxTier in RESOURCE_TIER_ORDER)) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Invalid maximum resource tier');
  }
  return { ...resources };
}

function resolveLimits(limits: ComfyUIRecipeRuntimeLimits): ResolvedRuntimeLimits {
  return {
    requestTimeoutMs: boundedLimit(limits.requestTimeoutMs, 10, 5 * 60_000, 30_000, 'requestTimeoutMs'),
    uploadTimeoutMs: boundedLimit(limits.uploadTimeoutMs, 10, 10 * 60_000, 120_000, 'uploadTimeoutMs'),
    maxRunMs: boundedLimit(limits.maxRunMs, 20, 60 * 60_000, 15 * 60_000, 'maxRunMs'),
    pollIntervalMs: boundedLimit(limits.pollIntervalMs, 1, 60_000, 500, 'pollIntervalMs'),
    maxObjectInfoBytes: boundedLimit(limits.maxObjectInfoBytes, 1024, 64 * 1024 * 1024, 16 * 1024 * 1024, 'maxObjectInfoBytes'),
    maxHistoryBytes: boundedLimit(limits.maxHistoryBytes, 1024, 64 * 1024 * 1024, 8 * 1024 * 1024, 'maxHistoryBytes'),
    maxOutputBytes: boundedLimit(limits.maxOutputBytes, 1024, 2 * 1024 * 1024 * 1024, 1024 * 1024 * 1024, 'maxOutputBytes'),
    maxTotalOutputBytes: boundedLimit(limits.maxTotalOutputBytes, 1024, 4 * 1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024, 'maxTotalOutputBytes'),
    maxUploadBytes: boundedLimit(limits.maxUploadBytes, 1024, 512 * 1024 * 1024, 64 * 1024 * 1024, 'maxUploadBytes'),
  };
}

function boundedLimit(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ComfyUIRecipeRuntimeError(
      'INVALID_CONFIGURATION',
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

async function inspectModelRoot(rootPath: string): Promise<ModelRootSnapshot> {
  const stats = await lstat(rootPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('ComfyUI models root is not a real directory');
  const canonical = await realpath(rootPath);
  if (canonical !== rootPath) throw new Error('ComfyUI models root contains a symbolic-link path component');
  return { configuredPath: rootPath, realPath: canonical, stats };
}

async function verifyModelRoot(root: ModelRootSnapshot): Promise<void> {
  const current = await lstat(root.configuredPath);
  if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, root.stats)) {
    throw new Error('ComfyUI models root changed during preflight');
  }
  if (await realpath(root.configuredPath) !== root.realPath) {
    throw new Error('ComfyUI models root identity changed during preflight');
  }
}

async function checkModel(
  root: ModelRootSnapshot,
  requirement: ComfyUIRecipe['requirements']['models'][number],
  signal?: AbortSignal,
): Promise<ComfyUIPreflightIssue[]> {
  throwIfAborted(signal);
  const issues: ComfyUIPreflightIssue[] = [];
  const candidate = path.resolve(root.realPath, ...requirement.relativePath.split('/'));
  try {
    assertContained(root.realPath, candidate, 'Model path');
    const snapshots = await snapshotModelPath(root.realPath, requirement.relativePath);
    const fileSnapshot = snapshots.at(-1);
    if (!fileSnapshot?.stats.isFile()) throw new Error('model is not a regular file');
    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(candidate, flags);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameIdentity(opened, fileSnapshot.stats)) {
        throw new Error('model changed while it was being opened');
      }
      if (opened.size < requirement.minBytes) {
        issues.push({
          code: 'model-too-small',
          requirement: requirement.id,
          message: `${requirement.relativePath} is ${opened.size} bytes; minimum is ${requirement.minBytes}`,
        });
      }
      if (requirement.sha256) {
        const digest = await hashFileHandle(handle, signal);
        if (digest !== requirement.sha256) {
          issues.push({
            code: 'model-hash',
            requirement: requirement.id,
            message: `${requirement.relativePath} failed SHA-256 verification`,
          });
        }
      }
      const after = await handle.stat();
      if (!sameSnapshot(opened, after)) throw new Error('model changed during preflight');
    } finally {
      await handle.close();
    }
    const canonical = await realpath(candidate);
    assertContained(root.realPath, canonical, 'Model real path');
    await verifyFileSnapshots(snapshots);
  } catch (error) {
    if (error instanceof ComfyUIRecipeRuntimeError && error.code === 'ABORTED') throw error;
    const code = (error as NodeJS.ErrnoException).code;
    issues.push({
      code: code === 'ENOENT' ? 'missing-model' : 'unsafe-model',
      requirement: requirement.id,
      message: code === 'ENOENT'
        ? `Missing model: ${requirement.relativePath}`
        : `Unsafe model ${requirement.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return issues;
}

async function snapshotModelPath(root: string, relativePath: string): Promise<FileSnapshot[]> {
  if (!isSafeComfyUIRelativePath(relativePath)) throw new Error('unsafe model relative path');
  const snapshots: FileSnapshot[] = [];
  let cursor = root;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) throw new Error('empty model path segment');
    cursor = path.join(cursor, segment);
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) throw new Error('model path contains a symbolic link');
    const isLast = index === segments.length - 1;
    if ((!isLast && !stats.isDirectory()) || (isLast && !stats.isFile())) {
      throw new Error('model path has an unexpected file type');
    }
    snapshots.push({ path: cursor, stats });
  }
  return snapshots;
}

async function verifyFileSnapshots(snapshots: readonly FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    const current = await lstat(snapshot.path);
    if (current.isSymbolicLink() || !sameIdentity(current, snapshot.stats)) {
      throw new Error('model path changed during preflight');
    }
  }
}

async function hashFileHandle(
  handle: Awaited<ReturnType<typeof open>>,
  signal?: AbortSignal,
): Promise<string> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    throwIfAborted(signal);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

function extractHistoryOutputs(recipe: ComfyUIRecipe, entry: Record<string, unknown>): HistoryOutputReference[] {
  const outputs = isPlainRecord(entry.outputs) ? entry.outputs : {};
  const result: HistoryOutputReference[] = [];
  for (const descriptor of recipe.outputs) {
    const nodeOutput = outputs[descriptor.nodeId];
    const values = isPlainRecord(nodeOutput) ? nodeOutput[descriptor.field] : undefined;
    if (!Array.isArray(values)) {
      if (descriptor.required) {
        throw new ComfyUIRecipeRuntimeError(
          'BAD_RESPONSE',
          `Required ComfyUI output is missing: ${descriptor.id} (${descriptor.nodeId}.${descriptor.field})`,
        );
      }
      continue;
    }
    if (values.length > descriptor.maxItems) {
      throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Output ${descriptor.id} exceeds its item limit`);
    }
    for (let index = 0; index < values.length; index += 1) {
      result.push({ descriptor, reference: parseOutputReference(values[index]), index });
    }
    if (descriptor.required && values.length === 0) {
      throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', `Required ComfyUI output is empty: ${descriptor.id}`);
    }
  }
  if (result.length > 64) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'ComfyUI history returned too many outputs');
  }
  return result;
}

function parseOutputReference(value: unknown): ComfyUIOutputReference {
  if (!isPlainRecord(value)) throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'Invalid output reference');
  const filename = readString(value, 'filename') ?? readString(value, 'name');
  const subfolder = readString(value, 'subfolder') ?? '';
  const type = readString(value, 'type') ?? 'output';
  if (!filename
    || !isSafeFilename(filename)
    || !isSafeSubfolder(subfolder)
    || (type !== 'output' && type !== 'temp')) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'ComfyUI returned an unsafe output path');
  }
  return { filename, subfolder, type };
}

function historyEntry(history: unknown, promptId: string): Record<string, unknown> | undefined {
  if (!isPlainRecord(history)) {
    throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', 'ComfyUI history response is not an object');
  }
  const nested = history[promptId];
  if (isPlainRecord(nested)) return nested;
  if (Object.prototype.hasOwnProperty.call(history, 'outputs')
    || Object.prototype.hasOwnProperty.call(history, 'status')) return history;
  return undefined;
}

function readStatus(entry: Record<string, unknown>): string | undefined {
  if (!isPlainRecord(entry.status)) return undefined;
  const value = entry.status.status_str;
  return typeof value === 'string' ? value.toLowerCase() : undefined;
}

function boundedStatusDetails(entry: Record<string, unknown>): string {
  if (!isPlainRecord(entry.status)) return '';
  try {
    return JSON.stringify(entry.status.messages ?? '').slice(0, 1000);
  } catch {
    return '';
  }
}

function validatedOutputExtension(
  type: ComfyUIRecipe['outputs'][number]['type'],
  filename: string,
): string {
  const extension = path.extname(filename).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(OUTPUT_MEDIA[type], extension)) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Unsupported ${type} output extension: ${extension || '<none>'}`);
  }
  return extension;
}

function acceptedMimeTypes(
  type: ComfyUIRecipe['outputs'][number]['type'],
  extension: string,
): readonly string[] {
  return OUTPUT_MEDIA[type][extension] ?? [];
}

function validateOutputMedia(
  response: Response,
  bytes: Buffer,
  type: ComfyUIRecipe['outputs'][number]['type'],
  extension: string,
): string {
  const rawMime = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const allowed = acceptedMimeTypes(type, extension);
  if (rawMime && rawMime !== 'application/octet-stream' && !allowed.includes(rawMime)) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Output MIME ${rawMime} does not match ${type}${extension}`);
  }
  if (!matchesMediaSignature(bytes, extension)) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Output bytes do not match ${extension}`);
  }
  return rawMime || allowed[0] || 'application/octet-stream';
}

function matchesMediaSignature(bytes: Buffer, extension: string): boolean {
  switch (extension) {
    case '.png':
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case '.jpg':
    case '.jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case '.webp':
      return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    case '.gif':
      return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
    case '.mp4':
    case '.mov':
    case '.m4a':
      return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
    case '.webm':
    case '.mkv':
      return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case '.wav':
      return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
    case '.flac':
      return bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'fLaC';
    case '.mp3':
      return bytes.length >= 3 && (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0));
    case '.ogg':
      return bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS';
    case '.aac':
      return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
    case '.glb':
      return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'glTF';
    case '.gltf':
      try {
        const value = JSON.parse(bytes.toString('utf8')) as unknown;
        return isPlainRecord(value) && typeof value.asset === 'object';
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function validateUpload(upload: ComfyUIImageUpload, maxBytes: number, mask: boolean): void {
  if (!(upload.bytes instanceof Uint8Array) || upload.bytes.byteLength === 0 || upload.bytes.byteLength > maxBytes) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Upload bytes are empty or exceed the configured limit');
  }
  if (!isSafeFilename(upload.filename) || !isSafeSubfolder(upload.subfolder ?? '')) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Upload path is unsafe');
  }
  const expectedExtension = upload.mimeType === 'image/png'
    ? '.png'
    : upload.mimeType === 'image/webp' ? '.webp' : ['.jpg', '.jpeg'];
  const extension = path.extname(upload.filename).toLowerCase();
  if (Array.isArray(expectedExtension) ? !expectedExtension.includes(extension) : extension !== expectedExtension) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Upload extension does not match its MIME type');
  }
  if (mask && upload.mimeType !== 'image/png') {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'ComfyUI masks must use PNG');
  }
  if (!matchesMediaSignature(Buffer.from(upload.bytes), extension)) {
    throw new ComfyUIRecipeRuntimeError('INVALID_CONFIGURATION', 'Upload bytes do not match the declared image format');
  }
}

function validateUploadedAsset(asset: {
  filename: string;
  subfolder: string;
  type: string;
  workflowPath?: string;
}): asserts asset is ComfyUIUploadedAsset {
  const expectedPath = asset.subfolder ? `${asset.subfolder}/${asset.filename}` : asset.filename;
  if (!isSafeFilename(asset.filename)
    || !isSafeSubfolder(asset.subfolder)
    || asset.type !== 'input'
    || !isSafeComfyUIAssetReference(expectedPath)
    || (asset.workflowPath !== undefined && asset.workflowPath !== expectedPath)) {
    throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', 'ComfyUI upload returned an unsafe reference');
  }
}

function isSafeFilename(value: string): boolean {
  return SAFE_FILENAME.test(value) && value !== '.' && value !== '..';
}

function isSafeSubfolder(value: string): boolean {
  return value === '' || (value.length <= 512 && isSafeComfyUIRelativePath(value));
}

async function createConfinedOutputDirectory(outputRoot: string, promptId: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const rootStats = await lstat(outputRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'Output root is not a real directory');
  }
  const rootReal = await realpath(outputRoot);
  if (rootReal !== outputRoot) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'Output root contains a symbolic-link path component');
  }
  const directoryName = `${promptId.slice(0, 40)}-${randomUUID()}`;
  const directory = path.join(rootReal, directoryName);
  assertContained(rootReal, directory, 'Output directory');
  await mkdir(directory, { mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'Output directory is unsafe');
  }
  const canonical = await realpath(directory);
  assertContained(rootReal, canonical, 'Output directory');
  const rootAfter = await lstat(outputRoot);
  if (!sameIdentity(rootStats, rootAfter)) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', 'Output root changed during creation');
  }
  return canonical;
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  return boundedOperation(
    (boundedSignal) => readResponseBytesUnchecked(response, maxBytes, boundedSignal),
    timeoutMs,
    signal,
  );
}

async function readResponseBytesUnchecked(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', 'ComfyUI response has no body');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  const onAbort = () => { void reader.cancel('aborted'); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('response too large');
        throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `Response exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks, total);
}

function boundedOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      callback();
    };
    const onExternalAbort = () => {
      controller.abort(externalSignal?.reason);
      finish(() => reject(new ComfyUIRecipeRuntimeError('ABORTED', 'ComfyUI operation aborted')));
    };
    const timer = setTimeout(() => {
      controller.abort('timeout');
      finish(() => reject(new ComfyUIRecipeRuntimeError('NETWORK_TIMEOUT', `ComfyUI request exceeded ${timeoutMs} ms`)));
    }, timeoutMs);
    if (externalSignal?.aborted) {
      onExternalAbort();
      return;
    }
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ComfyUIRecipeRuntimeError('ABORTED', 'ComfyUI operation aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertOk(response: Response, url: string): void {
  if (!response.ok) {
    throw new ComfyUIRecipeRuntimeError('BAD_RESPONSE', `${url} returned HTTP ${response.status}`);
  }
}

function readString(value: unknown, key: string): string | undefined {
  if (!isPlainRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertContained(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ComfyUIRecipeRuntimeError('UNSAFE_OUTPUT', `${label} escapes its configured root`);
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function defaultSeed(): number {
  return Number.parseInt(createHash('sha256').update(randomUUID()).digest('hex').slice(0, 12), 16);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ComfyUIRecipeRuntimeError('ABORTED', 'ComfyUI operation aborted');
}

function abortLikeError(
  externalSignal: AbortSignal | undefined,
  fallback: ComfyUIRecipeRuntimeErrorCode,
): ComfyUIRecipeRuntimeError {
  return externalSignal?.aborted
    ? new ComfyUIRecipeRuntimeError('ABORTED', 'ComfyUI operation aborted')
    : new ComfyUIRecipeRuntimeError(fallback, 'ComfyUI request timed out');
}

function normalizeRuntimeError(error: unknown, signal: AbortSignal | undefined, deadline: number): Error {
  if (error instanceof ComfyUIRecipeRuntimeError || error instanceof ComfyUIRecipeValidationError) return error;
  if (signal?.aborted) return new ComfyUIRecipeRuntimeError('ABORTED', 'ComfyUI operation aborted');
  if (Date.now() >= deadline) return new ComfyUIRecipeRuntimeError('RUN_TIMEOUT', 'ComfyUI run timed out');
  return new ComfyUIRecipeRuntimeError(
    'RUN_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}
