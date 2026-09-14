/**
 * Pre-build validation script for electron-builder.
 *
 * Verifies that all required build artifacts and resources exist before
 * electron-builder packages the application. Exits 0 on success, 1 on failure.
 *
 * Supports a testable API via module.exports.runChecks(rootDir, platform).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { validateRuntimeManifest } = require('../../scripts/runtime-manifest-utils.cjs');

// ANSI color codes
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';
const CODE_BUDDY_PACKAGE_NAME = /^@phuetz\/code-buddy$/;
const CORE_RUNTIME_DIR = '.bundle-resources/core-runtime';

/**
 * Child-process source that imports one staged runtime module in isolation.
 *
 * The runtime is staged below cowork/, itself below the repository, so Node's
 * ancestor lookup finds `cowork/node_modules` and `<repo>/node_modules` and can
 * satisfy a dependency the staged runtime lacks. `<resources>/dist` has no such
 * ancestors. Every resolution landing outside the staged runtime is refused
 * like a missing package — ESM through a resolve hook, CommonJS through
 * Module._resolveFilename — with the codes Node uses, so optional
 * `try { require() }` / `try { await import() }` fallbacks behave as packaged.
 *
 * A failed top-level import that carries a Node error code (resolution errors,
 * refused or native) is reported compactly: `Name [code]: message` plus the
 * frames outside Node internals, the eval wrapper and the data: URL of the hook,
 * so the missing package and its importer stay inside the check detail. Errors
 * without a code (a syntax error, for instance) keep Node's default report.
 */
function confinedImportSource(entryPath, runtimeRoot) {
  const root = JSON.stringify(runtimeRoot);
  const outside = `(file) => {
    const relative = path.relative(${root}, file);
    return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  }`;
  const hook = `import path from 'node:path';
import { fileURLToPath } from 'node:url';
const outside = ${outside};
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.startsWith('file:') && outside(fileURLToPath(resolved.url))) {
    const importer = context.parentURL?.startsWith('file:')
      ? fileURLToPath(context.parentURL)
      : context.parentURL ?? 'the probe entry';
    const error = new Error(
      \`Cannot find package '\${specifier}' imported from \${importer} \` +
        \`(only resolvable outside the staged runtime: \${fileURLToPath(resolved.url)})\`,
    );
    error.code = context.conditions?.includes('require') ? 'MODULE_NOT_FOUND' : 'ERR_MODULE_NOT_FOUND';
    throw error;
  }
  return resolved;
}
`;
  return `import { writeSync } from 'node:fs';
import Module, { register } from 'node:module';
import path from 'node:path';
const outside = ${outside};
register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hook)}));
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const file = resolveFilename.call(this, request, parent, ...rest);
  if (path.isAbsolute(file) && outside(file)) {
    const error = new Error(
      \`Cannot find module '\${request}' required from \${parent?.filename ?? 'an unknown module'} \` +
        \`(only resolvable outside the staged runtime: \${file})\`,
    );
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return file;
};
try {
  await import(${JSON.stringify(pathToFileURL(entryPath).href)});
} catch (error) {
  if (typeof error?.code !== 'string') throw error;
  const frames = String(error.stack ?? '')
    .split('\\n')
    .filter((line) => /^\\s+at /.test(line) && !/data:|node:internal|\\[eval/.test(line));
  const diagnostic = [\`\${error.name} [\${error.code}]: \${error.message}\`, ...frames].join('\\n') + '\\n';
  try {
    writeSync(2, diagnostic.slice(0, 2_000));
  } finally {
    process.exit(1);
  }
}
`;
}

/**
 * Import a staged runtime module in a child Node process, confined to the
 * staged runtime directory.
 *
 * @param {string} rootDir - Cowork project root (child cwd)
 * @param {string} entryPath - Absolute path of the staged module to import
 * @param {string} runtimeRoot - Absolute path of the staged runtime directory
 * @returns {{ ok: boolean; detail?: string }}
 */
function probeStagedImport(rootDir, entryPath, runtimeRoot) {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      confinedImportSource(fs.realpathSync(entryPath), fs.realpathSync(runtimeRoot)),
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', NODE_ENV: 'test' },
    },
  );
  if (probe.status === 0 && !probe.error) return { ok: true };
  return {
    ok: false,
    detail: (probe.error?.message || probe.stderr || probe.stdout || 'ESM import failed')
      .trim()
      .slice(0, 2_000),
  };
}

/**
 * @typedef {'fatal' | 'warn'} Severity
 * @typedef {{ label: string; relPath: string; type: 'file' | 'dir' | 'esm-import' | 'runtime-manifest'; severity: Severity }} CheckSpec
 * @typedef {{ label: string; relPath: string; passed: boolean; severity: Severity; detail?: string }} CheckResult
 */

function validateCoreRuntimeManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      valid: false,
      detail: `Invalid Code Buddy runtime manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, detail: 'Code Buddy runtime manifest must be a JSON object' };
  }
  if (manifest.schemaVersion !== 2) {
    return {
      valid: false,
      detail: `Unsupported Code Buddy runtime manifest schema: ${String(manifest.schemaVersion)}`,
    };
  }

  const corePackage = manifest.corePackage;
  for (const field of ['name', 'version', 'description']) {
    if (typeof corePackage?.[field] !== 'string' || !corePackage[field].trim()) {
      return { valid: false, detail: `Code Buddy runtime manifest is missing corePackage.${field}` };
    }
  }
  if (!CODE_BUDDY_PACKAGE_NAME.test(corePackage.name)) {
    return { valid: false, detail: `Unexpected Code Buddy core package name: ${corePackage.name}` };
  }

  const runtime = manifest.runtime;
  if (
    runtime?.kind !== 'codebuddy-core' ||
    runtime?.compiled !== true ||
    runtime?.moduleFormat !== 'esm' ||
    runtime?.distPath !== 'dist' ||
    runtime?.entrypoint !== 'dist/desktop/codebuddy-engine-adapter.js'
  ) {
    return {
      valid: false,
      detail: 'Code Buddy runtime manifest does not identify the compiled ESM core entrypoint',
    };
  }

  const entrypointPath = path.join(path.dirname(manifestPath), runtime.entrypoint);
  try {
    if (!fs.statSync(entrypointPath).isFile()) {
      return { valid: false, detail: `Code Buddy runtime entrypoint is not a file: ${runtime.entrypoint}` };
    }
  } catch {
    return { valid: false, detail: `Code Buddy runtime entrypoint is missing: ${runtime.entrypoint}` };
  }

  const distPackagePath = path.join(path.dirname(manifestPath), 'dist', 'package.json');
  try {
    const distPackage = JSON.parse(fs.readFileSync(distPackagePath, 'utf8'));
    const keys = distPackage && typeof distPackage === 'object' && !Array.isArray(distPackage)
      ? Object.keys(distPackage).sort()
      : [];
    if (
      distPackage?.private !== true ||
      distPackage?.type !== 'module' ||
      keys.join(',') !== 'private,type'
    ) {
      return {
        valid: false,
        detail: 'Code Buddy dist/package.json must be exactly the staged private ESM marker',
      };
    }
  } catch {
    return {
      valid: false,
      detail: 'Code Buddy dist/package.json is missing or invalid',
    };
  }

  if (
    manifest.sourceRevision !== null &&
    (typeof manifest.sourceRevision !== 'string' || !/^[0-9a-f]{7,64}$/i.test(manifest.sourceRevision))
  ) {
    return { valid: false, detail: 'Code Buddy runtime manifest has an invalid sourceRevision' };
  }
  if (
    manifest.sourceRevision !== null &&
    (typeof manifest.sourceRevisionOrigin !== 'string' || !manifest.sourceRevisionOrigin.trim())
  ) {
    return { valid: false, detail: 'Code Buddy runtime manifest has no sourceRevisionOrigin' };
  }
  if (
    manifest.sourceDirty !== undefined &&
    manifest.sourceDirty !== null &&
    typeof manifest.sourceDirty !== 'boolean'
  ) {
    return { valid: false, detail: 'Code Buddy runtime manifest has an invalid sourceDirty' };
  }

  try {
    validateRuntimeManifest(path.dirname(manifestPath), manifest);
  } catch (error) {
    return {
      valid: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return { valid: true };
}

/**
 * Build the list of checks for the given platform and arch.
 *
 * @param {string} platform - Node.js process.platform value
 * @param {string} arch - Node.js process.arch value
 * @returns {CheckSpec[]}
 */
function buildCheckList(platform, arch) {
  /** @type {CheckSpec[]} */
  const checks = [
    // Common checks (all platforms, FATAL)
    {
      label: 'GUI Operate MCP server bundle',
      relPath: '.bundle-resources/mcp/gui-operate-server.js',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Software Dev MCP server bundle',
      relPath: '.bundle-resources/mcp/software-dev-server-example.js',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Electron main process output (dist-electron/)',
      relPath: 'dist-electron',
      type: 'dir',
      severity: 'fatal',
    },
    {
      label: 'Renderer output (dist/)',
      relPath: 'dist',
      type: 'dir',
      severity: 'fatal',
    },
    {
      label: 'Built-in skills directory (.claude/skills/)',
      relPath: '.claude/skills',
      type: 'dir',
      severity: 'warn',
    },
    {
      // electron-builder has npmRebuild disabled so optional ws accelerators
      // don't force a Visual Studio toolchain on Windows. Keep the required
      // SQLite Electron binding explicit instead.
      label: 'better-sqlite3 Electron binding (run `npm install` or `npm run rebuild` in cowork)',
      relPath: 'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      type: 'file',
      severity: 'fatal',
    },
    {
      // This is an execution probe, not only an existence check. Importing the
      // staged adapter from a child Node process proves that its first bare ESM
      // dependency (logger -> chalk) resolves from the sibling runtime
      // node_modules exactly as it will under `<resources>/dist`.
      label: 'Self-contained Code Buddy core adapter + bare ESM dependencies',
      relPath: '.bundle-resources/core-runtime/dist/desktop/codebuddy-engine-adapter.js',
      type: 'esm-import',
      severity: 'fatal',
    },
    {
      // Companion sessions fail closed when this module cannot be loaded from
      // the packaged core runtime. Keep it as a first-class packaging gate.
      label: 'Code Buddy companion relationship safety gate',
      relPath: '.bundle-resources/core-runtime/dist/conversation/relationship-safety.js',
      type: 'file',
      severity: 'fatal',
    },
    {
      // Deep companion turns load this module dynamically. Import it during
      // packaging so its critic/runtime dependency closure cannot disappear
      // silently from a shipped Cowork build.
      label: 'Code Buddy companion semantic response gate',
      relPath: '.bundle-resources/core-runtime/dist/conversation/semantic-response-runtime.js',
      type: 'esm-import',
      severity: 'fatal',
    },
    {
      // The adapter imports CodeBuddyAgent lazily on the first prompt. Probe it
      // independently so a package can never pass startup and then fail only
      // when the user sends the first message.
      label: 'Code Buddy agent lazy-import dependency closure',
      relPath: '.bundle-resources/core-runtime/dist/agent/codebuddy-agent.js',
      type: 'esm-import',
      severity: 'fatal',
    },
    {
      // Cowork's slash commands load this gateway on demand. Its handlers
      // statically import root optional packages that prepare-core-runtime
      // stages on purpose (COWORK_REQUIRED_OPTIONAL_DEPENDENCIES): no release
      // may ship without a loadable slash-command gateway.
      label: 'Code Buddy slash-command gateway dependency closure',
      relPath: '.bundle-resources/core-runtime/dist/commands/headless-slash.js',
      type: 'esm-import',
      severity: 'fatal',
    },
    {
      label: 'Code Buddy staged ESM package boundary',
      relPath: '.bundle-resources/core-runtime/dist/package.json',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Code Buddy staged bare dependency (chalk)',
      relPath: '.bundle-resources/core-runtime/node_modules/chalk/package.json',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Code Buddy staged Electron-native SQLite binding',
      relPath:
        '.bundle-resources/core-runtime/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      type: 'file',
      severity: 'fatal',
    },
    {
      label: 'Code Buddy runtime manifest',
      relPath: '.bundle-resources/core-runtime/codebuddy-runtime.json',
      type: 'runtime-manifest',
      severity: 'fatal',
    },
  ];

  if (platform === 'darwin') {
    checks.push(
      {
        label: `Node.js binary for macOS ${arch}`,
        relPath: `resources/node/darwin-${arch}/bin/node`,
        type: 'file',
        severity: 'fatal',
      },
      {
        label: 'Lima sandbox agent bundle (dist-lima-agent/index.js)',
        relPath: 'dist-lima-agent/index.js',
        type: 'file',
        severity: 'fatal',
      },
      {
        label: `Python runtime for macOS ${arch} (GUI automation)`,
        relPath: `resources/python/darwin-${arch}`,
        type: 'dir',
        severity: 'warn',
      },
      {
        label: `CLI tools for macOS ${arch} (cliclick)`,
        relPath: `resources/tools/darwin-${arch}`,
        type: 'dir',
        severity: 'warn',
      }
    );
  } else if (platform === 'win32') {
    checks.push(
      {
        label: 'Node.js binary for Windows x64',
        relPath: 'resources/node/win32-x64/node.exe',
        type: 'file',
        severity: 'fatal',
      },
      {
        label: 'WSL sandbox agent bundle (dist-wsl-agent/index.js)',
        relPath: 'dist-wsl-agent/index.js',
        type: 'file',
        severity: 'fatal',
      }
    );
  } else if (platform === 'linux') {
    checks.push({
      label: 'Node.js directory for Linux x64',
      relPath: 'resources/node/linux-x64',
      type: 'dir',
      severity: 'fatal',
    });
  }

  return checks;
}

/**
 * Run all pre-build checks and return results.
 *
 * @param {string} rootDir - Absolute path to the project root to check against
 * @param {string} platform - Node.js platform string (e.g. 'darwin', 'win32', 'linux')
 * @param {string} [arch] - Node.js arch string (e.g. 'x64', 'arm64'); defaults to process.arch
 * @returns {{ results: CheckResult[]; passed: number; warnings: number; failed: number; hasFatal: boolean }}
 */
function runChecks(rootDir, platform, arch) {
  const resolvedArch = arch || process.arch;
  const checks = buildCheckList(platform, resolvedArch);

  let passed = 0;
  let warnings = 0;
  let failed = 0;

  /** @type {CheckResult[]} */
  const results = [];

  for (const check of checks) {
    const absolutePath = path.join(rootDir, check.relPath);
    let exists = false;
    let detail;

    try {
      const stat = fs.statSync(absolutePath);
      exists = check.type === 'dir' ? stat.isDirectory() : stat.isFile();
      if (exists && check.type === 'esm-import') {
        const probe = probeStagedImport(rootDir, absolutePath, path.join(rootDir, CORE_RUNTIME_DIR));
        exists = probe.ok;
        detail = probe.detail;
      }
      if (exists && check.type === 'runtime-manifest') {
        const validation = validateCoreRuntimeManifest(absolutePath);
        exists = validation.valid;
        if (!validation.valid) detail = validation.detail;
      }
    } catch {
      exists = false;
    }

    if (exists) {
      passed += 1;
      console.log(`${GREEN}[pass]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
    } else if (check.severity === 'warn') {
      warnings += 1;
      console.log(`${YELLOW}[warn]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
      if (detail) console.log(`       ${detail}`);
    } else {
      failed += 1;
      console.log(`${RED}[fail]${RESET} ${check.label}`);
      console.log(`       ${check.relPath}`);
      if (detail) console.log(`       ${detail}`);
    }

    results.push({
      label: check.label,
      relPath: check.relPath,
      passed: exists,
      severity: check.severity,
      ...(detail ? { detail } : {}),
    });
  }

  const hasFatal = failed > 0;
  return { results, passed, warnings, failed, hasFatal };
}

/**
 * CLI entry point: run checks against the project root and exit with appropriate code.
 */
function main() {
  const PROJECT_ROOT = path.join(__dirname, '..');

  console.log('\nRunning pre-build checks...\n');

  const { passed, warnings, failed, hasFatal } = runChecks(PROJECT_ROOT, process.platform);

  console.log(`\nPre-build check: ${passed} passed, ${warnings} warnings, ${failed} failed`);

  if (hasFatal) {
    console.log(
      `\n${RED}Build aborted. Fix the above issues before running electron-builder.${RESET}\n`
    );
    process.exit(1);
  }

  console.log('');
  process.exit(0);
}

module.exports = { runChecks, buildCheckList, probeStagedImport, validateCoreRuntimeManifest };

if (require.main === module) {
  main();
}
