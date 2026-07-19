/** Technical, human-review and private-bundle gates for YouTube masters. */

import { execFile as realExecFile } from 'child_process';
import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { canonicalSha256 } from './google-flow-handoff.js';

const execFile = promisify(realExecFile);
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

export interface YouTubeMasterProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
}

export interface YouTubeMasterSignalAnalysis {
  meanVolumeDb: number | null;
  maxVolumeDb: number | null;
  blackSeconds: number;
}

export interface YouTubeTechnicalReport {
  schemaVersion: 2;
  status: 'technical-approved';
  videoFile: string;
  sidecarFile: string;
  captionFile: string;
  videoSha256: string;
  sidecarSha256: string;
  captionSha256: string;
  sourceClips: Array<{ file: string; sha256: string }>;
  checkedAt: string;
  probe: YouTubeMasterProbe;
  signal: YouTubeMasterSignalAnalysis;
  autoPublish: false;
}

export interface YouTubeHumanReviewChecks {
  voice: boolean;
  lipSync: boolean;
  identity: boolean;
  anatomy: boolean;
  captions: boolean;
  disclosure: boolean;
  editorial: boolean;
}

export interface YouTubeHumanReviewReceipt {
  schemaVersion: 1;
  status: 'ready-for-private-upload';
  videoSha256: string;
  sidecarSha256: string;
  captionSha256: string;
  technicalReportSha256: string;
  reviewer: string;
  reason: string;
  checks: YouTubeHumanReviewChecks;
  reviewedAt: string;
  visibility: 'private';
  autoPublish: false;
}

export interface YouTubeChangesRequestedReceipt {
  schemaVersion: 1;
  status: 'changes-requested';
  videoSha256: string;
  sidecarSha256: string;
  captionSha256: string;
  technicalReportSha256: string;
  reviewer: string;
  reason: string;
  checks: YouTubeHumanReviewChecks;
  reviewedAt: string;
  visibility: 'blocked';
  autoPublish: false;
}

export interface YouTubePrivateBundleManifest {
  schemaVersion: 1;
  status: 'ready-for-private-upload';
  visibility: 'private';
  autoPublish: false;
  videoSha256: string;
  technicalReportSha256: string;
  humanReviewSha256: string;
  createdAt: string;
  files: Array<{ role: 'video' | 'captions' | 'youtube-sidecar' | 'technical-report' | 'human-review'; file: string; sha256: string }>;
  bundleSha256: string;
}

export async function validateYouTubeMasterBundle(input: {
  videoPath: string;
  sidecarPath?: string;
  probe?: (filename: string) => Promise<YouTubeMasterProbe>;
  analyze?: (filename: string) => Promise<YouTubeMasterSignalAnalysis>;
  now?: () => Date;
}): Promise<YouTubeTechnicalReport> {
  const videoPath = await regularFile(input.videoPath, 'YouTube master');
  const videoDirectory = path.dirname(videoPath);
  const sidecarPath = await regularFile(input.sidecarPath ?? `${videoPath}.youtube.json`, 'YouTube sidecar');
  if (path.dirname(sidecarPath) !== videoDirectory) throw new Error('YouTube sidecar must be beside its master');
  const sidecar = JSON.parse((await readRegularNoFollow(sidecarPath, 'YouTube sidecar')).toString('utf8')) as Record<string, unknown>;
  const video = sidecar.video as Record<string, unknown> | undefined;
  const captions = sidecar.captionTracks;
  const youtube = sidecar.youtube as Record<string, unknown> | undefined;
  const status = youtube?.status as Record<string, unknown> | undefined;
  const snippet = youtube?.snippet as Record<string, unknown> | undefined;
  const rights = sidecar.narrationRights as Record<string, unknown> | undefined;
  const sourceClips = sidecar.sourceClips;
  if (
    sidecar.schemaVersion !== 2 || sidecar.autoPublish !== false || sidecar.humanReviewRequired !== true ||
    sidecar.containsSyntheticMedia !== true || !video || video.file !== path.basename(videoPath) ||
    !Array.isArray(captions) || captions.length !== 1 || status?.privacyStatus !== 'private' ||
    status.selfDeclaredMadeForKids !== false || typeof snippet?.title !== 'string' || snippet.title.trim().length < 8 ||
    typeof snippet.description !== 'string' || snippet.description.trim().length < 30 ||
    rights?.commercialUseApproved !== true || typeof rights.provenanceRef !== 'string' || !rights.provenanceRef.trim() ||
    typeof rights.profileRevision !== 'string' || !SHA256.test(rights.profileRevision) ||
    !Array.isArray(sourceClips) || sourceClips.length !== 3
  ) throw new Error('YouTube sidecar contract, rights or private-publication gate is incomplete or unsafe');
  const validatedSourceClips = sourceClips.map((item, index) => {
    const clip = item as Record<string, unknown>;
    if (typeof clip.file !== 'string' || !SAFE_FILE.test(clip.file) || typeof clip.sha256 !== 'string' || !SHA256.test(clip.sha256)) {
      throw new Error(`YouTube source clip ${index + 1} is incomplete`);
    }
    return { file: clip.file, sha256: clip.sha256 };
  });
  if (new Set(validatedSourceClips.map((clip) => clip.file)).size !== 3) throw new Error('YouTube source clips must be distinct');

  const videoSha256 = await sha256NoFollow(videoPath, 'YouTube master');
  if (video.sha256 !== videoSha256) throw new Error('YouTube master digest does not match its sidecar');
  const caption = captions[0] as Record<string, unknown>;
  if (typeof caption.file !== 'string' || !SAFE_FILE.test(caption.file)) throw new Error('Caption path is invalid');
  const captionPath = await regularFile(path.join(videoDirectory, caption.file), 'WebVTT caption');
  if (path.dirname(captionPath) !== videoDirectory) throw new Error('WebVTT caption must be beside its master');
  const captionSha256 = await sha256NoFollow(captionPath, 'WebVTT caption');
  if (caption.sha256 !== captionSha256) throw new Error('Caption digest does not match its sidecar');
  validateWebVtt((await readRegularNoFollow(captionPath, 'WebVTT caption')).toString('utf8'), Number(video.durationMs));

  const [probe, signal] = await Promise.all([
    (input.probe ?? probeMaster)(videoPath),
    (input.analyze ?? analyzeMasterSignals)(videoPath),
  ]);
  const blackRatio = probe.duration > 0 ? signal.blackSeconds / probe.duration : 1;
  if (
    probe.width !== 720 || probe.height !== 1280 || Math.abs(probe.fps - 30) > 0.05 ||
    probe.duration < 6 || probe.duration > 15 || !probe.hasAudio ||
    !['h264', 'hevc'].includes(probe.videoCodec) || !['aac', 'opus'].includes(probe.audioCodec) ||
    Math.abs(probe.duration * 1_000 - Number(video.durationMs)) > 250 ||
    signal.meanVolumeDb === null || signal.meanVolumeDb <= -60 || signal.maxVolumeDb === null ||
    signal.maxVolumeDb > 0 || !Number.isFinite(signal.blackSeconds) || signal.blackSeconds < 0 || blackRatio > 0.15
  ) throw new Error('YouTube master failed resolution, duration, FPS, codec, audio or black-frame checks');
  return {
    schemaVersion: 2,
    status: 'technical-approved',
    videoFile: path.basename(videoPath),
    sidecarFile: path.basename(sidecarPath),
    captionFile: path.basename(captionPath),
    videoSha256,
    sidecarSha256: await sha256NoFollow(sidecarPath, 'YouTube sidecar'),
    captionSha256,
    sourceClips: validatedSourceClips,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    probe,
    signal,
    autoPublish: false,
  };
}

export async function reviewYouTubeMaster(input: {
  report: YouTubeTechnicalReport;
  expectedVideoSha256: string;
  reviewer: string;
  reason: string;
  checks: YouTubeHumanReviewChecks;
  now?: () => Date;
}): Promise<YouTubeHumanReviewReceipt> {
  if (
    input.report.schemaVersion !== 2 || input.report.status !== 'technical-approved' ||
    !SHA256.test(input.expectedVideoSha256) || input.report.videoSha256 !== input.expectedVideoSha256
  ) throw new Error('Human review must target the current technically approved master digest');
  if (Object.values(input.checks).some((passed) => passed !== true)) throw new Error('Every human review check must pass');
  if (input.reviewer.trim().length < 2 || input.reason.trim().length < 3) throw new Error('Reviewer and reason are required');
  return {
    schemaVersion: 1,
    status: 'ready-for-private-upload',
    videoSha256: input.report.videoSha256,
    sidecarSha256: input.report.sidecarSha256,
    captionSha256: input.report.captionSha256,
    technicalReportSha256: canonicalSha256(input.report),
    reviewer: input.reviewer.trim(),
    reason: input.reason.trim(),
    checks: input.checks,
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    visibility: 'private',
    autoPublish: false,
  };
}

/** Record a digest-bound negative visual review. This receipt can never authorize an upload bundle. */
export async function requestYouTubeMasterChanges(input: {
  report: YouTubeTechnicalReport;
  expectedVideoSha256: string;
  reviewer: string;
  reason: string;
  checks: YouTubeHumanReviewChecks;
  now?: () => Date;
}): Promise<YouTubeChangesRequestedReceipt> {
  if (
    input.report.schemaVersion !== 2 || input.report.status !== 'technical-approved' ||
    !SHA256.test(input.expectedVideoSha256) || input.report.videoSha256 !== input.expectedVideoSha256
  ) throw new Error('Change request must target the current technically approved master digest');
  if (Object.values(input.checks).some((passed) => typeof passed !== 'boolean')) {
    throw new Error('Every human review check must be recorded as true or false');
  }
  if (Object.values(input.checks).every((passed) => passed)) {
    throw new Error('A change request must identify at least one failed human review check');
  }
  if (input.reviewer.trim().length < 2 || input.reason.trim().length < 3) {
    throw new Error('Reviewer and reason are required');
  }
  return {
    schemaVersion: 1,
    status: 'changes-requested',
    videoSha256: input.report.videoSha256,
    sidecarSha256: input.report.sidecarSha256,
    captionSha256: input.report.captionSha256,
    technicalReportSha256: canonicalSha256(input.report),
    reviewer: input.reviewer.trim(),
    reason: input.reason.trim(),
    checks: input.checks,
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    visibility: 'blocked',
    autoPublish: false,
  };
}

/** Create a local immutable handoff. This function never calls YouTube or changes visibility. */
export async function createPrivateYouTubeBundle(input: {
  videoPath: string;
  report: YouTubeTechnicalReport;
  review: YouTubeHumanReviewReceipt;
  outputRoot: string;
  probe?: (filename: string) => Promise<YouTubeMasterProbe>;
  analyze?: (filename: string) => Promise<YouTubeMasterSignalAnalysis>;
  now?: () => Date;
}): Promise<{ directory: string; manifest: YouTubePrivateBundleManifest }> {
  if (
    input.report.schemaVersion !== 2 || input.report.status !== 'technical-approved' ||
    input.review.schemaVersion !== 1 || input.review.status !== 'ready-for-private-upload' ||
    input.review.visibility !== 'private' || input.review.autoPublish !== false ||
    input.review.videoSha256 !== input.report.videoSha256 || input.review.sidecarSha256 !== input.report.sidecarSha256 ||
    input.review.captionSha256 !== input.report.captionSha256 ||
    input.review.technicalReportSha256 !== canonicalSha256(input.report) ||
    Object.values(input.review.checks).some((passed) => passed !== true) ||
    input.review.reviewer.trim().length < 2 || input.review.reason.trim().length < 3
  ) throw new Error('Private bundle requires matching technical and human-review receipts');
  const videoPath = await regularFile(input.videoPath, 'YouTube master');
  const directory = path.dirname(videoPath);
  const sidecarPath = await regularFile(path.join(directory, input.report.sidecarFile), 'YouTube sidecar');
  const captionPath = await regularFile(path.join(directory, input.report.captionFile), 'WebVTT caption');
  const freshReport = await validateYouTubeMasterBundle({
    videoPath,
    sidecarPath,
    ...(input.probe ? { probe: input.probe } : {}),
    ...(input.analyze ? { analyze: input.analyze } : {}),
  });
  const current = await Promise.all([
    sha256NoFollow(videoPath, 'YouTube master'),
    sha256NoFollow(sidecarPath, 'YouTube sidecar'),
    sha256NoFollow(captionPath, 'WebVTT caption'),
  ]);
  if (
    current[0] !== input.report.videoSha256 || current[1] !== input.report.sidecarSha256 ||
    current[2] !== input.report.captionSha256 || freshReport.videoSha256 !== input.report.videoSha256 ||
    freshReport.sidecarSha256 !== input.report.sidecarSha256 || freshReport.captionSha256 !== input.report.captionSha256
  ) throw new Error('A reviewed YouTube bundle file changed after approval');

  const outputRoot = await confinedOutputRoot(input.outputRoot);
  const bundleName = `private-${input.report.videoSha256.slice(0, 20)}`;
  const destination = path.join(outputRoot, bundleName);
  const temporary = path.join(outputRoot, `.${bundleName}-${process.pid}-${Date.now()}.tmp`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    const fileInputs = [
      { role: 'video' as const, source: videoPath, file: input.report.videoFile, sha256: input.report.videoSha256 },
      { role: 'captions' as const, source: captionPath, file: input.report.captionFile, sha256: input.report.captionSha256 },
      { role: 'youtube-sidecar' as const, source: sidecarPath, file: input.report.sidecarFile, sha256: input.report.sidecarSha256 },
    ];
    for (const item of fileInputs) {
      await copyFile(item.source, path.join(temporary, item.file), fsConstants.COPYFILE_EXCL);
      if (await sha256NoFollow(path.join(temporary, item.file), `Bundled ${item.role}`) !== item.sha256) {
        throw new Error(`Bundled ${item.role} changed while it was copied`);
      }
    }
    const technicalBytes = Buffer.from(`${JSON.stringify(input.report, null, 2)}\n`);
    const reviewBytes = Buffer.from(`${JSON.stringify(input.review, null, 2)}\n`);
    await Promise.all([
      writeFile(path.join(temporary, 'technical-report.json'), technicalBytes, { flag: 'wx', mode: 0o600 }),
      writeFile(path.join(temporary, 'human-review.json'), reviewBytes, { flag: 'wx', mode: 0o600 }),
    ]);
    const unsigned = {
      schemaVersion: 1 as const,
      status: 'ready-for-private-upload' as const,
      visibility: 'private' as const,
      autoPublish: false as const,
      videoSha256: input.report.videoSha256,
      technicalReportSha256: input.review.technicalReportSha256,
      humanReviewSha256: createHash('sha256').update(reviewBytes).digest('hex'),
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
      files: [
        ...fileInputs.map(({ role, file, sha256 }) => ({ role, file, sha256 })),
        {
          role: 'technical-report' as const,
          file: 'technical-report.json',
          sha256: createHash('sha256').update(technicalBytes).digest('hex'),
        },
        {
          role: 'human-review' as const,
          file: 'human-review.json',
          sha256: createHash('sha256').update(reviewBytes).digest('hex'),
        },
      ],
    };
    const manifest: YouTubePrivateBundleManifest = { ...unsigned, bundleSha256: canonicalSha256(unsigned) };
    await writeFile(path.join(temporary, 'bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
    return { directory: destination, manifest };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function probeMaster(filename: string): Promise<YouTubeMasterProbe> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json', filename,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  const [rawNumerator = 0, rawDenominator = 1] = String(video?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: Number(parsed.format?.duration),
    width: Number(video?.width),
    height: Number(video?.height),
    fps: rawDenominator ? rawNumerator / rawDenominator : 0,
    videoCodec: String(video?.codec_name ?? ''),
    audioCodec: String(audio?.codec_name ?? ''),
    hasAudio: Boolean(audio),
  };
}

async function analyzeMasterSignals(filename: string): Promise<YouTubeMasterSignalAnalysis> {
  const { stderr } = await execFile('ffmpeg', [
    '-hide_banner', '-nostats', '-i', filename,
    '-vf', 'blackdetect=d=0.1:pic_th=0.98', '-af', 'volumedetect', '-f', 'null', '-',
  ], { timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  const mean = stderr.match(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/iu)?.[1];
  const max = stderr.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/iu)?.[1];
  const blackSeconds = [...stderr.matchAll(/black_duration:([0-9]+(?:\.[0-9]+)?)/gu)]
    .reduce((total, match) => total + Number(match[1]), 0);
  return {
    meanVolumeDb: mean && mean.toLowerCase() !== '-inf' ? Number(mean) : null,
    maxVolumeDb: max && max.toLowerCase() !== '-inf' ? Number(max) : null,
    blackSeconds,
  };
}

function validateWebVtt(value: string, durationMs: number): void {
  if (!value.startsWith('WEBVTT') || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('WebVTT header or duration is invalid');
  }
  const cuePattern = /(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/gu;
  let count = 0;
  let previousEnd = 0;
  for (const match of value.matchAll(cuePattern)) {
    const start = timestampMs(match[1]!);
    const end = timestampMs(match[2]!);
    if (start < previousEnd || end <= start || end > durationMs) throw new Error('WebVTT cues are unordered or outside the master');
    previousEnd = end;
    count += 1;
  }
  if (!count) throw new Error('WebVTT contains no valid cue');
}

function timestampMs(value: string): number {
  const [hours, minutes, seconds] = value.split(':');
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000;
}

async function regularFile(filename: string, label: string): Promise<string> {
  if (!path.isAbsolute(filename) || filename.includes('\0')) throw new Error(`${label} path must be absolute`);
  const info = await lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular non-symlink file`);
  return realpath(filename);
}

async function readRegularNoFollow(filename: string, label: string): Promise<Buffer> {
  const handle = await open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0) throw new Error(`${label} must be a non-empty regular file`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function sha256NoFollow(filename: string, label: string): Promise<string> {
  return createHash('sha256').update(await readRegularNoFollow(filename, label)).digest('hex');
}

async function confinedOutputRoot(value: string): Promise<string> {
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error('Private bundle output root must be absolute');
  await mkdir(value, { recursive: true, mode: 0o700 });
  const info = await lstat(value);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Private bundle output root must be a regular directory');
  return realpath(value);
}
