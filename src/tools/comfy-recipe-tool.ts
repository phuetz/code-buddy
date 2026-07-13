import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ToolResult } from '../types/index.js';
import {
  isSafeComfyUIAssetReference,
  type ComfyUIRecipe,
  type ComfyUIRecipeRunInputs,
  type ComfyUIRecipeSelector,
} from '../media/comfyui-recipe-contract.js';
import { ComfyUIRecipeRegistry } from '../media/comfyui-recipe-registry.js';
import {
  ComfyUIRecipeRuntime,
  type ComfyUIPreflightResult,
  type ComfyUIImageUpload,
  type ComfyUIRecipeRunOptions,
  type ComfyUIRecipeRunResult,
  type ComfyUIRecipeRuntimeOptions,
  type ComfyUIUploadedAsset,
} from '../media/comfyui-recipe-runtime.js';
import {
  ConfirmationService,
  type ConfirmationOptions,
  type ConfirmationResult,
} from '../utils/confirmation-service.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './registry/types.js';

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const OUTPUT_RELATIVE_ROOT = path.join('.codebuddy', 'media-generation', 'recipes');
const MAX_REFERENCE_IMAGES = 32;
const MAX_REFERENCE_IMAGE_BYTES = 64 * 1024 * 1024;
const REFERENCE_UPLOAD_SUBFOLDER = 'codebuddy-references';

interface ReferenceImageInput {
  id: string;
  path: string;
}

interface PreparedReferenceImage extends ReferenceImageInput {
  bytes: Uint8Array;
  mimeType: ComfyUIImageUpload['mimeType'];
  sha256: string;
  uploadFilename: string;
}

interface OwnedUpload {
  reference: PreparedReferenceImage;
  uploaded: ComfyUIUploadedAsset;
}

interface UploadCleanupLease {
  inputRoot: string;
  inputRootSnapshot?: Stats;
  subfolder: string;
  namespaceOwned: boolean;
  uploads: OwnedUpload[];
}

interface UploadCleanupReport {
  removed: number;
  retainedReferences: string[];
}

interface RuntimeSurface {
  preflight(
    selector: string | ComfyUIRecipeSelector,
    options?: Pick<ComfyUIRecipeRunOptions, 'signal' | 'commercialUse'>,
  ): Promise<ComfyUIPreflightResult>;
  run(
    selector: string | ComfyUIRecipeSelector,
    inputs: ComfyUIRecipeRunInputs,
    options?: ComfyUIRecipeRunOptions,
  ): Promise<ComfyUIRecipeRunResult>;
  uploadImage(upload: ComfyUIImageUpload, signal?: AbortSignal): Promise<ComfyUIUploadedAsset>;
}

export interface ComfyRecipeToolDependencies {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  createRuntime?: (options: ComfyUIRecipeRuntimeOptions) => RuntimeSurface;
  confirm?: (options: ConfirmationOptions) => Promise<ConfirmationResult>;
  createUploadToken?: () => string;
}

/** Restricted agent surface for registered local recipes and declared image bindings. */
export class ComfyRecipeTool implements ITool {
  readonly name = 'comfy_recipe';
  readonly description =
    'List, preflight, or run a registered local ComfyUI image/video/audio/3D recipe. A run may upload only workspace-local PNG/JPEG/WebP files mapped to image bindings explicitly declared by that recipe; masks, audio inputs, arbitrary workflows, and downloads remain blocked. Outputs are confined to .codebuddy/media-generation/recipes in the active workspace. commercial_use must always be explicit, and run always asks for fresh confirmation.';

  private readonly environment: NodeJS.ProcessEnv;
  private readonly homeDirectory: string;
  private readonly createRuntime: (options: ComfyUIRecipeRuntimeOptions) => RuntimeSurface;
  private readonly confirm: (options: ConfirmationOptions) => Promise<ConfirmationResult>;
  private readonly createUploadToken: () => string;

  constructor(deps: ComfyRecipeToolDependencies = {}) {
    this.environment = deps.environment ?? process.env;
    this.homeDirectory = deps.homeDirectory ?? homedir();
    this.createRuntime = deps.createRuntime ?? ((options) => new ComfyUIRecipeRuntime(options));
    this.confirm = deps.confirm ?? ((options) =>
      ConfirmationService.getInstance().requestConfirmation(options, 'file'));
    this.createUploadToken = deps.createUploadToken ?? (() => randomBytes(16).toString('hex'));
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const validation = this.validate(input);
    if (!validation.valid) {
      return { success: false, error: `comfy_recipe validation failed: ${validation.errors?.join(', ')}` };
    }

    try {
      const registry = await this.loadRegistry();
      const recipes = registry.list();
      if (input.action === 'list') {
        const summaries = recipes.map((recipe) => summarizeRecipe(recipe));
        return {
          success: true,
          output: summaries.length === 0
            ? 'No registered ComfyUI recipes were found.'
            : summaries.map(formatRecipeSummary).join('\n'),
          data: { recipes: summaries },
        };
      }

      const selector = selectorFromInput(input);
      const recipe = registry.get(selector);
      assertSupportedAgentInputs(recipe);
      const workspaceRoot = await resolveWorkspaceRoot(context?.cwd ?? process.cwd());
      const referenceImages = input.action === 'run'
        ? await prepareReferenceImages(
          recipe,
          input.reference_images as ReferenceImageInput[] | undefined,
          workspaceRoot,
          context?.abortSignal,
        )
        : [];
      const runtime = this.runtimeFor(registry, workspaceRoot, input.commercial_use as boolean);
      const preflight = await runtime.preflight(selector, {
        commercialUse: input.commercial_use as boolean,
        ...(context?.abortSignal ? { signal: context.abortSignal } : {}),
      });

      if (input.action === 'preflight') {
        return {
          success: preflight.ok,
          output: formatPreflight(preflight),
          data: { preflight, recipe: summarizeRecipe(recipe) },
          ...(preflight.ok ? {} : { error: 'ComfyUI recipe preflight failed' }),
        };
      }

      if (!preflight.ok) {
        return {
          success: false,
          error: 'ComfyUI recipe preflight failed',
          output: formatPreflight(preflight),
          data: { preflight, recipe: summarizeRecipe(recipe) },
        };
      }

      const confirmation = await this.confirm({
        operation: 'Run registered ComfyUI recipe',
        filename: OUTPUT_RELATIVE_ROOT,
        showVSCodeOpen: false,
        forcePrompt: true,
        content: [
          `Recipe: ${recipe.id}@${recipe.version}`,
          `Outputs: ${recipe.outputs.map((output) => output.type).join(', ')}`,
          `Commercial use: ${(input.commercial_use as boolean) ? 'yes' : 'no'}`,
          `Prompt: ${preview(input.prompt as string)}`,
          formatReferenceConfirmation(referenceImages),
          `Destination: ${OUTPUT_RELATIVE_ROOT}`,
        ].join('\n'),
      });
      if (!confirmation.confirmed) {
        return { success: false, error: confirmation.feedback || 'ComfyUI recipe run cancelled by user' };
      }

      const dimensions = input.width === undefined
        ? undefined
        : { width: input.width as number, height: input.height as number };
      const uploadedImages: Record<string, string> = {};
      const cleanupLease = await createUploadCleanupLease(
        this.configuredComfyRoot(),
        this.createUploadToken(),
        referenceImages.length > 0,
      );
      let cleanupReport: UploadCleanupReport = { removed: 0, retainedReferences: [] };
      let run: ComfyUIRecipeRunResult;
      try {
        for (const reference of referenceImages) {
          const uploaded = await runtime.uploadImage({
            bytes: reference.bytes,
            filename: reference.uploadFilename,
            mimeType: reference.mimeType,
            subfolder: cleanupLease.subfolder,
          }, context?.abortSignal);
          cleanupLease.uploads.push({ reference, uploaded });
          if (!isSafeComfyUIAssetReference(uploaded.workflowPath)
            || uploaded.subfolder !== cleanupLease.subfolder) {
            throw new Error(`ComfyUI returned an unsafe upload reference for image binding ${reference.id}`);
          }
          uploadedImages[reference.id] = uploaded.workflowPath;
        }
        run = await runtime.run(
          selector,
          {
            prompt: input.prompt as string,
            ...(input.negative_prompt === undefined ? {} : { negativePrompt: input.negative_prompt as string }),
            ...(input.seed === undefined ? {} : { seed: input.seed as number }),
            ...(dimensions ? { dimensions } : {}),
            ...(Object.keys(uploadedImages).length === 0 ? {} : { images: uploadedImages }),
          },
          {
            commercialUse: input.commercial_use as boolean,
            allowFallback: input.allow_fallback !== false,
            ...(context?.abortSignal ? { signal: context.abortSignal } : {}),
          },
        );
      } finally {
        cleanupReport = await cleanupOwnedUploads(cleanupLease);
      }
      const visibleArtifacts = run.artifacts.map((artifact) => {
        const relative = path.relative(workspaceRoot, artifact.path);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error('ComfyUI runtime returned an artifact outside the active workspace');
        }
        return { ...artifact, path: relative };
      });
      return {
        success: true,
        output: `ComfyUI recipe ${run.recipeId}@${run.recipeVersion} created ${visibleArtifacts.length} artifact(s):\n${visibleArtifacts.map((artifact) => `- ${artifact.path} (${artifact.type}, ${artifact.bytes} bytes)`).join('\n')}`,
        data: { ...run, artifacts: visibleArtifacts, uploadCleanup: cleanupReport },
      };
    } catch (error) {
      return { success: false, error: `comfy_recipe failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'preflight', 'run'], description: 'Operation to perform.' },
          commercial_use: { type: 'boolean', description: 'Explicitly declare whether the result is intended for commercial use.' },
          recipe_id: { type: 'string', description: 'Registered recipe id (required for preflight/run).' },
          version: { type: 'string', description: 'Optional exact registered semantic version.' },
          prompt: { type: 'string', maxLength: 16_384, description: 'Text prompt (run only).' },
          negative_prompt: { type: 'string', maxLength: 16_384, description: 'Optional negative prompt (run only).' },
          seed: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Optional deterministic integer seed.' },
          width: { type: 'number', minimum: 16, maximum: 16_384, description: 'Optional width; height must be supplied too.' },
          height: { type: 'number', minimum: 16, maximum: 16_384, description: 'Optional height; width must be supplied too.' },
          allow_fallback: { type: 'boolean', default: true, description: 'Allow only fallbacks already declared by the registered recipe.' },
          reference_images: {
            type: 'array',
            description: 'Workspace-local image references for run only. Every id must exactly match a recipe-declared image binding.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Exact recipe image-binding id.' },
                path: { type: 'string', maxLength: 1024, description: 'Relative workspace path to a PNG, JPEG, or WebP file.' },
              },
              required: ['id', 'path'],
            },
          },
        },
        required: ['action', 'commercial_use'],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const value = input as Record<string, unknown>;
    const allowed = new Set([
      'action', 'commercial_use', 'recipe_id', 'version', 'prompt', 'negative_prompt',
      'seed', 'width', 'height', 'allow_fallback', 'reference_images',
    ]);
    const errors = Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `Unknown input: ${key}`);
    if (!['list', 'preflight', 'run'].includes(String(value.action))) errors.push('action must be list, preflight, or run');
    if (typeof value.commercial_use !== 'boolean') errors.push('commercial_use must be an explicit boolean');
    if (value.action !== 'list') {
      if (typeof value.recipe_id !== 'string' || !SAFE_ID.test(value.recipe_id)) errors.push('recipe_id is invalid');
      if (value.version !== undefined && (typeof value.version !== 'string' || !SAFE_VERSION.test(value.version))) errors.push('version is invalid');
    }
    if (value.action === 'run') {
      if (typeof value.prompt !== 'string' || value.prompt.length === 0 || value.prompt.length > 16_384) errors.push('prompt must be 1..16384 characters');
    } else if (value.prompt !== undefined || value.negative_prompt !== undefined || value.seed !== undefined || value.width !== undefined || value.height !== undefined || value.reference_images !== undefined) {
      errors.push('generation inputs are accepted only for action=run');
    }
    if (value.negative_prompt !== undefined && (typeof value.negative_prompt !== 'string' || value.negative_prompt.length > 16_384)) errors.push('negative_prompt is invalid');
    if (value.seed !== undefined && (!Number.isSafeInteger(value.seed) || (value.seed as number) < 0)) errors.push('seed must be a non-negative safe integer');
    for (const dimension of ['width', 'height'] as const) {
      const entry = value[dimension];
      if (entry !== undefined && (!Number.isInteger(entry) || (entry as number) < 16 || (entry as number) > 16_384)) errors.push(`${dimension} is invalid`);
    }
    if ((value.width === undefined) !== (value.height === undefined)) errors.push('width and height must be supplied together');
    if (value.allow_fallback !== undefined && typeof value.allow_fallback !== 'boolean') errors.push('allow_fallback must be boolean');
    validateReferenceImageInput(value.reference_images, errors);
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'media' as ToolCategoryType,
      keywords: ['comfyui', 'comfy', 'recipe', 'workflow', 'image', 'reference image', 'avatar', 'character consistency', 'video', 'audio', '3d', 'storyboard', 'cover', 'trailer', 'local generation'],
      priority: 9,
      modifiesFiles: true,
      makesNetworkRequests: true,
      requiresConfirmation: false,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean { return true; }

  private async loadRegistry(): Promise<ComfyUIRecipeRegistry> {
    const configured = this.environment.CODEBUDDY_COMFY_RECIPE_DIR?.trim();
    const directory = configured || path.join(this.homeDirectory, '.codebuddy', 'comfy-recipes');
    if (!path.isAbsolute(directory) || directory.includes('\0')) throw new Error('ComfyUI recipe directory must be an absolute local path');
    const registry = new ComfyUIRecipeRegistry();
    await registry.loadDirectory(path.resolve(directory));
    return registry;
  }

  private runtimeFor(registry: ComfyUIRecipeRegistry, workspaceRoot: string, commercialUse: boolean): RuntimeSurface {
    const comfyRoot = this.configuredComfyRoot();
    return this.createRuntime({
      registry,
      baseUrl: this.environment.CODEBUDDY_COMFYUI_URL?.trim()
        || this.environment.COMFYUI_URL?.trim()
        || 'http://127.0.0.1:8188',
      modelsRoot: path.join(path.resolve(comfyRoot), 'models'),
      outputRoot: path.join(workspaceRoot, OUTPUT_RELATIVE_ROOT),
      commercialUse,
    });
  }

  private configuredComfyRoot(): string {
    const comfyRoot = this.environment.COMFYUI_ROOT?.trim();
    if (!comfyRoot || !path.isAbsolute(comfyRoot) || comfyRoot.includes('\0')) {
      throw new Error('COMFYUI_ROOT must be configured as an absolute local ComfyUI installation path');
    }
    return path.resolve(comfyRoot);
  }
}

async function resolveWorkspaceRoot(cwd: string): Promise<string> {
  const root = await realpath(path.resolve(cwd));
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error('Active ComfyUI workspace is not a directory');
  return root;
}

function selectorFromInput(input: Record<string, unknown>): ComfyUIRecipeSelector {
  return {
    id: input.recipe_id as string,
    ...(input.version === undefined ? {} : { version: input.version as string }),
  };
}

function assertSupportedAgentInputs(recipe: ComfyUIRecipe): void {
  if (!recipe.modalities.includes('text')) {
    throw new Error(`Recipe ${recipe.id}@${recipe.version} does not declare a text input`);
  }
  if (recipe.bindings.mask || recipe.bindings.audio) {
    throw new Error(`Recipe ${recipe.id}@${recipe.version} declares a mask or audio input; this agent surface supports only text and declared reference images`);
  }
}

function summarizeRecipe(recipe: ComfyUIRecipe) {
  const textInputOnly = recipe.modalities.includes('text')
    && recipe.bindings.images.length === 0
    && !recipe.bindings.mask
    && !recipe.bindings.audio;
  return {
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
    outputTypes: [...new Set(recipe.outputs.map((output) => output.type))],
    license: recipe.license,
    commercialAllowed: recipe.commercialAllowed,
    resourceTier: recipe.resources.tier,
    estimatedSeconds: recipe.resources.estimatedSeconds ?? null,
    textInputOnly,
    imageBindingIds: recipe.bindings.images.map((binding) => binding.id),
    agentReady: recipe.modalities.includes('text') && !recipe.bindings.mask && !recipe.bindings.audio,
  };
}

function formatRecipeSummary(recipe: ReturnType<typeof summarizeRecipe>): string {
  const imageInputs = recipe.imageBindingIds.length > 0
    ? `; reference-images=${recipe.imageBindingIds.join(',')}`
    : '';
  return `- ${recipe.id}@${recipe.version}: ${recipe.title} [${recipe.outputTypes.join(', ')}] — ${recipe.license.spdx}; commercial=${recipe.commercialAllowed ? 'yes' : 'no'}; agent=${recipe.agentReady ? 'ready' : 'asset-input blocked'}${imageInputs}`;
}

function formatPreflight(result: ComfyUIPreflightResult): string {
  if (result.ok) return `Preflight passed for ${result.recipeId}@${result.recipeVersion} (${result.checkedNodes} nodes, ${result.checkedModels} models checked).`;
  return `Preflight failed for ${result.recipeId}@${result.recipeVersion}:\n${result.issues.map((issue) => `- [${issue.code}] ${issue.message}`).join('\n')}`;
}

function preview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}

function validateReferenceImageInput(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('reference_images must be an array');
    return;
  }
  if (value.length > MAX_REFERENCE_IMAGES) {
    errors.push(`reference_images must contain at most ${MAX_REFERENCE_IMAGES} items`);
  }
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`reference_images[${index}] must be an object`);
      continue;
    }
    const record = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(record).filter((key) => key !== 'id' && key !== 'path');
    if (unknownKeys.length > 0) errors.push(`reference_images[${index}] has unknown fields`);
    if (typeof record.id !== 'string' || !SAFE_ID.test(record.id)) {
      errors.push(`reference_images[${index}].id is invalid`);
    } else if (ids.has(record.id)) {
      errors.push(`reference_images contains duplicate id: ${record.id}`);
    } else {
      ids.add(record.id);
    }
    if (typeof record.path !== 'string' || !isSafeWorkspaceRelativeInputPath(record.path)) {
      errors.push(`reference_images[${index}].path must be a safe relative workspace path`);
    }
  }
}

async function prepareReferenceImages(
  recipe: ComfyUIRecipe,
  supplied: ReferenceImageInput[] | undefined,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<PreparedReferenceImage[]> {
  const references = supplied ?? [];
  const declared = new Map(recipe.bindings.images.map((binding) => [binding.id, binding]));
  for (const reference of references) {
    if (!declared.has(reference.id)) {
      throw new Error(`Unknown recipe image binding: ${reference.id}`);
    }
  }
  const suppliedIds = new Set(references.map((reference) => reference.id));
  for (const binding of recipe.bindings.images) {
    if (binding.required && !suppliedIds.has(binding.id)) {
      throw new Error(`Missing required recipe image: ${binding.id}`);
    }
  }

  const prepared: PreparedReferenceImage[] = [];
  for (const reference of references) {
    prepared.push(await readWorkspaceReferenceImage(workspaceRoot, reference, signal));
  }
  return prepared;
}

async function readWorkspaceReferenceImage(
  workspaceRoot: string,
  reference: ReferenceImageInput,
  signal?: AbortSignal,
): Promise<PreparedReferenceImage> {
  try {
    throwIfAborted(signal);
    const segments = reference.path.split('/');
    const candidate = path.resolve(workspaceRoot, ...segments);
    assertContained(workspaceRoot, candidate);

    const snapshots: Array<{ absolutePath: string; stats: Stats }> = [];
    let current = workspaceRoot;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} contains a symbolic link`);
      }
      const isLast = index === segments.length - 1;
      if (isLast ? !info.isFile() : !info.isDirectory()) {
        throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} is not a regular workspace file`);
      }
      snapshots.push({ absolutePath: current, stats: info });
    }

    const fileSnapshot = snapshots.at(-1)?.stats;
    if (!fileSnapshot || fileSnapshot.size === 0 || fileSnapshot.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} must be between 1 and ${MAX_REFERENCE_IMAGE_BYTES} bytes`);
    }

    const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
    const handle = await open(candidate, flags);
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameIdentity(opened, fileSnapshot)) {
        throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} changed while it was opened`);
      }
      bytes = await readFileHandleBounded(handle, MAX_REFERENCE_IMAGE_BYTES, signal);
      const afterRead = await handle.stat();
      if (!sameSnapshot(opened, afterRead) || afterRead.size !== bytes.length) {
        throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} changed while it was read`);
      }
    } finally {
      await handle.close();
    }

    const canonical = await realpath(candidate);
    assertContained(workspaceRoot, canonical);
    for (const snapshot of snapshots) {
      const currentInfo = await lstat(snapshot.absolutePath);
      if (!sameSnapshot(currentInfo, snapshot.stats)) {
        throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} changed during validation`);
      }
    }

    const mimeType = detectReferenceImageMime(bytes, reference.path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      ...reference,
      bytes,
      mimeType,
      sha256,
      uploadFilename: `${reference.id}-${sha256.slice(0, 16)}${extensionForMime(mimeType)}`,
    };
  } catch (error) {
    if (error instanceof ReferenceImageError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ReferenceImageError(`Reference image ${JSON.stringify(reference.path)} could not be read safely`);
  }
}

async function readFileHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  limit: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    throwIfAborted(signal);
    const remaining = limit + 1 - total;
    if (remaining <= 0) throw new ReferenceImageError(`Reference image exceeds ${limit} bytes`);
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    chunks.push(chunk.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total === 0 || total > limit) throw new ReferenceImageError(`Reference image must be between 1 and ${limit} bytes`);
  return Buffer.concat(chunks, total);
}

function detectReferenceImageMime(bytes: Buffer, relativePath: string): ComfyUIImageUpload['mimeType'] {
  const extension = path.extname(relativePath).toLowerCase();
  let detected: ComfyUIImageUpload['mimeType'] | undefined;
  if (bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') {
    detected = 'image/png';
  } else if (bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    detected = 'image/jpeg';
  } else if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length) {
    detected = 'image/webp';
  }
  if (!detected) {
    throw new ReferenceImageError(`Reference image ${JSON.stringify(relativePath)} is not a valid PNG, JPEG, or WebP file`);
  }
  const allowedExtensions = detected === 'image/png'
    ? new Set(['.png'])
    : detected === 'image/jpeg' ? new Set(['.jpg', '.jpeg']) : new Set(['.webp']);
  if (!allowedExtensions.has(extension)) {
    throw new ReferenceImageError(`Reference image ${JSON.stringify(relativePath)} extension does not match its signature`);
  }
  return detected;
}

function extensionForMime(mimeType: ComfyUIImageUpload['mimeType']): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

function isSafeWorkspaceRelativeInputPath(value: string): boolean {
  if (!value || value.length > 1024 || value.includes('\0') || value.includes('\\') || value.includes(':')) return false;
  if (path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && ![...segment].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }));
}

function assertContained(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ReferenceImageError('Reference image must stay inside the active workspace');
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Operation aborted', 'AbortError');
}

function formatReferenceConfirmation(references: readonly PreparedReferenceImage[]): string {
  if (references.length === 0) return 'Reference images: none';
  return [
    'Reference images:',
    ...references.map((reference) => `- ${reference.id}: ${reference.path} (${reference.bytes.byteLength} bytes, SHA-256 ${reference.sha256})`),
  ].join('\n');
}

async function createUploadCleanupLease(
  comfyRoot: string,
  token: string,
  needed: boolean,
): Promise<UploadCleanupLease> {
  if (!/^[a-z0-9][a-z0-9_-]{15,63}$/.test(token)) {
    throw new Error('ComfyUI upload token generator returned an unsafe token');
  }
  const inputRoot = path.join(comfyRoot, 'input');
  const subfolder = `${REFERENCE_UPLOAD_SUBFOLDER}/${token}`;
  const lease: UploadCleanupLease = {
    inputRoot,
    subfolder,
    namespaceOwned: false,
    uploads: [],
  };
  if (!needed) return lease;

  try {
    const comfyInfo = await lstat(comfyRoot);
    const inputInfo = await lstat(inputRoot);
    if (!comfyInfo.isDirectory() || comfyInfo.isSymbolicLink()
      || !inputInfo.isDirectory() || inputInfo.isSymbolicLink()
      || await realpath(comfyRoot) !== comfyRoot
      || await realpath(inputRoot) !== inputRoot) {
      return lease;
    }
    const parent = path.join(inputRoot, REFERENCE_UPLOAD_SUBFOLDER);
    try {
      await mkdir(parent, { mode: 0o700 });
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) return lease;
    }
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || await realpath(parent) !== parent) {
      return lease;
    }
    const namespace = path.join(parent, token);
    await mkdir(namespace, { mode: 0o700 });
    const namespaceInfo = await lstat(namespace);
    if (!namespaceInfo.isDirectory() || namespaceInfo.isSymbolicLink() || await realpath(namespace) !== namespace) {
      return lease;
    }
    lease.inputRootSnapshot = inputInfo;
    lease.namespaceOwned = true;
  } catch {
    // Cleanup is privacy hardening, never a prerequisite for the primary run.
  }
  return lease;
}

async function cleanupOwnedUploads(lease: UploadCleanupLease): Promise<UploadCleanupReport> {
  const report: UploadCleanupReport = { removed: 0, retainedReferences: [] };
  for (const upload of lease.uploads) {
    const safeReference = isSafeComfyUIAssetReference(upload.uploaded.workflowPath)
      ? upload.uploaded.workflowPath
      : undefined;
    if (!lease.namespaceOwned || !lease.inputRootSnapshot || !safeReference) {
      if (safeReference) report.retainedReferences.push(safeReference);
      continue;
    }
    try {
      await cleanupOwnedUpload(lease, upload);
      report.removed += 1;
    } catch {
      report.retainedReferences.push(safeReference);
    }
  }

  if (lease.namespaceOwned) {
    try {
      await rmdir(path.join(lease.inputRoot, ...lease.subfolder.split('/')));
    } catch {
      // The namespace is kept if it is non-empty or its identity is uncertain.
    }
  }
  return report;
}

async function cleanupOwnedUpload(lease: UploadCleanupLease, upload: OwnedUpload): Promise<void> {
  if (upload.uploaded.subfolder !== lease.subfolder
    || upload.uploaded.type !== 'input'
    || upload.uploaded.workflowPath !== `${upload.uploaded.subfolder}/${upload.uploaded.filename}`) {
    throw new ReferenceImageError('Uploaded reference is outside its owned namespace');
  }
  const rootInfo = await lstat(lease.inputRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()
    || !sameIdentity(rootInfo, lease.inputRootSnapshot!)
    || await realpath(lease.inputRoot) !== lease.inputRoot) {
    throw new ReferenceImageError('ComfyUI input root changed before cleanup');
  }

  const segments = upload.uploaded.workflowPath.split('/');
  const candidate = path.join(lease.inputRoot, ...segments);
  assertContained(lease.inputRoot, candidate);
  const snapshots: Array<{ absolutePath: string; stats: Stats }> = [];
  let current = lease.inputRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new ReferenceImageError('Owned upload path contains a symbolic link');
    const last = index === segments.length - 1;
    if (last ? !info.isFile() : !info.isDirectory()) {
      throw new ReferenceImageError('Owned upload path has an unexpected file type');
    }
    snapshots.push({ absolutePath: current, stats: info });
  }

  const uploadedSnapshot = snapshots.at(-1)?.stats;
  if (!uploadedSnapshot || uploadedSnapshot.size !== upload.reference.bytes.byteLength) {
    throw new ReferenceImageError('Owned upload size does not match its source');
  }
  const canonical = await realpath(candidate);
  assertContained(lease.inputRoot, canonical);
  const handle = await open(candidate, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(opened, uploadedSnapshot)) {
      throw new ReferenceImageError('Owned upload changed while it was opened');
    }
    const bytes = await readFileHandleBounded(handle, MAX_REFERENCE_IMAGE_BYTES);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const afterRead = await handle.stat();
    if (digest !== upload.reference.sha256 || !sameSnapshot(opened, afterRead)) {
      throw new ReferenceImageError('Owned upload content or identity changed');
    }
  } finally {
    await handle.close();
  }

  for (const snapshot of snapshots) {
    const currentInfo = await lstat(snapshot.absolutePath);
    if (!sameSnapshot(currentInfo, snapshot.stats)) {
      throw new ReferenceImageError('Owned upload path changed before cleanup');
    }
  }
  const finalRoot = await lstat(lease.inputRoot);
  if (!sameIdentity(finalRoot, lease.inputRootSnapshot!)) {
    throw new ReferenceImageError('ComfyUI input root changed before deletion');
  }
  await unlink(candidate);
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === code);
}

class ReferenceImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceImageError';
  }
}
