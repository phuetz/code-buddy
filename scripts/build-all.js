#!/usr/bin/env node
/**
 * Unified build script for Code Buddy CLI + Desktop GUI.
 *
 * Steps:
 *   1. tsc        — compile Code Buddy engine (src/ → dist/)
 *   2. vite build — compile Cowork renderer + main process
 *   3. electron-builder — package into installer (optional, with --pack flag)
 *
 * Usage:
 *   node scripts/build-all.js           # build engine + GUI
 *   node scripts/build-all.js --pack    # build + package installer
 */

import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const coworkDir = resolve(projectRoot, 'cowork');
const pack = process.argv.includes('--pack');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const npx = isWin ? 'npx.cmd' : 'npx';

function run(cmd, args, cwd = projectRoot) {
  console.log(`\n  → ${cmd} ${args.join(' ')}  (cwd: ${cwd})\n`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// ─── Step 1: Build Code Buddy engine ───────────────────────────────────────
console.log('\n═══ Step 1/3: Building Code Buddy engine ═══');
run(npx, ['tsc']);

// ─── Step 2: Build Cowork GUI ──────────────────────────────────────────────
if (existsSync(coworkDir)) {
  console.log('\n═══ Step 2/3: Building Cowork desktop app ═══');

  // Install cowork deps if needed
  if (!existsSync(resolve(coworkDir, 'node_modules'))) {
    console.log('  Installing Cowork dependencies...');
    run(npm, ['install'], coworkDir);
  }

  run(npx, ['vite', 'build'], coworkDir);

  // ─── Step 3: Package installer (optional) ────────────────────────────────
  if (pack) {
    console.log('\n═══ Step 3/3: Packaging installer ═══');
    // The embedded runtime and the Cowork main process both load
    // better-sqlite3 from Electron. Rebuild it before staging the runtime so
    // the packaging path has the same ABI guarantee as `cowork npm run build`.
    run(npm, ['run', 'rebuild'], coworkDir);
    // The embedded core lives outside app.asar at resources/dist. Stage its
    // production dependency closure beside it before electron-builder runs;
    // otherwise bare imports such as `chalk` cannot resolve in production.
    run(process.execPath, ['scripts/prepare-core-runtime.js'], coworkDir);
    run(process.execPath, ['scripts/pre-build-check.js'], coworkDir);
    run(npx, ['electron-builder', '--config', 'electron-builder.yml'], coworkDir);
  } else {
    console.log('\n═══ Step 3/3: Skipped (no --pack flag) ═══');
  }
} else {
  console.log('\n═══ Step 2/3: Skipped (cowork/ not found) ═══');
  console.log('═══ Step 3/3: Skipped ═══');
}

console.log('\n  ✓ Build complete.\n');
