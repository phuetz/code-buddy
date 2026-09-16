#!/usr/bin/env node
/** One-time repair for the exact test records reported on 2026-09-14.
 * Preview by default; --apply removes lockfile rows only after making a backup.
 * Skill files and all other records are preserved.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const reportedFixtures = new Set([
  'healthy-helper', 'tampered-helper', 'missing-helper',
  'custom-disable-test', 'custom-prompt-disable-test',
  'research-reviewed-workflow', 'research-cli-reviewed-workflow', 'research-cli-repeat-workflow',
  'learned-real-review', 'learned-current', 'already-installed',
]);

export function repairReportedTestRecords(lockfilePath, apply = false) {
  if (!fs.existsSync(lockfilePath)) return { removed: [], candidates: [], applied: false };
  const original = fs.readFileSync(lockfilePath, 'utf8');
  const data = JSON.parse(original);
  if (!data.skills || typeof data.skills !== 'object' || Array.isArray(data.skills)) {
    throw new Error('Unrecognized skill lockfile; no changes made.');
  }
  const candidates = Object.keys(data.skills).filter(name => reportedFixtures.has(name) && data.skills[name]?.name === name);
  if (!apply || candidates.length === 0) return { candidates, removed: [], applied: false };
  const suffix = `${Date.now()}-${process.pid}`;
  const backup = `${lockfilePath}.before-test-repair-${suffix}.json`;
  fs.copyFileSync(lockfilePath, backup, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(backup, 0o600);
  for (const name of candidates) delete data.skills[name];
  data.updatedAt = new Date().toISOString();
  const temporary = `${lockfilePath}.${suffix}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (fs.readFileSync(lockfilePath, 'utf8') !== original) throw new Error('Lockfile changed during repair; close Buddy and retry.');
    fs.renameSync(temporary, lockfilePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { applied: true, candidates, removed: candidates, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = repairReportedTestRecords(path.join(os.homedir(), '.codebuddy', 'hub', 'lock.json'), process.argv.includes('--apply'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
