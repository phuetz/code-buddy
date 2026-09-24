#!/usr/bin/env node
/**
 * Optional-dependency guard for the type check.
 *
 * `optionalDependencies` may fail to install — silently, by design. When one of
 * them is also imported from `src/`, `tsc --noEmit` then fails with a TS2307
 * that blames the source code, although nothing in the source changed.
 *
 * Measured on CI run 35615398145 (2026-09-21): the Windows/Node 22 leg installed
 * 1831 packages where the Windows/Node 20 leg of the SAME run installed 1842.
 * Only the former went red — on `@xenova/transformers`, whose runtime import is
 * correctly wrapped in a try/catch. Nothing in the npm log said a package had
 * been skipped.
 *
 * This guard turns that silence into a named, actionable failure, and can repair
 * it in place.
 *
 * Usage:
 *   node scripts/check-optional-deps.mjs            # report only, exit 1 if missing
 *   node scripts/check-optional-deps.mjs --install  # try one targeted reinstall first
 *
 * Exit codes:
 *   0 - every optional dependency imported from src/ is present
 *   1 - at least one is missing (and could not be reinstalled, with --install)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// CHECK_OPTIONAL_DEPS_ROOT lets the tests run the guard against a fixture repository.
const ROOT = path.resolve(process.env.CHECK_OPTIONAL_DEPS_ROOT ?? path.join(import.meta.dirname, '..'));
const SRC = path.join(ROOT, 'src');
const SHOULD_INSTALL = process.argv.includes('--install');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const optional = Object.keys(pkg.optionalDependencies ?? {});

/** Every .ts/.tsx file under src/, excluding what tsconfig excludes. */
function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '_archived' || entry === 'node_modules') continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Drop comments before matching. Without this, prose such as
 * "// Use a non-literal specifier so tsc doesn't require 'usearch'" reads as
 * `require 'usearch'`: measured on PR #195 (2026-09-23), where the guard failed
 * the Windows/Node 20 leg over `usearch`, a package the source deliberately
 * loads through a non-literal specifier that tsc never resolves. Line comments
 * are only stripped after a character that cannot end a URL scheme, so
 * `'http://…'` inside a string survives.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/** Modules the source resolves by name — the ones tsc needs types for. */
function importedFromSource(modules) {
  const files = sourceFiles(SRC);
  const patterns = new Map(
    modules.map((m) => {
      const escaped = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [m, new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${escaped}(?:/[^'"]*)?['"]`)];
    })
  );
  const found = new Set();
  for (const file of files) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const [m, re] of patterns) {
      if (!found.has(m) && re.test(text)) found.add(m);
    }
    if (found.size === patterns.size) break;
  }
  return [...found];
}

const needed = importedFromSource(optional).sort();
const missing = needed.filter((m) => !existsSync(path.join(ROOT, 'node_modules', m)));

if (missing.length === 0) {
  console.log(`[optional-deps] ${needed.length} optional packages imported from src/ — all present.`);
  process.exit(0);
}

console.warn(
  `[optional-deps] ${missing.length}/${needed.length} optional package(s) imported from src/ are MISSING:`
);
for (const m of missing) console.warn(`  - ${m}`);
console.warn(
  '[optional-deps] npm skips a failed optional dependency without an error line, so this\n' +
    '                would otherwise surface as a TS2307 blaming src/ during the type check.'
);

if (!SHOULD_INSTALL) {
  console.error('[optional-deps] Re-run with --install to attempt a targeted reinstall.');
  process.exit(1);
}

console.warn(`[optional-deps] Attempting one targeted reinstall…`);
const specs = missing.map((m) => `${m}@${pkg.optionalDependencies[m]}`);
// On Windows `npm` is `npm.cmd`, a batch file: execFileSync cannot launch it
// without a shell (ENOENT, or EINVAL since Node's CVE-2024-27980 fix), so this
// repair failed on every Windows runner. Through the shell, each spec is quoted:
// cmd.exe treats `^` in `pkg@^1.2.3` as an escape character.
const onWindows = process.platform === 'win32';
try {
  execFileSync(
    'npm',
    ['install', '--no-save', '--include=optional', ...(onWindows ? specs.map((s) => `"${s}"`) : specs)],
    { cwd: ROOT, stdio: 'inherit', shell: onWindows },
  );
} catch (err) {
  // Say why: a bare "failed" hid this defect for two days.
  console.error(`[optional-deps] The reinstall command itself failed: ${err?.message ?? err}`);
}

const stillMissing = missing.filter((m) => !existsSync(path.join(ROOT, 'node_modules', m)));
if (stillMissing.length === 0) {
  console.log('[optional-deps] Repaired — every needed optional package is now present.');
  process.exit(0);
}

console.error(`[optional-deps] STILL MISSING after reinstall: ${stillMissing.join(', ')}`);
console.error(
  '[optional-deps] The type check will fail on these. Either install them on this runner\n' +
    '                or give each one a fallback that does not shadow the real types.'
);
process.exit(1);
