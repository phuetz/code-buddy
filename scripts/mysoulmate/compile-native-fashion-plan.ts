#!/usr/bin/env npx tsx

/** Compile one human-approved native fashion pilot clip into a schema V4 plan. */

import { execFile as realExecFile } from 'child_process';
import { createHash } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import {
  PILOT_FASHION_SCENES,
  type PilotFashionScene,
} from '../../src/companion/fashion-scene-catalog.js';
import {
  assertPlan,
  NATIVE_FASHION_PROFILE,
  type NativeFashionPlan,
} from './render-youtube-short-batch.js';

const execFile = promisify(realExecFile);
const SHA256 = /^[a-f0-9]{64}$/u;

export interface NativeFashionSourceDigests {
  imageManifestSha256: string;
  imageCatalogSha256: string;
  factoryConfigSha256: string;
  assetApprovalsSha256: string;
  productionLedgerSha256: string;
}

export interface NativeFashionClipProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
}

export interface BuildNativeFashionPlanInput {
  clipPath: string;
  clipSha256: string;
  expectedClipSha256?: string;
  probe: NativeFashionClipProbe;
  scene: PilotFashionScene;
  sourceDigests: NativeFashionSourceDigests;
  title: string;
  description: string;
  provenanceRef: string;
  profileRevision: string;
  qaApproved?: boolean;
}

export interface CompileNativeFashionPlanOptions {
  clipPath: string;
  expectedClipSha256?: string;
  sceneId: PilotFashionScene['sceneId'];
  digestsPath: string;
  title: string;
  description: string;
  provenanceRef: string;
  profileRevision: string;
  qaApproved?: boolean;
  outPath: string;
  force?: boolean;
}

export interface CompileNativeFashionPlanDependencies {
  probe?: (clipPath: string) => Promise<NativeFashionClipProbe>;
}

const SOURCE_DIGEST_KEYS = [
  'imageManifestSha256',
  'imageCatalogSha256',
  'factoryConfigSha256',
  'assetApprovalsSha256',
  'productionLedgerSha256',
] as const;

export function assertNativeFashionSourceDigests(value: unknown): asserts value is NativeFashionSourceDigests {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('sourceDigests must be an object');
  }
  const candidate = value as Partial<Record<(typeof SOURCE_DIGEST_KEYS)[number], unknown>>;
  for (const key of SOURCE_DIGEST_KEYS) {
    if (typeof candidate[key] !== 'string' || !SHA256.test(candidate[key])) {
      throw new Error(`sourceDigests.${key} must be a lowercase SHA-256`);
    }
  }
}

export function assertNativeFashionProbe(probe: NativeFashionClipProbe): void {
  if (
    !Number.isFinite(probe.width) || !Number.isFinite(probe.height) ||
    probe.width < NATIVE_FASHION_PROFILE.source.minWidth ||
    probe.height < NATIVE_FASHION_PROFILE.source.minHeight ||
    probe.height <= probe.width
  ) {
    throw new Error('Native fashion clip must be portrait at 1080x1920 or greater');
  }
  if (!Number.isFinite(probe.fps) || Math.abs(probe.fps - NATIVE_FASHION_PROFILE.master.fps) > 0.050_001) {
    throw new Error('Native fashion clip must be 30 fps within ±0.05 fps');
  }
  if (!Number.isFinite(probe.duration) || probe.duration < 11 || probe.duration > 13) {
    throw new Error('Native fashion clip duration must be between 11 and 13 seconds');
  }
}

export function buildNativeFashionPlan(input: BuildNativeFashionPlanInput): NativeFashionPlan {
  if (input.qaApproved !== true) {
    throw new Error('Human QA approval is prerequisite; pass --qa-approved true only after frame-by-frame review');
  }
  if (!path.isAbsolute(input.clipPath)) throw new Error('Native fashion clip path must be absolute');
  if (!SHA256.test(input.clipSha256)) throw new Error('Native fashion clip SHA-256 is invalid');
  if (input.expectedClipSha256 !== undefined) {
    if (!SHA256.test(input.expectedClipSha256)) throw new Error('--clip-sha256 must be a lowercase SHA-256');
    if (input.expectedClipSha256 !== input.clipSha256) throw new Error('Native fashion clip SHA-256 mismatch');
  }
  assertNativeFashionSourceDigests(input.sourceDigests);
  assertNativeFashionProbe(input.probe);
  if (!input.title.trim() || !input.description.trim()) throw new Error('Editorial title and description are required');
  if (!input.provenanceRef.trim()) throw new Error('Audio provenance reference is required');
  if (!SHA256.test(input.profileRevision)) throw new Error('Audio profile revision must be a lowercase SHA-256');

  const plan: NativeFashionPlan = {
    schemaVersion: 4,
    sourceDigests: { ...input.sourceDigests },
    policy: {
      contentTier: 'safe',
      qaStatus: 'approved',
      autoPublish: false,
      initialVisibility: 'private',
      syntheticMediaDisclosureRequired: true,
    },
    shorts: [{
      shortId: input.scene.sceneId,
      contentGroupId: 'mysoulmate-native-fashion-pilots',
      editorial: {
        title: input.title.trim(),
        description: input.description.trim(),
        translationStatus: 'source',
      },
      delivery: {
        mode: 'ambient-fashion-master',
        visualSpeechMode: 'none',
      },
      render: {
        engine: 'approved-native-video',
        profile: NATIVE_FASHION_PROFILE,
        clipDurationSeconds: 12,
        shots: [{
          index: 1,
          assetId: `lisa-${input.scene.sceneId}`,
          sourceSha256: input.clipSha256,
          referenceVideoPath: input.clipPath,
          contentTier: 'safe',
          qaStatus: 'approved',
          motionPrompt: input.scene.prompt,
          nativeVideo: {
            width: input.probe.width,
            height: input.probe.height,
            fps: 30,
            durationSeconds: input.probe.duration,
            generationMode: 'native',
            upscaled: false,
          },
        }],
      },
      publication: {
        visibility: 'private',
        autoPublish: false,
        madeForKids: false,
        containsSyntheticMedia: true,
        reviewStatus: 'pending-human-review',
      },
      audioRights: {
        provenanceRef: input.provenanceRef.trim(),
        profileRevision: input.profileRevision,
        commercialUseApproved: true,
      },
    }],
  };
  assertPlan(plan);
  return plan;
}

export async function probeNativeFashionClip(clipPath: string): Promise<NativeFashionClipProbe> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate',
    '-of', 'json',
    clipPath,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<Record<string, unknown>>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const rateParts = String(video?.r_frame_rate ?? '0/1').split('/').map(Number);
  const numerator = rateParts[0] ?? 0;
  const denominator = rateParts[1] ?? 1;
  return {
    duration: Number(parsed.format?.duration),
    width: Number(video?.width),
    height: Number(video?.height),
    fps: denominator === 0 ? 0 : numerator / denominator,
  };
}

async function sha256RegularNoFollow(filename: string): Promise<{ path: string; sha256: string }> {
  const absolute = path.resolve(filename);
  const info = await fs.lstat(absolute);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('Native fashion clip must be a regular non-symlink file');
  }
  const handle = await fs.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const openedInfo = await handle.stat();
    if (!openedInfo.isFile()) throw new Error('Native fashion clip must be a regular non-symlink file');
    const realPath = await fs.realpath(absolute);
    const sha256 = createHash('sha256').update(await handle.readFile()).digest('hex');
    return { path: realPath, sha256 };
  } finally {
    await handle.close();
  }
}

async function readSourceDigests(filename: string): Promise<NativeFashionSourceDigests> {
  const bytes = await fs.readFile(path.resolve(filename), 'utf8');
  const parsed = JSON.parse(bytes) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('sourceDigests' in parsed)) {
    throw new Error('Digests JSON must contain sourceDigests');
  }
  const sourceDigests = (parsed as { sourceDigests: unknown }).sourceDigests;
  assertNativeFashionSourceDigests(sourceDigests);
  return sourceDigests;
}

async function assertOutputWritable(outPath: string, force: boolean): Promise<void> {
  try {
    const info = await fs.lstat(outPath);
    if (!force) throw new Error(`Output already exists: ${outPath}; pass --force to overwrite`);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Output must be a regular non-symlink file');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function compileNativeFashionPlan(
  options: CompileNativeFashionPlanOptions,
  dependencies: CompileNativeFashionPlanDependencies = {},
): Promise<{ plan: NativeFashionPlan; planSha256: string }> {
  if (options.qaApproved !== true) {
    throw new Error('Human QA approval is prerequisite; pass --qa-approved true only after frame-by-frame review');
  }
  const scene = PILOT_FASHION_SCENES.find((candidate) => candidate.sceneId === options.sceneId);
  if (!scene) throw new Error(`Unknown pilot fashion scene: ${options.sceneId}`);
  const clip = await sha256RegularNoFollow(options.clipPath);
  const sourceDigests = await readSourceDigests(options.digestsPath);
  const probe = await (dependencies.probe ?? probeNativeFashionClip)(clip.path);
  const plan = buildNativeFashionPlan({
    clipPath: clip.path,
    clipSha256: clip.sha256,
    ...(options.expectedClipSha256 ? { expectedClipSha256: options.expectedClipSha256 } : {}),
    probe,
    scene,
    sourceDigests,
    title: options.title,
    description: options.description,
    provenanceRef: options.provenanceRef,
    profileRevision: options.profileRevision,
    qaApproved: options.qaApproved,
  });
  const outPath = path.resolve(options.outPath);
  await assertOutputWritable(outPath, options.force === true);
  const contents = `${JSON.stringify(plan, null, 2)}\n`;
  await fs.writeFile(outPath, contents, { flag: options.force === true ? 'w' : 'wx', mode: 0o600 });
  return {
    plan,
    planSha256: createHash('sha256').update(contents).digest('hex'),
  };
}

function argument(argv: readonly string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1]?.trim() ?? '' : '';
}

function requiredArgument(argv: readonly string[], name: string): string {
  const value = argument(argv, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

export function parseCompileNativeFashionArgs(argv: readonly string[]): CompileNativeFashionPlanOptions {
  const sceneId = requiredArgument(argv, 'scene');
  if (sceneId !== 'pilot-black-dress-turn' && sceneId !== 'pilot-floral-staircase') {
    throw new Error(`Unknown pilot fashion scene: ${sceneId}`);
  }
  return {
    clipPath: requiredArgument(argv, 'clip'),
    ...(argument(argv, 'clip-sha256') ? { expectedClipSha256: argument(argv, 'clip-sha256') } : {}),
    sceneId,
    digestsPath: requiredArgument(argv, 'digests'),
    title: requiredArgument(argv, 'title'),
    description: requiredArgument(argv, 'description'),
    provenanceRef: requiredArgument(argv, 'provenance-ref'),
    profileRevision: requiredArgument(argv, 'profile-revision'),
    qaApproved: argument(argv, 'qa-approved') === 'true',
    outPath: requiredArgument(argv, 'out'),
    force: argv.includes('--force'),
  };
}

export async function runCompileNativeFashionPlanCli(
  argv: readonly string[],
  dependencies: CompileNativeFashionPlanDependencies = {},
): Promise<void> {
  const result = await compileNativeFashionPlan(parseCompileNativeFashionArgs(argv), dependencies);
  process.stdout.write(`Native fashion plan written. SHA-256: ${result.planSha256}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCompileNativeFashionPlanCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
