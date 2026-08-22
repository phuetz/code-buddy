#!/usr/bin/env npx tsx

/** Generate resumable, character-free Krea 2 plates for the signature location catalog. */

import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildPlatePrompt,
  SIGNATURE_LOCATIONS,
  type SignatureLocationAngle,
  type SignatureLocationId,
} from '../../src/companion/signature-locations.js';
import {
  probeComfy,
  submitAndAwait,
  type ComfyProbeResult,
} from '../../src/tools/video/comfy-client.js';
import type { ComfyWorkflowGraph } from '../../src/tools/video/comfy-workflow-template.js';

const DEFAULT_COMFY_URL = 'http://100.73.222.64:8189';
const DEFAULT_OUTPUT = '.codebuddy/locations';
const DEFAULT_BASE_SEED = 610_000;
const DEFAULT_VARIANTS = 3;
const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const WORKFLOW_REVISION = 'krea2-location-plates-v1';
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface LocationPlateOptions {
  comfyUrl: string;
  outputRoot: string;
  locations: readonly SignatureLocationId[];
  baseSeed: number;
  variants: number;
  force: boolean;
}

export interface GenerateLocationPlateInput {
  baseUrl: string;
  workflow: ComfyWorkflowGraph;
  plateId: string;
}

export interface LocationPlateComfyClient {
  probe(baseUrl: string): Promise<ComfyProbeResult>;
  generatePlate(input: GenerateLocationPlateInput): Promise<Uint8Array>;
}

export interface LocationPlateDependencies {
  client?: LocationPlateComfyClient;
  now?: () => Date;
}

export interface LocationPlateSidecar {
  schemaVersion: 1;
  locationId: SignatureLocationId;
  angle: SignatureLocationAngle;
  prompt: string;
  seed: number;
  sha256: string;
  lightingSpec: string;
  focal: '35mm' | '50mm' | '85mm';
  generatedAt: string;
}

interface LocationState {
  schemaVersion: 1;
  generator: 'krea2-location-plates-v1';
  locationId: SignatureLocationId;
  requestSha256: string;
  completedPlateIds: string[];
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPng(bytes: Uint8Array, label: string): void {
  const hasSignature = bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!hasSignature || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`${label} must be a valid PNG no larger than ${MAX_IMAGE_BYTES} bytes`);
  }
}

function valueAfter(argv: readonly string[], name: string): string | undefined {
  const exact = argv.indexOf(`--${name}`);
  if (exact >= 0) {
    const value = argv[exact + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    return value;
  }
  const prefix = `--${name}=`;
  return argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
}

function validateComfyUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--comfy must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('--comfy must be a root URL');
  return url.origin;
}

function parsePositiveInteger(raw: string, name: '--seed' | '--variants', maximum: number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < (name === '--seed' ? 0 : 1) || value > maximum) {
    throw new Error(`${name} must be an integer between ${name === '--seed' ? 0 : 1} and ${maximum}`);
  }
  return value;
}

function selectLocations(raw: string): readonly SignatureLocationId[] {
  const catalogIds = Object.keys(SIGNATURE_LOCATIONS) as SignatureLocationId[];
  if (raw.trim().toLowerCase() === 'all') return catalogIds;
  const requested = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) throw new Error('--locations must be "all" or a comma-separated location list');
  if (new Set(requested).size !== requested.length) throw new Error('--locations contains duplicate location ids');
  const known = new Set<string>(catalogIds);
  for (const id of requested) {
    if (!known.has(id)) throw new Error(`Unknown signature location: ${id}`);
  }
  const requestedSet = new Set(requested);
  return catalogIds.filter((id) => requestedSet.has(id));
}

export function parseLocationPlateArgs(argv: readonly string[]): LocationPlateOptions {
  const knownFlags = new Set(['comfy', 'out', 'locations', 'seed', 'variants', 'force']);
  for (const entry of argv) {
    if (!entry.startsWith('--')) continue;
    const name = entry.slice(2).split('=', 1)[0];
    if (!name || !knownFlags.has(name)) throw new Error(`Unknown option: ${entry}`);
  }
  const forceEntries = argv.filter((entry) => entry === '--force');
  if (forceEntries.length > 1) throw new Error('--force may only be specified once');
  return {
    comfyUrl: validateComfyUrl(valueAfter(argv, 'comfy') ?? DEFAULT_COMFY_URL),
    outputRoot: path.resolve(valueAfter(argv, 'out') ?? DEFAULT_OUTPUT),
    locations: selectLocations(valueAfter(argv, 'locations') ?? 'all'),
    baseSeed: parsePositiveInteger(
      valueAfter(argv, 'seed') ?? String(DEFAULT_BASE_SEED),
      '--seed',
      Number.MAX_SAFE_INTEGER - 0xffff_ffff - 10,
    ),
    variants: parsePositiveInteger(valueAfter(argv, 'variants') ?? String(DEFAULT_VARIANTS), '--variants', 10),
    force: forceEntries.length === 1,
  };
}

/** Stable unsigned hash used by the base + hash(locationId + angle) + k formula. */
export function locationAngleSeedHash(
  locationId: SignatureLocationId,
  angle: SignatureLocationAngle,
): number {
  return createHash('sha256').update(`${locationId}${angle}`).digest().readUInt32BE(0);
}

export function plateSeed(
  baseSeed: number,
  locationId: SignatureLocationId,
  angle: SignatureLocationAngle,
  variantIndex: number,
): number {
  if (!Number.isSafeInteger(baseSeed) || baseSeed < 0 || !Number.isInteger(variantIndex) || variantIndex < 0) {
    throw new Error('Plate seed inputs must be non-negative integers');
  }
  const seed = baseSeed + locationAngleSeedHash(locationId, angle) + variantIndex;
  if (!Number.isSafeInteger(seed)) throw new Error(`Seed overflow for ${locationId}/${angle}`);
  return seed;
}

/** Exact native Krea 2 Turbo t2i topology, deliberately without identity LoRA nodes. */
export function buildLocationPlateWorkflow(input: {
  prompt: string;
  seed: number;
  prefix: string;
}): ComfyWorkflowGraph {
  const graph: ComfyWorkflowGraph = {
    '4': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' },
    },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: WIDTH, height: HEIGHT, batch_size: 1 } },
    '6': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' },
    },
    '7': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '8': { class_type: 'CLIPTextEncode', inputs: { text: input.prompt, clip: ['6', 0] } },
    '10': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['8', 0] } },
    '11': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['7', 0] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: input.prefix, images: ['11', 0] } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: input.seed,
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['4', 0],
        positive: ['8', 0],
        negative: ['10', 0],
        latent_image: ['5', 0],
      },
    },
  };
  assertNoLoraNodes(graph);
  return graph;
}

export function assertNoLoraNodes(workflow: ComfyWorkflowGraph): void {
  const loraNode = Object.values(workflow).find((node) => /lora/iu.test(node.class_type));
  if (loraNode) throw new Error(`Location plate workflows must not contain LoRA nodes: ${loraNode.class_type}`);
}

async function lstatIfPresent(filename: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function locationRequestSha(options: LocationPlateOptions, locationId: SignatureLocationId): string {
  const location = SIGNATURE_LOCATIONS[locationId];
  return sha256(JSON.stringify({
    generator: WORKFLOW_REVISION,
    location,
    prompts: location.angles.map((angle) => buildPlatePrompt(locationId, angle)),
    width: WIDTH,
    height: HEIGHT,
    baseSeed: options.baseSeed,
    variants: options.variants,
  }));
}

async function readLocationState(filename: string): Promise<LocationState | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(filename, 'utf8')) as unknown;
    if (!isRecord(value)
      || value.schemaVersion !== 1
      || value.generator !== WORKFLOW_REVISION
      || typeof value.locationId !== 'string'
      || typeof value.requestSha256 !== 'string'
      || !Array.isArray(value.completedPlateIds)
      || !value.completedPlateIds.every((id) => typeof id === 'string')
      || typeof value.updatedAt !== 'string') {
      throw new Error(`Malformed location state: ${filename}`);
    }
    return value as unknown as LocationState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Perform every fail-closed check before creating directories or submitting work. */
export async function preflightLocationPlateGeneration(
  options: LocationPlateOptions,
  client: LocationPlateComfyClient,
): Promise<void> {
  const outputInfo = await lstatIfPresent(options.outputRoot);
  if (outputInfo && (outputInfo.isSymbolicLink() || !outputInfo.isDirectory())) {
    throw new Error(`Output root must be a non-symlink directory: ${options.outputRoot}`);
  }
  for (const locationId of options.locations) {
    const locationDirectory = path.join(options.outputRoot, locationId);
    const locationInfo = await lstatIfPresent(locationDirectory);
    if (locationInfo?.isSymbolicLink() || (locationInfo && !locationInfo.isDirectory())) {
      throw new Error(`Location output must be a non-symlink directory: ${locationDirectory}`);
    }
    if (options.force || !locationInfo) continue;
    const statePath = path.join(locationDirectory, 'state.json');
    const state = await readLocationState(statePath);
    const targetNames = SIGNATURE_LOCATIONS[locationId].angles.flatMap((angle) =>
      Array.from({ length: options.variants }, (_unused, index) => [
        `${angle}-${index + 1}.png`,
        `${angle}-${index + 1}.json`,
      ]).flat(),
    );
    const targetExists = (await Promise.all(targetNames.map((name) => lstatIfPresent(path.join(locationDirectory, name)))))
      .some(Boolean);
    if (targetExists && !state) {
      throw new Error(`Refusing to overwrite existing plates without --force: ${locationDirectory}`);
    }
    if (state && (state.locationId !== locationId || state.requestSha256 !== locationRequestSha(options, locationId))) {
      throw new Error(`Location state belongs to a different request: ${statePath}; use --force`);
    }
  }
  const probe = await client.probe(options.comfyUrl);
  if (!probe.ok) throw new Error(`ComfyUI preflight failed at ${options.comfyUrl}`);
}

async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function writeNewAtomic(filename: string, value: Uint8Array | string): Promise<void> {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, value, { flag: 'wx' });
    await fs.link(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function plateIsComplete(input: {
  directory: string;
  plateId: string;
  locationId: SignatureLocationId;
  angle: SignatureLocationAngle;
  prompt: string;
  seed: number;
}): Promise<boolean> {
  const imagePath = path.join(input.directory, `${input.plateId}.png`);
  const sidecarPath = path.join(input.directory, `${input.plateId}.json`);
  const present = await Promise.all([imagePath, sidecarPath].map((filename) => lstatIfPresent(filename)));
  if (present.every((value) => !value)) return false;
  if (!present.every((value) => value?.isFile() && !value.isSymbolicLink())) {
    throw new Error(`Incomplete or unsafe plate ${input.plateId}; use --force after review`);
  }
  const image = await fs.readFile(imagePath);
  assertPng(image, `Existing plate ${input.plateId}`);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as unknown;
  const location = SIGNATURE_LOCATIONS[input.locationId];
  if (!isRecord(sidecar)
    || sidecar.locationId !== input.locationId
    || sidecar.angle !== input.angle
    || sidecar.prompt !== input.prompt
    || sidecar.seed !== input.seed
    || sidecar.sha256 !== sha256(image)
    || sidecar.lightingSpec !== location.lightingSpec
    || sidecar.focal !== location.focal[input.angle]) {
    throw new Error(`Plate sidecar/hash/request mismatch: ${sidecarPath}; use --force after review`);
  }
  return true;
}

async function defaultGeneratePlate(input: GenerateLocationPlateInput): Promise<Uint8Array> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'location-plate-comfy-'));
  try {
    const result = await submitAndAwait(input.baseUrl, input.workflow, {
      clientId: randomUUID(),
      timeoutMs: 10 * 60_000,
      pollMs: 1_500,
      workDir,
    });
    const image = result.outputs.find((output) => output.kind === 'image');
    if (!image) throw new Error(`ComfyUI prompt ${result.promptId} returned no image`);
    return await fs.readFile(image.path);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

const DEFAULT_CLIENT: LocationPlateComfyClient = {
  probe: probeComfy,
  generatePlate: defaultGeneratePlate,
};

export async function generateLocationPlates(
  options: LocationPlateOptions,
  dependencies: LocationPlateDependencies = {},
): Promise<void> {
  const client = dependencies.client ?? DEFAULT_CLIENT;
  const now = dependencies.now ?? (() => new Date());
  await preflightLocationPlateGeneration(options, client);
  await fs.mkdir(options.outputRoot, { recursive: true });

  for (const locationId of options.locations) {
    const location = SIGNATURE_LOCATIONS[locationId];
    const directory = path.join(options.outputRoot, locationId);
    if (options.force) await fs.rm(directory, { recursive: true, force: true });
    await fs.mkdir(directory, { recursive: true });
    const statePath = path.join(directory, 'state.json');
    const requestSha256 = locationRequestSha(options, locationId);
    let state = await readLocationState(statePath);
    state ??= {
      schemaVersion: 1,
      generator: WORKFLOW_REVISION,
      locationId,
      requestSha256,
      completedPlateIds: [],
      updatedAt: now().toISOString(),
    };
    const completed = new Set(state.completedPlateIds);

    for (const angle of location.angles) {
      const prompt = buildPlatePrompt(locationId, angle);
      for (let variantIndex = 0; variantIndex < options.variants; variantIndex += 1) {
        const plateId = `${angle}-${variantIndex + 1}`;
        const seed = plateSeed(options.baseSeed, locationId, angle, variantIndex);
        if (await plateIsComplete({ directory, plateId, locationId, angle, prompt, seed })) {
          completed.add(plateId);
          continue;
        }
        if (completed.has(plateId)) {
          throw new Error(`Location state marks missing plate complete: ${locationId}/${plateId}; use --force`);
        }
        const workflow = buildLocationPlateWorkflow({
          prompt,
          seed,
          prefix: `codebuddy-location-plates/${locationId}/${plateId}`,
        });
        const image = await client.generatePlate({
          baseUrl: options.comfyUrl,
          workflow,
          plateId: `${locationId}/${plateId}`,
        });
        assertPng(image, `Generated plate ${locationId}/${plateId}`);
        const sidecar: LocationPlateSidecar = {
          schemaVersion: 1,
          locationId,
          angle,
          prompt,
          seed,
          sha256: sha256(image),
          lightingSpec: location.lightingSpec,
          focal: location.focal[angle],
          generatedAt: now().toISOString(),
        };
        await writeNewAtomic(path.join(directory, `${plateId}.png`), image);
        await writeNewAtomic(path.join(directory, `${plateId}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
        completed.add(plateId);
        state.completedPlateIds = [...completed].sort();
        state.updatedAt = now().toISOString();
        await writeJsonAtomic(statePath, state);
      }
    }
    state.completedPlateIds = [...completed].sort();
    state.updatedAt = now().toISOString();
    await writeJsonAtomic(statePath, state);
  }
}

async function main(): Promise<void> {
  const options = parseLocationPlateArgs(process.argv.slice(2));
  console.log(`[location-plates] locations=${options.locations.length} variants=${options.variants}`);
  await generateLocationPlates(options);
  console.log(`[location-plates] complete out=${options.outputRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
