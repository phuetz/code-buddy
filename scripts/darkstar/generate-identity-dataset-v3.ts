#!/usr/bin/env npx tsx

/** Generate the reference-locked Krea 2 candidate pool for identity dataset v3. */

import { constants as fsConstants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createDatasetV3Plan,
  type DatasetV3Slot,
} from '../../src/lora/dataset-v3-plan.js';
import {
  probeComfy,
  submitAndAwait,
  type ComfyProbeResult,
} from '../../src/tools/video/comfy-client.js';
import type { ComfyWorkflowGraph } from '../../src/tools/video/comfy-workflow-template.js';

const DEFAULT_COMFY_URL = 'http://100.73.222.64:8189';
const DEFAULT_OUTPUT = '.codebuddy/lora/lisa-hq-v3/identity-candidates';
const DEFAULT_RESOLUTION = '1024x1536';
const DEFAULT_BASE_SEED = 420_000;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const WORKFLOW_REVISION = 'krea2-identity-edit-v3';
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface IdentityDatasetV3Options {
  referencePath: string;
  comfyUrl: string;
  outputRoot: string;
  width: number;
  height: number;
  slots: readonly DatasetV3Slot[];
  baseSeed: number;
  force: boolean;
}

export interface UploadedOriginalReference {
  readonly workflowPath: string;
  readonly sourcePath: string;
  readonly sha256: string;
}

export interface UploadOriginalReferenceInput {
  baseUrl: string;
  referencePath: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface GenerateCandidateInput {
  baseUrl: string;
  workflow: ComfyWorkflowGraph;
  candidateId: string;
}

export interface IdentityDatasetV3ComfyClient {
  probe(baseUrl: string): Promise<ComfyProbeResult>;
  uploadOriginalReference(input: UploadOriginalReferenceInput): Promise<string>;
  generateCandidate(input: GenerateCandidateInput): Promise<Uint8Array>;
}

export interface IdentityDatasetV3Dependencies {
  client?: IdentityDatasetV3ComfyClient;
  now?: () => Date;
}

export interface CandidateSidecar {
  schemaVersion: 3;
  candidateId: string;
  slot: DatasetV3Slot;
  seed: number;
  sha256: string;
  provenance: {
    generator: 'krea2-identity-edit-v3';
    workflowRevision: string;
    referenceKind: 'original';
    referencePath: string;
    referenceSha256: string;
    generatedAt: string;
  };
}

interface SlotState {
  schemaVersion: 1;
  generator: 'krea2-identity-edit-v3';
  slotId: string;
  requestSha256: string;
  referencePath: string;
  referenceSha256: string;
  completedCandidateIds: string[];
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function assertPng(bytes: Uint8Array, label: string): void {
  if (bytes.length > MAX_IMAGE_BYTES || !hasPngSignature(bytes)) {
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
  const inline = argv.find((entry) => entry.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function parseResolution(raw: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/u.exec(raw.trim().toLowerCase());
  if (!match) throw new Error('--resolution must use WIDTHxHEIGHT');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1024 || height < 1536) {
    throw new Error('--resolution must be at least 1024x1536');
  }
  if (width > 4096 || height > 4096 || width % 8 !== 0 || height % 8 !== 0) {
    throw new Error('--resolution dimensions must be multiples of 8 and no larger than 4096');
  }
  return { width, height };
}

function parseBaseSeed(raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 0xffff_ffff - 4) {
    throw new Error('--seed must be a non-negative safe integer with room for the slot hash');
  }
  return value;
}

function validateComfyUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--comfy must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('--comfy must be a root URL');
  return url.origin;
}

function selectSlots(raw: string, trigger?: string): readonly DatasetV3Slot[] {
  const plan = createDatasetV3Plan(trigger);
  if (raw.trim().toLowerCase() === 'all') return plan;
  const requested = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) throw new Error('--slots must be "all" or a comma-separated slot list');
  if (new Set(requested).size !== requested.length) throw new Error('--slots contains duplicate slot ids');
  const known = new Map(plan.map((slot) => [slot.slotId, slot]));
  for (const id of requested) {
    if (!known.has(id)) throw new Error(`Unknown dataset v3 slot: ${id}`);
  }
  const requestedSet = new Set(requested);
  return plan.filter((slot) => requestedSet.has(slot.slotId));
}

export function parseIdentityDatasetV3Args(argv: readonly string[]): IdentityDatasetV3Options {
  const knownFlags = new Set(['reference', 'comfy', 'out', 'resolution', 'slots', 'seed', 'force', 'trigger']);
  for (const entry of argv) {
    if (!entry.startsWith('--')) continue;
    const name = entry.slice(2).split('=', 1)[0];
    if (!name || !knownFlags.has(name)) throw new Error(`Unknown option: ${entry}`);
  }
  const reference = valueAfter(argv, 'reference');
  if (!reference) throw new Error('--reference is required and must name the original image');
  const forceEntries = argv.filter((entry) => entry === '--force');
  if (forceEntries.length > 1) throw new Error('--force may only be specified once');
  const resolution = parseResolution(valueAfter(argv, 'resolution') ?? DEFAULT_RESOLUTION);
  return {
    referencePath: path.resolve(reference),
    comfyUrl: validateComfyUrl(valueAfter(argv, 'comfy') ?? DEFAULT_COMFY_URL),
    outputRoot: path.resolve(valueAfter(argv, 'out') ?? DEFAULT_OUTPUT),
    ...resolution,
    slots: selectSlots(valueAfter(argv, 'slots') ?? 'all', valueAfter(argv, 'trigger') ?? undefined),
    baseSeed: parseBaseSeed(valueAfter(argv, 'seed') ?? String(DEFAULT_BASE_SEED)),
    force: forceEntries.length === 1,
  };
}

/** Stable unsigned hash used in the required base + hash(slotId) + k seed formula. */
export function slotSeedHash(slotId: string): number {
  const digest = createHash('sha256').update(slotId).digest();
  return digest.readUInt32BE(0);
}

export function candidateSeed(baseSeed: number, slotId: string, candidateIndex: number): number {
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 3) {
    throw new Error('candidateIndex must be between 0 and 3');
  }
  const seed = baseSeed + slotSeedHash(slotId) + candidateIndex;
  if (!Number.isSafeInteger(seed)) throw new Error(`Seed overflow for slot ${slotId}`);
  return seed;
}

export function buildIdentityDatasetV3Workflow(input: {
  reference: UploadedOriginalReference;
  slot: DatasetV3Slot;
  seed: number;
  width: number;
  height: number;
  prefix: string;
}): ComfyWorkflowGraph {
  const source: [string, number] = ['5', 0];
  const vae: [string, number] = ['3', 0];
  const clip: [string, number] = ['2', 0];
  const workflow: ComfyWorkflowGraph = {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'krea2_turbo_fp8_scaled.safetensors', weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: 'qwen3vl_4b_fp8_scaled.safetensors', type: 'krea2', device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '4': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: 'krea2_identity_edit_v1_2_r64.safetensors',
        strength_model: 1,
      },
    },
    '5': { class_type: 'LoadImage', inputs: { image: input.reference.workflowPath } },
    '6': { class_type: 'VAEEncode', inputs: { pixels: source, vae } },
    '7': {
      class_type: 'Krea2EditModelPatch',
      inputs: {
        model: ['4', 0],
        source_latent: ['6', 0],
        ref_boost: 4,
        ref_boost_a: 1,
        fit_mode: 'fit',
        vae,
        source_image: source,
      },
    },
    '8': {
      class_type: 'Krea2EditGroundedEncode',
      inputs: {
        clip,
        prompt: input.slot.prompt,
        image: source,
        grounding_px: 1024,
        system_prompt: 'Preserve the identity in the original reference while applying only the requested pose, expression, wardrobe, light, setting, and framing.',
      },
    },
    '9': {
      class_type: 'Krea2EditGroundedEncode',
      inputs: {
        clip,
        prompt: 'sunglasses, blur, filter, occlusion, duplicate person, deformed hands, cropped feet',
        image: source,
        grounding_px: 1024,
        system_prompt: '',
      },
    },
    '10': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: input.width, height: input.height, batch_size: 1 },
    },
    '11': {
      class_type: 'KSampler',
      inputs: {
        seed: input.seed,
        steps: 10,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['7', 0],
        positive: ['8', 0],
        negative: ['9', 0],
        latent_image: ['10', 0],
      },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae } },
    '13': { class_type: 'SaveImage', inputs: { filename_prefix: input.prefix, images: ['12', 0] } },
  };
  assertOriginalReferenceOnly(workflow, input.reference.workflowPath);
  return workflow;
}

/** Fail if a graph could read any image other than the single uploaded original. */
export function assertOriginalReferenceOnly(workflow: ComfyWorkflowGraph, expectedReference: string): void {
  const loadImages = Object.values(workflow).filter((node) => node.class_type === 'LoadImage');
  if (loadImages.length !== 1 || loadImages[0]?.inputs.image !== expectedReference) {
    throw new Error('Anti-chaining invariant failed: workflow must load exactly the verified original reference');
  }
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'LoadImageOutput' || node.class_type === 'LoadGeneratedImage') {
      throw new Error('Anti-chaining invariant failed: generated-image reference nodes are forbidden');
    }
  }
}

async function readOriginalReference(referencePath: string): Promise<{ bytes: Uint8Array; sha256: string }> {
  const lexical = await fs.lstat(referencePath);
  if (lexical.isSymbolicLink() || !lexical.isFile() || lexical.size < PNG_SIGNATURE.length || lexical.size > MAX_IMAGE_BYTES) {
    throw new Error('Reference must be a readable regular non-symlink PNG within the size limit');
  }
  const handle = await fs.open(referencePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== lexical.dev || opened.ino !== lexical.ino) {
      throw new Error('Reference changed during preflight');
    }
    const bytes = await handle.readFile();
    assertPng(bytes, 'Reference');
    return { bytes, sha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
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

function slotRequestSha(options: IdentityDatasetV3Options, slot: DatasetV3Slot, referenceSha256: string): string {
  return sha256(JSON.stringify({
    generator: WORKFLOW_REVISION,
    slot,
    referenceSha256,
    width: options.width,
    height: options.height,
    baseSeed: options.baseSeed,
  }));
}

async function readSlotState(filename: string): Promise<SlotState | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(filename, 'utf8')) as unknown;
    if (!isRecord(value)
      || value.schemaVersion !== 1
      || value.generator !== 'krea2-identity-edit-v3'
      || typeof value.slotId !== 'string'
      || typeof value.requestSha256 !== 'string'
      || typeof value.referencePath !== 'string'
      || typeof value.referenceSha256 !== 'string'
      || !Array.isArray(value.completedCandidateIds)
      || !value.completedCandidateIds.every((id) => typeof id === 'string')
      || typeof value.updatedAt !== 'string') {
      throw new Error(`Malformed slot state: ${filename}`);
    }
    return value as unknown as SlotState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function candidateIsComplete(input: {
  slotDirectory: string;
  candidateId: string;
  slot: DatasetV3Slot;
  seed: number;
  referenceSha256: string;
}): Promise<boolean> {
  const imagePath = path.join(input.slotDirectory, `${input.candidateId}.png`);
  const captionPath = path.join(input.slotDirectory, `${input.candidateId}.txt`);
  const sidecarPath = path.join(input.slotDirectory, `${input.candidateId}.json`);
  const present = await Promise.all([imagePath, captionPath, sidecarPath].map(async (filename) => {
    try {
      await fs.access(filename);
      return true;
    } catch {
      return false;
    }
  }));
  if (present.every((value) => !value)) return false;
  if (!present.every(Boolean)) throw new Error(`Incomplete candidate ${input.candidateId}; use --force after review`);
  const image = await fs.readFile(imagePath);
  assertPng(image, `Existing candidate ${input.candidateId}`);
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as unknown;
  const caption = await fs.readFile(captionPath, 'utf8');
  if (!isRecord(sidecar)
    || sidecar.candidateId !== input.candidateId
    || sidecar.seed !== input.seed
    || sidecar.sha256 !== sha256(image)
    || !isRecord(sidecar.slot)
    || sidecar.slot.slotId !== input.slot.slotId
    || !isRecord(sidecar.provenance)
    || sidecar.provenance.generator !== 'krea2-identity-edit-v3'
    || sidecar.provenance.referenceKind !== 'original'
    || sidecar.provenance.referenceSha256 !== input.referenceSha256
    || caption !== `${input.slot.prompt}\n`) {
    throw new Error(`Candidate sidecar/hash/reference mismatch: ${sidecarPath}`);
  }
  return true;
}

async function defaultUploadOriginalReference(input: UploadOriginalReferenceInput): Promise<string> {
  const form = new FormData();
  const uploadBuffer = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(uploadBuffer).set(input.bytes);
  form.append('image', new Blob([uploadBuffer], { type: 'image/png' }), path.basename(input.referencePath));
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetch(`${input.baseUrl}/upload/image`, { method: 'POST', body: form });
  const body = await response.json() as unknown;
  if (!response.ok || !isRecord(body) || typeof body.name !== 'string') {
    throw new Error(`ComfyUI reference upload failed (${response.status})`);
  }
  const name = path.basename(body.name);
  if (name !== body.name || !name) throw new Error('ComfyUI returned an unsafe uploaded reference name');
  const subfolder = typeof body.subfolder === 'string' ? body.subfolder : '';
  if (subfolder.split(/[\\/]/u).some((part) => part === '..')) {
    throw new Error('ComfyUI returned an unsafe uploaded reference subfolder');
  }
  return subfolder ? `${subfolder.replace(/\\/gu, '/')}/${name}` : name;
}

async function defaultGenerateCandidate(input: GenerateCandidateInput): Promise<Uint8Array> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-v3-comfy-'));
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

const DEFAULT_CLIENT: IdentityDatasetV3ComfyClient = {
  probe: probeComfy,
  uploadOriginalReference: defaultUploadOriginalReference,
  generateCandidate: defaultGenerateCandidate,
};

export async function generateIdentityDatasetV3(
  options: IdentityDatasetV3Options,
  dependencies: IdentityDatasetV3Dependencies = {},
): Promise<void> {
  const client = dependencies.client ?? DEFAULT_CLIENT;
  const now = dependencies.now ?? (() => new Date());
  const reference = await readOriginalReference(options.referencePath);
  const probe = await client.probe(options.comfyUrl);
  if (!probe.ok) throw new Error(`ComfyUI preflight failed at ${options.comfyUrl}`);

  const workflowPath = await client.uploadOriginalReference({
    baseUrl: options.comfyUrl,
    referencePath: options.referencePath,
    bytes: reference.bytes,
    sha256: reference.sha256,
  });
  if (!workflowPath.trim()) throw new Error('ComfyUI upload returned an empty original-reference path');
  const originalReference: UploadedOriginalReference = Object.freeze({
    workflowPath,
    sourcePath: options.referencePath,
    sha256: reference.sha256,
  });
  await fs.mkdir(options.outputRoot, { recursive: true });

  for (const slot of options.slots) {
    const slotDirectory = path.join(options.outputRoot, slot.slotId);
    const statePath = path.join(slotDirectory, 'state.json');
    if (options.force) await fs.rm(slotDirectory, { recursive: true, force: true });
    await fs.mkdir(slotDirectory, { recursive: true });
    const requestSha256 = slotRequestSha(options, slot, reference.sha256);
    let state = await readSlotState(statePath);
    if (state && (state.slotId !== slot.slotId
      || state.requestSha256 !== requestSha256
      || state.referencePath !== options.referencePath
      || state.referenceSha256 !== reference.sha256)) {
      throw new Error(`Slot state belongs to a different immutable request: ${statePath}; use --force`);
    }
    state ??= {
      schemaVersion: 1,
      generator: 'krea2-identity-edit-v3',
      slotId: slot.slotId,
      requestSha256,
      referencePath: options.referencePath,
      referenceSha256: reference.sha256,
      completedCandidateIds: [],
      updatedAt: now().toISOString(),
    };
    const completed = new Set(state.completedCandidateIds);

    for (let index = 0; index < slot.overgenCount; index += 1) {
      const candidateId = `${slot.slotId}-${String(index + 1).padStart(2, '0')}`;
      const seed = candidateSeed(options.baseSeed, slot.slotId, index);
      const complete = await candidateIsComplete({
        slotDirectory,
        candidateId,
        slot,
        seed,
        referenceSha256: reference.sha256,
      });
      if (complete) {
        completed.add(candidateId);
        continue;
      }
      if (completed.has(candidateId)) {
        throw new Error(`Slot state marks missing candidate complete: ${candidateId}; use --force after review`);
      }
      const workflow = buildIdentityDatasetV3Workflow({
        reference: originalReference,
        slot,
        seed,
        width: options.width,
        height: options.height,
        prefix: `codebuddy-identity-v3/${candidateId}`,
      });
      assertOriginalReferenceOnly(workflow, originalReference.workflowPath);
      const image = await client.generateCandidate({ baseUrl: options.comfyUrl, workflow, candidateId });
      assertPng(image, `Generated candidate ${candidateId}`);
      const sidecar: CandidateSidecar = {
        schemaVersion: 3,
        candidateId,
        slot,
        seed,
        sha256: sha256(image),
        provenance: {
          generator: 'krea2-identity-edit-v3',
          workflowRevision: WORKFLOW_REVISION,
          referenceKind: 'original',
          referencePath: options.referencePath,
          referenceSha256: reference.sha256,
          generatedAt: now().toISOString(),
        },
      };
      await writeNewAtomic(path.join(slotDirectory, `${candidateId}.png`), image);
      await writeNewAtomic(path.join(slotDirectory, `${candidateId}.txt`), `${slot.prompt}\n`);
      await writeNewAtomic(
        path.join(slotDirectory, `${candidateId}.json`),
        `${JSON.stringify(sidecar, null, 2)}\n`,
      );
      completed.add(candidateId);
      state.completedCandidateIds = [...completed].sort();
      state.updatedAt = now().toISOString();
      await writeJsonAtomic(statePath, state);
    }
    state.completedCandidateIds = [...completed].sort();
    state.updatedAt = now().toISOString();
    await writeJsonAtomic(statePath, state);
  }
}

async function main(): Promise<void> {
  const options = parseIdentityDatasetV3Args(process.argv.slice(2));
  console.log(`[identity-dataset-v3] slots=${options.slots.length} reference=${options.referencePath}`);
  await generateIdentityDatasetV3(options);
  console.log(`[identity-dataset-v3] complete out=${options.outputRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
