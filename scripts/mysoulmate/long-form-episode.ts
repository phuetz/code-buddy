#!/usr/bin/env npx tsx

/** Prepare or assemble a private, original, eight-to-twenty-minute YouTube episode. */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import {
  assembleLongFormMaster,
  compileLongFormRenderPacket,
  reviewLongFormMaster,
} from '../../src/tools/video/long-form-production.js';
import type { LongFormEpisodePlan } from '../../src/tools/video/long-form-plan.js';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]!.trim() : '';
}

async function atomicWrite(filename: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, filename);
}

async function atomicCreate(filename: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!['prepare', 'assemble', 'review'].includes(action ?? '')) {
    throw new Error('Usage: long-form-episode.ts prepare|assemble|review [options]');
  }
  if (action === 'review') {
    if (!argument('video')) throw new Error('--video is required for review');
    const requiredChecks = ['voice', 'identity', 'anatomy', 'captions', 'disclosure', 'chapters', 'editorial'] as const;
    const selected = new Set(argument('checks').split(',').map((value) => value.trim()).filter(Boolean));
    if (selected.size !== requiredChecks.length || requiredChecks.some((check) => !selected.has(check))) {
      throw new Error(`--checks must explicitly contain: ${requiredChecks.join(',')}`);
    }
    const video = path.resolve(argument('video'));
    const receipt = await reviewLongFormMaster({
      videoPath: video,
      reviewer: argument('reviewer'),
      reason: argument('reason'),
      checks: { voice: true, identity: true, anatomy: true, captions: true, disclosure: true, chapters: true, editorial: true },
    });
    await atomicCreate(`${video}.review.json`, `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`Long-form master approved for private upload only: ${video}.review.json\n`);
    return;
  }
  if (!argument('plan')) throw new Error('--plan is required');
  const planPath = path.resolve(argument('plan'));
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8')) as LongFormEpisodePlan;
  if (action === 'prepare') {
    const packet = compileLongFormRenderPacket(plan);
    const output = argument('output') ? path.resolve(argument('output')) : path.join(path.dirname(planPath), `${plan.episodeId}.render-packet.json`);
    await atomicWrite(output, `${JSON.stringify(packet, null, 2)}\n`);
    process.stdout.write(`Prepared ${packet.scenes.length} long-form scene job(s), private output only: ${output}\n`);
    return;
  }
  if (!argument('clips-dir') || !argument('project-root')) throw new Error('--clips-dir and --project-root are required for assembly');
  const result = await assembleLongFormMaster({
    plan,
    clipsRoot: path.resolve(argument('clips-dir')),
    projectRoot: path.resolve(argument('project-root')),
  });
  process.stdout.write(`Assembled private long-form master pending human review: ${result.outputPath}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
