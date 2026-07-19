#!/usr/bin/env npx tsx

/** Create digest-bound technical and human-review receipts for a private YouTube master. */

import { randomUUID } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  createPrivateYouTubeBundle,
  requestYouTubeMasterChanges,
  reviewYouTubeMaster,
  validateYouTubeMasterBundle,
  type YouTubeHumanReviewReceipt,
  type YouTubeTechnicalReport,
} from '../../src/tools/video/youtube-master-quality.js';

const REQUIRED_CHECKS = ['voice', 'lipSync', 'identity', 'anatomy', 'captions', 'disclosure', 'editorial'] as const;

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]!.trim() : '';
}

function command(): 'technical' | 'review' | 'request-changes' | 'bundle' {
  const value = process.argv[2];
  if (value !== 'technical' && value !== 'review' && value !== 'request-changes' && value !== 'bundle') {
    throw new Error('Usage: review-youtube-master.ts technical|review|request-changes|bundle --video /absolute/master.mp4 [...]');
  }
  return value;
}

async function atomicCreate(filename: string, contents: string): Promise<void> {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(temporary, filename);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function regularJson<T>(filename: string): Promise<T> {
  if (!path.isAbsolute(filename) || filename.includes('\0')) throw new Error('Receipt path must be absolute');
  const handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) {
      throw new Error('Receipt must be a regular non-symlink JSON file smaller than 1 MiB');
    }
    return JSON.parse((await handle.readFile()).toString('utf8')) as T;
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const action = command();
  const videoPath = path.resolve(argument('video'));
  if (!argument('video')) throw new Error('--video is required');
  const currentReport = await validateYouTubeMasterBundle({ videoPath });

  if (action === 'technical') {
    const output = argument('output') ? path.resolve(argument('output')) : `${videoPath}.technical.json`;
    await atomicCreate(output, `${JSON.stringify(currentReport, null, 2)}\n`);
    process.stdout.write(`Technical receipt created: ${output}\n`);
    return;
  }

  const technicalPath = argument('technical') ? path.resolve(argument('technical')) : `${videoPath}.technical.json`;
  const storedReport = await regularJson<YouTubeTechnicalReport>(technicalPath);
  if (
    storedReport.schemaVersion !== 2 || storedReport.status !== 'technical-approved' ||
    storedReport.videoSha256 !== currentReport.videoSha256 ||
    storedReport.sidecarSha256 !== currentReport.sidecarSha256 ||
    storedReport.captionSha256 !== currentReport.captionSha256
  ) {
    throw new Error('Stored technical receipt is stale or differs from a fresh validation');
  }
  if (action === 'bundle') {
    if (!argument('review-receipt') || !argument('output-dir')) {
      throw new Error('bundle requires --review-receipt and --output-dir');
    }
    const review = await regularJson<YouTubeHumanReviewReceipt>(path.resolve(argument('review-receipt')));
    const bundle = await createPrivateYouTubeBundle({
      videoPath,
      report: storedReport,
      review,
      outputRoot: path.resolve(argument('output-dir')),
    });
    process.stdout.write(`Private upload bundle created locally: ${bundle.directory}\n`);
    return;
  }
  const reviewer = argument('reviewer');
  const reason = argument('reason');
  const checksArgument = action === 'request-changes' ? argument('failed-checks') : argument('checks');
  const selectedChecks = new Set(checksArgument.split(',').map((value) => value.trim()).filter(Boolean));
  const unknown = [...selectedChecks].filter((value) => !REQUIRED_CHECKS.includes(value as typeof REQUIRED_CHECKS[number]));
  if (unknown.length || (action === 'review' && REQUIRED_CHECKS.some((check) => !selectedChecks.has(check)))) {
    throw new Error(`--checks must explicitly contain: ${REQUIRED_CHECKS.join(',')}`);
  }
  if (action === 'request-changes' && selectedChecks.size === 0) {
    throw new Error(`--failed-checks must contain at least one of: ${REQUIRED_CHECKS.join(',')}`);
  }
  const checks = Object.fromEntries(REQUIRED_CHECKS.map((check) => [
    check,
    action === 'review' || !selectedChecks.has(check),
  ])) as Record<typeof REQUIRED_CHECKS[number], boolean>;
  const receipt = action === 'request-changes'
    ? await requestYouTubeMasterChanges({
      report: storedReport,
      expectedVideoSha256: currentReport.videoSha256,
      reviewer,
      reason,
      checks,
    })
    : await reviewYouTubeMaster({
      report: storedReport,
      expectedVideoSha256: currentReport.videoSha256,
      reviewer,
      reason,
      checks,
    });
  const output = argument('output')
    ? path.resolve(argument('output'))
    : action === 'request-changes'
      ? `${videoPath}.changes.${currentReport.videoSha256.slice(0, 16)}.json`
      : `${videoPath}.review.${currentReport.videoSha256.slice(0, 16)}.json`;
  await atomicCreate(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(action === 'request-changes'
    ? `Changes-requested receipt created; upload remains blocked: ${output}\n`
    : `Human-review receipt created for private upload only: ${output}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
