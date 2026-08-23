/** Verify operator-provided Google Flow outputs and create auditable local receipts. */

import { execFile as realExecFile } from 'child_process';
import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import {
  canonicalJson,
  canonicalSha256,
  verifyGoogleFlowHandoffDigest,
  type GoogleFlowHandoff,
} from './google-flow-handoff.js';

const execFile = promisify(realExecFile);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

export interface GoogleFlowResultProbe {
  durationSeconds: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
}

interface GoogleFlowImportedJob {
  id: string;
  role: 'hero' | 'b-roll' | 'transition';
  sourceFile: string;
  sourceSha256: string;
  sourceHadAudio: boolean;
  outputFile: string;
  sha256: string;
  bytes: number;
  probe: GoogleFlowResultProbe;
  audioPreserved?: true;
  qaStatus: 'pending-human-review';
}

interface UnsignedGoogleFlowImportReceipt {
  schemaVersion: 2;
  batchId: string;
  provider: 'google-flow-web';
  sourcePlanSha256: string;
  handoffSha256: string;
  handoffFileSha256: string;
  importedAt: string;
  audioPolicy: 'removed-on-import' | 'preserved-on-import';
  audioPreserved?: true;
  autoPublish: false;
  humanReviewRequired: true;
  jobs: GoogleFlowImportedJob[];
}

export interface GoogleFlowImportReceipt extends UnsignedGoogleFlowImportReceipt {
  receiptSha256: string;
}

export interface GoogleFlowReviewChecks {
  identity: boolean;
  anatomy: boolean;
  motion: boolean;
  cleanEnd: boolean;
  noSpeech: boolean;
  noTextOrLogo: boolean;
  safeContent: boolean;
}

export interface GoogleFlowReviewReceipt {
  schemaVersion: 1;
  batchId: string;
  status: 'approved-for-editing';
  importReceiptSha256: string;
  jobs: Array<{ id: string; sha256: string; qaStatus: 'approved' }>;
  checks: GoogleFlowReviewChecks;
  reviewer: string;
  reason: string;
  reviewedAt: string;
  autoPublish: false;
}

export async function importGoogleFlowResults(input: {
  handoff: GoogleFlowHandoff;
  handoffBytes: Uint8Array;
  resultsRoot: string;
  outputRoot: string;
  now?: () => Date;
  minWidth?: number;
  minHeight?: number;
  preserveAudio?: boolean;
  probe?: (filename: string) => Promise<GoogleFlowResultProbe>;
  normalize?: (
    source: string,
    destination: string,
    options: { preserveAudio: boolean },
  ) => Promise<void>;
}): Promise<GoogleFlowImportReceipt> {
  assertHandoff(input.handoff);
  assertHandoffBytes(input.handoff, input.handoffBytes);
  assertImportOptions(input.minWidth, input.minHeight);
  const resultsRoot = await confinedRoot(input.resultsRoot, false);
  const outputRoot = await confinedRoot(input.outputRoot, true);
  await assertExactResultSet(resultsRoot, input.handoff.jobs.map((job) => `${job.id}.mp4`));
  const batchDirectory = await createConfinedBatchDirectory(outputRoot, input.handoff.batchId);
  const probe = input.probe ?? probeFlowResult;
  const normalize = input.normalize ?? normalizeFlowResult;
  const preserveAudio = input.preserveAudio ?? false;

  const jobs: GoogleFlowImportedJob[] = [];
  for (const job of input.handoff.jobs) {
    const source = path.join(resultsRoot, `${job.id}.mp4`);
    const sourceBytes = await readRegularNoFollow(source, `Flow result ${job.id}`);
    if (!hasMp4Signature(sourceBytes)) throw new Error(`Flow result ${job.id} is not an MP4 file`);

    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const capturedSource = path.join(batchDirectory, `.${job.id}-${nonce}-source.mp4`);
    const normalizedTemporary = path.join(
      batchDirectory,
      `.${job.id}-${nonce}-${preserveAudio ? 'audio' : 'silent'}.mp4`,
    );
    await writeFile(capturedSource, sourceBytes, { flag: 'wx', mode: 0o600 });
    try {
      // Probe the immutable captured bytes, never the operator-controlled path
      // again, so a concurrent replacement cannot change what gets imported.
      const sourceProbe = await probe(capturedSource);
      assertExpectedProbe(job.id, sourceProbe, job.settings.aspectRatio, job.settings.durationSeconds, {
        minWidth: input.minWidth,
        minHeight: input.minHeight,
        requireAudio: preserveAudio,
      });
      await normalize(capturedSource, normalizedTemporary, { preserveAudio });
      const normalizedBytes = await readRegularNoFollow(normalizedTemporary, `Normalized Flow result ${job.id}`);
      if (!hasMp4Signature(normalizedBytes)) throw new Error(`Normalized Flow result ${job.id} is not an MP4 file`);
      const normalizedProbe = await probe(normalizedTemporary);
      assertExpectedProbe(job.id, normalizedProbe, job.settings.aspectRatio, job.settings.durationSeconds, {
        minWidth: input.minWidth,
        minHeight: input.minHeight,
        requireAudio: preserveAudio,
        requireSilent: !preserveAudio,
      });
      const sha256 = digest(normalizedBytes);
      const outputFile = `${job.id}-${sha256.slice(0, 16)}.mp4`;
      const destination = path.join(batchDirectory, outputFile);
      await installImmutableFile(normalizedTemporary, destination, sha256);
      const importedJob: GoogleFlowImportedJob = {
        id: job.id,
        role: job.role,
        sourceFile: path.basename(source),
        sourceSha256: digest(sourceBytes),
        sourceHadAudio: sourceProbe.hasAudio,
        outputFile: path.relative(outputRoot, destination).split(path.sep).join('/'),
        sha256,
        bytes: normalizedBytes.length,
        probe: normalizedProbe,
        qaStatus: 'pending-human-review',
      };
      if (preserveAudio) importedJob.audioPreserved = true;
      jobs.push(importedJob);
    } finally {
      await Promise.all([
        unlink(capturedSource).catch(() => undefined),
        unlink(normalizedTemporary).catch(() => undefined),
      ]);
    }
  }

  const unsigned: UnsignedGoogleFlowImportReceipt = {
    schemaVersion: 2,
    batchId: input.handoff.batchId,
    provider: 'google-flow-web',
    sourcePlanSha256: input.handoff.sourcePlanSha256,
    handoffSha256: input.handoff.handoffSha256,
    handoffFileSha256: digest(input.handoffBytes),
    importedAt: (input.now ?? (() => new Date()))().toISOString(),
    audioPolicy: preserveAudio ? 'preserved-on-import' : 'removed-on-import',
    autoPublish: false,
    humanReviewRequired: true,
    jobs,
  };
  if (preserveAudio) unsigned.audioPreserved = true;
  const receipt: GoogleFlowImportReceipt = { ...unsigned, receiptSha256: canonicalSha256(unsigned) };
  await writeImmutableJson(path.join(batchDirectory, 'receipt.json'), receipt);
  return receipt;
}

export function reviewGoogleFlowImport(input: {
  receipt: GoogleFlowImportReceipt;
  expectedReceiptSha256: string;
  reviewer: string;
  reason: string;
  checks: GoogleFlowReviewChecks;
  now?: () => Date;
}): GoogleFlowReviewReceipt {
  const { receiptSha256, ...unsigned } = input.receipt;
  if (
    !SHA256.test(input.expectedReceiptSha256) ||
    receiptSha256 !== input.expectedReceiptSha256 ||
    canonicalSha256(unsigned) !== receiptSha256 ||
    !input.receipt.jobs.length ||
    input.receipt.jobs.some((job) => job.qaStatus !== 'pending-human-review' || !SHA256.test(job.sha256))
  ) throw new Error('Flow review must target the current immutable import receipt SHA-256');
  if (Object.values(input.checks).some((value) => value !== true)) {
    throw new Error('Every Flow human-review check must pass');
  }
  if (input.reviewer.trim().length < 2 || input.reason.trim().length < 3) {
    throw new Error('Reviewer and reason are required');
  }
  return {
    schemaVersion: 1,
    batchId: input.receipt.batchId,
    status: 'approved-for-editing',
    importReceiptSha256: receiptSha256,
    jobs: input.receipt.jobs.map((job) => ({ id: job.id, sha256: job.sha256, qaStatus: 'approved' })),
    checks: input.checks,
    reviewer: input.reviewer.trim(),
    reason: input.reason.trim(),
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    autoPublish: false,
  };
}

function assertHandoff(value: GoogleFlowHandoff): void {
  const uniqueJobIds = Array.isArray(value?.jobs) ? new Set(value.jobs.map((job) => job.id)) : new Set<string>();
  if (
    value?.schemaVersion !== 2 || value.provider !== 'google-flow-web' || value.apiBillingAllowed !== false ||
    value.autoPublish !== false || !SAFE_ID.test(value.batchId) || !SHA256.test(value.sourcePlanSha256) ||
    !verifyGoogleFlowHandoffDigest(value) || !Array.isArray(value.jobs) || !value.jobs.length || value.jobs.length > 100 ||
    uniqueJobIds.size !== value.jobs.length || value.estimatedCredits !== value.jobs.reduce((total, job) => total + job.estimatedCredits, 0) ||
    value.jobs.some((job) =>
      !SAFE_ID.test(job.id) || !SHA256.test(job.source.sha256) ||
      !['hero', 'b-roll', 'transition'].includes(job.role) || job.status !== 'awaiting-flow-generation' ||
      job.settings.audio !== 'ambient-only' || job.settings.lipSync !== false ||
      !Array.isArray(job.consumerShortIds) || !job.consumerShortIds.length ||
      job.consumerShortIds.some((shortId) => !SAFE_ID.test(shortId)) ||
      !Array.isArray(job.consumers) || !job.consumers.length || job.consumers.some((consumer) =>
        !SAFE_ID.test(consumer.shortId) || !job.consumerShortIds.includes(consumer.shortId) ||
        !Number.isInteger(consumer.shotIndex) || consumer.shotIndex < 1))
  ) throw new Error('Flow handoff is invalid, modified or unsafe');
}

function assertHandoffBytes(handoff: GoogleFlowHandoff, bytes: Uint8Array): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new Error('Flow handoff bytes are not valid JSON');
  }
  if (canonicalJson(parsed) !== canonicalJson(handoff)) {
    throw new Error('Flow handoff bytes do not match the supplied handoff');
  }
}

async function assertExactResultSet(root: string, expectedNames: string[]): Promise<void> {
  const actual = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith('.mp4'))
    .sort();
  const expected = [...expectedNames].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('Flow results directory must contain exactly one MP4 for every handoff job');
  }
}

async function createConfinedBatchDirectory(outputRoot: string, batchId: string): Promise<string> {
  const batchDirectory = path.join(outputRoot, batchId);
  try {
    await mkdir(batchDirectory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const existing = await lstat(batchDirectory);
  if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('Flow import batch destination is unsafe');
  const canonical = await realpath(batchDirectory);
  if (!isWithin(canonical, outputRoot)) throw new Error('Flow import destination escapes its output root');
  return canonical;
}

async function installImmutableFile(temporary: string, destination: string, expectedSha256: string): Promise<void> {
  try {
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readRegularNoFollow(destination, 'Existing Flow import');
    if (digest(existing) !== expectedSha256) throw new Error('Existing Flow import has different bytes');
  }
}

async function writeImmutableJson(filename: string, value: unknown): Promise<void> {
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await link(temporary, filename);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function confinedRoot(value: string, create: boolean): Promise<string> {
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error('Flow import root must be absolute');
  if (create) await mkdir(value, { recursive: true, mode: 0o700 });
  const lexical = await lstat(value);
  if (lexical.isSymbolicLink() || !lexical.isDirectory()) throw new Error('Flow import root must be a regular directory');
  const canonical = await realpath(value);
  if (!(await stat(canonical)).isDirectory()) throw new Error('Flow import root is invalid');
  return canonical;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function readRegularNoFollow(filename: string, label: string): Promise<Buffer> {
  const handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > MAX_VIDEO_BYTES) {
      throw new Error(`${label} must be a regular file smaller than 1 GiB`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function hasMp4Signature(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertExpectedProbe(
  id: string,
  probe: GoogleFlowResultProbe,
  aspectRatio: '9:16' | '16:9',
  durationSeconds: number,
  requirements: {
    minWidth?: number;
    minHeight?: number;
    requireAudio?: boolean;
    requireSilent?: boolean;
  },
): void {
  const targetRatio = aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
  const actualRatio = probe.width / probe.height;
  if (
    !probe.hasVideo || !Number.isFinite(probe.durationSeconds) ||
    !Number.isInteger(probe.width) || !Number.isInteger(probe.height) ||
    probe.width < (requirements.minWidth ?? 480) || probe.height < (requirements.minHeight ?? 480) ||
    Math.abs(actualRatio - targetRatio) > 0.01 ||
    Math.abs(probe.durationSeconds - durationSeconds) > 0.75 ||
    (requirements.requireSilent && probe.hasAudio) ||
    (requirements.requireAudio && (
      !probe.hasAudio || !probe.audioCodec || !Number.isInteger(probe.audioChannels) ||
      probe.audioChannels! <= 0 || !Number.isInteger(probe.audioSampleRate) || probe.audioSampleRate! <= 0
    ))
  ) throw new Error(`Flow result ${id} failed video, duration, aspect-ratio, resolution or audio validation`);
}

function assertImportOptions(minWidth: number | undefined, minHeight: number | undefined): void {
  if (
    (minWidth === undefined) !== (minHeight === undefined) ||
    (minWidth !== undefined && (!Number.isInteger(minWidth) || minWidth < 1)) ||
    (minHeight !== undefined && (!Number.isInteger(minHeight) || minHeight < 1))
  ) throw new Error('Flow import minimum resolution requires positive integer minWidth and minHeight');
}

export function buildNormalizeFlowResultArgs(
  source: string,
  destination: string,
  preserveAudio = false,
): string[] {
  if (!preserveAudio) {
    return [
      '-v', 'error', '-n', '-i', source, '-map', '0:v:0', '-an', '-c:v', 'copy',
      '-movflags', '+faststart', destination,
    ];
  }
  return [
    '-v', 'error', '-n', '-i', source, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', destination,
  ];
}

async function normalizeFlowResult(
  source: string,
  destination: string,
  options: { preserveAudio: boolean },
): Promise<void> {
  await execFile('ffmpeg', buildNormalizeFlowResultArgs(source, destination, options.preserveAudio), {
    timeout: 5 * 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function probeFlowResult(filename: string): Promise<GoogleFlowResultProbe> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error', '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height,channels,sample_rate', '-of', 'json', filename,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  return {
    durationSeconds: Number(parsed.format?.duration),
    width: Number(video?.width),
    height: Number(video?.height),
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    videoCodec: typeof video?.codec_name === 'string' ? video.codec_name : undefined,
    audioCodec: typeof audio?.codec_name === 'string' ? audio.codec_name : undefined,
    audioChannels: audio ? Number(audio.channels) : undefined,
    audioSampleRate: audio ? Number(audio.sample_rate) : undefined,
  };
}
