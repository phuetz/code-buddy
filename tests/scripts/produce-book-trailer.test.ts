import { createHash } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  runAssembleStage,
  runHandoffStage,
  runPlanStage,
} from '../../scripts/trailers/produce-book-trailer.js';
import type { CinematicTrailerPlan, TrailerShot } from '../../src/tools/video/cinematic-trailer-plan.js';
import { canonicalSha256, verifyGoogleFlowHandoffDigest } from '../../src/tools/video/google-flow-handoff.js';
import type { GoogleFlowImportReceipt } from '../../src/tools/video/google-flow-result-import.js';

const temporaryDirectories: string[] = [];

function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

const SOURCE = { file: '01.md', locator: 'chapter:1;lines:3-3' };

function shot(id: string, token: TrailerShot['token'], durationSeconds: number): TrailerShot {
  const editorial = token === 'brand' || token === 'cta';
  return {
    id,
    token,
    ...(editorial ? {} : { manuscriptSource: SOURCE }),
    information: `Information ${id}`,
    action: 'avance',
    cameraMove: 'slow push-in',
    durationSeconds,
    characters: [],
    entryHandle: true,
    exitHandle: true,
    burnedInText: false,
    rejectionConditions: ['no text'],
    useCase: 'hero-shot',
  };
}

function validPlan(): CinematicTrailerPlan {
  return {
    schemaVersion: 1,
    status: 'READY_FOR_PREFLIGHT',
    contentTier: 'safe',
    book: {
      title: 'Les Veilleurs',
      genre: 'thriller',
      stagingSentence: 'We move from shelter to pursuit, seen from Mara, without revealing the watcher.',
      spoilerLimit: 'Ne pas révéler le veilleur',
      commercialAction: 'Lire le livre',
    },
    masterDurationSeconds: 60,
    characters: [],
    shots: [
      shot('shot-01', 'hook', 3),
      shot('shot-02', 'world', 9),
      shot('shot-03', 'protagonist', 9),
      shot('shot-04', 'escalation', 9),
      shot('shot-05', 'price', 9),
      shot('shot-06', 'withheld', 9),
      shot('shot-07', 'brand', 8),
      shot('shot-08', 'cta', 4),
    ],
    overlays: [{ timecodeSeconds: 52, text: 'Les Veilleurs', source: 'editorial', safeZone: true }],
    sound: { layers: ['ambience', 'foley', 'motif', 'speech'], masters: ['mix.wav'] },
    retention: {
      hookA: 'Porte',
      hookB: 'Ombre',
      promise: 'La maison observe',
      proofWithinThreeSeconds: 'Ombre visible',
      deeperPayoff: 'La poursuite commence',
      singleAbVariable: 'Hook',
    },
    cost: { displayedInUi: false, estimatedFlowCredits: 0, approvedCeilingFlowCredits: 0 },
    approvals: {
      narrativeReviewed: false,
      castingReviewed: false,
      costApproved: false,
      publicationApproved: false,
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      containsSyntheticMedia: true,
      humanReviewRequired: true,
    },
  };
}

async function preparedWorkspace(): Promise<{ workspace: string; book: string }> {
  const root = await temporaryDirectory('book-trailer-');
  const book = path.join(root, 'book');
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(book);
  await fs.writeFile(path.join(book, '01.md'), '# Les Veilleurs\n\nMara ouvre la porte. Une ombre traverse la chambre.\n');
  await fs.writeFile(path.join(book, 'cover.png'), 'local-cover-bytes');
  return { workspace, book };
}

describe('book trailer producer stages', () => {
  it('plans from a local book with an injected provider and refuses overwrites', async () => {
    const { workspace, book } = await preparedWorkspace();
    const provider = vi.fn(async () => JSON.stringify(validPlan()));

    const result = await runPlanStage({ bookDirectory: book, workspace }, { provider });

    expect(result.plan.shots).toHaveLength(8);
    expect(result.excerpts.excerpts[0]?.manuscriptSource).toEqual(SOURCE);
    await expect(fs.readFile(path.join(workspace, 'trailer-plan.json'), 'utf8')).resolves.toContain(
      'Les Veilleurs',
    );
    await expect(runPlanStage({ bookDirectory: book, workspace }, { provider })).rejects.toThrow(
      /without --force/i,
    );
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('creates a canonical one-job-per-shot Flow handoff within budget', async () => {
    const { workspace, book } = await preparedWorkspace();
    await runPlanStage(
      { bookDirectory: book, workspace },
      { provider: async () => JSON.stringify(validPlan()) },
    );

    await expect(runHandoffStage({ workspace, remainingFlowCredits: 799 })).rejects.toThrow(
      /credit|engine|guardrail/i,
    );
    const handoff = await runHandoffStage({ workspace, remainingFlowCredits: 800 });

    expect(handoff.jobs).toHaveLength(validPlan().shots.length);
    expect(handoff.estimatedCredits).toBe(800);
    expect(handoff.remainingCreditsAfterEstimate).toBe(0);
    expect(handoff.jobs[0]?.settings.aspectRatio).toBe('16:9');
    expect(handoff.jobs[0]?.prompt).toContain('Single camera move: slow push-in');
    expect(verifyGoogleFlowHandoffDigest(handoff)).toBe(true);
    await expect(runHandoffStage({ workspace, remainingFlowCredits: 800 })).rejects.toThrow(
      /without --force/i,
    );
  });

  it('imports, orders, assembles, hashes, and leaves the master pending human review', async () => {
    const { workspace, book } = await preparedWorkspace();
    await runPlanStage(
      { bookDirectory: book, workspace },
      { provider: async () => JSON.stringify(validPlan()) },
    );
    const handoff = await runHandoffStage({ workspace, remainingFlowCredits: 800 });
    const resultsDirectory = path.join(path.dirname(workspace), 'raw-results');
    await fs.mkdir(resultsDirectory);
    const importResults = vi.fn(async (input: Parameters<typeof import('../../src/tools/video/google-flow-result-import.js').importGoogleFlowResults>[0]) => {
      const batchDirectory = path.join(input.outputRoot, input.handoff.batchId);
      await fs.mkdir(batchDirectory, { recursive: true });
      const jobs = [];
      for (const [index, job] of input.handoff.jobs.entries()) {
        const bytes = Buffer.from(`clip-${index + 1}`);
        const outputFile = `${input.handoff.batchId}/${job.id}.mp4`;
        await fs.writeFile(path.join(input.outputRoot, outputFile), bytes);
        jobs.push({
          id: job.id,
          role: job.role,
          sourceFile: `${job.id}.mp4`,
          sourceSha256: digest(`raw-${index + 1}`),
          sourceHadAudio: true,
          outputFile,
          sha256: digest(bytes),
          bytes: bytes.length,
          probe: { durationSeconds: 8, width: 1920, height: 1080, hasVideo: true, hasAudio: false },
          qaStatus: 'pending-human-review' as const,
        });
      }
      const unsigned = {
        schemaVersion: 2 as const,
        batchId: input.handoff.batchId,
        provider: 'google-flow-web' as const,
        sourcePlanSha256: input.handoff.sourcePlanSha256,
        handoffSha256: input.handoff.handoffSha256,
        handoffFileSha256: digest(input.handoffBytes),
        importedAt: '2026-07-20T10:00:00.000Z',
        audioPolicy: 'removed-on-import' as const,
        autoPublish: false as const,
        humanReviewRequired: true as const,
        jobs,
      };
      return { ...unsigned, receiptSha256: canonicalSha256(unsigned) } as GoogleFlowImportReceipt;
    });
    let assembledClips: string[] = [];
    const assemble = vi.fn(async (input: Parameters<typeof import('../../src/tools/video/film-assemble.js').assembleFilm>[0]) => {
      assembledClips = input.clips;
      const outputPath = path.join(workspace, 'fake-master.mp4');
      await fs.writeFile(outputPath, 'master-bytes');
      await fs.writeFile(`${outputPath}.meta.json`, '{"kind":"film"}');
      return {
        kind: 'film_assemble_result' as const,
        success: true,
        outputPath,
        mediaPath: `MEDIA:${outputPath}`,
        engine: 'xfade' as const,
        clipCount: input.clips.length,
        transitionCount: input.clips.length - 1,
        targetWidth: 1920,
        targetHeight: 1080,
        fps: 30,
        estimatedDuration: 61.9,
        hasAudio: true,
        transitions: [],
        warnings: [],
      };
    });

    const receipt = await runAssembleStage(
      { workspace, resultsDirectory, music: path.join(book, 'music.wav') },
      { importResults, assemble, now: () => new Date('2026-07-20T11:00:00.000Z') },
    );

    expect(importResults).toHaveBeenCalledTimes(1);
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(assembledClips.map((clip) => path.basename(clip))).toEqual(
      handoff.jobs.map((job) => `${job.id}.mp4`),
    );
    expect(assemble.mock.calls[0]?.[0]).toMatchObject({
      transitionDuration: 0.3,
      ducking: true,
      aspectRatio: '16:9',
    });
    expect(receipt.status).toBe('pending-human-review');
    expect(receipt.autoPublish).toBe(false);
    expect(receipt.clips).toHaveLength(handoff.jobs.length);
    expect(receipt.master.sha256).toBe(digest('master-bytes'));
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(fs.readFile(path.join(workspace, 'trailer-overlay-todo.json'), 'utf8')).resolves.toContain(
      'pending-operator-render',
    );
  });
});
