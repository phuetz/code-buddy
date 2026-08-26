/**
 * Prepare a self-contained Code Buddy core runtime for electron-builder.
 *
 * The packaged core is loaded from `<resources>/dist`. Node resolves bare ESM
 * imports relative to that physical directory, so dependencies hidden in
 * `app.asar/node_modules` are not visible. This script stages the complete
 * compiled core next to the production dependency closure it needs:
 *
 *   .bundle-resources/core-runtime/
 *     dist/
 *     node_modules/
 *
 * Files are hard-linked when possible (copy fallback), keeping staging fast and
 * space-efficient while electron-builder still receives ordinary files. We do
 * not bundle the core: Cowork dynamically imports many independent core modules
 * and several dependencies ship native binaries/assets that bundlers cannot
 * safely flatten.
 *
 * Root optionalDependencies are deliberately not seeded. They remain optional
 * capabilities, while every dependency (including optional platform helpers)
 * reachable from a required production package is included. Set
 * CODEBUDDY_CORE_INCLUDE_OPTIONAL=1 for a full, larger runtime. Native core
 * staging intentionally fails closed for cross-platform/architecture builds:
 * package on the target host so Electron bindings and optional binaries match.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  validateRuntimeManifest,
} = require('../../scripts/runtime-manifest-utils.cjs');

const CORE_RUNTIME_RELATIVE_PATH = path.join('.bundle-resources', 'core-runtime');
const CORE_RUNTIME_ENTRYPOINT = 'dist/desktop/codebuddy-engine-adapter.js';
const CODE_BUDDY_PACKAGE_NAME = /^@phuetz\/code-buddy$/;
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const MAX_NPM_PACKAGE_NAME_LENGTH = 214;

function isWithinRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertDependencyName(dependencyName) {
  if (
    typeof dependencyName !== 'string' ||
    dependencyName.length === 0 ||
    dependencyName.length > MAX_NPM_PACKAGE_NAME_LENGTH ||
    !NPM_PACKAGE_NAME.test(dependencyName)
  ) {
    throw new Error(`Invalid installed dependency name: ${String(dependencyName)}`);
  }
}

function assertConfinedPath(boundary, candidate, label) {
  if (!isWithinRoot(boundary, candidate)) {
    throw new Error(`${label} escapes its allowed root: ${candidate}`);
  }
}

function requiredPackageString(packageJson, field, packagePath) {
  const value = packageJson[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Code Buddy package manifest has no valid ${field}: ${packagePath}`);
  }
  return value.trim();
}

function readCorePackageIdentity(coreRoot) {
  const packagePath = path.join(coreRoot, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Code Buddy package manifest is missing: ${packagePath}`);
  }
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Code Buddy package manifest is invalid: ${packagePath} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const identity = {
    name: requiredPackageString(packageJson, 'name', packagePath),
    version: requiredPackageString(packageJson, 'version', packagePath),
    description: requiredPackageString(packageJson, 'description', packagePath),
  };
  if (!CODE_BUDDY_PACKAGE_NAME.test(identity.name)) {
    throw new Error(`Unexpected Code Buddy package name ${identity.name}: ${packagePath}`);
  }
  return identity;
}

function normalizeSourceRevision(value) {
  if (typeof value !== 'string') return null;
  const revision = value.trim();
  return /^[0-9a-f]{7,64}$/i.test(revision) ? revision.toLowerCase() : null;
}

function normalizeSourceDirty(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}

/**
 * Resolve the exact source revision without making a Git checkout a packaging
 * requirement. Explicit/CI metadata wins; a best-effort local `git rev-parse`
 * is the fallback. A source archive or machine without Git simply returns null.
 */
function resolveSourceRevision(coreRoot, options = {}) {
  const env = options.env ?? process.env;
  const envCandidates = [
    ['CODEBUDDY_SOURCE_REVISION', env.CODEBUDDY_SOURCE_REVISION],
    ['GITHUB_SHA', env.GITHUB_SHA],
    ['CI_COMMIT_SHA', env.CI_COMMIT_SHA],
    ['VERCEL_GIT_COMMIT_SHA', env.VERCEL_GIT_COMMIT_SHA],
    ['SOURCE_VERSION', env.SOURCE_VERSION],
  ];
  for (const [name, value] of envCandidates) {
    const revision = normalizeSourceRevision(value);
    if (revision) {
      return {
        revision,
        origin: `env:${name}`,
        dirty: normalizeSourceDirty(env.CODEBUDDY_SOURCE_DIRTY),
      };
    }
  }

  const run = options.spawnSync ?? spawnSync;
  try {
    const result = run('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: coreRoot,
      encoding: 'utf8',
      timeout: 2_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const revision = result.status === 0 && !result.error
      ? normalizeSourceRevision(result.stdout)
      : null;
    if (!revision) return null;
    const status = run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
      cwd: coreRoot,
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

function configuredTargetArch(platform) {
  if (platform === 'darwin') return 'arm64';
  if (platform === 'win32' || platform === 'linux') return 'x64';
  return process.arch;
}

function packageParent(packagePath) {
  const match = packagePath.match(/^(.*?)(?:\/)?node_modules\/(?:@[^/]+\/)?[^/]+$/);
  return match ? match[1].replace(/\/$/, '') : '';
}

function supportsValue(values, value) {
  if (!Array.isArray(values) || values.length === 0) return true;
  if (values.includes(`!${value}`)) return false;
  const positive = values.filter((entry) => !entry.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

function supportsCurrentTarget(entry, platform, arch) {
  return supportsValue(entry.os, platform) && supportsValue(entry.cpu, arch);
}

function resolveInstalledDependencyPath(coreRoot, fromPackagePath, dependencyName) {
  assertDependencyName(dependencyName);
  let cursor = fromPackagePath;
  while (true) {
    const candidate = cursor
      ? `${cursor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    const absoluteCandidate = path.resolve(coreRoot, candidate);
    assertConfinedPath(coreRoot, absoluteCandidate, 'Installed dependency path');
    if (fs.existsSync(path.join(absoluteCandidate, 'package.json'))) return candidate;
    if (!cursor) return null;
    const parent = packageParent(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/**
 * Walk the dependency graph that is actually installed on the packaging host.
 * A clean CI install matches package-lock exactly; using installed package.json
 * files also makes local packaging tolerant of a lockfile updated slightly
 * ahead of node_modules, without copying unrelated development dependencies.
 */
function collectInstalledRuntimePackagePaths(coreRoot, options = {}) {
  const platform =
    options.platform ?? process.env.CODEBUDDY_CORE_TARGET_PLATFORM ?? process.platform;
  const arch =
    options.arch ??
    process.env.CODEBUDDY_CORE_TARGET_ARCH ??
    configuredTargetArch(platform);
  const includeRootOptional = options.includeRootOptional === true;
  const rootPackagePath = path.join(coreRoot, 'package.json');
  if (!fs.existsSync(rootPackagePath)) {
    throw new Error(`Code Buddy package manifest is missing: ${rootPackagePath}`);
  }
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const queue = [];
  const included = new Set();

  const enqueueRootGroup = (group, required) => {
    for (const dependencyName of Object.keys(group ?? {})) {
      const resolved = resolveInstalledDependencyPath(coreRoot, '', dependencyName);
      if (resolved) queue.push(resolved);
      else if (required) {
        throw new Error(`Installed production dependency is missing: ${dependencyName} (run npm install)`);
      }
    }
  };
  enqueueRootGroup(rootPackage.dependencies, true);
  if (includeRootOptional) enqueueRootGroup(rootPackage.optionalDependencies, false);

  while (queue.length > 0) {
    const packagePath = queue.pop();
    if (!packagePath || included.has(packagePath)) continue;
    const packageJsonPath = path.join(coreRoot, packagePath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (!supportsCurrentTarget(packageJson, platform, arch)) continue;
    included.add(packagePath);

    const enqueueGroup = (group, required) => {
      for (const dependencyName of Object.keys(group ?? {})) {
        const resolved = resolveInstalledDependencyPath(coreRoot, packagePath, dependencyName);
        if (resolved) queue.push(resolved);
        else if (required) {
          throw new Error(
            `Installed dependency ${dependencyName} required by ${packagePath} is missing (run npm install)`,
          );
        }
      }
    };
    enqueueGroup(packageJson.dependencies, true);
    enqueueGroup(packageJson.optionalDependencies, false);
    enqueueGroup(packageJson.peerDependencies, false);
  }

  return [...included].sort((left, right) => {
    const depthDelta = left.split('/node_modules/').length - right.split('/node_modules/').length;
    return depthDelta || left.localeCompare(right);
  });
}

function copyTreeWithHardlinks(source, destination, options = {}, traversalState) {
  const resolvedSource = fs.realpathSync(source);
  const state = traversalState ?? {
    sourceBoundary: fs.realpathSync(options.sourceBoundary ?? source),
    destinationBoundary: path.resolve(options.destinationBoundary ?? destination),
    activeDirectories: new Set(),
  };
  assertConfinedPath(state.sourceBoundary, resolvedSource, 'Runtime copy source');
  assertConfinedPath(
    state.destinationBoundary,
    path.resolve(destination),
    'Runtime copy destination',
  );

  const sourceStat = fs.lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    // A top-level installed package may itself be a workspace/pnpm link. Its
    // resolved directory becomes the package boundary above. Nested links are
    // dereferenced only when their target remains inside that same package.
    copyTreeWithHardlinks(resolvedSource, destination, options, state);
    return;
  }
  if (sourceStat.isDirectory()) {
    if (state.activeDirectories.has(resolvedSource)) {
      throw new Error(`Circular symlink in runtime package: ${source}`);
    }
    state.activeDirectories.add(resolvedSource);
    fs.mkdirSync(destination, { recursive: true });
    try {
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (options.excludeNestedNodeModules && entry.name === 'node_modules') {
          continue;
        }
        copyTreeWithHardlinks(
          path.join(source, entry.name),
          path.join(destination, entry.name),
          options,
          state,
        );
      }
    } finally {
      state.activeDirectories.delete(resolvedSource);
    }
    return;
  }
  if (!sourceStat.isFile()) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.linkSync(source, destination);
  } catch (error) {
    if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
    fs.copyFileSync(source, destination);
  }
}

function replacePackage(runtimeRoot, packageName, sourcePackagePath) {
  const destination = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'));
  fs.rmSync(destination, { recursive: true, force: true });
  copyTreeWithHardlinks(sourcePackagePath, destination, { excludeNestedNodeModules: true });
}

function prepareCoreRuntime(options = {}) {
  const coworkRoot = path.resolve(options.coworkRoot ?? path.join(__dirname, '..'));
  const coreRoot = path.resolve(options.coreRoot ?? path.join(coworkRoot, '..'));
  const runtimeRoot = path.resolve(
    options.runtimeRoot ?? path.join(coworkRoot, CORE_RUNTIME_RELATIVE_PATH),
  );
  const platform =
    options.platform ?? process.env.CODEBUDDY_CORE_TARGET_PLATFORM ?? process.platform;
  const arch =
    options.arch ??
    process.env.CODEBUDDY_CORE_TARGET_ARCH ??
    configuredTargetArch(platform);
  const includeRootOptional =
    options.includeRootOptional ?? process.env.CODEBUDDY_CORE_INCLUDE_OPTIONAL === '1';
  const coreDist = path.join(coreRoot, 'dist');

  if (
    options.useCoworkNativeOverrides !== false &&
    (platform !== process.platform || arch !== process.arch)
  ) {
    throw new Error(
      `Cross-target core runtime staging is unsafe (${process.platform}/${process.arch} host -> ` +
        `${platform}/${arch} target): build Cowork on the target host so native dependencies match`,
    );
  }

  if (!fs.existsSync(path.join(coreDist, 'desktop', 'codebuddy-engine-adapter.js'))) {
    throw new Error(`Code Buddy core is not built: ${coreDist} (run npm run build at repo root)`);
  }
  const corePackage = readCorePackageIdentity(coreRoot);
  const sourceManifestPath = path.join(coreRoot, 'codebuddy-runtime.json');
  if (!fs.existsSync(sourceManifestPath)) {
    throw new Error(
      `Code Buddy build-time runtime manifest is missing: ${sourceManifestPath} (run npm run build)`,
    );
  }
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  validateRuntimeManifest(coreRoot, sourceManifest);
  for (const field of ['name', 'version', 'description']) {
    if (sourceManifest.corePackage?.[field] !== corePackage[field]) {
      throw new Error(
        `Code Buddy runtime manifest corePackage.${field} does not match package.json; run npm run build`,
      );
    }
  }
  const packagePaths = collectInstalledRuntimePackagePaths(coreRoot, {
    platform,
    arch,
    includeRootOptional,
  });

  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  copyTreeWithHardlinks(coreDist, path.join(runtimeRoot, 'dist'), {
    sourceBoundary: coreRoot,
    destinationBoundary: runtimeRoot,
  });
  fs.writeFileSync(
    path.join(runtimeRoot, 'dist', 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );

  for (const packagePath of packagePaths) {
    const source = path.resolve(coreRoot, packagePath);
    const destination = path.resolve(runtimeRoot, packagePath);
    assertConfinedPath(
      path.join(coreRoot, 'node_modules'),
      source,
      'Installed dependency source',
    );
    assertConfinedPath(
      path.join(runtimeRoot, 'node_modules'),
      destination,
      'Staged dependency destination',
    );
    if (!fs.existsSync(source)) {
      throw new Error(`Installed production dependency is missing: ${source} (run npm install)`);
    }
    copyTreeWithHardlinks(source, destination, {
      excludeNestedNodeModules: true,
      destinationBoundary: runtimeRoot,
    });
  }

  // The root install is compiled for the host Node ABI. Embedded mode runs in
  // Electron, so always stage Cowork's postinstall-rebuilt package for this
  // ABI-sensitive dependency. better-sqlite3 is optional in the core manifest,
  // but mandatory for Cowork, so it may not be present in packagePaths.
  const nativeOverrides = [];
  if (options.useCoworkNativeOverrides !== false) {
    const sqliteSource = path.join(coworkRoot, 'node_modules', 'better-sqlite3');
    const sqliteBinding = path.join(sqliteSource, 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(sqliteBinding)) {
      throw new Error(
        `Cowork better-sqlite3 Electron binding is missing: ${sqliteBinding} (run npm run rebuild)`,
      );
    }
    replacePackage(runtimeRoot, 'better-sqlite3', sqliteSource);
    nativeOverrides.push('better-sqlite3');
  }

  const manifest = {
    ...sourceManifest,
    platform,
    arch,
    includeRootOptional,
    packageCount: packagePaths.length,
    nativeOverrides,
  };
  fs.writeFileSync(
    path.join(runtimeRoot, 'codebuddy-runtime.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  validateRuntimeManifest(runtimeRoot, manifest);
  return { runtimeRoot, packagePaths, manifest };
}

function main() {
  try {
    const result = prepareCoreRuntime();
    console.log(
      `Prepared Code Buddy core runtime: ${result.runtimeRoot} (${result.packagePaths.length} packages)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  CORE_RUNTIME_RELATIVE_PATH,
  CORE_RUNTIME_ENTRYPOINT,
  collectInstalledRuntimePackagePaths,
  copyTreeWithHardlinks,
  prepareCoreRuntime,
  readCorePackageIdentity,
  resolveSourceRevision,
};

if (require.main === module) main();
