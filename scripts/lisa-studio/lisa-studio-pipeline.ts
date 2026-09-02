import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  PYTHON_JSON_MARKER,
  SCORE_KEYFRAMES_PYTHON,
  SCORE_VIDEO_PYTHON,
} from './arcface-inline.js';

const MAX_SEED = 2_000_000_000;
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const DEFAULT_IMAGE_URL = 'http://gpuNode:8188';
const DEFAULT_VIDEO_URL = 'http://gpuNode:8190';
const DEFAULT_IMAGE_MODEL = 'krea2_turbo_fp8_scaled.safetensors';
const DEFAULT_IMAGE_TEXT_ENCODER = 'qwen3vl_4b_fp8_scaled.safetensors';
const DEFAULT_IMAGE_VAE = 'qwen_image_vae.safetensors';
const DEFAULT_LORA = 'lisa-krea2.safetensors';
const DEFAULT_H3_UNET = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const DEFAULT_H3_TEXT_ENCODER = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const DEFAULT_H3_VIDEO_VAE = 'minimax_h3_video_vae_fp16.safetensors';
const DEFAULT_SCENE_PROMPT =
  'Lisa, portrait cinématographique photoréaliste, cadrage vertical, lumière douce, regard caméra';
export const DEFAULT_ANIMATION_LOCK = 'plan fixe verrouillé, visage net et centré';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TRIAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==',
  'base64'
);
const TRIAL_MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');

export interface StudioClock {
  nowMs(): number;
  sleep(milliseconds: number): Promise<void>;
}

export type PythonTask = 'score-keyframes' | 'score-video';

export interface PythonExecutionRequest {
  task: PythonTask;
  executable: string;
  code: string;
  arguments: string[];
  timeoutMs: number;
}

export interface PythonExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type PythonExecutor = (request: PythonExecutionRequest) => Promise<PythonExecutionResult>;

export interface LisaStudioRuntime {
  fetch?: typeof fetch;
  pythonExecutor?: PythonExecutor;
  clock?: StudioClock;
  createId?: () => string;
  env?: NodeJS.ProcessEnv;
  onProgress?: (message: string) => void;
}

export interface LisaStudioInput {
  referencePath: string;
  rootDir?: string;
  scenePrompt?: string;
  animationPrompt?: string;
  candidateCount?: number;
  threshold?: number;
  durationSeconds?: number;
  baseSeed?: number;
  trial?: boolean;
  imageBaseUrl?: string;
  videoBaseUrl?: string;
  imageModel?: string;
  imageTextEncoder?: string;
  imageVae?: string;
  loraName?: string;
  loraStrength?: number;
  h3Unet?: string;
  h3TextEncoder?: string;
  h3VideoVae?: string;
  pythonPath?: string;
  pollIntervalMs?: number;
  imageTimeoutMs?: number;
  videoTimeoutMs?: number;
}

export interface KeyframeScore {
  index: number;
  path: string;
  seed: number;
  faceDetected: boolean;
  arcfaceScore: number | null;
  generationDurationMs: number;
}

export interface VideoFrameScore {
  position: 'debut' | 'milieu' | 'fin';
  frameIndex: number;
  timestampSeconds: number;
  arcfaceScore: number;
}

export interface LisaStudioReport {
  schemaVersion: 1;
  mode: 'production' | 'essai';
  createdAt: string;
  paths: {
    reference: string;
    keyframes: string[];
    selectedKeyframe: string;
    video: string;
    report: string;
    sidecar: string;
  };
  prompts: {
    scene: string;
    animation: string;
  };
  configuration: {
    candidateCount: number;
    threshold: number;
    imageProvider: 'comfyui';
    imageEndpoint: string;
    imageModel: string;
    imageLora: string;
    videoProvider: 'comfyui';
    videoEndpoint: string;
    videoModel: 'minimax-h3';
    width: 768;
    height: 1344;
    frames: number;
    fps: 24;
    steps: 8;
    sampler: 'euler';
    scheduler: 'beta';
    cfg: 1;
  };
  seeds: {
    keyframes: number[];
    animation: number;
  };
  keyframes: KeyframeScore[];
  gate: {
    accepted: true;
    threshold: number;
    bestScore: number;
    selectedIndex: number;
  };
  animation: {
    requestedDurationSeconds: number;
    generatedDurationSeconds: number;
    generationDurationMs: number;
  };
  finalArcFace: {
    frameCount: number;
    fps: number;
    frames: VideoFrameScore[];
    minScore: number;
    meanScore: number;
    maxScore: number;
    scoringDurationMs: number;
  };
  durationsMs: {
    keyframeGeneration: number;
    keyframeScoring: number;
    animationGeneration: number;
    finalScoring: number;
    total: number;
  };
}

interface NormalizedOptions {
  referencePath: string;
  rootDir: string;
  scenePrompt: string;
  animationPrompt: string;
  candidateCount: number;
  threshold: number;
  durationSeconds: number;
  baseSeed: number;
  trial: boolean;
  imageBaseUrl: string;
  videoBaseUrl: string;
  imageModel: string;
  imageTextEncoder: string;
  imageVae: string;
  loraName: string;
  loraStrength: number;
  h3Unet: string;
  h3TextEncoder: string;
  h3VideoVae: string;
  pythonPath: string;
  pollIntervalMs: number;
  imageTimeoutMs: number;
  videoTimeoutMs: number;
}

interface ResolvedRuntime {
  fetch: typeof fetch;
  pythonExecutor: PythonExecutor;
  clock: StudioClock;
  createId: () => string;
  env: NodeJS.ProcessEnv;
  onProgress: (message: string) => void;
}

interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ComfyWorkflow = Record<string, ComfyNode>;

interface ComfyFileReference {
  filename: string;
  subfolder: string;
  type: string;
}

interface GeneratedKeyframe {
  index: number;
  path: string;
  seed: number;
  durationMs: number;
}

interface PythonKeyframePayload {
  scores: Array<{
    path: string;
    detected: boolean;
    arcface: number | null;
  }>;
}

interface PythonVideoPayload {
  frameCount: number;
  fps: number;
  durationSeconds: number;
  scores: Array<{
    position: string;
    frameIndex: number;
    timestampSeconds: number;
    arcface: number;
  }>;
}

export class IdentityGateError extends Error {
  readonly bestScore: number;
  readonly threshold: number;

  constructor(bestScore: number, threshold: number, noFace = false) {
    super(
      noFace
        ? `Gate ArcFace refusé : aucun visage détecté dans les keyframes (score disponible ${bestScore.toFixed(6)}, seuil ${threshold.toFixed(6)}). Aucune animation lancée.`
        : `Gate ArcFace refusé : meilleur score ${bestScore.toFixed(6)} < seuil ${threshold.toFixed(6)}. Aucune animation lancée.`
    );
    this.name = 'IdentityGateError';
    this.bestScore = bestScore;
    this.threshold = threshold;
  }
}

const systemClock: StudioClock = {
  nowMs: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export const defaultPythonExecutor: PythonExecutor = (request) =>
  new Promise((resolve) => {
    execFile(
      request.executable,
      ['-c', request.code, ...request.arguments],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: request.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const numericCode =
          error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? (error as NodeJS.ErrnoException & { code: number }).code
            : error
              ? 1
              : 0;
        resolve({
          exitCode: numericCode,
          stdout: String(stdout ?? ''),
          stderr: `${String(stderr ?? '')}${error ? `\n${error.message}` : ''}`.trim(),
        });
      }
    );
  });

export function buildKrea2KeyframeWorkflow(options: {
  prompt: string;
  seed: number;
  model: string;
  textEncoder: string;
  vae: string;
  loraName: string;
  loraStrength: number;
}): ComfyWorkflow {
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: options.model, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: options.textEncoder, type: 'krea2', device: 'default' },
    },
    '3': { class_type: 'VAELoader', inputs: { vae_name: options.vae } },
    '4': {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: ['1', 0],
        lora_name: options.loraName,
        strength_model: options.loraStrength,
      },
    },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: options.prompt, clip: ['2', 0] } },
    '6': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['5', 0] } },
    '7': {
      class_type: 'EmptySD3LatentImage',
      inputs: { width: 1024, height: 1344, batch_size: 1 },
    },
    '8': {
      class_type: 'KSampler',
      inputs: {
        seed: options.seed,
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['4', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['7', 0],
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'codebuddy/lisa-studio/keyframe', images: ['9', 0] },
    },
  };
}

export function buildH3FirstFrameWorkflow(options: {
  prompt: string;
  seed: number;
  frames: number;
  uploadedFirstFrame: string;
  unet: string;
  textEncoder: string;
  videoVae: string;
}): ComfyWorkflow {
  return {
    '1': {
      class_type: 'UNETLoader',
      inputs: { unet_name: options.unet, weight_dtype: 'default' },
    },
    '2': {
      class_type: 'MiniMaxH3SigmaShift',
      inputs: { model: ['1', 0], shift_video: 12, shift_audio: 3 },
    },
    '3': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: options.textEncoder, type: 'minimax', device: 'default' },
    },
    '4': { class_type: 'VAELoader', inputs: { vae_name: options.videoVae } },
    '5': { class_type: 'LoadImage', inputs: { image: options.uploadedFirstFrame } },
    '6': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: {
        clip: ['3', 0],
        vae: ['4', 0],
        prompt: options.prompt,
        width: 768,
        height: 1344,
        length: options.frames,
        first_frame: ['5', 0],
      },
    },
    '7': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['2', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['6', 1],
        seed: options.seed,
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'beta',
        denoise: 1,
      },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['4', 0] } },
    '10': {
      class_type: 'CreateVideo',
      inputs: { images: ['9', 0], fps: 24, bit_depth: 8 },
    },
    '11': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['10', 0],
        filename_prefix: 'codebuddy/lisa-studio/h3',
        format: 'mp4',
        codec: 'h264',
      },
    },
  };
}

export function snapH3Frames(durationSeconds: number): number {
  const wanted = Math.round(durationSeconds * 24);
  return Math.min(362, Math.max(124, 5 + 17 * Math.ceil((wanted - 5) / 17)));
}

export function withDefaultAnimationLock(prompt: string | undefined): string {
  const custom = prompt?.trim();
  if (!custom) return DEFAULT_ANIMATION_LOCK;
  if (custom.toLocaleLowerCase('fr').includes(DEFAULT_ANIMATION_LOCK.toLocaleLowerCase('fr'))) {
    return custom;
  }
  return `${custom}, ${DEFAULT_ANIMATION_LOCK}`;
}

export async function runLisaStudio(
  input: LisaStudioInput,
  runtimeInput: LisaStudioRuntime = {}
): Promise<LisaStudioReport> {
  const runtime = resolveRuntime(runtimeInput);
  const options = normalizeOptions(input, runtime);
  const totalStartedAt = runtime.clock.nowMs();
  await validateReference(options.referencePath);

  const rootReal = await fs.realpath(options.rootDir);
  const imageDirectory = await ensureConfinedDirectory(options.rootDir, rootReal, [
    '.codebuddy',
    'media-generation',
    'images',
  ]);
  const videoDirectory = await ensureConfinedDirectory(options.rootDir, rootReal, [
    '.codebuddy',
    'media-generation',
    'videos',
  ]);

  const runId = sanitizeId(runtime.createId());
  const keyframeSeeds = Array.from(
    { length: options.candidateCount },
    (_, index) => (options.baseSeed + index) % MAX_SEED
  );
  const animationSeed = (options.baseSeed + options.candidateCount) % MAX_SEED;
  const generatedAt = new Date(runtime.clock.nowMs()).toISOString();

  runtime.onProgress(`Génération de ${options.candidateCount} keyframes Krea 2…`);
  const keyframeStageStartedAt = runtime.clock.nowMs();
  const keyframes: GeneratedKeyframe[] = [];
  for (const [index, seed] of keyframeSeeds.entries()) {
    const startedAt = runtime.clock.nowMs();
    const outputPath = path.join(
      imageDirectory,
      `lisa-keyframe-${runId}-${String(index + 1).padStart(2, '0')}-seed-${seed}.png`
    );
    const bytes = options.trial ? TRIAL_PNG : await generateKeyframeBytes(options, runtime, seed);
    assertPng(bytes, `Keyframe ${index + 1}`);
    await writeNewFile(outputPath, bytes);
    keyframes.push({
      index,
      path: outputPath,
      seed,
      durationMs: elapsed(runtime.clock, startedAt),
    });
  }
  const keyframeGenerationMs = elapsed(runtime.clock, keyframeStageStartedAt);

  runtime.onProgress('Calcul du gate ArcFace buffalo_l…');
  const keyframeScoringStartedAt = runtime.clock.nowMs();
  const pythonKeyframeScores = options.trial
    ? trialKeyframeScores(keyframes)
    : await scoreKeyframes(options, runtime, keyframes);
  const keyframeScoringMs = elapsed(runtime.clock, keyframeScoringStartedAt);
  const scoredKeyframes = mergeKeyframeScores(keyframes, pythonKeyframeScores);

  for (const keyframe of scoredKeyframes) {
    await writeNewJson(`${keyframe.path}.meta.json`, {
      kind: 'image',
      prompt: options.scenePrompt,
      provider: 'comfyui',
      model: options.imageModel,
      lora: options.loraName,
      seed: keyframe.seed,
      arcfaceScore: keyframe.arcfaceScore,
      faceDetected: keyframe.faceDetected,
      generatedAt,
      lisaStudioRunId: runId,
    });
  }

  const eligible = scoredKeyframes.filter(
    (candidate): candidate is KeyframeScore & { arcfaceScore: number } =>
      candidate.faceDetected && candidate.arcfaceScore !== null
  );
  const winner = eligible.reduce<(KeyframeScore & { arcfaceScore: number }) | undefined>(
    (best, candidate) => (!best || candidate.arcfaceScore > best.arcfaceScore ? candidate : best),
    undefined
  );
  const bestScore = winner?.arcfaceScore ?? 0;
  if (!winner || bestScore < options.threshold) {
    throw new IdentityGateError(bestScore, options.threshold, !winner);
  }
  runtime.onProgress(
    `Gate accepté : keyframe ${winner.index + 1}, score ${bestScore.toFixed(6)} (seuil ${options.threshold.toFixed(6)}).`
  );

  const frames = snapH3Frames(options.durationSeconds);
  const videoPath = path.join(videoDirectory, `lisa-clip-${runId}-seed-${animationSeed}.mp4`);
  runtime.onProgress('Animation MiniMax H3 depuis la keyframe gagnante…');
  const animationStartedAt = runtime.clock.nowMs();
  const videoBytes = options.trial
    ? TRIAL_MP4
    : await generateH3VideoBytes(options, runtime, winner.path, animationSeed, frames, runId);
  assertMp4(videoBytes, 'Clip MiniMax H3');
  await writeNewFile(videoPath, videoBytes);
  const animationGenerationMs = elapsed(runtime.clock, animationStartedAt);

  runtime.onProgress('Score ArcFace final sur les frames début, milieu et fin…');
  const finalScoringStartedAt = runtime.clock.nowMs();
  const finalPayload = options.trial
    ? trialVideoScores(frames)
    : await scoreVideo(options, runtime, videoPath);
  const finalScoringMs = elapsed(runtime.clock, finalScoringStartedAt);
  const finalFrames = validateVideoScores(finalPayload);
  const finalValues = finalFrames.map((frame) => frame.arcfaceScore);
  const generatedDurationSeconds = options.trial ? frames / 24 : finalPayload.durationSeconds;

  const reportPath = `${videoPath}.report.json`;
  const sidecarPath = `${videoPath}.meta.json`;
  const report: LisaStudioReport = {
    schemaVersion: 1,
    mode: options.trial ? 'essai' : 'production',
    createdAt: generatedAt,
    paths: {
      reference: options.referencePath,
      keyframes: scoredKeyframes.map((candidate) => candidate.path),
      selectedKeyframe: winner.path,
      video: videoPath,
      report: reportPath,
      sidecar: sidecarPath,
    },
    prompts: {
      scene: options.scenePrompt,
      animation: options.animationPrompt,
    },
    configuration: {
      candidateCount: options.candidateCount,
      threshold: options.threshold,
      imageProvider: 'comfyui',
      imageEndpoint: options.imageBaseUrl,
      imageModel: options.imageModel,
      imageLora: options.loraName,
      videoProvider: 'comfyui',
      videoEndpoint: options.videoBaseUrl,
      videoModel: 'minimax-h3',
      width: 768,
      height: 1344,
      frames,
      fps: 24,
      steps: 8,
      sampler: 'euler',
      scheduler: 'beta',
      cfg: 1,
    },
    seeds: {
      keyframes: keyframeSeeds,
      animation: animationSeed,
    },
    keyframes: scoredKeyframes,
    gate: {
      accepted: true,
      threshold: options.threshold,
      bestScore,
      selectedIndex: winner.index,
    },
    animation: {
      requestedDurationSeconds: options.durationSeconds,
      generatedDurationSeconds,
      generationDurationMs: animationGenerationMs,
    },
    finalArcFace: {
      frameCount: finalPayload.frameCount,
      fps: finalPayload.fps,
      frames: finalFrames,
      minScore: Math.min(...finalValues),
      meanScore: finalValues.reduce((sum, score) => sum + score, 0) / finalValues.length,
      maxScore: Math.max(...finalValues),
      scoringDurationMs: finalScoringMs,
    },
    durationsMs: {
      keyframeGeneration: keyframeGenerationMs,
      keyframeScoring: keyframeScoringMs,
      animationGeneration: animationGenerationMs,
      finalScoring: finalScoringMs,
      total: elapsed(runtime.clock, totalStartedAt),
    },
  };

  await writeNewJson(reportPath, report);
  await writeNewJson(sidecarPath, {
    kind: 'video',
    prompt: options.animationPrompt,
    provider: 'comfyui',
    model: 'minimax-h3',
    modality: 'image',
    aspect_ratio: '9:16',
    duration: generatedDurationSeconds,
    generatedAt,
    seed: animationSeed,
    reference: options.referencePath,
    firstFrame: winner.path,
    arcfaceScores: finalFrames.map((frame) => frame.arcfaceScore),
    reportPath,
    lisaStudioRunId: runId,
    trial: options.trial,
  });
  runtime.onProgress(`Clip prêt : ${videoPath}`);
  return report;
}

function resolveRuntime(runtime: LisaStudioRuntime): ResolvedRuntime {
  const clock = runtime.clock ?? systemClock;
  return {
    fetch: runtime.fetch ?? fetch,
    pythonExecutor: runtime.pythonExecutor ?? defaultPythonExecutor,
    clock,
    createId: runtime.createId ?? (() => `${clock.nowMs()}-${randomUUID()}`),
    env: runtime.env ?? process.env,
    onProgress: runtime.onProgress ?? (() => undefined),
  };
}

function normalizeOptions(input: LisaStudioInput, runtime: ResolvedRuntime): NormalizedOptions {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const referencePath = path.resolve(input.referencePath);
  const scenePrompt = (input.scenePrompt ?? DEFAULT_SCENE_PROMPT).trim();
  const animationPrompt = withDefaultAnimationLock(input.animationPrompt);
  const candidateCount = input.candidateCount ?? 4;
  const threshold = input.threshold ?? 0.5;
  const durationSeconds = input.durationSeconds ?? 5;
  const derivedSeed = Math.floor(Math.abs(runtime.clock.nowMs()) % MAX_SEED);
  const baseSeed = input.baseSeed ?? derivedSeed;
  const env = runtime.env;
  const requestedImageModel = (
    input.imageModel ??
    env.CODEBUDDY_IMAGE_MODEL ??
    env.CODEBUDDY_LORA_INFER_CHECKPOINT ??
    DEFAULT_IMAGE_MODEL
  ).trim();
  const imageModel = /^krea.?2$/i.test(requestedImageModel)
    ? DEFAULT_IMAGE_MODEL
    : requestedImageModel;

  if (!scenePrompt) throw new Error('Le prompt de scène ne peut pas être vide.');
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 12) {
    throw new Error('--n doit être un entier entre 1 et 12.');
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--seuil doit être compris entre 0 et 1.');
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 5 || durationSeconds > 15) {
    throw new Error('--duree doit être comprise entre 5 et 15 secondes (plage entraînée H3).');
  }
  if (!Number.isInteger(baseSeed) || baseSeed < 0 || baseSeed >= MAX_SEED) {
    throw new Error('--seed doit être un entier entre 0 et 1999999999.');
  }

  const normalized: NormalizedOptions = {
    referencePath,
    rootDir,
    scenePrompt,
    animationPrompt,
    candidateCount,
    threshold,
    durationSeconds,
    baseSeed,
    trial: input.trial ?? false,
    imageBaseUrl: normalizeBaseUrl(
      input.imageBaseUrl ??
        env.CODEBUDDY_LISA_IMAGE_URL ??
        env.CODEBUDDY_IMAGE_BASE_URL ??
        env.COMFYUI_URL ??
        DEFAULT_IMAGE_URL,
      'image'
    ),
    videoBaseUrl: normalizeBaseUrl(
      input.videoBaseUrl ??
        env.CODEBUDDY_LISA_VIDEO_URL ??
        env.CODEBUDDY_VIDEO_BASE_URL ??
        DEFAULT_VIDEO_URL,
      'vidéo'
    ),
    imageModel,
    imageTextEncoder: (
      input.imageTextEncoder ??
      env.CODEBUDDY_COMFYUI_KREA2_TEXT_ENCODER ??
      DEFAULT_IMAGE_TEXT_ENCODER
    ).trim(),
    imageVae: (input.imageVae ?? env.CODEBUDDY_COMFYUI_KREA2_VAE ?? DEFAULT_IMAGE_VAE).trim(),
    loraName: (input.loraName ?? env.CODEBUDDY_COMFYUI_LORA ?? DEFAULT_LORA).trim(),
    loraStrength: input.loraStrength ?? finiteNumber(env.CODEBUDDY_COMFYUI_LORA_STRENGTH, 0.85),
    h3Unet: (input.h3Unet ?? env.CODEBUDDY_H3_UNET ?? DEFAULT_H3_UNET).trim(),
    h3TextEncoder: (
      input.h3TextEncoder ??
      env.CODEBUDDY_H3_TEXT_ENCODER ??
      DEFAULT_H3_TEXT_ENCODER
    ).trim(),
    h3VideoVae: (input.h3VideoVae ?? env.CODEBUDDY_H3_VIDEO_VAE ?? DEFAULT_H3_VIDEO_VAE).trim(),
    pythonPath: path.resolve(
      input.pythonPath ??
        env.CODEBUDDY_LISA_QC_PYTHON ??
        path.join(os.homedir(), '.venvs', 'tri-outils-qc', 'bin', 'python')
    ),
    pollIntervalMs: positiveInteger(
      input.pollIntervalMs ?? finiteNumber(env.CODEBUDDY_COMFYUI_POLL_MS, 1_500),
      'intervalle de polling'
    ),
    imageTimeoutMs: positiveInteger(
      input.imageTimeoutMs ?? finiteNumber(env.CODEBUDDY_COMFYUI_TIMEOUT_MS, 300_000),
      'timeout image'
    ),
    videoTimeoutMs: positiveInteger(
      input.videoTimeoutMs ?? finiteNumber(env.CODEBUDDY_H3_TIMEOUT_MS, 1_800_000),
      'timeout H3'
    ),
  };

  for (const [label, value] of [
    ['modèle image', normalized.imageModel],
    ['encodeur Krea 2', normalized.imageTextEncoder],
    ['VAE Krea 2', normalized.imageVae],
    ['LoRA Lisa', normalized.loraName],
    ['UNET H3', normalized.h3Unet],
    ['encodeur H3', normalized.h3TextEncoder],
    ['VAE H3', normalized.h3VideoVae],
  ] as const) {
    assertSafeComfyModelName(value, label);
  }
  if (!/krea.?2/i.test(normalized.imageModel)) {
    throw new Error(`Lisa Studio exige un modèle Krea 2, reçu : ${normalized.imageModel}`);
  }
  if (/^(?:none|off|false|0)$/i.test(normalized.loraName)) {
    throw new Error('Lisa Studio exige un LoRA d’identité actif.');
  }
  if (
    !Number.isFinite(normalized.loraStrength) ||
    normalized.loraStrength <= 0 ||
    normalized.loraStrength > 1.5
  ) {
    throw new Error('La force du LoRA doit être > 0 et <= 1,5.');
  }
  return normalized;
}

async function generateKeyframeBytes(
  options: NormalizedOptions,
  runtime: ResolvedRuntime,
  seed: number
): Promise<Buffer> {
  const workflow = buildKrea2KeyframeWorkflow({
    prompt: options.scenePrompt,
    seed,
    model: options.imageModel,
    textEncoder: options.imageTextEncoder,
    vae: options.imageVae,
    loraName: options.loraName,
    loraStrength: options.loraStrength,
  });
  return submitWorkflowAndDownload({
    baseUrl: options.imageBaseUrl,
    workflow,
    expectedExtensions: ['.png'],
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: options.imageTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    fetchImpl: runtime.fetch,
    clock: runtime.clock,
    label: 'Keyframe Krea 2',
  });
}

async function generateH3VideoBytes(
  options: NormalizedOptions,
  runtime: ResolvedRuntime,
  firstFramePath: string,
  seed: number,
  frames: number,
  runId: string
): Promise<Buffer> {
  const uploadedFirstFrame = await uploadComfyImage(
    runtime.fetch,
    options.videoBaseUrl,
    firstFramePath,
    `lisa-first-frame-${runId}.png`
  );
  const workflow = buildH3FirstFrameWorkflow({
    prompt: options.animationPrompt,
    seed,
    frames,
    uploadedFirstFrame,
    unet: options.h3Unet,
    textEncoder: options.h3TextEncoder,
    videoVae: options.h3VideoVae,
  });
  return submitWorkflowAndDownload({
    baseUrl: options.videoBaseUrl,
    workflow,
    expectedExtensions: ['.mp4'],
    maxBytes: MAX_VIDEO_BYTES,
    timeoutMs: options.videoTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    fetchImpl: runtime.fetch,
    clock: runtime.clock,
    label: 'Clip MiniMax H3',
  });
}

async function scoreKeyframes(
  options: NormalizedOptions,
  runtime: ResolvedRuntime,
  keyframes: GeneratedKeyframe[]
): Promise<PythonKeyframePayload> {
  return runPythonJson<PythonKeyframePayload>(runtime.pythonExecutor, {
    task: 'score-keyframes',
    executable: options.pythonPath,
    code: SCORE_KEYFRAMES_PYTHON,
    arguments: [
      JSON.stringify({
        reference: options.referencePath,
        candidates: keyframes.map((candidate) => candidate.path),
      }),
    ],
    timeoutMs: 180_000,
  });
}

async function scoreVideo(
  options: NormalizedOptions,
  runtime: ResolvedRuntime,
  videoPath: string
): Promise<PythonVideoPayload> {
  return runPythonJson<PythonVideoPayload>(runtime.pythonExecutor, {
    task: 'score-video',
    executable: options.pythonPath,
    code: SCORE_VIDEO_PYTHON,
    arguments: [JSON.stringify({ reference: options.referencePath, video: videoPath })],
    timeoutMs: 240_000,
  });
}

async function runPythonJson<T>(
  executor: PythonExecutor,
  request: PythonExecutionRequest
): Promise<T> {
  const result = await executor(request);
  if (!Number.isInteger(result.exitCode) || result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'aucun détail';
    throw new Error(
      `QC Python ${request.task} en échec (exit ${result.exitCode}) : ${detail.slice(0, 1_000)}`
    );
  }
  const markerLine = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.startsWith(PYTHON_JSON_MARKER));
  if (!markerLine) {
    throw new Error(`QC Python ${request.task} n'a retourné aucun rapport JSON marqué.`);
  }
  try {
    return JSON.parse(markerLine.slice(PYTHON_JSON_MARKER.length)) as T;
  } catch (error) {
    throw new Error(
      `QC Python ${request.task} a retourné un JSON invalide : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function mergeKeyframeScores(
  keyframes: GeneratedKeyframe[],
  payload: PythonKeyframePayload
): KeyframeScore[] {
  if (!payload || !Array.isArray(payload.scores) || payload.scores.length !== keyframes.length) {
    throw new Error(`ArcFace devait retourner ${keyframes.length} scores de keyframe.`);
  }
  return keyframes.map((keyframe, index) => {
    const score = payload.scores[index];
    if (
      !score ||
      path.resolve(score.path) !== keyframe.path ||
      typeof score.detected !== 'boolean'
    ) {
      throw new Error(`Rapport ArcFace incohérent pour la keyframe ${index + 1}.`);
    }
    const arcfaceScore = score.arcface;
    if (
      arcfaceScore !== null &&
      (!Number.isFinite(arcfaceScore) || arcfaceScore < -1 || arcfaceScore > 1)
    ) {
      throw new Error(`Score ArcFace invalide pour la keyframe ${index + 1}.`);
    }
    if (score.detected !== (arcfaceScore !== null)) {
      throw new Error(`Détection ArcFace incohérente pour la keyframe ${index + 1}.`);
    }
    return {
      index: keyframe.index,
      path: keyframe.path,
      seed: keyframe.seed,
      faceDetected: score.detected,
      arcfaceScore,
      generationDurationMs: keyframe.durationMs,
    };
  });
}

function validateVideoScores(payload: PythonVideoPayload): VideoFrameScore[] {
  if (
    !payload ||
    !Number.isInteger(payload.frameCount) ||
    payload.frameCount < 3 ||
    !Number.isFinite(payload.fps) ||
    payload.fps <= 0 ||
    !Number.isFinite(payload.durationSeconds) ||
    payload.durationSeconds <= 0 ||
    !Array.isArray(payload.scores) ||
    payload.scores.length !== 3
  ) {
    throw new Error(
      'Le QC vidéo ArcFace doit retourner exactement trois frames et une durée valide.'
    );
  }
  const expected = ['debut', 'milieu', 'fin'] as const;
  return payload.scores.map((score, index) => {
    const position = expected[index];
    if (
      !score ||
      score.position !== position ||
      !Number.isInteger(score.frameIndex) ||
      score.frameIndex < 0 ||
      score.frameIndex >= payload.frameCount ||
      !Number.isFinite(score.timestampSeconds) ||
      score.timestampSeconds < 0 ||
      !Number.isFinite(score.arcface) ||
      score.arcface < -1 ||
      score.arcface > 1
    ) {
      throw new Error(`Score ArcFace final invalide pour la frame ${position}.`);
    }
    return {
      position,
      frameIndex: score.frameIndex,
      timestampSeconds: score.timestampSeconds,
      arcfaceScore: score.arcface,
    };
  });
}

function trialKeyframeScores(keyframes: GeneratedKeyframe[]): PythonKeyframePayload {
  return {
    scores: keyframes.map((candidate, index) => ({
      path: candidate.path,
      detected: true,
      arcface: Math.min(0.95, 0.72 + index * 0.03),
    })),
  };
}

function trialVideoScores(frames: number): PythonVideoPayload {
  return {
    frameCount: frames,
    fps: 24,
    durationSeconds: frames / 24,
    scores: [
      { position: 'debut', frameIndex: 0, timestampSeconds: 0, arcface: 0.74 },
      {
        position: 'milieu',
        frameIndex: Math.floor(frames / 2),
        timestampSeconds: Math.floor(frames / 2) / 24,
        arcface: 0.71,
      },
      {
        position: 'fin',
        frameIndex: frames - 1,
        timestampSeconds: (frames - 1) / 24,
        arcface: 0.69,
      },
    ],
  };
}

async function submitWorkflowAndDownload(options: {
  baseUrl: string;
  workflow: ComfyWorkflow;
  expectedExtensions: string[];
  maxBytes: number;
  timeoutMs: number;
  pollIntervalMs: number;
  fetchImpl: typeof fetch;
  clock: StudioClock;
  label: string;
}): Promise<Buffer> {
  const submitted = await fetchJson(
    options.fetchImpl,
    joinUrl(options.baseUrl, '/prompt'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: options.workflow, client_id: randomUUID() }),
    },
    60_000,
    `${options.label} /prompt`
  );
  const promptId = stringField(submitted, 'prompt_id');
  if (!promptId) {
    throw new Error(
      `${options.label} refusé par ComfyUI : ${JSON.stringify(submitted).slice(0, 500)}`
    );
  }

  const deadline = options.clock.nowMs() + options.timeoutMs;
  let output: ComfyFileReference | undefined;
  while (options.clock.nowMs() <= deadline) {
    const history = await fetchJson(
      options.fetchImpl,
      joinUrl(options.baseUrl, `/history/${encodeURIComponent(promptId)}`),
      { headers: { Accept: 'application/json' } },
      60_000,
      `${options.label} /history`
    );
    const entry = recordField(history, promptId);
    if (entry) {
      const status = recordField(entry, 'status');
      const statusText = status ? (stringField(status, 'status_str') ?? '').toLowerCase() : '';
      if (statusText === 'error' || statusText === 'failed') {
        throw new Error(
          `${options.label} échoué dans ComfyUI : ${JSON.stringify(status).slice(0, 500)}`
        );
      }
      output = findComfyOutput(entry.outputs, options.expectedExtensions);
      if (output) break;
      if (status && (status.completed === true || statusText === 'success')) {
        throw new Error(
          `${options.label} terminé sans fichier ${options.expectedExtensions.join('/')}.`
        );
      }
    }
    await options.clock.sleep(options.pollIntervalMs);
  }
  if (!output) {
    throw new Error(`${options.label} expiré après ${options.timeoutMs} ms (prompt ${promptId}).`);
  }

  const viewUrl = new URL(joinUrl(options.baseUrl, '/view'));
  viewUrl.searchParams.set('filename', output.filename);
  viewUrl.searchParams.set('subfolder', output.subfolder);
  viewUrl.searchParams.set('type', output.type);
  const response = await fetchWithTimeout(
    options.fetchImpl,
    viewUrl.toString(),
    { headers: { Accept: '*/*' } },
    120_000
  );
  if (!response.ok) {
    throw new Error(`${options.label} /view a retourné HTTP ${response.status}.`);
  }
  return readBoundedBody(response, options.maxBytes, options.label);
}

async function uploadComfyImage(
  fetchImpl: typeof fetch,
  baseUrl: string,
  imagePath: string,
  filename: string
): Promise<string> {
  const bytes = await fs.readFile(imagePath);
  assertPng(bytes, 'First frame H3');
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), filename);
  form.append('overwrite', 'false');
  const response = await fetchWithTimeout(
    fetchImpl,
    joinUrl(baseUrl, '/upload/image'),
    { method: 'POST', body: form },
    120_000
  );
  if (!response.ok) {
    throw new Error(`Upload first_frame H3 refusé : HTTP ${response.status}.`);
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Upload first_frame H3 : réponse JSON invalide.');
  }
  if (!isRecord(value)) throw new Error('Upload first_frame H3 : réponse non objet.');
  const name = stringField(value, 'name');
  const subfolder = stringField(value, 'subfolder') ?? '';
  if (!name || !safeComfyFilename(name) || !safeComfySubfolder(subfolder)) {
    throw new Error('Upload first_frame H3 : chemin ComfyUI invalide.');
  }
  return subfolder ? `${subfolder}/${name}` : name;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} a retourné HTTP ${response.status} : ${text.slice(0, 500)}`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch (error) {
    throw new Error(
      `${label} a retourné un JSON invalide : ${error instanceof Error ? error.message : String(error)}`
    );
  }
  throw new Error(`${label} a retourné un JSON non objet.`);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${url} a expiré après ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`${label} dépasse ${Math.round(maxBytes / (1024 * 1024))} Mo.`);
  }
  if (!response.body) throw new Error(`${label} a retourné un corps vide.`);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel(`${label} body timeout`);
  }, 120_000);
  try {
    for (;;) {
      const part = await reader.read();
      if (timedOut) throw new Error(`${label} a expiré pendant le téléchargement.`);
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel(`${label} trop volumineux`);
        throw new Error(`${label} dépasse ${Math.round(maxBytes / (1024 * 1024))} Mo.`);
      }
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (total === 0) throw new Error(`${label} a retourné zéro octet.`);
  return Buffer.concat(chunks, total);
}

function findComfyOutput(value: unknown, extensions: string[]): ComfyFileReference | undefined {
  if (!isRecord(value)) return undefined;
  for (const node of Object.values(value)) {
    if (!isRecord(node)) continue;
    for (const key of ['images', 'videos', 'files']) {
      const items = node[key];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!isRecord(item)) continue;
        const filename = stringField(item, 'filename');
        const subfolder = stringField(item, 'subfolder') ?? '';
        const type = stringField(item, 'type') ?? 'output';
        if (
          filename &&
          extensions.some((extension) => filename.toLowerCase().endsWith(extension)) &&
          safeComfyFilename(filename) &&
          safeComfySubfolder(subfolder) &&
          ['input', 'output', 'temp'].includes(type)
        ) {
          return { filename, subfolder, type };
        }
      }
    }
  }
  return undefined;
}

async function validateReference(referencePath: string): Promise<void> {
  let metadata;
  try {
    metadata = await fs.lstat(referencePath);
  } catch (error) {
    throw new Error(
      `Image de référence introuvable : ${referencePath} (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      `--reference doit désigner un fichier régulier non symbolique : ${referencePath}`
    );
  }
  if (metadata.size <= 0 || metadata.size > MAX_REFERENCE_BYTES) {
    throw new Error(`--reference doit peser entre 1 octet et ${MAX_REFERENCE_BYTES} octets.`);
  }
}

async function ensureConfinedDirectory(
  rootPath: string,
  rootReal: string,
  segments: string[]
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
      throw new Error(`Répertoire de sortie dangereux : ${cursor}`);
    }
    const cursorReal = await fs.realpath(cursor);
    const relative = path.relative(rootReal, cursorReal);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Le répertoire de sortie sort du worktree : ${cursor}`);
    }
  }
  return fs.realpath(cursor);
}

async function writeNewFile(filename: string, bytes: Buffer): Promise<void> {
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(filename, flags, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeNewJson(filename: string, value: unknown): Promise<void> {
  await writeNewFile(filename, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

function assertPng(bytes: Buffer, label: string): void {
  if (
    bytes.length < PNG_SIGNATURE.length ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error(`${label} n'est pas un PNG valide.`);
  }
}

function assertMp4(bytes: Buffer, label: string): void {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new Error(`${label} n'est pas un MP4 valide.`);
  }
}

function normalizeBaseUrl(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new Error('protocole');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`URL ComfyUI ${label} invalide : ${value}`);
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function assertSafeComfyModelName(value: string, label: string): void {
  const normalized = value.replace(/\\/g, '/');
  if (
    !value ||
    value.length > 512 ||
    normalized.startsWith('/') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9_./\\ -]+$/.test(value)
  ) {
    throw new Error(`${label} ComfyUI invalide : ${value || '(vide)'}`);
  }
}

function safeComfyFilename(value: string): boolean {
  return value.length <= 255 && value !== '.' && value !== '..' && /^[A-Za-z0-9_. -]+$/.test(value);
}

function safeComfySubfolder(value: string): boolean {
  if (!value) return true;
  const normalized = value.replace(/\\/g, '/');
  return (
    normalized.length <= 512 &&
    !normalized.startsWith('/') &&
    normalized
      .split('/')
      .every((segment) => segment !== '.' && segment !== '..' && /^[A-Za-z0-9_. -]+$/.test(segment))
  );
}

function sanitizeId(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return sanitized || randomUUID();
}

function finiteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${label} invalide.`);
  return Math.floor(value);
}

function elapsed(clock: StudioClock, startedAt: number): number {
  return Math.max(0, clock.nowMs() - startedAt);
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field.trim() : undefined;
}

function recordField(
  value: Record<string, unknown>,
  key: string
): Record<string, unknown> | undefined {
  const field = value[key];
  return isRecord(field) ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
