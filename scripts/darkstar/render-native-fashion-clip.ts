#!/usr/bin/env npx tsx

/** Resumable native fashion renderer driven only by operator-exported ComfyUI API templates. */

import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PILOT_FASHION_SCENES,
} from '../../src/companion/fashion-scene-catalog.js';
import {
  probeComfy,
  submitAndAwait,
  type ComfyProbeResult,
  type SubmitAndAwaitOptions,
  type SubmitAndAwaitResult,
} from '../../src/tools/video/comfy-client.js';
import {
  assertAllSeedsPinned,
  INTERPOLATE_RIFE_TEMPLATE_CONTRACT,
  I2V_WAN_FLF2V_TEMPLATE_CONTRACT,
  I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT,
  KEYFRAME_FLUX_TEMPLATE_CONTRACT,
  loadWorkflowTemplate,
  patchWorkflow,
  UPSCALE_SEEDVR2_TEMPLATE_CONTRACT,
  type ComfyWorkflowGraph,
  type LoadedWorkflowTemplate,
  type TemplateContract,
  type WorkflowPatch,
} from '../../src/tools/video/comfy-workflow-template.js';
import {
  appendRetryReceipt,
  assertBatchBounded,
  type RetryReceipt,
} from '../../src/tools/video/native-fashion-defects.js';

const STAGE = {
  preflight: 1,
  keyframe: 2,
  segments: 3,
  assembly: 4,
  upscale: 5,
  interpolation: 6,
  receipt: 7,
} as const;
const TARGET_DURATION_SECONDS = 12;
const SEGMENT_FRAMES = 81;
const SEGMENT_OUTPUT_FRAMES = 64;
const SOURCE_FPS = 16;
const DEFAULT_NEGATIVE = 'identity drift, deformed anatomy, extra fingers, foot sliding, fabric warping, flicker, blur, watermark, logo';

export interface NativeFashionRenderOptions {
  scene?: string;
  prompt?: string;
  outfit?: string;
  setting?: string;
  keyframe?: string;
  comfyUrl: string;
  segments: number;
  seed: number;
  workDir: string;
  outPath: string;
  batchId: string;
  journalPath: string;
  skipUpscale: boolean;
  skipInterpolate: boolean;
  force: boolean;
  maxMinutes: number;
  workflowsDir: string;
  seedVr2Batch: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface NativeFashionClipProbe {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}

export interface NativeFashionRenderDependencies {
  probeComfy?: (baseUrl: string) => Promise<ComfyProbeResult>;
  submitAndAwait?: (
    baseUrl: string,
    graph: ComfyWorkflowGraph,
    options: SubmitAndAwaitOptions,
  ) => Promise<SubmitAndAwaitResult>;
  runProcess?: (command: string, args: readonly string[]) => Promise<ProcessResult>;
  probeFinal?: (filename: string) => Promise<NativeFashionClipProbe>;
  appendRetryReceipt?: typeof appendRetryReceipt;
  now?: () => Date;
  createClientId?: () => string;
}

interface ArtifactRecord {
  path: string;
  sha256: string;
  stage: number;
  durationSeconds?: number;
}

export interface NativeFashionRenderState {
  schemaVersion: 1;
  requestSha256: string;
  completedStage: number;
  artifacts: Record<string, ArtifactRecord>;
  templateSha256: Record<string, string>;
  warnings: string[];
  updatedAt: string;
}

export interface NativeFashionRenderManifest {
  schemaVersion: 1;
  batchId: string;
  sceneId: string;
  baseSeed: number;
  segmentSeeds: number[];
  templateSha256: Record<string, string>;
  artifacts: Record<string, ArtifactRecord>;
  durations: Record<string, number>;
  warnings: string[];
  generatedAt: string;
}

export interface NativeFashionRenderResult {
  status: 'completed' | 'paused';
  statePath: string;
  outputPath?: string;
  manifestPath?: string;
  warnings: string[];
}

interface ResolvedRenderPrompt {
  sceneId: string;
  prompt: string;
  targetDurationSeconds: number;
}

interface LoadedTemplates {
  keyframe?: LoadedWorkflowTemplate;
  i2v: LoadedWorkflowTemplate;
  flf2v?: LoadedWorkflowTemplate;
  upscale?: LoadedWorkflowTemplate;
  interpolate?: LoadedWorkflowTemplate;
  digests: Record<string, string>;
}

function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(filename: string): Promise<string> {
  return sha256Bytes(await fs.readFile(filename));
}

async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filename);
}

function requestDigest(options: NativeFashionRenderOptions, resolved: ResolvedRenderPrompt): string {
  return sha256Bytes(JSON.stringify({
    sceneId: resolved.sceneId,
    prompt: resolved.prompt,
    keyframe: options.keyframe ? path.resolve(options.keyframe) : null,
    segments: options.segments,
    seed: options.seed,
    skipUpscale: options.skipUpscale,
    skipInterpolate: options.skipInterpolate,
    seedVr2Batch: options.seedVr2Batch,
  }));
}

export function resolveRenderPrompt(options: Pick<NativeFashionRenderOptions, 'scene' | 'prompt' | 'outfit' | 'setting'>): ResolvedRenderPrompt {
  if (options.scene) {
    const scene = PILOT_FASHION_SCENES.find((candidate) => candidate.sceneId === options.scene);
    if (!scene) throw new Error(`Unknown pilot fashion scene: ${options.scene}`);
    if (options.prompt || options.outfit || options.setting) {
      throw new Error('--scene cannot be combined with --prompt, --outfit, or --setting');
    }
    return { sceneId: scene.sceneId, prompt: scene.prompt, targetDurationSeconds: scene.targetDurationSeconds };
  }
  if (!options.prompt?.trim() || !options.outfit?.trim() || !options.setting?.trim()) {
    throw new Error('Use --scene <pilot-id>, or provide --prompt together with --outfit and --setting');
  }
  return {
    sceneId: 'custom-fashion-scene',
    prompt: [
      options.prompt.trim(),
      `outfit: ${options.outfit.trim()}`,
      `setting: ${options.setting.trim()}`,
      'adult woman, safe elegant covered outfit, original fashion scene',
      'native vertical 9:16 composition, stable identity, coherent anatomy, continuous outfit and stable decor',
    ].join(', '),
    targetDurationSeconds: TARGET_DURATION_SECONDS,
  };
}

export function assertSeedVr2Batch(batchSize: number): void {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || (batchSize - 1) % 4 !== 0) {
    throw new Error(`SeedVR2 batch_size must satisfy 4n+1; received ${batchSize}`);
  }
}

export function assertFinalProbe(probe: NativeFashionClipProbe, expectedDurationSeconds = TARGET_DURATION_SECONDS): void {
  if (probe.width !== 1080 || probe.height !== 1920) {
    throw new Error(`Final clip must be 1080x1920; probed ${probe.width}x${probe.height}`);
  }
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - 30) > 0.05) {
    throw new Error(`Final clip must be 30 fps ±0.05; probed ${probe.fps}`);
  }
  if (!Number.isFinite(probe.durationSeconds) || Math.abs(probe.durationSeconds - expectedDurationSeconds) > 1) {
    throw new Error(`Final clip duration must be within 1s of ${expectedDurationSeconds}s; probed ${probe.durationSeconds}s`);
  }
}

async function defaultRunProcess(command: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

async function defaultProbeFinal(filename: string, run: NativeFashionRenderDependencies['runProcess']): Promise<NativeFashionClipProbe> {
  const result = await (run ?? defaultRunProcess)('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filename,
  ]);
  const parsed = JSON.parse(result.stdout) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const rate = video?.avg_frame_rate ?? video?.r_frame_rate ?? '0/1';
  const [numerator = '0', denominator = '1'] = rate.split('/');
  return {
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Number(numerator) / Number(denominator),
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

async function loadTemplate(
  directory: string,
  filename: string,
  contract: TemplateContract,
  required: boolean,
): Promise<{ template?: LoadedWorkflowTemplate; digest?: string }> {
  const fullPath = path.join(directory, filename);
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(fullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) return {};
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Required ComfyUI API template is missing: ${fullPath}`);
    }
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ComfyUI template ${fullPath}: ${(error as Error).message}`);
  }
  return { template: loadWorkflowTemplate(json, contract), digest: sha256Bytes(bytes) };
}

async function loadTemplates(options: NativeFashionRenderOptions): Promise<LoadedTemplates> {
  const needKeyframe = !options.keyframe || options.segments > 1;
  const [keyframe, i2v, flf2v, upscale, interpolate] = await Promise.all([
    loadTemplate(options.workflowsDir, 'keyframe-flux.json', KEYFRAME_FLUX_TEMPLATE_CONTRACT, needKeyframe),
    loadTemplate(options.workflowsDir, 'i2v-wan-lightx2v.json', I2V_WAN_LIGHTX2V_TEMPLATE_CONTRACT, true),
    loadTemplate(options.workflowsDir, 'i2v-wan-flf2v.json', I2V_WAN_FLF2V_TEMPLATE_CONTRACT, false),
    loadTemplate(options.workflowsDir, 'upscale-seedvr2.json', UPSCALE_SEEDVR2_TEMPLATE_CONTRACT, !options.skipUpscale),
    loadTemplate(options.workflowsDir, 'interpolate-rife.json', INTERPOLATE_RIFE_TEMPLATE_CONTRACT, !options.skipInterpolate),
  ]);
  if (!i2v.template || !i2v.digest) throw new Error('Internal error: required i2v template did not load');
  const digests: Record<string, string> = { 'i2v-wan-lightx2v.json': i2v.digest };
  for (const [name, value] of [
    ['keyframe-flux.json', keyframe],
    ['i2v-wan-flf2v.json', flf2v],
    ['upscale-seedvr2.json', upscale],
    ['interpolate-rife.json', interpolate],
  ] as const) {
    if (value.digest) digests[name] = value.digest;
  }
  return {
    i2v: i2v.template,
    ...(keyframe.template ? { keyframe: keyframe.template } : {}),
    ...(flf2v.template ? { flf2v: flf2v.template } : {}),
    ...(upscale.template ? { upscale: upscale.template } : {}),
    ...(interpolate.template ? { interpolate: interpolate.template } : {}),
    digests,
  };
}

async function readState(statePath: string): Promise<NativeFashionRenderState | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8')) as Partial<NativeFashionRenderState>;
    if (parsed.schemaVersion !== 1 || typeof parsed.requestSha256 !== 'string' ||
        !Number.isSafeInteger(parsed.completedStage) || !parsed.artifacts || !parsed.templateSha256 ||
        !Array.isArray(parsed.warnings) || typeof parsed.updatedAt !== 'string') {
      throw new Error(`Render state is malformed: ${statePath}`);
    }
    return parsed as NativeFashionRenderState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function lastValidStage(state: NativeFashionRenderState): Promise<number> {
  let valid = state.completedStage;
  const artifacts = Object.values(state.artifacts).sort((left, right) => left.stage - right.stage);
  for (const artifact of artifacts) {
    if (artifact.stage > valid) continue;
    try {
      if (await sha256File(artifact.path) !== artifact.sha256) valid = Math.min(valid, artifact.stage - 1);
    } catch {
      valid = Math.min(valid, artifact.stage - 1);
    }
  }
  return valid;
}

async function recordArtifact(
  state: NativeFashionRenderState,
  key: string,
  filename: string,
  stage: number,
  durationSeconds?: number,
): Promise<void> {
  state.artifacts[key] = {
    path: filename,
    sha256: await sha256File(filename),
    stage,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function patched(template: LoadedWorkflowTemplate, patches: readonly WorkflowPatch[]): ComfyWorkflowGraph {
  const graph = patchWorkflow(template, patches);
  assertAllSeedsPinned(graph);
  return graph;
}

function firstOutput(result: SubmitAndAwaitResult, kinds: ReadonlyArray<'image' | 'video' | 'gif'>): string {
  const output = result.outputs.find((candidate) => kinds.includes(candidate.kind));
  if (!output) throw new Error(`ComfyUI prompt ${result.promptId} returned no ${kinds.join('/')} output`);
  return output.path;
}

function continuityPrompt(prompt: string, segment: number, poseReference: string): string {
  return `${prompt}, continuity keyframe ${segment}, preserve the same identity, outfit, lighting and decor, ` +
    `match the controlled ending pose represented by operator reference ${path.basename(poseReference)}, no accumulated VAE frame reuse`;
}

async function copyKeyframe(source: string, destination: string): Promise<void> {
  const info = await fs.stat(source);
  if (!info.isFile()) throw new Error(`Approved keyframe is not a regular file: ${source}`);
  await fs.copyFile(source, destination);
}

async function readReceipts(journalPath: string): Promise<RetryReceipt[]> {
  try {
    const lines = (await fs.readFile(journalPath, 'utf8')).split(/\r?\n/u).filter(Boolean);
    return lines.map((line) => JSON.parse(line) as RetryReceipt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function renderNativeFashionClip(
  options: NativeFashionRenderOptions,
  dependencies: NativeFashionRenderDependencies = {},
): Promise<NativeFashionRenderResult> {
  const resolved = resolveRenderPrompt(options);
  if (!Number.isSafeInteger(options.segments) || options.segments < 1) throw new Error('--segments must be a positive integer');
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) throw new Error('--seed must be a non-negative safe integer');
  if (!Number.isFinite(options.maxMinutes) || options.maxMinutes <= 0) throw new Error('--max-minutes must be positive');
  if (!options.skipUpscale) assertSeedVr2Batch(options.seedVr2Batch);

  await fs.mkdir(options.workDir, { recursive: true });
  await fs.mkdir(path.dirname(options.outPath), { recursive: true });
  await fs.mkdir(path.dirname(options.journalPath), { recursive: true });
  const statePath = path.join(options.workDir, 'state.json');
  const digest = requestDigest(options, resolved);
  const startedAt = (dependencies.now ?? (() => new Date()))().getTime();
  const deadline = startedAt + options.maxMinutes * 60_000;
  let state = await readState(statePath);
  if (state && state.requestSha256 !== digest && !options.force) {
    throw new Error(`Existing render state belongs to a different request: ${statePath}; use --force to restart`);
  }
  if (!state || options.force) {
    state = {
      schemaVersion: 1,
      requestSha256: digest,
      completedStage: 0,
      artifacts: {},
      templateSha256: {},
      warnings: [],
      updatedAt: new Date(startedAt).toISOString(),
    };
    await writeJsonAtomic(statePath, state);
  } else {
    state.completedStage = await lastValidStage(state);
  }

  const pauseIfExpired = async (): Promise<NativeFashionRenderResult | undefined> => {
    const now = (dependencies.now ?? (() => new Date()))();
    if (now.getTime() < deadline) return undefined;
    state!.updatedAt = now.toISOString();
    await writeJsonAtomic(statePath, state);
    return { status: 'paused', statePath, warnings: [...state!.warnings] };
  };
  const completeStage = async (stage: number): Promise<void> => {
    state!.completedStage = stage;
    state!.updatedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    await writeJsonAtomic(statePath, state);
  };

  const templates = await loadTemplates(options);
  if (state.completedStage < STAGE.preflight) {
    const probe = await (dependencies.probeComfy ?? probeComfy)(options.comfyUrl);
    if (!probe.ok) throw new Error(`ComfyUI preflight failed at ${options.comfyUrl}`);
    state.templateSha256 = templates.digests;
    await completeStage(STAGE.preflight);
  } else if (JSON.stringify(state.templateSha256) !== JSON.stringify(templates.digests)) {
    throw new Error('ComfyUI templates changed since the saved preflight; use --force to restart safely');
  }
  const pausedAfterPreflight = await pauseIfExpired();
  if (pausedAfterPreflight) return pausedAfterPreflight;

  const submit = dependencies.submitAndAwait ?? submitAndAwait;
  const clientId = dependencies.createClientId ?? randomUUID;
  const submitGraph = async (graph: ComfyWorkflowGraph, outputDir: string): Promise<SubmitAndAwaitResult> => {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    return submit(options.comfyUrl, graph, {
      clientId: clientId(), timeoutMs: 90 * 60_000, pollMs: 1500, workDir: outputDir,
    });
  };

  const approvedExtension = options.keyframe ? path.extname(options.keyframe) : '';
  const initialKeyframe = path.join(options.workDir, `keyframe-00${approvedExtension || '.png'}`);
  if (state.completedStage < STAGE.keyframe) {
    if (options.keyframe) {
      await copyKeyframe(path.resolve(options.keyframe), initialKeyframe);
    } else {
      if (!templates.keyframe) throw new Error('FLUX keyframe template is required when --keyframe is absent');
      const result = await submitGraph(patched(templates.keyframe, [
        { role: 'seed', value: options.seed },
        { role: 'prompt', value: resolved.prompt },
        { role: 'negative', value: DEFAULT_NEGATIVE },
        { role: 'resolution', value: { width: 1080, height: 1920 } },
        { role: 'outputPrefix', value: `${options.batchId}/keyframe-00` },
      ]), path.join(options.workDir, 'comfy', 'keyframe-00'));
      await fs.copyFile(firstOutput(result, ['image']), initialKeyframe);
    }
    await recordArtifact(state, 'keyframe-00', initialKeyframe, STAGE.keyframe);
    await completeStage(STAGE.keyframe);
  }
  const pausedAfterKeyframe = await pauseIfExpired();
  if (pausedAfterKeyframe) return pausedAfterKeyframe;

  const runProcess = dependencies.runProcess ?? defaultRunProcess;
  const segmentPaths: string[] = [];
  if (state.completedStage < STAGE.segments) {
    let currentKeyframe = initialKeyframe;
    for (let index = 0; index < options.segments; index += 1) {
      const ordinal = index + 1;
      const segmentSeed = options.seed + ordinal;
      const provisional = await submitGraph(patched(templates.i2v, [
        { role: 'seed', value: segmentSeed },
        { role: 'prompt', value: resolved.prompt },
        { role: 'negative', value: DEFAULT_NEGATIVE },
        { role: 'inputImage', value: currentKeyframe },
        { role: 'frames', value: SEGMENT_FRAMES },
        { role: 'resolution', value: { width: 720, height: 1280 } },
        { role: 'outputPrefix', value: `${options.batchId}/segment-${ordinal}-provisional` },
      ]), path.join(options.workDir, 'comfy', `segment-${ordinal}-provisional`));
      let finalSegmentSource = firstOutput(provisional, ['video', 'gif']);

      if (ordinal < options.segments) {
        const poseReference = path.join(options.workDir, `pose-reference-${ordinal}.png`);
        await runProcess('ffmpeg', ['-y', '-sseof', '-0.001', '-i', finalSegmentSource, '-frames:v', '1', poseReference]);
        await recordArtifact(state, `pose-reference-${ordinal}`, poseReference, STAGE.segments);
        if (!templates.keyframe) throw new Error('FLUX keyframe template is required for regenerated junction keyframes');
        const nextKeyframe = path.join(options.workDir, `keyframe-${String(ordinal).padStart(2, '0')}.png`);
        const keyframeResult = await submitGraph(patched(templates.keyframe, [
          { role: 'seed', value: options.seed },
          { role: 'prompt', value: continuityPrompt(resolved.prompt, ordinal, poseReference) },
          { role: 'negative', value: DEFAULT_NEGATIVE },
          { role: 'resolution', value: { width: 1080, height: 1920 } },
          { role: 'outputPrefix', value: `${options.batchId}/keyframe-${ordinal}` },
        ]), path.join(options.workDir, 'comfy', `keyframe-${ordinal}`));
        await fs.copyFile(firstOutput(keyframeResult, ['image']), nextKeyframe);
        await recordArtifact(state, `keyframe-${ordinal}`, nextKeyframe, STAGE.segments);

        if (templates.flf2v) {
          const anchored = await submitGraph(patched(templates.flf2v, [
            { role: 'seed', value: segmentSeed },
            { role: 'prompt', value: resolved.prompt },
            { role: 'negative', value: DEFAULT_NEGATIVE },
            { role: 'inputImage', value: currentKeyframe },
            { role: 'endImage', value: nextKeyframe },
            { role: 'frames', value: SEGMENT_FRAMES },
            { role: 'resolution', value: { width: 720, height: 1280 } },
            { role: 'outputPrefix', value: `${options.batchId}/segment-${ordinal}-flf2v` },
          ]), path.join(options.workDir, 'comfy', `segment-${ordinal}-flf2v`));
          finalSegmentSource = firstOutput(anchored, ['video', 'gif']);
        } else {
          state.warnings.push(
            `Segment ${ordinal}: i2v-wan-flf2v.json absent; kept last-frame-referenced I2V provisional clip, ` +
            'while the next generative keyframe was independently regenerated with FLUX.',
          );
        }
        currentKeyframe = nextKeyframe;
      }

      const segmentPath = path.join(options.workDir, `segment-${String(ordinal).padStart(2, '0')}.mp4`);
      await fs.copyFile(finalSegmentSource, segmentPath);
      await recordArtifact(state, `segment-${ordinal}`, segmentPath, STAGE.segments, SEGMENT_FRAMES / SOURCE_FPS);
      segmentPaths.push(segmentPath);
      const paused = await pauseIfExpired();
      if (paused) return paused;
    }
    await completeStage(STAGE.segments);
  } else {
    for (let ordinal = 1; ordinal <= options.segments; ordinal += 1) {
      const artifact = state.artifacts[`segment-${ordinal}`];
      if (!artifact) throw new Error(`Saved stage 3 is missing segment-${ordinal}`);
      segmentPaths.push(artifact.path);
    }
  }

  const assembledPath = path.join(options.workDir, 'assembled-720x1280-16fps.mp4');
  if (state.completedStage < STAGE.assembly) {
    const inputs = segmentPaths.flatMap((segment) => ['-i', segment]);
    const trims = segmentPaths.map((_, index) =>
      `[${index}:v]trim=end_frame=${SEGMENT_OUTPUT_FRAMES},setpts=PTS-STARTPTS[v${index}]`,
    );
    const joins = segmentPaths.map((_, index) => `[v${index}]`).join('');
    await runProcess('ffmpeg', [
      '-y', ...inputs,
      '-filter_complex', `${trims.join(';')};${joins}concat=n=${segmentPaths.length}:v=1:a=0[v]`,
      '-map', '[v]', '-r', String(SOURCE_FPS), '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', assembledPath,
    ]);
    const i2vHasColorMatch = Object.values(templates.i2v.graph)
      .some((node) => node.class_type === 'ColorMatch' || node.class_type === 'ColorMatchV2');
    if (!i2vHasColorMatch) {
      state.warnings.push('ColorMatch node absent from the I2V template; assembly used no ffmpeg ColorMatch reimplementation.');
    }
    await recordArtifact(state, 'assembled', assembledPath, STAGE.assembly, TARGET_DURATION_SECONDS);
    await completeStage(STAGE.assembly);
  }
  const pausedAfterAssembly = await pauseIfExpired();
  if (pausedAfterAssembly) return pausedAfterAssembly;

  let postUpscalePath = assembledPath;
  if (state.completedStage < STAGE.upscale) {
    if (options.skipUpscale) {
      state.warnings.push('SeedVR2 upscale skipped by debug flag.');
    } else {
      if (!templates.upscale) throw new Error('SeedVR2 template is required unless --skip-upscale is set');
      const result = await submitGraph(patched(templates.upscale, [
        { role: 'seed', value: options.seed },
        { role: 'inputVideo', value: assembledPath },
        { role: 'frames', value: options.seedVr2Batch },
        { role: 'resolution', value: 1080 },
        { role: 'outputPrefix', value: `${options.batchId}/upscaled-seedvr2` },
      ]), path.join(options.workDir, 'comfy', 'upscale'));
      postUpscalePath = path.join(options.workDir, 'upscaled-1080x1920.mp4');
      await fs.copyFile(firstOutput(result, ['video', 'gif']), postUpscalePath);
      await recordArtifact(state, 'upscaled', postUpscalePath, STAGE.upscale, TARGET_DURATION_SECONDS);
    }
    await completeStage(STAGE.upscale);
  } else if (state.artifacts.upscaled) {
    postUpscalePath = state.artifacts.upscaled.path;
  }
  const pausedAfterUpscale = await pauseIfExpired();
  if (pausedAfterUpscale) return pausedAfterUpscale;

  if (state.completedStage < STAGE.interpolation) {
    let preEncodePaths = [postUpscalePath];
    if (options.skipInterpolate) {
      state.warnings.push('RIFE interpolation skipped by debug flag.');
    } else {
      if (!templates.interpolate) throw new Error('RIFE template is required unless --skip-interpolate is set');
      const interpolationInputs: string[] = [];
      if (options.segments === 1) {
        interpolationInputs.push(postUpscalePath);
      } else {
        const secondsPerSegment = TARGET_DURATION_SECONDS / options.segments;
        for (let index = 0; index < options.segments; index += 1) {
          const slicePath = path.join(options.workDir, `rife-input-${String(index + 1).padStart(2, '0')}.mp4`);
          await runProcess('ffmpeg', [
            '-y', '-ss', String(index * secondsPerSegment), '-t', String(secondsPerSegment),
            '-i', postUpscalePath, '-an', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', slicePath,
          ]);
          await recordArtifact(state, `rife-input-${index + 1}`, slicePath, STAGE.interpolation, secondsPerSegment);
          interpolationInputs.push(slicePath);
        }
      }
      preEncodePaths = [];
      for (const [index, interpolationInput] of interpolationInputs.entries()) {
        const result = await submitGraph(patched(templates.interpolate, [
          { role: 'inputVideo', value: interpolationInput },
          { role: 'frames', value: 2 },
          { role: 'outputPrefix', value: `${options.batchId}/interpolated-rife-${index + 1}` },
        ]), path.join(options.workDir, 'comfy', `interpolate-${index + 1}`));
        const stablePath = path.join(options.workDir, `interpolated-${String(index + 1).padStart(2, '0')}.mp4`);
        await fs.copyFile(firstOutput(result, ['video', 'gif']), stablePath);
        await recordArtifact(state, `interpolated-${index + 1}`, stablePath, STAGE.interpolation);
        preEncodePaths.push(stablePath);
      }
    }
    const finalInputs = preEncodePaths.flatMap((input) => ['-i', input]);
    const finalVideoSelection = preEncodePaths.length === 1
      ? ['-map', '0:v:0', '-vf', 'scale=1080:1920:flags=lanczos']
      : [
          '-filter_complex', `${preEncodePaths.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}]`).join(';')};` +
            `${preEncodePaths.map((_, index) => `[v${index}]`).join('')}concat=n=${preEncodePaths.length}:v=1:a=0[joined];` +
            '[joined]scale=1080:1920:flags=lanczos[v]',
          '-map', '[v]',
        ];
    await runProcess('ffmpeg', [
      '-y', ...finalInputs, ...finalVideoSelection, '-an', '-r', '30',
      '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', options.outPath,
    ]);
    const finalProbe = await (dependencies.probeFinal ?? ((filename) => defaultProbeFinal(filename, runProcess)))(options.outPath);
    assertFinalProbe(finalProbe, resolved.targetDurationSeconds);
    await recordArtifact(state, 'final', options.outPath, STAGE.interpolation, finalProbe.durationSeconds);
    await completeStage(STAGE.interpolation);
  }

  const manifestPath = path.join(options.workDir, 'render-manifest.json');
  if (state.completedStage < STAGE.receipt) {
    const finalArtifact = state.artifacts.final;
    if (!finalArtifact) throw new Error('Final artifact missing before receipt stage');
    const receipts = await readReceipts(options.journalPath);
    assertBatchBounded(receipts, Number.MAX_SAFE_INTEGER);
    const related = receipts.filter((receipt) => receipt.batchId === options.batchId && receipt.sceneId === resolved.sceneId);
    const attempt = related.length + 1;
    const adjustedParameters = attempt === 1
      ? []
      : [`operator-requested deterministic rerender with pinned base seed ${options.seed}`];
    await (dependencies.appendRetryReceipt ?? appendRetryReceipt)(options.journalPath, {
      attempt,
      batchId: options.batchId,
      sceneId: resolved.sceneId,
      candidateSha256: finalArtifact.sha256,
      seed: options.seed,
      adjustedParameters,
      failedGates: [],
      verdict: 'promoted-to-human-review',
      at: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    const manifest: NativeFashionRenderManifest = {
      schemaVersion: 1,
      batchId: options.batchId,
      sceneId: resolved.sceneId,
      baseSeed: options.seed,
      segmentSeeds: Array.from({ length: options.segments }, (_, index) => options.seed + index + 1),
      templateSha256: { ...state.templateSha256 },
      artifacts: { ...state.artifacts },
      durations: Object.fromEntries(
        Object.entries(state.artifacts)
          .filter((entry): entry is [string, ArtifactRecord & { durationSeconds: number }] => entry[1].durationSeconds !== undefined)
          .map(([key, artifact]) => [key, artifact.durationSeconds]),
      ),
      warnings: [...state.warnings],
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    };
    await writeJsonAtomic(manifestPath, manifest);
    await recordArtifact(state, 'manifest', manifestPath, STAGE.receipt);
    await completeStage(STAGE.receipt);
  }

  return {
    status: 'completed',
    statePath,
    outputPath: options.outPath,
    manifestPath,
    warnings: [...state.warnings],
  };
}

function cliValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numericCliValue(argv: readonly string[], name: string, fallback: number): number {
  const raw = cliValue(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric`);
  return value;
}

export function parseRenderArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): NativeFashionRenderOptions {
  const knownValue = new Set([
    'scene', 'prompt', 'outfit', 'setting', 'keyframe', 'comfy', 'segments', 'seed', 'workdir', 'out',
    'batch-id', 'journal', 'max-minutes', 'workflows-dir', 'seedvr2-batch',
  ]);
  const knownFlag = new Set(['skip-upscale', 'skip-interpolate', 'force']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument: ${argument}`);
    const name = argument.slice(2);
    if (knownFlag.has(name)) continue;
    if (!knownValue.has(name)) throw new Error(`Unknown argument: ${argument}`);
    if (!argv[index + 1] || argv[index + 1]!.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
  }
  const scene = cliValue(argv, 'scene');
  const seed = numericCliValue(argv, 'seed', 1000);
  const workDir = path.resolve(cliValue(argv, 'workdir') ?? path.join('tmp', 'darkstar-native-fashion', scene ?? `custom-${seed}`));
  const outPath = path.resolve(cliValue(argv, 'out') ?? path.join(workDir, 'native-fashion-final.mp4'));
  return {
    ...(scene ? { scene } : {}),
    ...(cliValue(argv, 'prompt') ? { prompt: cliValue(argv, 'prompt') } : {}),
    ...(cliValue(argv, 'outfit') ? { outfit: cliValue(argv, 'outfit') } : {}),
    ...(cliValue(argv, 'setting') ? { setting: cliValue(argv, 'setting') } : {}),
    ...(cliValue(argv, 'keyframe') ? { keyframe: path.resolve(cliValue(argv, 'keyframe')!) } : {}),
    comfyUrl: cliValue(argv, 'comfy') ?? env.COMFYUI_URL ?? 'http://127.0.0.1:8188',
    segments: numericCliValue(argv, 'segments', 3),
    seed,
    workDir,
    outPath,
    batchId: cliValue(argv, 'batch-id') ?? `native-${scene ?? 'custom'}-${seed}`,
    journalPath: path.resolve(cliValue(argv, 'journal') ?? path.join(workDir, 'retry.jsonl')),
    skipUpscale: argv.includes('--skip-upscale'),
    skipInterpolate: argv.includes('--skip-interpolate'),
    force: argv.includes('--force'),
    maxMinutes: numericCliValue(argv, 'max-minutes', 120),
    workflowsDir: path.resolve(cliValue(argv, 'workflows-dir') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows')),
    seedVr2Batch: numericCliValue(argv, 'seedvr2-batch', 5),
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const result = await renderNativeFashionClip(parseRenderArgs(argv));
  if (result.status === 'paused') {
    console.log(`Native fashion render paused cleanly; resume with the same arguments (${result.statePath})`);
    return;
  }
  console.log(`Native fashion render completed: ${result.outputPath}`);
  console.log(`Manifest: ${result.manifestPath}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
