#!/usr/bin/env npx tsx

/** Import already-generated Flow MP4s. Never signs in, generates, spends or publishes. */

import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { importGoogleFlowResults } from '../../src/tools/video/google-flow-result-import.js';
import type { GoogleFlowHandoff } from '../../src/tools/video/google-flow-handoff.js';

function argument(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const handoffPath = path.resolve(argument('handoff'));
  const resultsRoot = path.resolve(argument('results-dir'));
  const outputRoot = path.resolve(argument('output-dir', path.join(path.dirname(handoffPath), 'imported')));
  if (!argument('handoff') || !argument('results-dir')) {
    throw new Error('--handoff and --results-dir are required');
  }
  const handle = await fs.open(handoffPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let handoffBytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > 10 * 1024 * 1024) throw new Error('Flow handoff is unsafe');
    handoffBytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  const handoff = JSON.parse(handoffBytes.toString('utf8')) as GoogleFlowHandoff;
  const receipt = await importGoogleFlowResults({ handoff, handoffBytes, resultsRoot, outputRoot });
  process.stdout.write(`Imported ${receipt.jobs.length} Flow result(s) as pending human review -> ${outputRoot}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
