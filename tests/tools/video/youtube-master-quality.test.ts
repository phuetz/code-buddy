import { createHash } from 'crypto';
import { execFile as rawExecFile, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createPrivateYouTubeBundle,
  requestYouTubeMasterChanges,
  reviewYouTubeMaster,
  validateYouTubeMasterBundle,
} from '../../../src/tools/video/youtube-master-quality.js';

const roots: string[] = [];
const execFile = promisify(rawExecFile);
const ffmpegEncoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const REAL_MEDIA = ffmpegEncoders.status === 0 && /\blibx264\b/u.test(ffmpegEncoders.stdout ?? '') &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-master-'));
  roots.push(root);
  const videoPath = path.join(root, 'pilot.mp4');
  const captionPath = `${videoPath}.fr-FR.vtt`;
  await fs.writeFile(videoPath, 'synthetic private master');
  await fs.writeFile(captionPath, 'WEBVTT\n\n00:00:00.100 --> 00:00:10.000\nBonjour\n');
  const sha = async (filename: string) => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
  await fs.writeFile(`${videoPath}.youtube.json`, JSON.stringify({
    schemaVersion: 2, autoPublish: false, humanReviewRequired: true, containsSyntheticMedia: true,
    video: { file: path.basename(videoPath), durationMs: 10_160, sha256: await sha(videoPath) },
    captionTracks: [{ file: path.basename(captionPath), sha256: await sha(captionPath) }],
    youtube: {
      snippet: {
        title: 'Une histoire originale avec Lisa',
        description: 'Une micro-histoire originale préparée pour une revue privée.',
      },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    },
    narrationRights: {
      commercialUseApproved: true,
      provenanceRef: 'voice-rights/lisa-fr-v2',
      profileRevision: 'a'.repeat(64),
    },
    sourceClips: [1, 2, 3].map((index) => ({ file: `clip-${index}.mp4`, sha256: String(index).repeat(64) })),
  }));
  return videoPath;
}

const passingProbe = async () => ({
  duration: 10.16,
  width: 720,
  height: 1280,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
});

const passingSignals = async () => ({ meanVolumeDb: -20, maxVolumeDb: -0.5, blackSeconds: 0.2 });

describe('YouTube master quality gate', () => {
  it('requires technical approval before a complete digest-bound human review', async () => {
    const videoPath = await fixture();
    const report = await validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: passingSignals,
    });
    const checks = { voice: true, lipSync: true, identity: true, anatomy: true, captions: true, disclosure: true, editorial: true };
    await expect(reviewYouTubeMaster({ report, expectedVideoSha256: report.videoSha256, reviewer: 'Patrice', reason: 'Master vérifié.', checks }))
      .resolves.toMatchObject({ status: 'ready-for-private-upload', visibility: 'private', autoPublish: false });
  });

  it('rejects invalid probes and incomplete human checks', async () => {
    const videoPath = await fixture();
    await expect(validateYouTubeMasterBundle({
      videoPath,
      probe: async () => ({ duration: 10.16, width: 1920, height: 1080, fps: 30, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true }),
      analyze: passingSignals,
    })).rejects.toThrow('failed');
    const report = await validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: passingSignals,
    });
    await expect(reviewYouTubeMaster({
      report, expectedVideoSha256: report.videoSha256, reviewer: 'Patrice', reason: 'À revoir.',
      checks: { voice: false, lipSync: true, identity: true, anatomy: true, captions: true, disclosure: true, editorial: true },
    })).rejects.toThrow('Every');
  });

  it('records digest-bound change requests without granting upload readiness', async () => {
    const videoPath = await fixture();
    const report = await validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: passingSignals,
    });
    const checks = {
      voice: true,
      lipSync: true,
      identity: false,
      anatomy: true,
      captions: true,
      disclosure: true,
      editorial: false,
    };
    await expect(requestYouTubeMasterChanges({
      report,
      expectedVideoSha256: report.videoSha256,
      reviewer: 'Codex visual QA',
      reason: 'Continuité visuelle et cohérence éditoriale à corriger.',
      checks,
      now: () => new Date('2026-07-19T08:35:00Z'),
    })).resolves.toMatchObject({
      status: 'changes-requested',
      visibility: 'blocked',
      autoPublish: false,
      checks: { identity: false, editorial: false },
    });
    await expect(requestYouTubeMasterChanges({
      report,
      expectedVideoSha256: report.videoSha256,
      reviewer: 'Codex visual QA',
      reason: 'Aucune correction.',
      checks: { ...checks, identity: true, editorial: true },
    })).rejects.toThrow('at least one failed');
  });

  it('rejects silence, excessive black frames and incomplete source provenance', async () => {
    const videoPath = await fixture();
    await expect(validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: async () => ({ meanVolumeDb: -80, maxVolumeDb: -1, blackSeconds: 2 }),
    })).rejects.toThrow('audio or black-frame');

    const sidecarPath = `${videoPath}.youtube.json`;
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as { sourceClips: unknown[] };
    sidecar.sourceClips.pop();
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar));
    await expect(validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: passingSignals,
    })).rejects.toThrow('contract');
  });

  it('creates an immutable local private-upload bundle and refuses post-review changes', async () => {
    const videoPath = await fixture();
    const report = await validateYouTubeMasterBundle({
      videoPath,
      probe: passingProbe,
      analyze: passingSignals,
      now: () => new Date('2026-07-18T12:00:00Z'),
    });
    const checks = { voice: true, lipSync: true, identity: true, anatomy: true, captions: true, disclosure: true, editorial: true };
    const review = await reviewYouTubeMaster({
      report,
      expectedVideoSha256: report.videoSha256,
      reviewer: 'Patrice',
      reason: 'Master, captions et disclosure vérifiés.',
      checks,
      now: () => new Date('2026-07-18T12:05:00Z'),
    });
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-private-bundle-'));
    roots.push(outputRoot);
    const bundle = await createPrivateYouTubeBundle({
      videoPath,
      report,
      review,
      outputRoot,
      probe: passingProbe,
      analyze: passingSignals,
      now: () => new Date('2026-07-18T12:10:00Z'),
    });
    expect(bundle.manifest).toMatchObject({
      status: 'ready-for-private-upload',
      visibility: 'private',
      autoPublish: false,
    });
    expect(bundle.manifest.files.map((file) => file.role)).toEqual([
      'video', 'captions', 'youtube-sidecar', 'technical-report', 'human-review',
    ]);
    await expect(fs.readFile(path.join(bundle.directory, 'bundle.json'), 'utf8')).resolves.toContain('ready-for-private-upload');

    await fs.appendFile(videoPath, 'changed');
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'youtube-private-bundle-tampered-'));
    roots.push(secondRoot);
    await expect(createPrivateYouTubeBundle({
      videoPath,
      report,
      review,
      outputRoot: secondRoot,
      probe: passingProbe,
      analyze: passingSignals,
    })).rejects.toThrow(/digest|changed after approval/u);
  });

  it.skipIf(!REAL_MEDIA)('probes and analyzes a real vertical H.264/AAC master', async () => {
    const videoPath = await fixture();
    const captionPath = `${videoPath}.fr-FR.vtt`;
    await execFile('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:r=30:d=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest', videoPath,
    ], { timeout: 30_000 });
    await fs.writeFile(captionPath, 'WEBVTT\n\n00:00:00.100 --> 00:00:05.900\nBonjour\n');
    const sha = async (filename: string) => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
    const sidecarPath = `${videoPath}.youtube.json`;
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as {
      video: { durationMs: number; sha256: string };
      captionTracks: Array<{ sha256: string }>;
    };
    sidecar.video.durationMs = 6_000;
    sidecar.video.sha256 = await sha(videoPath);
    sidecar.captionTracks[0]!.sha256 = await sha(captionPath);
    await fs.writeFile(sidecarPath, JSON.stringify(sidecar));
    await expect(validateYouTubeMasterBundle({ videoPath })).resolves.toMatchObject({
      status: 'technical-approved',
      probe: { width: 720, height: 1280, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true },
    });
  }, 30_000);
});
