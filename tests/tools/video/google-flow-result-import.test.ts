import { execFile as rawExecFile, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

import { createGoogleFlowHandoff } from '../../../src/tools/video/google-flow-handoff.js';
import { importGoogleFlowResults, reviewGoogleFlowImport } from '../../../src/tools/video/google-flow-result-import.js';

const roots: string[] = [];
const execFile = promisify(rawExecFile);
const FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture() {
  const resultsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-results-'));
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-import-'));
  roots.push(resultsRoot, outputRoot);
  const handoff = createGoogleFlowHandoff([{
    id: 'pilot-flow-01', characterName: 'Lisa', declaredAdultAge: 28,
    sourcePath: '/catalog/lisa.png', sourceSha256: 'a'.repeat(64),
    motionPrompt: 'gentle cinematic movement', consumerShortIds: ['pilot-fr'], role: 'hero',
  }], {
    sourcePlanSha256: 'f'.repeat(64),
    batchId: 'pilot', model: 'fast', locale: 'fr-FR', durationSeconds: 4,
    aspectRatio: '9:16', upscale4k: false,
    capacity: { darkstar: true, ministar: true, googleFlow: true, remainingFlowCredits: 100, maxFlowCreditsPerBatch: 100 },
  });
  const handoffBytes = Buffer.from(JSON.stringify(handoff));
  return { resultsRoot, outputRoot, handoff, handoffBytes };
}

function mp4(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24)]);
}

describe('Google Flow result import', () => {
  it('copies content-addressed MP4s and leaves them pending human review', async () => {
    const input = await fixture();
    await fs.writeFile(path.join(input.resultsRoot, 'pilot-flow-01.mp4'), mp4());
    const receipt = await importGoogleFlowResults({
      ...input,
      now: () => new Date('2026-07-18T12:00:00Z'),
      normalize: async (source, destination) => fs.copyFile(source, destination),
      probe: async (filename) => ({
        durationSeconds: 4,
        width: 720,
        height: 1280,
        hasVideo: true,
        hasAudio: !filename.includes('-silent.mp4'),
      }),
    });
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      audioPolicy: 'removed-on-import',
      autoPublish: false,
      humanReviewRequired: true,
    });
    expect(receipt.jobs[0]).toMatchObject({
      id: 'pilot-flow-01',
      role: 'hero',
      sourceHadAudio: true,
      probe: { hasAudio: false },
      qaStatus: 'pending-human-review',
    });
    expect(receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(fs.readFile(path.join(input.outputRoot, 'pilot', 'receipt.json'))).resolves.toBeInstanceOf(Buffer);
    expect(reviewGoogleFlowImport({
      receipt,
      expectedReceiptSha256: receipt.receiptSha256,
      reviewer: 'Patrice',
      reason: 'Identity and motion checked frame by frame',
      checks: {
        identity: true,
        anatomy: true,
        motion: true,
        cleanEnd: true,
        noSpeech: true,
        noTextOrLogo: true,
        safeContent: true,
      },
    })).toMatchObject({ status: 'approved-for-editing', autoPublish: false });
  });

  it('rejects missing, disguised and symlinked results', async () => {
    const missing = await fixture();
    await expect(importGoogleFlowResults(missing)).rejects.toThrow();
    const disguised = await fixture();
    await fs.writeFile(path.join(disguised.resultsRoot, 'pilot-flow-01.mp4'), 'not-video');
    await expect(importGoogleFlowResults(disguised)).rejects.toThrow('not an MP4');
    const linked = await fixture();
    const outside = path.join(linked.outputRoot, 'outside.mp4');
    await fs.writeFile(outside, mp4());
    await fs.symlink(outside, path.join(linked.resultsRoot, 'pilot-flow-01.mp4'));
    await expect(importGoogleFlowResults(linked)).rejects.toThrow();
  });

  it('rejects modified handoffs, unexpected result files and stale review hashes', async () => {
    const modified = await fixture();
    await fs.writeFile(path.join(modified.resultsRoot, 'pilot-flow-01.mp4'), mp4());
    modified.handoff.jobs[0]!.prompt = 'changed after handoff';
    modified.handoffBytes = Buffer.from(JSON.stringify(modified.handoff));
    await expect(importGoogleFlowResults(modified)).rejects.toThrow('modified');

    const extra = await fixture();
    await Promise.all([
      fs.writeFile(path.join(extra.resultsRoot, 'pilot-flow-01.mp4'), mp4()),
      fs.writeFile(path.join(extra.resultsRoot, 'unexpected.mp4'), mp4()),
    ]);
    await expect(importGoogleFlowResults(extra)).rejects.toThrow('exactly one MP4');

    const review = await fixture();
    await fs.writeFile(path.join(review.resultsRoot, 'pilot-flow-01.mp4'), mp4());
    const receipt = await importGoogleFlowResults({
      ...review,
      normalize: async (source, destination) => fs.copyFile(source, destination),
      probe: async (filename) => ({
        durationSeconds: 4,
        width: 720,
        height: 1280,
        hasVideo: true,
        hasAudio: !filename.includes('-silent.mp4'),
      }),
    });
    expect(() => reviewGoogleFlowImport({
      receipt,
      expectedReceiptSha256: '0'.repeat(64),
      reviewer: 'Patrice',
      reason: 'Full review completed',
      checks: {
        identity: true,
        anatomy: true,
        motion: true,
        cleanEnd: true,
        noSpeech: true,
        noTextOrLogo: true,
        safeContent: true,
      },
    })).toThrow('SHA-256');
  });

  it.skipIf(!FFMPEG)('removes a real audio track and reprobes the normalized MP4', async () => {
    const input = await fixture();
    const source = path.join(input.resultsRoot, 'pilot-flow-01.mp4');
    await execFile('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=720x1280:r=30:d=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', '-shortest', source,
    ], { timeout: 30_000 });
    const receipt = await importGoogleFlowResults(input);
    expect(receipt.jobs[0]).toMatchObject({ sourceHadAudio: true, probe: { hasAudio: false } });
    const imported = path.join(input.outputRoot, receipt.jobs[0]!.outputFile);
    const { stdout } = await execFile('ffprobe', [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', imported,
    ]);
    expect(stdout.trim()).toBe('');
  }, 30_000);
});
