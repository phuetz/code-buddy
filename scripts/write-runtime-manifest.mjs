#!/usr/bin/env node

/**
 * Generate the attested identity consumed by operational self-inspection in a
 * dist-only npm installation. The file is generated, ignored by Git, and
 * explicitly included in the npm package allowlist.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_SCHEMA_VERSION = 2;
export const CORE_RUNTIME_ENTRYPOINT = 'dist/desktop/codebuddy-engine-adapter.js';

const require = createRequire(import.meta.url);
const {
  CODE_BUDDY_PACKAGE_NAME,
  computeDistDigest,
  validateRuntimeManifest,
} = require('./runtime-manifest-utils.cjs');

function requiredString(record, field, source) {
  const value = record?.[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Code Buddy package manifest has no valid ${field}: ${source}`);
  }
  return value.trim();
}

function normalizeRevision(value) {
  if (typeof value !== 'string') return null;
  const revision = value.trim();
  return /^[a-f0-9]{7,64}$/i.test(revision) ? revision.toLowerCase() : null;
}

function normalizeDirty(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

function readCorePackageIdentity(root) {
  const packagePath = join(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const corePackage = {
    name: requiredString(packageJson, 'name', packagePath),
    version: requiredString(packageJson, 'version', packagePath),
    description: requiredString(packageJson, 'description', packagePath),
  };
  if (!CODE_BUDDY_PACKAGE_NAME.test(corePackage.name)) {
    throw new Error(`Unexpected Code Buddy package name ${corePackage.name}: ${packagePath}`);
  }
  return corePackage;
}

export function resolveSourceRevision(root, env = process.env, run = spawnSync) {
  for (const [name, value] of [
    ['CODEBUDDY_SOURCE_REVISION', env.CODEBUDDY_SOURCE_REVISION],
    ['GITHUB_SHA', env.GITHUB_SHA],
    ['CI_COMMIT_SHA', env.CI_COMMIT_SHA],
    ['VERCEL_GIT_COMMIT_SHA', env.VERCEL_GIT_COMMIT_SHA],
    ['SOURCE_VERSION', env.SOURCE_VERSION],
  ]) {
    const revision = normalizeRevision(value);
    if (revision) {
      return {
        revision,
        origin: `env:${name}`,
        dirty: normalizeDirty(env.CODEBUDDY_SOURCE_DIRTY),
      };
    }
  }
  try {
    const result = run('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 2_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const revision = result.status === 0 && !result.error
      ? normalizeRevision(result.stdout)
      : null;
    if (!revision) return null;
    const status = run('git', [
      'status',
      '--porcelain=v1',
      '--untracked-files=normal',
      '--',
      '.',
      ':(exclude).codebuddy/**',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 2_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const dirty = status.status === 0 && !status.error
      ? Boolean(String(status.stdout ?? '').trim())
      : null;
    return { revision, origin: 'git', dirty };
  } catch {
    return null;
  }
}

export function writeRuntimeManifest(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const entrypoint = join(root, CORE_RUNTIME_ENTRYPOINT);
  const corePackage = readCorePackageIdentity(root);
  if (!statSync(entrypoint).isFile()) {
    throw new Error(`Code Buddy compiled entrypoint is missing: ${entrypoint}`);
  }

  const sourceRevision = resolveSourceRevision(root);
  const manifest = {
    schemaVersion: RUNTIME_SCHEMA_VERSION,
    corePackage,
    sourceRevision: sourceRevision?.revision ?? null,
    sourceDirty: sourceRevision?.dirty ?? null,
    ...(sourceRevision ? { sourceRevisionOrigin: sourceRevision.origin } : {}),
    distDigest: computeDistDigest(root),
    runtime: {
      kind: 'codebuddy-core',
      compiled: true,
      moduleFormat: 'esm',
      distPath: 'dist',
      entrypoint: CORE_RUNTIME_ENTRYPOINT,
    },
  };
  const target = join(root, 'codebuddy-runtime.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  renameSync(temporary, target);
  return { target, manifest };
}

export function verifyRuntimeManifest(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const target = join(root, 'codebuddy-runtime.json');
  const manifest = JSON.parse(readFileSync(target, 'utf8'));
  // The model registry reads this file beside its compiled module.
  try {
    if (!statSync(join(root, 'dist/config/models-snapshot.json')).isFile()) {
      throw new Error('not a file');
    }
  } catch {
    throw new Error('Code Buddy compiled runtime is missing dist/config/models-snapshot.json; run npm run build');
  }
  validateRuntimeManifest(root, manifest);
  const corePackage = readCorePackageIdentity(root);
  for (const field of ['name', 'version', 'description']) {
    if (manifest.corePackage?.[field] !== corePackage[field]) {
      throw new Error(
        `Code Buddy runtime manifest corePackage.${field} does not match package.json; run npm run build`,
      );
    }
  }
  return { target, manifest };
}

function cliRoot(argv) {
  const index = argv.indexOf('--root');
  return index >= 0 && argv[index + 1] ? resolve(argv[index + 1]) : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const verify = argv.includes('--verify');
    const result = verify
      ? verifyRuntimeManifest(cliRoot(argv))
      : writeRuntimeManifest(cliRoot(argv));
    process.stdout.write(
      `${verify ? 'Verified' : 'Generated'} Code Buddy runtime manifest: ${result.target}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
