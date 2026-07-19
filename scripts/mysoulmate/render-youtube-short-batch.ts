#!/usr/bin/env npx tsx

/**
 * Resumable MySoulmate Short renderer.
 *
 * Default mode is read-only planning. `--execute` is required before the
 * script synthesizes audio, stages files on Darkstar, submits LongCat jobs or
 * writes a final film.
 */

import { execFile as realExecFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

import { GpuMediaWorkerClient, type GpuMediaJobView } from '../../src/tools/gpu-media-worker.js';
import { assembleFilm, computeCrossfadedDuration } from '../../src/tools/video/film-assemble.js';
import {
  synthesizeLocalizedNarration,
  synthesizeNarration,
  type ResolvedVoiceProfile,
} from '../../src/tools/video/narration.js';
import { loadApprovedImageSource } from '../../src/tools/video/approved-media-source.js';
import {
  assessAudioFit,
  buildWebVtt,
  canonicalizeLocale,
  localePathSlug,
  renderCacheKey,
} from '../../src/tools/video/localized-media.js';
import {
  loadVoiceRightsRegistry,
  voiceProfileRevision,
} from '../../src/tools/video/voice-rights-registry.js';
import { validateYouTubeMasterBundle } from '../../src/tools/video/youtube-master-quality.js';
import * as editorialQualityModule from '../../cowork/src/shared/editorial-quality.ts';
import type { EditorialQualityReport } from '../../cowork/src/shared/editorial-quality.ts';

const assessEditorialQuality = (
  editorialQualityModule as typeof editorialQualityModule & {
    default?: typeof editorialQualityModule;
  }
).assessEditorialQuality ?? (
  editorialQualityModule as typeof editorialQualityModule & {
    default?: typeof editorialQualityModule;
  }
).default?.assessEditorialQuality;

const execFile = promisify(realExecFile);
const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,125}[a-z0-9])?$/u;
const TRANSITION_SECONDS = 0.5;

interface RenderJobJournal {
  schemaVersion: 1;
  shortId: string;
  shotIndex: number;
  cacheKey: string;
  workerRevision: string;
  jobId: string;
  status: GpuMediaJobView['status'];
  requestHash?: string;
  attempt?: number;
  retryOf?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  updatedAt: string;
}

export interface LongCatClipProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
}

interface RenderedClipReceipt {
  file: string;
  sha256: string;
  durationMs: number;
  jobId: string;
  requestHash: string;
  runnerRevision: string;
  attempt: number;
  retryOf?: string;
  completedAt?: string;
  output: Record<string, unknown>;
}

export interface PlannedShot {
  index: number;
  assetId: string;
  sourceSha256: string;
  referenceImagePath: string;
  contentTier: 'safe';
  qaStatus: 'approved';
  voiceLine: string;
  motionPrompt: string;
  longCatPayload: {
    turnId: string;
    prompt: string;
    resolution: '480p';
  };
}

export interface PlannedShort {
  shortId: string;
  contentGroupId?: string;
  locale?: string;
  editorial: {
    title: string;
    description: string;
    translationStatus?: 'source' | 'approved';
  };
  narration?: {
    locale: string;
    voiceProfileId: string;
    ttsLanguage: string;
    fitPolicy: {
      leadInMs: number;
      tailOutMs: number;
      maxSpeedup: number;
      overflow: 'reject';
    };
  };
  delivery?: {
    mode: 'localized-lipsync-masters';
    visualSpeechMode: 'localized-lipsync';
  };
  render: {
    engine: 'LongCat-Video-Avatar-1.5';
    clipDurationSeconds: number;
    shots: PlannedShot[];
  };
  publication: {
    visibility: 'private';
    autoPublish: false;
    madeForKids: false;
    containsSyntheticMedia: true;
    reviewStatus: 'pending-human-review';
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
  };
  rights?: {
    voiceProfileId?: string;
    validation?: 'registry-required';
  };
}

export interface ShortPlan {
  schemaVersion: 3;
  sourceDigests: {
    imageManifestSha256: string;
    imageCatalogSha256: string;
    factoryConfigSha256: string;
    assetApprovalsSha256: string;
    productionLedgerSha256: string;
  };
  policy: {
    contentTier: 'safe';
    qaStatus: 'approved';
    autoPublish: false;
    initialVisibility: 'private';
    syntheticMediaDisclosureRequired: true;
  };
  shorts: PlannedShort[];
}

function argument(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function unquote(value: string): string {
  const trimmed = value.trim().replace(/^\uFEFF/u, '');
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvironmentFile(filename: string): Promise<Record<string, string>> {
  try {
    const entries: Record<string, string> = {};
    for (const rawLine of (await fs.readFile(filename, 'utf8')).split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      entries[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1));
    }
    return entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function loadVoiceRegistry(filename: string): Promise<Map<string, ResolvedVoiceProfile>> {
  try {
    return await loadVoiceRightsRegistry(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `Voice rights registry not found: ${filename}. ` +
          'Review docs/specs/voice/voice-rights-registry.example.json before enabling a commercial profile.',
      );
    }
    throw error;
  }
}

export function assertPlan(plan: unknown): asserts plan is ShortPlan {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Plan must be an object');
  const value = plan as Partial<ShortPlan>;
  if (
    value.schemaVersion !== 3 ||
    !value.sourceDigests ||
    ![
      value.sourceDigests.imageManifestSha256,
      value.sourceDigests.imageCatalogSha256,
      value.sourceDigests.factoryConfigSha256,
      value.sourceDigests.assetApprovalsSha256,
      value.sourceDigests.productionLedgerSha256,
    ].every((digest) => /^[a-f0-9]{64}$/u.test(digest)) ||
    value.policy?.contentTier !== 'safe' ||
    value.policy.qaStatus !== 'approved' ||
    value.policy.autoPublish !== false ||
    value.policy.initialVisibility !== 'private' ||
    value.policy.syntheticMediaDisclosureRequired !== true
  ) {
    throw new Error('Plan policy is not safe, QA-approved, private and disclosed');
  }
  if (!Array.isArray(value.shorts)) throw new Error('Plan shorts must be an array');
  const shortIds = new Set<string>();
  const turnIds = new Set<string>();
  for (const short of value.shorts) {
    if (!SAFE_ID.test(short.shortId)) throw new Error(`Unsafe short ID: ${short.shortId}`);
    if (shortIds.has(short.shortId)) throw new Error(`Duplicate short ID: ${short.shortId}`);
    shortIds.add(short.shortId);
    if (
      short.render?.engine !== 'LongCat-Video-Avatar-1.5' ||
      !Array.isArray(short.render.shots) ||
      short.render.shots.length !== 3
    ) {
      throw new Error(`${short.shortId} must contain exactly three LongCat clips`);
    }
    if (
      short.publication?.visibility !== 'private' ||
      short.publication.autoPublish !== false ||
      short.publication.madeForKids !== false ||
      short.publication.containsSyntheticMedia !== true ||
      short.publication.reviewStatus !== 'pending-human-review'
    ) {
      throw new Error(`${short.shortId} publication gate is unsafe`);
    }
    const locale = canonicalizeLocale(short.locale ?? '');
    if (
      short.narration?.locale !== locale ||
      !short.narration.voiceProfileId?.trim() ||
      short.narration.fitPolicy?.overflow !== 'reject' ||
      !Number.isFinite(short.narration.fitPolicy.leadInMs) ||
      short.narration.fitPolicy.leadInMs < 0 ||
      short.narration.fitPolicy.leadInMs > 2_000 ||
      !Number.isFinite(short.narration.fitPolicy.tailOutMs) ||
      short.narration.fitPolicy.tailOutMs < 0 ||
      short.narration.fitPolicy.tailOutMs > 2_000 ||
      !Number.isFinite(short.narration.fitPolicy.maxSpeedup) ||
      short.narration.fitPolicy.maxSpeedup < 1 ||
      short.narration.fitPolicy.maxSpeedup > 1.25 ||
      short.delivery?.mode !== 'localized-lipsync-masters' ||
      short.delivery.visualSpeechMode !== 'localized-lipsync' ||
      short.publication.defaultLanguage !== locale ||
      short.publication.defaultAudioLanguage !== locale ||
      short.rights?.voiceProfileId !== short.narration.voiceProfileId ||
      short.rights?.validation !== 'registry-required' ||
      !['source', 'approved'].includes(short.editorial.translationStatus ?? '')
    ) {
      throw new Error(`${short.shortId} has an incomplete localized narration or rights contract`);
    }
    if (!Number.isFinite(short.render.clipDurationSeconds) || short.render.clipDurationSeconds <= 0) {
      throw new Error(`${short.shortId} has an invalid clip duration`);
    }
    if (Math.abs(short.render.clipDurationSeconds - 3.72) > 0.001) {
      throw new Error(`${short.shortId} clip duration must match the current LongCat 3.72-second contract`);
    }
    for (const [shotOffset, shot] of short.render.shots.entries()) {
      if (
        shot.index !== shotOffset + 1 ||
        shot.contentTier !== 'safe' ||
        shot.qaStatus !== 'approved' ||
        !path.isAbsolute(shot.referenceImagePath) ||
        !/^[a-f0-9]{64}$/u.test(shot.sourceSha256 ?? '') ||
        !shot.voiceLine?.trim() ||
        !/^[A-Za-z0-9._:-]{1,90}$/u.test(shot.longCatPayload?.turnId ?? '') ||
        turnIds.has(shot.longCatPayload.turnId) ||
        shot.longCatPayload?.resolution !== '480p'
      ) {
        throw new Error(`${short.shortId} contains an unsafe or incomplete shot`);
      }
      turnIds.add(shot.longCatPayload.turnId);
    }
  }
}

export function assessPlannedShort(
  planned: PlannedShort,
  allShorts: PlannedShort[],
): EditorialQualityReport {
  const prompt = planned.render.shots.map((shot) => `${shot.motionPrompt} ${shot.voiceLine}`).join('\n');
  const duration = computeCrossfadedDuration(
    planned.render.shots.map(() => planned.render.clipDurationSeconds),
    planned.render.shots.slice(1).map(() => TRANSITION_SECONDS),
  );
  return assessEditorialQuality({
    publication: true,
    title: planned.editorial.title,
    description: planned.editorial.description,
    prompt,
    aspect: '9:16',
    duration,
    syntheticMediaDisclosure: planned.publication.containsSyntheticMedia,
    selectedAssets: planned.render.shots.map((shot) => ({
      kind: 'character',
      companionId: shot.assetId,
      contentTier: shot.contentTier,
      qaStatus: shot.qaStatus,
    })),
    scenes: planned.render.shots.map((shot) => ({ prompt: shot.motionPrompt, status: 'done', mediaType: 'video' })),
    previousPrompts: allShorts.filter((candidate) => candidate.shortId !== planned.shortId)
      .map((candidate) => candidate.render.shots.map((shot) => `${shot.motionPrompt} ${shot.voiceLine}`).join('\n')),
  });
}

export { voiceProfileRevision };

export function assertVoiceProfiles(
  shorts: readonly PlannedShort[],
  profiles: ReadonlyMap<string, ResolvedVoiceProfile>,
): void {
  for (const planned of shorts) {
    if (!planned.narration) continue;
    const profile = profiles.get(planned.narration.voiceProfileId);
    if (!profile) throw new Error(`Voice profile ${planned.narration.voiceProfileId} is missing`);
    if (
      canonicalizeLocale(profile.locale) !== canonicalizeLocale(planned.narration.locale) ||
      (profile.provider === 'pocket' && profile.language.toLowerCase() !== planned.narration.ttsLanguage.toLowerCase()) ||
      profile.id !== planned.rights?.voiceProfileId ||
      !profile.commercialUseApproved || planned.rights.validation !== 'registry-required'
    ) {
      throw new Error(`Voice profile ${profile.id} does not match the planned locale and rights provenance`);
    }
  }
}

async function sha256(filename: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}

export async function verifiedAudioDigest(
  audioPath: string,
  digestPath = `${audioPath}.sha256`,
): Promise<string | null> {
  try {
    const [audioInfo, digestInfo, recordedDigest] = await Promise.all([
      fs.lstat(audioPath),
      fs.lstat(digestPath),
      fs.readFile(digestPath, 'utf8'),
    ]);
    const expected = recordedDigest.trim();
    if (
      audioInfo.isSymbolicLink() || !audioInfo.isFile() || audioInfo.size <= 1_024 ||
      audioInfo.size > 512 * 1024 * 1024 || digestInfo.isSymbolicLink() || !digestInfo.isFile() ||
      !/^[a-f0-9]{64}$/u.test(expected)
    ) {
      return null;
    }
    return await sha256(audioPath) === expected ? expected : null;
  } catch {
    return null;
  }
}

export function narrationTurnId(
  baseTurnId: string,
  localeSlug: string,
  cacheKey: string,
  audioSha256: string,
): string {
  const identity = createHash('sha256')
    .update(JSON.stringify({ baseTurnId, localeSlug, cacheKey, audioSha256 }))
    .digest('hex')
    .slice(0, 16);
  const maximumPrefixLength = 128 - localeSlug.length - identity.length - 2;
  return `${baseTurnId.slice(0, maximumPrefixLength)}-${localeSlug}-${identity}`;
}

async function normalizeAudio(
  source: string,
  destination: string,
  duration: number,
  narrationDuration: number,
  fitPolicy: NonNullable<PlannedShort['narration']>['fitPolicy'],
): Promise<void> {
  const fit = assessAudioFit(Math.round(narrationDuration * 1_000), {
    slotDurationMs: Math.round(duration * 1_000),
    leadInMs: fitPolicy.leadInMs,
    tailOutMs: fitPolicy.tailOutMs,
    maxSpeedup: fitPolicy.maxSpeedup,
    toleranceMs: 20,
  });
  if (fit.status === 'overflow') {
    throw new Error(
      `Narration is too long for the ${duration.toFixed(2)}s clip ` +
        `(requires ${fit.requiredRate.toFixed(3)}x; maximum is ${fitPolicy.maxSpeedup.toFixed(3)}x)`,
    );
  }
  const speed = fit.status === 'speedup' ? `atempo=${fit.playbackRate},` : '';
  await execFile('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    source,
    '-af',
    `${speed}adelay=${fitPolicy.leadInMs}:all=1,apad=pad_dur=${duration},atrim=duration=${duration}`,
    '-ar',
    '16000',
    '-ac',
    '1',
    destination,
  ]);
}

async function waitForJob(
  client: GpuMediaWorkerClient,
  job: GpuMediaJobView,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GpuMediaJobView> {
  let current = job;
  const deadline = Date.now() + timeoutMs;
  while (current.status === 'queued' || current.status === 'running') {
    if (signal?.aborted) {
      await client.cancel(current.id).catch(() => undefined);
      throw new Error(`LongCat job ${current.id} cancelled after an interruption signal`);
    }
    if (Date.now() >= deadline) {
      await client.cancel(current.id).catch(() => undefined);
      throw new Error(`LongCat job ${current.id} exceeded its ${Math.round(timeoutMs / 60_000)}-minute deadline`);
    }
    process.stdout.write(
      `[${current.id}] ${current.status} ${Math.round((current.progress ?? 0) * 100)}% ${current.progressMessage ?? ''}\n`,
    );
    await waitForPoll(15_000, signal);
    current = await client.status(current.id);
  }
  if (current.status !== 'succeeded') {
    throw new Error(`LongCat job ${current.id} ended as ${current.status}: ${current.error ?? 'unknown error'}`);
  }
  return current;
}

async function waitForPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export function assertLongCatClipProbe(probe: LongCatClipProbe, expectedDuration: number): void {
  if (
    !Number.isFinite(probe.duration) || Math.abs(probe.duration - expectedDuration) > 0.15 ||
    !Number.isInteger(probe.width) || probe.width <= 0 ||
    !Number.isInteger(probe.height) || probe.height <= probe.width ||
    !Number.isFinite(probe.fps) || Math.abs(probe.fps - 25) > 0.1 ||
    !probe.hasAudio || !['h264', 'hevc'].includes(probe.videoCodec) ||
    !['aac', 'opus'].includes(probe.audioCodec)
  ) {
    throw new Error('LongCat clip failed duration, portrait, FPS, codec or audio checks');
  }
}

export function timelineStartsMs(durationsMs: readonly number[], transitionMs: number): number[] {
  if (
    durationsMs.length !== 3 ||
    durationsMs.some((duration) => !Number.isInteger(duration) || duration <= transitionMs) ||
    !Number.isInteger(transitionMs) || transitionMs < 0
  ) {
    throw new Error('Short timeline requires three positive clip durations and a valid transition');
  }
  const starts = [0];
  for (let index = 1; index < durationsMs.length; index += 1) {
    starts.push(starts[index - 1]! + durationsMs[index - 1]! - transitionMs);
  }
  return starts;
}

async function probeLongCatClip(filename: string): Promise<LongCatClipProbe> {
  const { stdout } = await execFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of', 'json', filename,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
  const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
  const [numerator = 0, denominator = 1] = String(video?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: Number(parsed.format?.duration),
    width: Number(video?.width),
    height: Number(video?.height),
    fps: denominator ? numerator / denominator : 0,
    videoCodec: String(video?.codec_name ?? ''),
    audioCodec: String(audio?.codec_name ?? ''),
    hasAudio: Boolean(audio),
  };
}

async function renderShort(
  planned: PlannedShort,
  client: GpuMediaWorkerClient,
  projectRoot: string,
  assetRoot: string,
  resolveVoiceProfile?: (id: string) => Promise<ResolvedVoiceProfile | null>,
  workerRevision = 'unknown-worker-revision',
  planRevision = 'unknown-plan-revision',
  planSourceDigests: ShortPlan['sourceDigests'] = {
    imageManifestSha256: '0'.repeat(64),
    imageCatalogSha256: '0'.repeat(64),
    factoryConfigSha256: '0'.repeat(64),
    assetApprovalsSha256: '0'.repeat(64),
    productionLedgerSha256: '0'.repeat(64),
  },
  jobTimeoutMs = 120 * 60_000,
  signal?: AbortSignal,
  activeJobIds: Set<string> = new Set(),
  retryTerminalJobs = false,
): Promise<string> {
  const locale = canonicalizeLocale(planned.locale ?? 'fr-FR');
  const localeSlug = localePathSlug(locale);
  const voiceProfileId = planned.narration?.voiceProfileId ?? 'legacy-env-fr-v1';
  const voiceProfile = planned.narration
    ? await resolveVoiceProfile?.(voiceProfileId) ?? null
    : null;
  if (planned.narration && !voiceProfile) {
    throw new Error(`Voice profile ${voiceProfileId} is unavailable`);
  }
  const profileRevision = voiceProfile ? voiceProfileRevision(voiceProfile) : 'legacy-env-v1';
  const workDirectory = path.join(projectRoot, 'youtube-shorts-workspace', planned.shortId);
  await fs.mkdir(workDirectory, { recursive: true });
  const clipPaths: string[] = [];
  const clipDurationsMs: number[] = [];
  const clipReceipts: RenderedClipReceipt[] = [];

  for (const shot of planned.render.shots) {
    const number = String(shot.index).padStart(2, '0');
    const source = await loadApprovedImageSource(
      shot.referenceImagePath,
      assetRoot,
      shot.sourceSha256,
    );
    const cacheKey = renderCacheKey({
      rendererVersion: `mysoulmate-youtube-short-v3:${workerRevision}`,
      sourceSha256: source.sha256,
      motionPrompt: shot.longCatPayload.prompt,
      locale,
      voiceProfileId,
      voiceProfileRevision: profileRevision,
      voiceLine: shot.voiceLine,
      clipDurationMs: Math.round(planned.render.clipDurationSeconds * 1_000),
      visualSpeechMode: 'localized-lipsync',
    });
    const clipPath = path.join(workDirectory, `clip-${number}-${localeSlug}-${cacheKey.slice(0, 16)}.mp4`);
    const clipDigestPath = `${clipPath}.sha256`;
    const journalPath = `${clipPath}.job.json`;
    try {
      const [stat, recordedDigest, journal] = await Promise.all([
        fs.lstat(clipPath),
        fs.readFile(clipDigestPath, 'utf8'),
        readRenderJournal(journalPath, planned.shortId, shot.index, cacheKey, workerRevision),
      ]);
      const digest = await sha256(clipPath);
      if (
        stat.isFile() && stat.size > 1024 && digest === recordedDigest.trim() && journal &&
        journal.status === 'succeeded' && journal.requestHash && journal.attempt && journal.output
      ) {
        const cachedJob = journalAsJob(journal);
        assertLongCatOutput(cachedJob, planned.render.clipDurationSeconds, workerRevision);
        const probe = await probeLongCatClip(clipPath);
        assertLongCatClipProbe(probe, planned.render.clipDurationSeconds);
        clipPaths.push(clipPath);
        clipDurationsMs.push(Math.round(probe.duration * 1_000));
        clipReceipts.push(receiptFromJob(clipPath, digest, probe, cachedJob));
        process.stdout.write(`[${planned.shortId}] reuse ${path.basename(clipPath)}\n`);
        continue;
      }
    } catch {
      // Render the missing clip.
    }
    const previous = await readRenderJournal(journalPath, planned.shortId, shot.index, cacheKey, workerRevision);
    let job: GpuMediaJobView | undefined;
    if (previous) {
      try {
        job = await client.status(previous.jobId);
        process.stdout.write(`[${planned.shortId}] resume LongCat job ${job.id} (${job.status})\n`);
      } catch {
        // The remote worker may have pruned the job. Recreate the same deterministic request below.
      }
    }
    const retryTerminal = job !== undefined && (
      job.status === 'failed' || job.status === 'cancelled' ||
      (retryTerminalJobs && job.status === 'succeeded')
    );
    if (!job || retryTerminal) {
      const rawAudio = path.join(workDirectory, `voice-${number}-${localeSlug}-${cacheKey.slice(0, 16)}-raw.wav`);
      const audioPath = path.join(workDirectory, `voice-${number}-${localeSlug}-${cacheKey.slice(0, 16)}.wav`);
      const audioDigestPath = `${audioPath}.sha256`;
      let audioSha256 = await verifiedAudioDigest(audioPath, audioDigestPath);
      if (!audioSha256) {
        const narration = planned.narration
          ? await synthesizeLocalizedNarration(
              {
                text: shot.voiceLine,
                outputPath: rawAudio,
                locale,
                voiceProfileId,
                fallbackPolicy: 'none',
              },
              { resolveVoiceProfile },
            )
          : await synthesizeNarration(shot.voiceLine, rawAudio);
        if (!narration) throw new Error(`Local TTS is unavailable for ${planned.shortId} shot ${number}`);
        await normalizeAudio(
          rawAudio,
          audioPath,
          planned.render.clipDurationSeconds,
          narration.duration,
          planned.narration?.fitPolicy ?? {
            leadInMs: 100,
            tailOutMs: 100,
            maxSpeedup: 1.08,
            overflow: 'reject',
          },
        );
        audioSha256 = await sha256(audioPath);
        await atomicWrite(audioDigestPath, `${audioSha256}\n`);
      }
      const imageExtension = source.contentType === 'image/jpeg'
        ? '.jpg'
        : source.contentType === 'image/webp' ? '.webp' : '.png';
      const [remoteImage, remoteAudio] = await Promise.all([
        client.uploadAsset(
          `${planned.shortId}-${number}-${localeSlug}-${cacheKey.slice(0, 12)}${imageExtension}`,
          source.bytes,
          source.contentType,
        ),
        fs.readFile(audioPath).then((bytes) =>
          client.uploadAsset(
            `${planned.shortId}-${number}-${localeSlug}-${cacheKey.slice(0, 12)}.wav`,
            bytes,
            'audio/wav',
          ),
        ),
      ]);
      job = await client.submit('avatar_video_render', {
        turnId: narrationTurnId(shot.longCatPayload.turnId, localeSlug, cacheKey, audioSha256),
        audioPath: remoteAudio.path,
        referenceImagePath: remoteImage.path,
        audioSha256,
        referenceImageSha256: source.sha256,
        prompt: shot.longCatPayload.prompt,
        resolution: '480p',
      }, { retryTerminal });
      await writeRenderJournal(journalPath, planned.shortId, shot.index, cacheKey, workerRevision, job);
    }
    activeJobIds.add(job.id);
    let completed: GpuMediaJobView;
    try {
      completed = await waitForJob(client, job, jobTimeoutMs, signal);
    } finally {
      activeJobIds.delete(job.id);
    }
    await writeRenderJournal(journalPath, planned.shortId, shot.index, cacheKey, workerRevision, completed);
    assertLongCatOutput(completed, planned.render.clipDurationSeconds, workerRevision);
    const bytes = await client.downloadArtifact(job.id, 'avatar.mp4');
    const temporary = `${clipPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, bytes, { flag: 'wx' });
    try {
      const probe = await probeLongCatClip(temporary);
      assertLongCatClipProbe(probe, planned.render.clipDurationSeconds);
      await fs.rename(temporary, clipPath);
      const digest = await sha256(clipPath);
      await atomicWrite(clipDigestPath, `${digest}\n`);
      clipDurationsMs.push(Math.round(probe.duration * 1_000));
      clipReceipts.push(receiptFromJob(clipPath, digest, probe, completed));
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    clipPaths.push(clipPath);
  }

  const outputRelative = `youtube-shorts/${planned.shortId}/${planRevision}.mp4`;
  const existingOutput = path.join(projectRoot, '.codebuddy', 'media-generation', 'films', ...outputRelative.split('/'));
  let existingMaster = false;
  try {
    const info = await fs.lstat(existingOutput);
    existingMaster = true;
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Immutable master path is not a regular file: ${existingOutput}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existingMaster) {
    try {
      await validateYouTubeMasterBundle({ videoPath: existingOutput });
      process.stdout.write(`[${planned.shortId}] reuse immutable approved technical master ${planRevision}\n`);
      return existingOutput;
    } catch (error) {
      throw new Error(`Immutable master ${existingOutput} already exists but failed revalidation`, { cause: error });
    }
  }
  const result = await assembleFilm({
    clips: clipPaths,
    transitions: [
      { type: 'fade', duration: TRANSITION_SECONDS },
      { type: 'fade', duration: TRANSITION_SECONDS },
    ],
    resolution: '720p',
    aspectRatio: '9:16',
    fps: 30,
    fit: 'cover',
    rootDir: projectRoot,
    name: planned.shortId,
    output: outputRelative,
  });
  if (!result.success || !result.outputPath) throw new Error(result.error || 'Film assembly failed');
  if (
    result.clipCount !== 3 || result.transitionCount !== 2 || !result.hasAudio ||
    result.targetWidth !== 720 || result.targetHeight !== 1280 || result.fps !== 30
  ) {
    throw new Error('Final master failed the 3-clip, 2-transition, 720x1280@30 audio contract');
  }
  const expectedDuration = computeCrossfadedDuration(
    clipDurationsMs.map((duration) => duration / 1_000),
    planned.render.shots.slice(1).map(() => TRANSITION_SECONDS),
  );
  if (Math.abs((result.probedDuration ?? result.estimatedDuration) - expectedDuration) > 0.2) {
    throw new Error('Final master duration does not match the planned crossfaded timeline');
  }
  const durationMs = Math.round((result.probedDuration ?? result.estimatedDuration) * 1_000);
  const transitionMs = Math.round(TRANSITION_SECONDS * 1_000);
  const starts = timelineStartsMs(clipDurationsMs, transitionMs);
  const captions = buildWebVtt(
    planned.render.shots.map((shot, index) => ({
      id: `shot-${String(shot.index).padStart(2, '0')}`,
      startMs: (starts[index] ?? 0) + 100,
      endMs: index + 1 < starts.length
        ? Math.max((starts[index] ?? 0) + 101, (starts[index + 1] ?? durationMs) - 20)
        : Math.max((starts[index] ?? 0) + 101, durationMs - 20),
      text: shot.voiceLine,
    })),
    durationMs,
  );
  const captionsPath = `${result.outputPath}.${locale}.vtt`;
  await atomicWrite(captionsPath, captions);
  const [masterSha256, captionSha256] = await Promise.all([
    sha256(result.outputPath),
    sha256(captionsPath),
  ]);
  const sidecarPath = `${result.outputPath}.youtube.json`;
  await atomicWrite(
    sidecarPath,
    `${JSON.stringify({
      schemaVersion: 2,
      shortId: planned.shortId,
      contentGroupId: planned.contentGroupId ?? planned.shortId,
      locale,
      video: {
        file: path.basename(result.outputPath),
        durationMs,
        sha256: masterSha256,
      },
      captionTracks: [{
        locale,
        name: locale === 'fr-FR' ? 'Français' : locale === 'en-US' ? 'English' : locale,
        format: 'webvtt',
        file: path.basename(captionsPath),
        sha256: captionSha256,
        isDraft: true,
      }],
      youtube: {
        snippet: {
          title: planned.editorial.title,
          description: planned.editorial.description,
          defaultLanguage: locale,
          defaultAudioLanguage: locale,
        },
        status: {
          privacyStatus: 'private',
          selfDeclaredMadeForKids: false,
        },
      },
      containsSyntheticMedia: true,
      autoPublish: false,
      humanReviewRequired: true,
      narrationRights: voiceProfile ? {
        voiceProfileId: voiceProfile.id,
        locale: canonicalizeLocale(voiceProfile.locale),
        provider: voiceProfile.provider,
        profileRevision,
        provenanceRef: voiceProfile.provenanceRef,
        commercialUseApproved: voiceProfile.commercialUseApproved,
      } : null,
      planRevision,
      sourceDigests: planSourceDigests,
      sourceClips: clipReceipts,
      workerRevision,
      renderedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );
  await atomicWrite(`${sidecarPath}.sha256`, `${await sha256(sidecarPath)}\n`);
  const technicalReport = await validateYouTubeMasterBundle({ videoPath: result.outputPath, sidecarPath });
  await atomicWrite(`${result.outputPath}.technical.json`, `${JSON.stringify(technicalReport, null, 2)}\n`);
  return result.outputPath;
}

async function main(): Promise<void> {
  const defaultPlan = '/home/patrice/DEV/MySoulmate/youtube-shorts-workspace/plan.json';
  const planPath = path.resolve(argument('plan', defaultPlan));
  const planBytes = await fs.readFile(planPath);
  const planRevision = createHash('sha256').update(planBytes).digest('hex');
  const plan = JSON.parse(planBytes.toString('utf8')) as unknown;
  assertPlan(plan);
  const projectRoot = path.resolve(
    argument(
      'project-root',
      path.basename(path.dirname(planPath)) === 'youtube-shorts-workspace'
        ? path.dirname(path.dirname(planPath))
        : process.cwd(),
    ),
  );
  const assetRoot = path.resolve(
    argument('asset-root', path.join(projectRoot, 'companion-image-cache')),
  );
  const requestedShort = argument('short');
  const selected = requestedShort
    ? plan.shorts.filter((planned) => planned.shortId === requestedShort)
    : process.argv.includes('--all')
      ? plan.shorts
      : plan.shorts.slice(0, 1);
  if (!selected.length) throw new Error('No matching planned Short');

  const execute = process.argv.includes('--execute');
  const preflight = process.argv.includes('--preflight');
  if (execute && preflight) throw new Error('--execute and --preflight are mutually exclusive');
  process.stdout.write(
    `${execute ? 'EXECUTE' : preflight ? 'PREFLIGHT' : 'DRY RUN'}: ${selected.length} Short(s), ` +
      `${selected.length * 3} LongCat clip(s), private output only\n`,
  );
  for (const planned of selected) {
    const quality = assessPlannedShort(planned, plan.shorts);
    process.stdout.write(`- ${planned.shortId}: ${planned.editorial.title} — qualité ${quality.score}/100\n`);
  }
  if (!execute && !preflight) return;

  for (const planned of selected) {
    const quality = assessPlannedShort(planned, plan.shorts);
    if (!quality.ready) {
      const failures = quality.checks.filter((check) => check.status === 'fail').map((check) => check.label).join(', ');
      throw new Error(`${planned.shortId} did not pass the editorial gate (${quality.score}/100): ${failures}`);
    }
  }

  await Promise.all(selected.flatMap((planned) => planned.render.shots.map((shot) =>
    loadApprovedImageSource(shot.referenceImagePath, assetRoot, shot.sourceSha256))));

  const voiceProfiles = await loadVoiceRegistry(
    path.resolve(
      argument('voice-registry', path.join(homedir(), '.codebuddy', 'voice-rights-registry.json')),
    ),
  );
  assertVoiceProfiles(selected, voiceProfiles);

  const clientEnv = await loadEnvironmentFile(
    argument('worker-env', path.join(homedir(), '.codebuddy', 'gpu-worker-client.env')),
  );
  const baseUrl = process.env.CODEBUDDY_GPU_WORKER_URL || clientEnv.CODEBUDDY_GPU_WORKER_URL;
  const token = process.env.CODEBUDDY_GPU_WORKER_TOKEN || clientEnv.CODEBUDDY_GPU_WORKER_TOKEN;
  if (!baseUrl || !token) throw new Error('GPU worker URL and token are required');
  const client = new GpuMediaWorkerClient({ baseUrl, token: token.replace(/^\uFEFF/u, ''), timeoutMs: 120_000 });
  const capabilities = await client.capabilities();
  if (!capabilities.jobs.includes('avatar_video_render')) throw new Error('Darkstar LongCat runner is unavailable');
  if ((capabilities.queueDepth ?? 0) > 0 || (capabilities.activeJobs ?? 0) > 0 || capabilities.availableSlots === 0) {
    throw new Error('Darkstar GPU worker has no immediately available render slot');
  }
  const workerRevision = capabilities.runnerRevisions?.avatar_video_render;
  if (!workerRevision || !/^[a-f0-9]{64}$/u.test(workerRevision)) {
    throw new Error('Darkstar worker does not expose a valid LongCat runner revision');
  }

  const resolveVoiceProfile = async (id: string): Promise<ResolvedVoiceProfile | null> =>
    voiceProfiles.get(id) ?? null;

  if (preflight && !execute) {
    process.stdout.write(
      `Preflight passed: ${selected.length * 3} approved source(s), ` +
        `${voiceProfiles.size} voice profile(s), worker queue ${capabilities.queueDepth ?? 0}\n`,
    );
    return;
  }

  const jobTimeoutMinutes = Number.parseInt(argument('job-timeout-minutes', '120'), 10);
  if (!Number.isInteger(jobTimeoutMinutes) || jobTimeoutMinutes < 5 || jobTimeoutMinutes > 360) {
    throw new Error('--job-timeout-minutes must be between 5 and 360');
  }
  const abortController = new AbortController();
  const activeJobIds = new Set<string>();
  const retryTerminalJobs = process.argv.includes('--retry-terminal-jobs');
  const interrupt = () => {
    abortController.abort();
    for (const jobId of activeJobIds) void client.cancel(jobId).catch(() => undefined);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    for (const planned of selected) {
      const output = await renderShort(
        planned, client, projectRoot, assetRoot, resolveVoiceProfile, workerRevision, planRevision,
        plan.sourceDigests,
        jobTimeoutMinutes * 60_000, abortController.signal, activeJobIds,
        retryTerminalJobs,
      );
      process.stdout.write(`Rendered private master: ${output}\n`);
    }
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

function assertLongCatOutput(job: GpuMediaJobView, duration: number, workerRevision: string): void {
  const output = job.output;
  if (
    !output || output.audioTruncated !== false || output.resolution !== '480p' ||
    output.frames !== 93 || output.fps !== 25 || output.runnerVersion !== '2' ||
    output.jobId !== job.id || typeof output.turnId !== 'string' || !output.turnId.trim() ||
    typeof output.upstreamCommit !== 'string' || !output.upstreamCommit.trim() ||
    typeof output.durationSeconds !== 'number' || Math.abs(output.durationSeconds - duration) > 0.05 ||
    job.runnerRevision !== workerRevision
  ) {
    throw new Error(`LongCat job ${job.id} returned an incomplete or incompatible render receipt`);
  }
}

async function atomicWrite(filename: string, contents: string): Promise<void> {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filename);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

function journalAsJob(journal: RenderJobJournal): GpuMediaJobView {
  return {
    id: journal.jobId,
    kind: 'avatar_video_render',
    status: journal.status,
    ...(journal.requestHash ? { requestHash: journal.requestHash } : {}),
    runnerRevision: journal.workerRevision,
    ...(journal.attempt !== undefined ? { attempt: journal.attempt } : {}),
    ...(journal.retryOf ? { retryOf: journal.retryOf } : {}),
    ...(journal.completedAt ? { completedAt: journal.completedAt } : {}),
    ...(journal.output ? { output: journal.output } : {}),
  };
}

function receiptFromJob(
  clipPath: string,
  digest: string,
  probe: LongCatClipProbe,
  job: GpuMediaJobView,
): RenderedClipReceipt {
  if (!job.requestHash || !job.runnerRevision || !job.attempt || !job.output) {
    throw new Error(`LongCat job ${job.id} lacks an auditable receipt`);
  }
  return {
    file: path.basename(clipPath),
    sha256: digest,
    durationMs: Math.round(probe.duration * 1_000),
    jobId: job.id,
    requestHash: job.requestHash,
    runnerRevision: job.runnerRevision,
    attempt: job.attempt,
    ...(job.retryOf ? { retryOf: job.retryOf } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    output: job.output,
  };
}

async function readRenderJournal(
  filename: string,
  shortId: string,
  shotIndex: number,
  cacheKey: string,
  workerRevision: string,
): Promise<RenderJobJournal | null> {
  try {
    const info = await fs.lstat(filename);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    const value = JSON.parse(await fs.readFile(filename, 'utf8')) as Partial<RenderJobJournal>;
    return value.schemaVersion === 1 && value.shortId === shortId && value.shotIndex === shotIndex &&
      value.cacheKey === cacheKey && value.workerRevision === workerRevision &&
      typeof value.jobId === 'string' && /^[A-Za-z0-9._-]{1,128}$/u.test(value.jobId)
      ? value as RenderJobJournal
      : null;
  } catch {
    return null;
  }
}

async function writeRenderJournal(
  filename: string,
  shortId: string,
  shotIndex: number,
  cacheKey: string,
  workerRevision: string,
  job: GpuMediaJobView,
): Promise<void> {
  const journal: RenderJobJournal = {
    schemaVersion: 1,
    shortId,
    shotIndex,
    cacheKey,
    workerRevision,
    jobId: job.id,
    status: job.status,
    ...(job.requestHash ? { requestHash: job.requestHash } : {}),
    ...(job.attempt !== undefined ? { attempt: job.attempt } : {}),
    ...(job.retryOf ? { retryOf: job.retryOf } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    ...(job.output ? { output: job.output } : {}),
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(filename, `${JSON.stringify(journal, null, 2)}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
