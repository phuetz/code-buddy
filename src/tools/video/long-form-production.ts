/** Compile and assemble human-reviewed long-form episode plans without publishing them. */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { assembleFilm, type AssembleFilmResult } from './film-assemble.js';
import { assessLongFormPlan, type LongFormEpisodePlan } from './long-form-plan.js';

export interface LongFormRenderPacket {
  schemaVersion: 1;
  episodeId: string;
  planSha256: string;
  locale: string;
  target: { width: 1920; height: 1080; fps: 30; audio: 'required' };
  publication: { visibility: 'private'; autoPublish: false; humanReviewRequired: true };
  scenes: Array<{
    order: number;
    chapterId: string;
    sceneId: string;
    role: 'chapter-hero' | 'b-roll';
    durationSeconds: number;
    narration: string;
    visualPrompt: string;
    expectedFilename: string;
    status: 'awaiting-media-generation';
  }>;
}

export function compileLongFormRenderPacket(plan: LongFormEpisodePlan): LongFormRenderPacket {
  const assessment = assessLongFormPlan(plan);
  if (!assessment.ready) throw new Error(`Long-form plan is not production-ready: ${assessment.failures.join(', ')}`);
  const planSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  let order = 0;
  return {
    schemaVersion: 1,
    episodeId: plan.episodeId,
    planSha256,
    locale: plan.locale,
    target: { width: 1920, height: 1080, fps: 30, audio: 'required' },
    publication: { visibility: 'private', autoPublish: false, humanReviewRequired: true },
    scenes: plan.chapters.flatMap((chapter) => chapter.scenes.map((scene, index) => ({
      order: ++order,
      chapterId: chapter.id,
      sceneId: scene.id,
      role: index === 0 ? 'chapter-hero' as const : 'b-roll' as const,
      durationSeconds: scene.durationSeconds,
      narration: scene.narration,
      visualPrompt: scene.visualPrompt,
      expectedFilename: `${scene.id}.mp4`,
      status: 'awaiting-media-generation' as const,
    }))),
  };
}

export async function assembleLongFormMaster(input: {
  plan: LongFormEpisodePlan;
  clipsRoot: string;
  projectRoot: string;
  assembler?: typeof assembleFilm;
}): Promise<{ outputPath: string; metadataPath: string; result: AssembleFilmResult }> {
  const packet = compileLongFormRenderPacket(input.plan);
  const clipsRoot = await regularDirectory(input.clipsRoot, 'Long-form clips root');
  const projectRoot = await regularDirectory(input.projectRoot, 'Long-form project root');
  const clips: string[] = [];
  for (const scene of packet.scenes) {
    const candidate = path.join(clipsRoot, scene.expectedFilename);
    const info = await fs.lstat(candidate);
    if (info.isSymbolicLink() || !info.isFile() || info.size <= 1024) {
      throw new Error(`Long-form scene ${scene.sceneId} must be a regular non-empty MP4`);
    }
    const canonical = await fs.realpath(candidate);
    if (!within(canonical, clipsRoot)) throw new Error(`Long-form scene ${scene.sceneId} escapes the clips root`);
    clips.push(canonical);
  }
  const outputRelative = `long-form/${input.plan.episodeId}/${packet.planSha256}.mp4`;
  const result = await (input.assembler ?? assembleFilm)({
    clips,
    transitions: clips.slice(1).map(() => ({ type: 'cut', duration: 0 })),
    resolution: '1080p',
    aspectRatio: '16:9',
    fps: 30,
    fit: 'cover',
    rootDir: projectRoot,
    name: input.plan.episodeId,
    output: outputRelative,
  });
  if (!result.success || !result.outputPath || result.clipCount !== clips.length || result.transitionCount !== clips.length - 1 ||
      result.targetWidth !== 1920 || result.targetHeight !== 1080 || result.fps !== 30 || !result.hasAudio ||
      (result.probedDuration ?? result.estimatedDuration) < 480 || (result.probedDuration ?? result.estimatedDuration) > 1200 ||
      Math.abs((result.probedDuration ?? result.estimatedDuration) - assessLongFormPlan(input.plan).durationSeconds) > 1) {
    throw new Error(result.error ?? 'Long-form master failed its clip, audio, duration or output-profile contract');
  }
  const outputPath = await regularFile(result.outputPath, 'Long-form master');
  const expectedOutput = path.join(
    projectRoot, '.codebuddy', 'media-generation', 'films', 'long-form', input.plan.episodeId, `${packet.planSha256}.mp4`,
  );
  if (outputPath !== expectedOutput) throw new Error('Long-form assembler returned an unexpected output path');
  const outputSha256 = createHash('sha256').update(await fs.readFile(outputPath)).digest('hex');
  const captionPath = `${outputPath}.${input.plan.locale}.vtt`;
  await fs.writeFile(captionPath, buildLongFormWebVtt(input.plan), { flag: 'wx', mode: 0o600 });
  const captionSha256 = createHash('sha256').update(await fs.readFile(captionPath)).digest('hex');
  const metadataPath = `${outputPath}.youtube.json`;
  await fs.writeFile(metadataPath, `${JSON.stringify({
    schemaVersion: 1,
    episodeId: input.plan.episodeId,
    planSha256: packet.planSha256,
    videoSha256: outputSha256,
    caption: { file: path.basename(captionPath), sha256: captionSha256, locale: input.plan.locale, format: 'webvtt' },
    title: input.plan.title,
    description: input.plan.description,
    locale: input.plan.locale,
    chapters: input.plan.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
    suggestedAdBreakSeconds: assessLongFormPlan(input.plan).suggestedAdBreakSeconds,
    visibility: 'private',
    madeForKids: false,
    containsSyntheticMedia: true,
    humanReviewRequired: true,
    reviewStatus: 'pending-human-review',
    technical: { width: 1920, height: 1080, fps: 30, hasAudio: true, durationSeconds: result.probedDuration ?? result.estimatedDuration },
    autoPublish: false,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { outputPath, metadataPath, result };
}

export async function reviewLongFormMaster(input: {
  videoPath: string;
  reviewer: string;
  reason: string;
  checks: Record<'voice' | 'identity' | 'anatomy' | 'captions' | 'disclosure' | 'chapters' | 'editorial', boolean>;
  now?: () => Date;
}): Promise<Record<string, unknown>> {
  const videoPath = await regularFile(input.videoPath, 'Long-form master');
  const metadataPath = await regularFile(`${videoPath}.youtube.json`, 'Long-form metadata');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
  const videoSha256 = createHash('sha256').update(await fs.readFile(videoPath)).digest('hex');
  const caption = metadata.caption as Record<string, unknown> | undefined;
  if (
    metadata.schemaVersion !== 1 || metadata.videoSha256 !== videoSha256 || metadata.visibility !== 'private' ||
    metadata.autoPublish !== false || metadata.humanReviewRequired !== true || metadata.reviewStatus !== 'pending-human-review' ||
    !caption || typeof caption.file !== 'string' || path.basename(caption.file) !== caption.file
  ) throw new Error('Long-form metadata is incomplete, stale or unsafe');
  const captionPath = await regularFile(path.join(path.dirname(videoPath), caption.file), 'Long-form captions');
  const captionSha256 = createHash('sha256').update(await fs.readFile(captionPath)).digest('hex');
  if (caption.sha256 !== captionSha256) throw new Error('Long-form caption digest is stale');
  if (Object.values(input.checks).some((value) => value !== true)) throw new Error('Every long-form human-review check must pass');
  if (input.reviewer.trim().length < 2 || input.reason.trim().length < 3) throw new Error('Reviewer and reason are required');
  return {
    schemaVersion: 1,
    status: 'ready-for-private-upload',
    episodeId: metadata.episodeId,
    videoSha256,
    metadataSha256: createHash('sha256').update(await fs.readFile(metadataPath)).digest('hex'),
    captionSha256,
    reviewer: input.reviewer.trim(),
    reason: input.reason.trim(),
    checks: input.checks,
    reviewedAt: (input.now ?? (() => new Date()))().toISOString(),
    visibility: 'private',
    autoPublish: false,
  };
}

function buildLongFormWebVtt(plan: LongFormEpisodePlan): string {
  let cursor = 0;
  const cues: string[] = ['WEBVTT', ''];
  for (const chapter of plan.chapters) {
    for (const scene of chapter.scenes) {
      const start = cursor;
      cursor += scene.durationSeconds;
      cues.push(scene.id, `${vttTime(start)} --> ${vttTime(cursor)}`, scene.narration.replace(/-->/gu, '→').trim(), '');
    }
  }
  return `${cues.join('\n')}\n`;
}

function vttTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const secs = Math.floor(milliseconds % 60_000 / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

async function regularDirectory(value: string, label: string): Promise<string> {
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error(`${label} must be absolute`);
  const info = await fs.lstat(value);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a regular directory`);
  return fs.realpath(value);
}

async function regularFile(value: string, label: string): Promise<string> {
  const info = await fs.lstat(value);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file`);
  return fs.realpath(value);
}

function within(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
