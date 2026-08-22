import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { assembleLongFormMaster, compileLongFormRenderPacket, reviewLongFormMaster } from '../../../src/tools/video/long-form-production.js';
import type { LongFormEpisodePlan } from '../../../src/tools/video/long-form-plan.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

function plan(): LongFormEpisodePlan {
  const narration = Array.from({ length: 26 }, (_, index) => `word${index}`).join(' ');
  return {
    schemaVersion: 1, episodeId: 'episode-original', locale: 'fr-FR', title: 'Une histoire originale',
    description: 'Une histoire longue, originale et structurée en chapitres.',
    chapters: Array.from({ length: 5 }, (_, chapter) => ({
      id: `chapter-${chapter}`, title: `Chapitre ${chapter}`,
      scenes: Array.from({ length: 5 }, (_, scene) => ({ id: `c${chapter}-s${scene}`, durationSeconds: 20,
        narration: `${narration} chapitre ${chapter} scene ${scene}`, visualPrompt: `composition unique ${chapter}-${scene}` })),
    })),
    publication: { visibility: 'private', autoPublish: false, madeForKids: false, containsSyntheticMedia: true, humanReviewRequired: true },
  };
}

describe('long-form production', () => {
  it('compiles an immutable 25-scene render packet', () => {
    const packet = compileLongFormRenderPacket(plan());
    expect(packet.scenes).toHaveLength(25);
    expect(packet.scenes.filter((scene) => scene.role === 'chapter-hero')).toHaveLength(5);
    expect(packet.publication).toEqual({ visibility: 'private', autoPublish: false, humanReviewRequired: true });
  });

  it('assembles only the exact regular scene files into a private immutable master', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'long-form-'));
    roots.push(root);
    const clips = path.join(root, 'clips'); await fs.mkdir(clips);
    for (const scene of compileLongFormRenderPacket(plan()).scenes) await fs.writeFile(path.join(clips, scene.expectedFilename), Buffer.alloc(2048, 1));
    const packet = compileLongFormRenderPacket(plan());
    const output = path.join(root, '.codebuddy', 'media-generation', 'films', 'long-form', 'episode-original', `${packet.planSha256}.mp4`);
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, Buffer.alloc(2048, 2));
    const assembler = vi.fn(async () => ({ kind: 'film_assemble_result' as const, success: true, outputPath: output,
      engine: 'xfade' as const, clipCount: 25, transitionCount: 24, targetWidth: 1920, targetHeight: 1080, fps: 30,
      estimatedDuration: 500, probedDuration: 500, hasAudio: true, transitions: [], warnings: [] }));
    const result = await assembleLongFormMaster({ plan: plan(), clipsRoot: clips, projectRoot: root, assembler });
    expect(result.outputPath).toBe(output);
    expect(JSON.parse(await fs.readFile(result.metadataPath, 'utf8'))).toMatchObject({ visibility: 'private', autoPublish: false });
    await expect(reviewLongFormMaster({
      videoPath: output, reviewer: 'Patrice', reason: 'Episode watched from start to finish',
      checks: { voice: true, identity: true, anatomy: true, captions: true, disclosure: true, chapters: true, editorial: true },
    })).resolves.toMatchObject({ status: 'ready-for-private-upload', autoPublish: false });
  });
});
