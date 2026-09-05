#!/usr/bin/env node
/**
 * Cowork is a nested package. `husky` looks for `.git` in *this* directory
 * and prints `.git can't be found` when the real repo lives one level up.
 * Skip unless Cowork itself is a git root.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const coworkRoot = path.resolve(__dirname, '..');
const gitDir = path.join(coworkRoot, '.git');

if (!fs.existsSync(gitDir)) {
  console.log("husky: skipped (cowork/ is not a git root; parent repo owns hooks)");
  process.exit(0);
}

const result = spawnSync('husky', [], {
  cwd: coworkRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status === null ? 1 : result.status);
