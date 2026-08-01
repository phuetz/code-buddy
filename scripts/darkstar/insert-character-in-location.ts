#!/usr/bin/env npx tsx

/** Insert an identity keyframe into a canonical signature-location plate. */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  SIGNATURE_LOCATIONS,
  type SignatureLocationId,
} from '../../src/companion/signature-locations.js';
import {
  buildCharacterInLocationWorkflow,
  buildContinuousAlphaMatteWorkflow,
  buildFaceProtectedCharacterInLocationWorkflow,
  INSERT_QWEN_RELIGHT_TEMPLATE_CONTRACT,
  INSERT_QWEN_TEMPLATE_CONTRACT,
  type InsertionLocation,
} from '../../src/tools/video/character-in-location.js';
import {
  probeComfy,
  submitAndAwait,
  type ComfyProbeResult,
} from '../../src/tools/video/comfy-client.js';
import type {
  ComfyWorkflowGraph,
  TemplateContract,
} from '../../src/tools/video/comfy-workflow-template.js';
import {
  parseVisualGateReport,
  VISUAL_GATE_THRESHOLDS,
} from '../../src/tools/video/visual-gate-report.js';

const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';
const DEFAULT_OUTPUT_DIR = 'tmp/darkstar-character-in-location';
const DEFAULT_SEED = 610_000;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const execFileAsync = promisify(execFile);

export interface InsertCharacterOptions {
  characterPath: string;
  locationId?: SignatureLocationId;
  platePath?: string;
  draftPath?: string;
  comfyUrl: string;
  outputDir: string;
  seed: number;
  relight: boolean;
  faceTargetBbox?: readonly [number, number, number, number];
  frontalMedium: boolean;
  gate: boolean;
  force: boolean;
  locationsRoot: string;
  workflowsDir: string;
}

export interface UploadInsertionImageInput {
  baseUrl: string;
  sourcePath: string;
  bytes: Uint8Array;
  role: 'character' | 'location' | 'protected-base' | 'edit-mask' | 'matte-source';
}

export interface SubmitInsertionInput {
  baseUrl: string;
  workflow: ComfyWorkflowGraph;
  workDir: string;
}

export interface CharacterInsertionClient {
  probe(baseUrl: string): Promise<ComfyProbeResult>;
  uploadImage(input: UploadInsertionImageInput): Promise<string>;
  submit(input: SubmitInsertionInput): Promise<Uint8Array>;
}

export interface IdentityGateInput {
  characterPath: string;
  compositePath: string;
  reportPath: string;
}

export interface FaceProtectionInput {
  characterPath: string;
  compositePath: string;
  outputPath: string;
  reportPath: string;
  editMaskPath: string;
  targetFaceBbox?: readonly [number, number, number, number];
}

export interface CharacterInsertionDependencies {
  client?: CharacterInsertionClient;
  runFaceProtection?: (input: FaceProtectionInput) => Promise<void>;
  runIdentityGate?: (input: IdentityGateInput) => Promise<void>;
}

export interface ContinuousAlphaMatteOptions {
  compositePath: string;
  platePath: string;
  outputPath: string;
  outputPrefix: string;
  comfyUrl: string;
  force: boolean;
}

export interface CharacterInsertionResult {
  outputPath: string;
  platePath: string;
  promptIdPrefix: string;
  faceProtectionReportPath: string;
  gateReportPath?: string;
}

export interface ResolvedInsertionPlate {
  platePath: string;
  location: InsertionLocation;
  outputSlug: string;
}

interface InsertionPreflight {
  characterBytes: Uint8Array;
  plateBytes: Uint8Array;
  draftBytes?: Uint8Array;
  templateJson: unknown;
  contract: TemplateContract;
  plate: ResolvedInsertionPlate;
  outputPath: string;
  faceProtectionReportPath: string;
  gateReportPath: string;
}

function valueAfter(argv: readonly string[], name: string): string | undefined {
  const exactIndex = argv.indexOf(`--${name}`);
  if (exactIndex >= 0) {
    const value = argv[exactIndex + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    return value;
  }
  const prefix = `--${name}=`;
  return argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
}

function parseSeed(raw: string): number {
  const seed = Number(raw);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('--seed must be a non-negative safe integer');
  return seed;
}

function parseFaceTargetBbox(raw: string): readonly [number, number, number, number] {
  const values = raw.split(',').map(Number);
  if (
    values.length !== 4
    || values.some((value) => !Number.isFinite(value) || value < 0)
    || values[2]! <= values[0]!
    || values[3]! <= values[1]!
  ) {
    throw new Error('--target-face-bbox must be left,top,right,bottom with ordered non-negative numbers');
  }
  return values as [number, number, number, number];
}

function validateComfyUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('--comfy must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('--comfy must be a root URL');
  return url.origin;
}

function parseLocationId(raw: string): SignatureLocationId {
  if (!(raw in SIGNATURE_LOCATIONS)) throw new Error(`Unknown signature location: ${raw}`);
  return raw as SignatureLocationId;
}

export function parseInsertCharacterArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): InsertCharacterOptions {
  const valueOptions = new Set([
    'character', 'location', 'plate', 'draft', 'comfy', 'out', 'seed', 'target-face-bbox',
  ]);
  const flags = new Set(['relight', 'frontal-medium', 'gate', 'force']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument: ${argument}`);
    const [name, inlineValue] = argument.slice(2).split('=', 2);
    if (!name || (!valueOptions.has(name) && !flags.has(name))) throw new Error(`Unknown option: ${argument}`);
    if (flags.has(name)) {
      if (inlineValue !== undefined) throw new Error(`--${name} does not accept a value`);
      continue;
    }
    if (inlineValue === undefined) {
      if (!argv[index + 1] || argv[index + 1]!.startsWith('--')) throw new Error(`--${name} requires a value`);
      index += 1;
    } else if (!inlineValue) {
      throw new Error(`--${name} requires a value`);
    }
  }
  const character = valueAfter(argv, 'character');
  if (!character) throw new Error('--character is required');
  const location = valueAfter(argv, 'location');
  const plate = valueAfter(argv, 'plate');
  if (Boolean(location) === Boolean(plate)) throw new Error('Specify exactly one of --location or --plate');
  return {
    characterPath: path.resolve(character),
    ...(location ? { locationId: parseLocationId(location) } : {}),
    ...(plate ? { platePath: path.resolve(plate) } : {}),
    ...(valueAfter(argv, 'draft') ? { draftPath: path.resolve(valueAfter(argv, 'draft')!) } : {}),
    comfyUrl: validateComfyUrl(valueAfter(argv, 'comfy') ?? env.COMFYUI_URL ?? DEFAULT_COMFY_URL),
    outputDir: path.resolve(valueAfter(argv, 'out') ?? DEFAULT_OUTPUT_DIR),
    seed: parseSeed(valueAfter(argv, 'seed') ?? String(DEFAULT_SEED)),
    relight: argv.includes('--relight'),
    frontalMedium: argv.includes('--frontal-medium'),
    ...(valueAfter(argv, 'target-face-bbox')
      ? { faceTargetBbox: parseFaceTargetBbox(valueAfter(argv, 'target-face-bbox')!) }
      : {}),
    gate: argv.includes('--gate'),
    force: argv.includes('--force'),
    locationsRoot: path.resolve('.codebuddy/locations'),
    workflowsDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'workflows'),
  };
}

/** Pure path resolution; existence and file safety are checked by preflight. */
export function resolveInsertionPlate(options: Pick<
  InsertCharacterOptions,
  'locationId' | 'platePath' | 'locationsRoot'
>): ResolvedInsertionPlate {
  if (options.locationId && options.platePath) throw new Error('Specify a locationId or a platePath, not both');
  if (options.locationId) {
    if (!SIGNATURE_LOCATIONS[options.locationId]) {
      throw new Error(`Unknown signature location: ${options.locationId}`);
    }
    return {
      platePath: path.join(options.locationsRoot, options.locationId, 'medium-frontal-1.png'),
      location: options.locationId,
      outputSlug: options.locationId,
    };
  }
  if (!options.platePath) throw new Error('A locationId or platePath is required');
  const basename = path.basename(options.platePath, path.extname(options.platePath));
  const outputSlug = basename.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'custom-plate';
  return { platePath: path.resolve(options.platePath), location: 'custom-plate', outputSlug };
}

export function insertionTemplatePath(
  workflowsDir: string,
  relight: boolean,
): string {
  return path.join(workflowsDir, relight ? 'insert-qwen-edit-relight.json' : 'insert-qwen-edit.json');
}

export function insertionOutputPath(outputDir: string): string {
  return path.join(outputDir, 'composite.png');
}

async function lstatIfPresent(filename: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertPng(bytes: Uint8Array, label: string): void {
  const validSignature = bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!validSignature || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`${label} must be a readable PNG no larger than ${MAX_IMAGE_BYTES} bytes`);
  }
}

async function readRegularFile(
  filename: string,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  let lexical: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    lexical = await fs.lstat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${filename}`);
    }
    throw error;
  }
  if (lexical.isSymbolicLink() || !lexical.isFile() || lexical.size <= 0 || lexical.size > maximumBytes) {
    throw new Error(`${label} must be a readable regular non-symlink file no larger than ${maximumBytes} bytes: ${filename}`);
  }
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== lexical.dev || opened.ino !== lexical.ino) {
      throw new Error(`${label} changed during preflight: ${filename}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readPng(filename: string, label: string): Promise<Uint8Array> {
  const bytes = await readRegularFile(filename, label, MAX_IMAGE_BYTES);
  assertPng(bytes, label);
  return bytes;
}

function parseTemplate(bytes: Uint8Array, filename: string): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Invalid ComfyUI API template ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Complete fail-closed preflight. It performs no writes and no uploads. */
export async function preflightCharacterInsertion(
  options: InsertCharacterOptions,
  client: CharacterInsertionClient,
): Promise<InsertionPreflight> {
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) {
    throw new Error('Insertion seed must be a non-negative safe integer');
  }
  const plate = resolveInsertionPlate(options);
  const templatePath = insertionTemplatePath(options.workflowsDir, options.relight);
  const contract = options.relight
    ? INSERT_QWEN_RELIGHT_TEMPLATE_CONTRACT
    : INSERT_QWEN_TEMPLATE_CONTRACT;
  const [characterBytes, plateBytes, templateBytes, draftBytes] = await Promise.all([
    readPng(options.characterPath, 'Character image'),
    readPng(plate.platePath, 'Location plate'),
    readRegularFile(templatePath, 'ComfyUI API template', MAX_TEMPLATE_BYTES),
    options.draftPath ? readPng(options.draftPath, 'Insertion draft') : Promise.resolve(undefined),
  ]);
  const templateJson = parseTemplate(templateBytes, templatePath);
  // Build once with inert upload names to validate multiplicities, titles,
  // patchable inputs, and every seed before any remote side effect.
  buildCharacterInLocationWorkflow(templateJson, {
    characterImage: 'preflight-character.png',
    locationImage: 'preflight-location.png',
    location: plate.location,
    seed: options.seed,
    outputPrefix: 'preflight/character-in-location',
  }, contract);

  const outputInfo = await lstatIfPresent(options.outputDir);
  if (outputInfo && (outputInfo.isSymbolicLink() || !outputInfo.isDirectory())) {
    throw new Error(`Output directory must be a non-symlink directory: ${options.outputDir}`);
  }
  const outputPath = insertionOutputPath(options.outputDir);
  const faceProtectionReportPath = path.join(options.outputDir, 'face-protection-report.json');
  const gateReportPath = path.join(options.outputDir, 'identity-gate-report.json');
  const targets = [
    outputPath,
    faceProtectionReportPath,
    ...(options.gate ? [gateReportPath] : []),
  ];
  for (const target of targets) {
    const targetInfo = await lstatIfPresent(target);
    if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isFile())) {
      throw new Error(`Output target must be a regular non-symlink file: ${target}`);
    }
    if (targetInfo && !options.force) throw new Error(`Output already exists: ${target}; use --force to replace it`);
  }
  const probe = await client.probe(options.comfyUrl);
  if (!probe.ok) throw new Error(`ComfyUI preflight failed at ${options.comfyUrl}`);
  return {
    characterBytes,
    plateBytes,
    ...(draftBytes ? { draftBytes } : {}),
    templateJson,
    contract,
    plate,
    outputPath,
    faceProtectionReportPath,
    gateReportPath,
  };
}

function uploadReference(body: unknown, status: number, role: UploadInsertionImageInput['role']): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`ComfyUI ${role} upload failed (${status})`);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.name !== 'string') throw new Error(`ComfyUI ${role} upload returned no filename`);
  const name = path.basename(record.name);
  if (!name || name !== record.name) throw new Error(`ComfyUI ${role} upload returned an unsafe filename`);
  const subfolder = typeof record.subfolder === 'string' ? record.subfolder : '';
  if (subfolder.split(/[\\/]/u).some((part) => part === '..')) {
    throw new Error(`ComfyUI ${role} upload returned an unsafe subfolder`);
  }
  return subfolder ? `${subfolder.replace(/\\/gu, '/')}/${name}` : name;
}

async function defaultUploadImage(input: UploadInsertionImageInput): Promise<string> {
  const bytes = new Uint8Array(input.bytes.byteLength);
  bytes.set(input.bytes);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), path.basename(input.sourcePath));
  form.append('type', 'input');
  form.append('overwrite', 'false');
  const response = await fetch(`${input.baseUrl.replace(/\/+$/u, '')}/upload/image`, { method: 'POST', body: form });
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(`ComfyUI ${input.role} upload returned invalid JSON (${response.status})`);
  }
  if (!response.ok) throw new Error(`ComfyUI ${input.role} upload failed (${response.status})`);
  return uploadReference(body, response.status, input.role);
}

async function defaultSubmit(input: SubmitInsertionInput): Promise<Uint8Array> {
  const result = await submitAndAwait(input.baseUrl, input.workflow, {
    clientId: randomUUID(),
    timeoutMs: 15 * 60_000,
    pollMs: 1_500,
    workDir: input.workDir,
  });
  const image = result.outputs.find((output) => output.kind === 'image');
  if (!image) throw new Error(`ComfyUI prompt ${result.promptId} returned no composite image`);
  return await fs.readFile(image.path);
}

const DEFAULT_CLIENT: CharacterInsertionClient = {
  probe: probeComfy,
  uploadImage: defaultUploadImage,
  submit: defaultSubmit,
};

async function defaultRunFaceProtection(input: FaceProtectionInput): Promise<void> {
  const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'restore-canonical-face.py');
  const helperArgs = [
    scriptPath,
    '--source', input.characterPath,
    '--composite', input.compositePath,
    '--output', input.outputPath,
    '--report', input.reportPath,
    '--edit-mask', input.editMaskPath,
    ...(input.targetFaceBbox ? ['--target-bbox', input.targetFaceBbox.join(',')] : []),
  ];
  await execFileAsync(process.env.VISUAL_GATE_PYTHON ?? process.env.PYTHON ?? 'python3', helperArgs, {
    maxBuffer: 4 * 1024 * 1024,
  });
  const [output, report] = await Promise.all([
    readPng(input.outputPath, 'Face-protected composite'),
    readRegularFile(input.reportPath, 'Face protection report', MAX_TEMPLATE_BYTES),
  ]);
  assertPng(output, 'Face-protected composite');
  await readPng(input.editMaskPath, 'Face edit mask');
  try {
    JSON.parse(Buffer.from(report).toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`Invalid face protection report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeOutput(filename: string, bytes: Uint8Array, force: boolean): Promise<void> {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    if (force) await fs.rename(temporary, filename);
    else await fs.link(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

/** Apply only the final continuous-alpha pass, for deterministic replays. */
export async function matteCompositeAgainstPlate(
  options: ContinuousAlphaMatteOptions,
  dependencies: Pick<CharacterInsertionDependencies, 'client'> = {},
): Promise<string> {
  const compositePath = path.resolve(options.compositePath);
  const platePath = path.resolve(options.platePath);
  const outputPath = path.resolve(options.outputPath);
  if (outputPath === compositePath || outputPath === platePath) {
    throw new Error('Continuous-alpha output must not overwrite an input image');
  }
  const [compositeBytes, plateBytes] = await Promise.all([
    readPng(compositePath, 'Composite to matte'),
    readPng(platePath, 'Untouched location plate'),
  ]);
  const outputInfo = await lstatIfPresent(outputPath);
  if (outputInfo?.isSymbolicLink() || (outputInfo && !outputInfo.isFile())) {
    throw new Error(`Output target must be a regular non-symlink file: ${outputPath}`);
  }
  if (outputInfo && !options.force) {
    throw new Error(`Output already exists: ${outputPath}; use force to replace it`);
  }
  const client = dependencies.client ?? DEFAULT_CLIENT;
  const comfyUrl = validateComfyUrl(options.comfyUrl);
  const probe = await client.probe(comfyUrl);
  if (!probe.ok) throw new Error(`ComfyUI preflight failed at ${comfyUrl}`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'character-location-matte-'));
  try {
    const [compositeImage, locationImage] = await Promise.all([
      client.uploadImage({
        baseUrl: comfyUrl,
        sourcePath: compositePath,
        bytes: compositeBytes,
        role: 'matte-source',
      }),
      client.uploadImage({
        baseUrl: comfyUrl,
        sourcePath: platePath,
        bytes: plateBytes,
        role: 'location',
      }),
    ]);
    const workflow = buildContinuousAlphaMatteWorkflow({
      compositeImage,
      locationImage,
      outputPrefix: options.outputPrefix,
    });
    const output = await client.submit({ baseUrl: comfyUrl, workflow, workDir });
    assertPng(output, 'Continuous-alpha composite');
    await writeOutput(outputPath, output, options.force);
    return outputPath;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function defaultRunIdentityGate(input: IdentityGateInput): Promise<void> {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'character-location-gate-'));
  try {
    const framesDirectory = path.join(temporaryRoot, 'frames');
    const referencesDirectory = path.join(temporaryRoot, 'references');
    const temporaryReport = path.join(temporaryRoot, 'report.json');
    await Promise.all([fs.mkdir(framesDirectory), fs.mkdir(referencesDirectory)]);
    await Promise.all([
      fs.copyFile(input.compositePath, path.join(framesDirectory, '000001.png')),
      fs.copyFile(input.characterPath, path.join(referencesDirectory, 'reference.png')),
    ]);
    const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'measure-visual-gates.py');
    await execFileAsync(process.env.PYTHON ?? 'python3', [
      scriptPath,
      '--frames-dir', framesDirectory,
      '--reference-dir', referencesDirectory,
      '--output', temporaryReport,
      '--sample-fps', '1',
      '--profile', 'native-fashion-v1',
    ], { maxBuffer: 4 * 1024 * 1024 });
    const reportBytes = await readRegularFile(temporaryReport, 'ArcFace visual gate report', MAX_TEMPLATE_BYTES);
    const report = parseVisualGateReport(JSON.parse(Buffer.from(reportBytes).toString('utf8')) as unknown);
    const identity = report.metrics.identity;
    const thresholds = VISUAL_GATE_THRESHOLDS['native-fashion-v1'].identity;
    const passes = identity.detectedFaceCount > 0
      && identity.minSimilarity >= thresholds.minSimilarity
      && identity.meanSimilarity >= thresholds.meanSimilarity
      && identity.noFace.length <= thresholds.maxNoFaceFrames;
    if (!passes) {
      throw new Error(
        `ArcFace identity gate failed: min=${identity.minSimilarity.toFixed(4)}, ` +
        `mean=${identity.meanSimilarity.toFixed(4)}, noFace=${identity.noFace.length}`,
      );
    }
    await writeOutput(input.reportPath, reportBytes, true);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function insertCharacterInLocation(
  options: InsertCharacterOptions,
  dependencies: CharacterInsertionDependencies = {},
): Promise<CharacterInsertionResult> {
  const client = dependencies.client ?? DEFAULT_CLIENT;
  const preflight = await preflightCharacterInsertion(options, client);
  await fs.mkdir(options.outputDir, { recursive: true });
  const [characterImage, locationImage] = await Promise.all([
    client.uploadImage({
      baseUrl: options.comfyUrl,
      sourcePath: options.characterPath,
      bytes: preflight.characterBytes,
      role: 'character',
    }),
    client.uploadImage({
      baseUrl: options.comfyUrl,
      sourcePath: preflight.plate.platePath,
      bytes: preflight.plateBytes,
      role: 'location',
    }),
  ]);
  if (!characterImage.trim() || !locationImage.trim()) throw new Error('ComfyUI upload returned an empty image reference');
  const promptIdPrefix = `character-in-location/${preflight.plate.outputSlug}-${options.seed}`;
  const workflow = buildCharacterInLocationWorkflow(preflight.templateJson, {
    characterImage,
    locationImage,
    location: preflight.plate.location,
    seed: options.seed,
    outputPrefix: promptIdPrefix,
    promptOptions: { frontalMedium: options.frontalMedium },
  }, preflight.contract);
  const comfyWorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'character-location-comfy-'));
  try {
    const composite = preflight.draftBytes
      ?? await client.submit({ baseUrl: options.comfyUrl, workflow, workDir: comfyWorkDir });
    assertPng(composite, 'Composite output');
    const rawCompositePath = path.join(comfyWorkDir, 'model-composite.png');
    const protectedCompositePath = path.join(comfyWorkDir, 'protected-composite.png');
    const protectionReportPath = path.join(comfyWorkDir, 'face-protection-report.json');
    const editMaskPath = path.join(comfyWorkDir, 'face-edit-mask.png');
    await fs.writeFile(rawCompositePath, composite, { flag: 'wx' });
    await (dependencies.runFaceProtection ?? defaultRunFaceProtection)({
      characterPath: options.characterPath,
      compositePath: rawCompositePath,
      outputPath: protectedCompositePath,
      reportPath: protectionReportPath,
      editMaskPath,
      ...(options.faceTargetBbox ? { targetFaceBbox: options.faceTargetBbox } : {}),
    });
    const [protectedComposite, protectionReport, editMask] = await Promise.all([
      readPng(protectedCompositePath, 'Face-protected composite'),
      readRegularFile(protectionReportPath, 'Face protection report', MAX_TEMPLATE_BYTES),
      readPng(editMaskPath, 'Face edit mask'),
    ]);
    const [protectedBaseImage, editMaskImage] = await Promise.all([
      client.uploadImage({
        baseUrl: options.comfyUrl,
        sourcePath: protectedCompositePath,
        bytes: protectedComposite,
        role: 'protected-base',
      }),
      client.uploadImage({
        baseUrl: options.comfyUrl,
        sourcePath: editMaskPath,
        bytes: editMask,
        role: 'edit-mask',
      }),
    ]);
    const protectedWorkflow = buildFaceProtectedCharacterInLocationWorkflow(preflight.templateJson, {
      characterImage,
      locationImage: protectedBaseImage,
      editMaskImage,
      location: preflight.plate.location,
      seed: options.seed,
      outputPrefix: `${promptIdPrefix}-face-protected`,
      promptOptions: { frontalMedium: options.frontalMedium },
    }, preflight.contract);
    const finalComposite = await client.submit({
      baseUrl: options.comfyUrl,
      workflow: protectedWorkflow,
      workDir: comfyWorkDir,
    });
    assertPng(finalComposite, 'Masked face-protected composite');
    const matteSourceImage = await client.uploadImage({
      baseUrl: options.comfyUrl,
      sourcePath: protectedCompositePath,
      bytes: finalComposite,
      role: 'matte-source',
    });
    const matteWorkflow = buildContinuousAlphaMatteWorkflow({
      compositeImage: matteSourceImage,
      locationImage,
      outputPrefix: `${promptIdPrefix}-continuous-alpha`,
    });
    const continuousAlphaComposite = await client.submit({
      baseUrl: options.comfyUrl,
      workflow: matteWorkflow,
      workDir: comfyWorkDir,
    });
    assertPng(continuousAlphaComposite, 'Continuous-alpha composite');
    await Promise.all([
      writeOutput(preflight.outputPath, continuousAlphaComposite, options.force),
      writeOutput(preflight.faceProtectionReportPath, protectionReport, options.force),
    ]);
  } finally {
    await fs.rm(comfyWorkDir, { recursive: true, force: true });
  }

  if (options.gate) {
    await (dependencies.runIdentityGate ?? defaultRunIdentityGate)({
      characterPath: options.characterPath,
      compositePath: preflight.outputPath,
      reportPath: preflight.gateReportPath,
    });
  }
  return {
    outputPath: preflight.outputPath,
    platePath: preflight.plate.platePath,
    promptIdPrefix,
    faceProtectionReportPath: preflight.faceProtectionReportPath,
    ...(options.gate ? { gateReportPath: preflight.gateReportPath } : {}),
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const result = await insertCharacterInLocation(parseInsertCharacterArgs(argv));
  console.log(`[character-in-location] composite=${result.outputPath}`);
  console.log(`[character-in-location] face-protection=${result.faceProtectionReportPath}`);
  if (result.gateReportPath) console.log(`[character-in-location] identity-gate=${result.gateReportPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
