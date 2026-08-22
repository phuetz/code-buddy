import { spawn as realSpawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export type VideoAssetRole = 'master' | 'delivery' | 'alternate' | 'shot';

export interface VideoFingerprint {
  sha256: string;
  perceptualFrames: string[];
}

export interface VideoAssetRecord extends VideoFingerprint {
  titleId: string;
  masterId: string;
  language: string;
  role: VideoAssetRole;
  revision: number;
  path: string;
  differenceJustification?: string;
}

interface VideoAssetIndex {
  schemaVersion: 1;
  assets: VideoAssetRecord[];
}

export interface RegisterVideoAssetsOptions {
  titleId: string;
  masterId: string;
  language?: string;
  role?: VideoAssetRole;
  revision?: number;
  registryPath?: string;
  differenceJustification?: string;
  allowedCrossTitleReuseReason?: string;
}

export interface VideoAssetGateDependencies {
  spawn?: typeof realSpawn;
  fingerprint?: typeof fingerprintVideo;
}

export const DEFAULT_VIDEO_ASSET_REGISTRY = path.join(
  os.homedir(),
  '.codebuddy',
  'video-shot-index.json',
);

function popcountHex(value: string): number {
  let count = 0;
  for (const character of value) {
    let nibble = Number.parseInt(character, 16);
    if (!Number.isFinite(nibble)) throw new Error(`Invalid hexadecimal hash: ${value}`);
    while (nibble > 0) {
      count += nibble & 1;
      nibble >>= 1;
    }
  }
  return count;
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  const xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  return popcountHex(xor.toString(16).padStart(left.length, '0'));
}

/** 9×8 grayscale frame -> 64-bit dHash. */
export function dHashFrame(frame: Uint8Array): string {
  if (frame.length !== 72) throw new Error('dHash requires one 9x8 grayscale frame');
  let bits = 0n;
  let offset = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (frame[y * 9 + x]! > frame[y * 9 + x + 1]!) bits |= 1n << offset;
      offset += 1n;
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function perceptualDuplicate(
  left: readonly string[],
  right: readonly string[],
  maximumMedianDistance = 6,
): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const nearest = left.map((hash) =>
    Math.min(...right.map((candidate) => hammingDistance(hash, candidate))));
  nearest.sort((a, b) => a - b);
  const median = nearest[Math.floor(nearest.length / 2)]!;
  return median <= maximumMedianDistance;
}

export function deliveryFilename(record: Pick<
  VideoAssetRecord,
  'titleId' | 'language' | 'role' | 'revision' | 'masterId'
>): string {
  const safe = (value: string): string => {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    if (!normalized) throw new Error('Video filename identifiers cannot be empty');
    return normalized;
  };
  if (!Number.isInteger(record.revision) || record.revision < 1) {
    throw new Error('Video revision must be a positive integer');
  }
  return [
    safe(record.titleId),
    safe(record.language),
    record.role,
    `r${record.revision}`,
    safe(record.masterId),
  ].join('--') + '.mp4';
}

function runRawFrames(
  spawn: typeof realSpawn,
  filename: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filename,
        '-vf',
        'fps=1/5,scale=9:8:flags=area,format=gray',
        '-frames:v',
        '12',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg fingerprint failed: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export async function fingerprintVideo(
  filenameInput: string,
  dependencies: VideoAssetGateDependencies = {},
): Promise<VideoFingerprint> {
  const filename = path.resolve(filenameInput);
  const bytes = await fs.readFile(filename);
  const rawFrames = await runRawFrames(dependencies.spawn ?? realSpawn, filename);
  if (rawFrames.length < 72 || rawFrames.length % 72 !== 0) {
    throw new Error(`Video fingerprint produced no complete frames: ${filename}`);
  }
  const perceptualFrames: string[] = [];
  for (let offset = 0; offset < rawFrames.length; offset += 72) {
    perceptualFrames.push(dHashFrame(rawFrames.subarray(offset, offset + 72)));
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    perceptualFrames,
  };
}

async function readIndex(filename: string): Promise<VideoAssetIndex> {
  try {
    const value = JSON.parse(await fs.readFile(filename, 'utf8')) as Partial<VideoAssetIndex>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.assets)) {
      throw new Error('video asset index is malformed');
    }
    return value as VideoAssetIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, assets: [] };
    }
    throw error;
  }
}

async function writeIndex(filename: string, value: VideoAssetIndex): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, filename);
}

/** Blocks recycled cross-title shots and semantically empty alternates. */
export async function registerVideoAssets(
  filenames: readonly string[],
  options: RegisterVideoAssetsOptions,
  dependencies: VideoAssetGateDependencies = {},
): Promise<VideoAssetRecord[]> {
  const registryPath = path.resolve(options.registryPath ?? DEFAULT_VIDEO_ASSET_REGISTRY);
  const index = await readIndex(registryPath);
  const created: VideoAssetRecord[] = [];
  for (const filename of filenames) {
    const makeFingerprint = dependencies.fingerprint ?? fingerprintVideo;
    const fingerprint = await makeFingerprint(filename, dependencies);
    const exact = index.assets.find((asset) => asset.sha256 === fingerprint.sha256);
    const perceptual = index.assets.find((asset) =>
      asset.titleId !== options.titleId &&
      perceptualDuplicate(asset.perceptualFrames, fingerprint.perceptualFrames));
    if (exact && exact.titleId !== options.titleId && !options.allowedCrossTitleReuseReason?.trim()) {
      throw new Error(
        `Cross-title stock reuse refused (exact fingerprint): ${options.titleId} vs ${exact.titleId}`,
      );
    }
    if (perceptual && !options.allowedCrossTitleReuseReason?.trim()) {
      throw new Error(
        `Cross-title stock reuse refused (perceptual fingerprint): ${options.titleId} vs ${perceptual.titleId}`,
      );
    }
    if (
      (options.role ?? 'shot') === 'alternate' &&
      exact?.masterId === options.masterId
    ) {
      throw new Error('Alternate/directorscut refused: it is bit-for-bit identical to its master');
    }
    if (
      (options.role ?? 'shot') === 'alternate' &&
      !options.differenceJustification?.trim()
    ) {
      throw new Error('Alternate/directorscut refused: differenceJustification is required');
    }
    created.push({
      ...fingerprint,
      titleId: options.titleId,
      masterId: options.masterId,
      language: options.language ?? 'und',
      role: options.role ?? 'shot',
      revision: options.revision ?? 1,
      path: path.resolve(filename),
      ...(options.differenceJustification
        ? { differenceJustification: options.differenceJustification }
        : {}),
    });
  }
  await writeIndex(registryPath, {
    schemaVersion: 1,
    assets: [
      ...index.assets.filter((existing) =>
        !created.some((candidate) => candidate.path === existing.path)),
      ...created,
    ],
  });
  return created;
}
