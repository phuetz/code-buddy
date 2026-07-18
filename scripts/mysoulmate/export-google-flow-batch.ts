#!/usr/bin/env npx tsx

/**
 * Create a browser-assisted Google Flow packet from a MySoulmate Short plan.
 * This script never signs in, calls a paid API, generates media or publishes.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  exportGoogleFlowHandoffFromPlan,
  type GoogleFlowPlanExportOptions,
} from '../../src/tools/video/google-flow-plan-export.js';
import type { GoogleFlowModel } from '../../src/tools/video/google-flow-handoff.js';

function argument(argv: string[], name: string, fallback = ''): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback;
}

function positiveInteger(argv: string[], name: string, fallback: string): number {
  const value = Number.parseInt(argument(argv, name, fallback), 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}

function modelArgument(argv: string[]): GoogleFlowModel {
  const value = argument(argv, 'model', 'fast');
  if (value !== 'lite' && value !== 'fast' && value !== 'quality') {
    throw new Error('--model must be lite, fast or quality');
  }
  return value;
}

function durationArgument(argv: string[]): 4 | 6 | 8 {
  const value = positiveInteger(argv, 'duration', '4');
  if (value !== 4 && value !== 6 && value !== 8) throw new Error('--duration must be 4, 6 or 8');
  return value;
}

export async function runGoogleFlowExport(argv = process.argv): Promise<void> {
  const planPath = path.resolve(argument(argv, 'plan', path.join(process.cwd(), 'youtube-shorts-workspace', 'plan.json')));
  const approvedAssetRoot = path.resolve(
    argument(argv, 'asset-root', process.env.COMPANION_IMAGE_CACHE_ROOT ?? path.join(process.cwd(), 'companion-image-cache')),
  );
  const batchId = argument(argv, 'batch-id', `flow-${new Date().toISOString().slice(0, 10)}`);
  const outputPath = path.resolve(
    argument(argv, 'output', path.join(path.dirname(planPath), 'google-flow', `${batchId}.json`)),
  );
  const shortId = argument(argv, 'short', '');
  const options: GoogleFlowPlanExportOptions = {
    approvedAssetRoot,
    batchId,
    model: modelArgument(argv),
    durationSeconds: durationArgument(argv),
    aspectRatio: argument(argv, 'aspect', '9:16') === '16:9' ? '16:9' : '9:16',
    upscale4k: argv.includes('--upscale-4k'),
    remainingFlowCredits: positiveInteger(argv, 'remaining-credits', '25000'),
    maxFlowCreditsPerBatch: positiveInteger(argv, 'max-credits', '100'),
    darkstarAvailable: !argv.includes('--no-darkstar'),
    ministarAvailable: !argv.includes('--no-ministar'),
    ...(shortId ? { shortId } : {}),
    ...(argv.includes('--all') ? { includeAllShorts: true } : {}),
  };
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8')) as unknown;
  const handoff = await exportGoogleFlowHandoffFromPlan(plan, options);

  if (!argv.includes('--write')) {
    process.stdout.write(`${JSON.stringify(handoff, null, 2)}\n`);
    return;
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, outputPath);
  process.stdout.write(
    `Prepared ${handoff.jobs.length} Flow job(s), estimated ${handoff.estimatedCredits} credits -> ${outputPath}\n`,
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runGoogleFlowExport().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
