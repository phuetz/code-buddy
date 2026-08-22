#!/usr/bin/env npx tsx

/** Record the mandatory human QA decision for an imported Google Flow batch. */

import { randomUUID } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  reviewGoogleFlowImport,
  type GoogleFlowImportReceipt,
} from '../../src/tools/video/google-flow-result-import.js';

const CHECKS = ['identity', 'anatomy', 'motion', 'cleanEnd', 'noSpeech', 'noTextOrLogo', 'safeContent'] as const;

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]!.trim() : '';
}

async function main(): Promise<void> {
  if (!argument('receipt')) throw new Error('--receipt is required');
  const receiptPath = path.resolve(argument('receipt'));
  const info = await fs.lstat(receiptPath);
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) throw new Error('Import receipt is unsafe');
  const handle = await fs.open(receiptPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let receipt: GoogleFlowImportReceipt;
  try {
    receipt = JSON.parse((await handle.readFile()).toString('utf8')) as GoogleFlowImportReceipt;
  } finally {
    await handle.close();
  }
  const selected = new Set(argument('checks').split(',').map((value) => value.trim()).filter(Boolean));
  if (selected.size !== CHECKS.length || CHECKS.some((check) => !selected.has(check))) {
    throw new Error(`--checks must explicitly contain: ${CHECKS.join(',')}`);
  }
  const review = reviewGoogleFlowImport({
    receipt,
    expectedReceiptSha256: argument('receipt-sha'),
    reviewer: argument('reviewer'),
    reason: argument('reason'),
    checks: {
      identity: true,
      anatomy: true,
      motion: true,
      cleanEnd: true,
      noSpeech: true,
      noTextOrLogo: true,
      safeContent: true,
    },
  });
  const output = path.join(path.dirname(receiptPath), 'human-review.json');
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(temporary, output);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
  process.stdout.write(`Flow batch approved for editing only: ${output}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
