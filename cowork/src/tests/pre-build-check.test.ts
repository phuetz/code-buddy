import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

// Import the runChecks function from the CommonJS script using createRequire
const require = createRequire(import.meta.url);
const { runChecks, validateCoreRuntimeManifest } = require('../../scripts/pre-build-check.js');
const { computeDistDigest } = require('../../../scripts/runtime-manifest-utils.cjs') as {
  computeDistDigest: (root: string) => {
    algorithm: string;
    scope: string;
    value: string;
    fileCount: number;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-build-check-test-'));
}

function makeFile(filePath: string, content: string = '// placeholder'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Self-contained staged Code Buddy runtime. The adapter deliberately imports a
 * fake `chalk` package from the sibling node_modules so runChecks exercises the
 * same bare-ESM lookup used in packaged resources, not just file existence.
 */
function populateEngineAdapter(root: string): void {
  const runtime = path.join(root, '.bundle-resources', 'core-runtime');
  makeFile(
    path.join(runtime, 'dist', 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  makeFile(
    path.join(runtime, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
    "import chalk from 'chalk'; if (chalk.blue('ok') !== 'ok') throw new Error('bad chalk'); export class CodeBuddyEngineAdapter {}",
  );
  makeFile(
    path.join(runtime, 'dist', 'conversation', 'relationship-safety.js'),
    'export class RelationshipSafetyStreamGuard {}',
  );
  makeFile(
    path.join(runtime, 'dist', 'conversation', 'semantic-response-runtime.js'),
    'export const shouldReviewSemanticResponse = () => false; export const reviewSemanticResponse = async (input) => ({ response: input.draft });',
  );
  makeFile(
    path.join(runtime, 'dist', 'agent', 'codebuddy-agent.js'),
    "import chalk from 'chalk'; export class CodeBuddyAgent { color = chalk.blue('ok'); }",
  );
  // Slash-command gateway and the two root optional packages Cowork stages for it.
  makeFile(
    path.join(runtime, 'dist', 'commands', 'headless-slash.js'),
    [
      "import stringWidth from 'string-width';",
      "import { GoogleGenerativeAI } from '@google/generative-ai';",
      "if (stringWidth('ok') !== 2 || typeof GoogleGenerativeAI !== 'function') throw new Error('bad slash dependencies');",
      'export async function executeHeadlessSlashToken() { return { handled: true }; }',
    ].join('\n'),
  );
  makeFile(
    path.join(runtime, 'node_modules', 'string-width', 'package.json'),
    JSON.stringify({ type: 'module', exports: './index.js' }),
  );
  makeFile(
    path.join(runtime, 'node_modules', 'string-width', 'index.js'),
    'export default (value) => value.length;',
  );
  makeFile(
    path.join(runtime, 'node_modules', '@google', 'generative-ai', 'package.json'),
    JSON.stringify({ main: 'index.js' }),
  );
  makeFile(
    path.join(runtime, 'node_modules', '@google', 'generative-ai', 'index.js'),
    'exports.GoogleGenerativeAI = class GoogleGenerativeAI {};',
  );
  makeFile(
    path.join(runtime, 'node_modules', 'chalk', 'package.json'),
    JSON.stringify({ type: 'module', exports: './index.js' }),
  );
  makeFile(
    path.join(runtime, 'node_modules', 'chalk', 'index.js'),
    "export default { blue(value) { return value; } };",
  );
  makeFile(
    path.join(
      runtime,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
  );
  makeFile(
    path.join(runtime, 'codebuddy-runtime.json'),
    JSON.stringify({
      schemaVersion: 2,
      corePackage: {
        name: '@phuetz/code-buddy',
        version: '1.8.0',
        description: 'Compiled Code Buddy test runtime',
      },
      sourceRevision: null,
      sourceDirty: null,
      distDigest: computeDistDigest(runtime),
      runtime: {
        kind: 'codebuddy-core',
        compiled: true,
        moduleFormat: 'esm',
        distPath: 'dist',
        entrypoint: 'dist/desktop/codebuddy-engine-adapter.js',
      },
      platform: 'test',
      arch: 'x64',
      packageCount: 2,
    }),
  );
}

function populateSqliteBinding(root: string): void {
  makeFile(
    path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
  );
}

/**
 * Creates all artifacts that are required for a successful darwin/arm64 check.
 */
function populateDarwinArtifacts(root: string, arch: string = 'arm64'): void {
  // Common FATAL resources
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));
  populateSqliteBinding(root);
  populateEngineAdapter(root);

  // macOS FATAL resources
  makeFile(path.join(root, `resources/node/darwin-${arch}/bin/node`));
  makeFile(path.join(root, 'dist-lima-agent/index.js'));
}

/**
 * Creates all artifacts that are required for a successful win32/x64 check.
 */
function populateWin32Artifacts(root: string): void {
  makeFile(path.join(root, '.bundle-resources/mcp/gui-operate-server.js'));
  makeFile(path.join(root, '.bundle-resources/mcp/software-dev-server-example.js'));
  makeDir(path.join(root, 'dist-electron'));
  makeDir(path.join(root, 'dist'));
  makeDir(path.join(root, '.claude/skills'));
  populateSqliteBinding(root);
  populateEngineAdapter(root);
  makeFile(path.join(root, 'resources/node/win32-x64/node.exe'));
  makeFile(path.join(root, 'dist-wsl-agent/index.js'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pre-build-check: runChecks', () => {
  let parentDir: string;
  let tmpDir: string;

  beforeEach(() => {
    // Keep the fixture shaped like the real cowork project so all relative
    // resource paths are exercised without leaking files into /tmp.
    parentDir = makeTempDir();
    tmpDir = path.join(parentDir, 'cowork');
    fs.mkdirSync(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // All-pass scenarios
  // -------------------------------------------------------------------------

  it('passes all FATAL checks on darwin when required artifacts exist', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // 6 common (incl. engine adapter) + 2 darwin FATAL = 8 FATAL checks should pass
    expect(result.passed).toBeGreaterThanOrEqual(8);
  });

  it('passes all FATAL checks on win32 when required artifacts exist', () => {
    populateWin32Artifacts(tmpDir);

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    expect(result.passed).toBeGreaterThanOrEqual(8);
  });

  it('reports warnings for optional darwin resources that are missing', () => {
    // Only populate FATAL items; leave warn items absent
    populateDarwinArtifacts(tmpDir, 'x64');

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.hasFatal).toBe(false);
    // Both python and tools dirs are absent => 2 warnings
    expect(result.warnings).toBe(2);
  });

  it('reports zero warnings when optional darwin resources are present', () => {
    populateDarwinArtifacts(tmpDir, 'x64');
    makeDir(path.join(tmpDir, 'resources/python/darwin-x64'));
    makeDir(path.join(tmpDir, 'resources/tools/darwin-x64'));

    const result = runChecks(tmpDir, 'darwin', 'x64');

    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.hasFatal).toBe(false);
  });

  it('treats missing built-in skills as warning instead of blocking packaging', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, '.claude/skills'), { recursive: true });

    const result = runChecks(tmpDir, 'win32', 'x64');
    const skillsCheck = result.results.find(
      (r: { relPath: string; severity: string }) => r.relPath === '.claude/skills'
    );

    expect(skillsCheck).toMatchObject({
      passed: false,
      severity: 'warn',
    });
    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(1);
    expect(result.hasFatal).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Failure scenarios
  // -------------------------------------------------------------------------

  it('rejects a runtime manifest that attests an unrelated package', () => {
    const manifestPath = path.join(tmpDir, 'codebuddy-runtime.json');
    makeFile(manifestPath, JSON.stringify({
      schemaVersion: 2,
      corePackage: {
        name: '@evil/code-buddy',
        version: '1.0.0',
        description: 'not the core',
      },
    }));

    expect(validateCoreRuntimeManifest(manifestPath)).toMatchObject({
      valid: false,
      detail: expect.stringContaining('Unexpected Code Buddy core package name'),
    });
  });

  it('rejects a staged runtime whose unhashed ESM marker was altered', () => {
    populateWin32Artifacts(tmpDir);
    const runtime = path.join(tmpDir, '.bundle-resources', 'core-runtime');
    makeFile(
      path.join(runtime, 'dist', 'package.json'),
      JSON.stringify({ private: true, type: 'commonjs', main: '../outside.js' }),
    );

    const result = validateCoreRuntimeManifest(path.join(runtime, 'codebuddy-runtime.json'));

    expect(result).toMatchObject({
      valid: false,
      detail: expect.stringContaining('private ESM marker'),
    });
  });

  it('reports hasFatal when a common FATAL file is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    // Remove a required common file
    fs.rmSync(path.join(tmpDir, '.bundle-resources/mcp/gui-operate-server.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the companion relationship gate is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(
      path.join(
        tmpDir,
        '.bundle-resources',
        'core-runtime',
        'dist',
        'conversation',
        'relationship-safety.js',
      ),
    );

    const result = runChecks(tmpDir, 'win32', 'x64');
    const safety = result.results.find((entry: { relPath: string }) =>
      entry.relPath.includes('conversation/relationship-safety.js')
    );
    expect(safety).toMatchObject({ passed: false, severity: 'fatal' });
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the companion semantic response gate is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(
      path.join(
        tmpDir,
        '.bundle-resources',
        'core-runtime',
        'dist',
        'conversation',
        'semantic-response-runtime.js',
      ),
    );

    const result = runChecks(tmpDir, 'win32', 'x64');
    const semanticGate = result.results.find((entry: { relPath: string }) =>
      entry.relPath.includes('conversation/semantic-response-runtime.js'),
    );
    expect(semanticGate).toMatchObject({ passed: false, severity: 'fatal' });
    expect(result.hasFatal).toBe(true);
  });

  describe('slash-command gateway', () => {
    const runtimeModules = () => path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules');
    const gatewayResult = (result: { results: Array<{ relPath: string }> }) =>
      result.results.find((entry) => entry.relPath.endsWith('core-runtime/dist/commands/headless-slash.js'));

    it('passes when the gateway and its staged optional dependencies load', () => {
      populateWin32Artifacts(tmpDir);

      const result = runChecks(tmpDir, 'win32', 'x64');

      expect(gatewayResult(result)).toMatchObject({ passed: true, severity: 'fatal' });
      expect(result.hasFatal).toBe(false);
    });

    it('blocks packaging when the gateway is missing', () => {
      populateWin32Artifacts(tmpDir);
      fs.rmSync(path.join(tmpDir, '.bundle-resources', 'core-runtime', 'dist', 'commands', 'headless-slash.js'));

      const result = runChecks(tmpDir, 'win32', 'x64');

      expect(gatewayResult(result)).toMatchObject({ passed: false, severity: 'fatal' });
      expect(result.hasFatal).toBe(true);
    });

    it.each([
      ['string-width', ['string-width']],
      ['@google/generative-ai', ['@google', 'generative-ai']],
    ])(
      'blocks packaging when %s only exists in the source install, not in the staged runtime',
      (dependency, segments) => {
        populateWin32Artifacts(tmpDir);
        const staged = path.join(runtimeModules(), ...segments);
        fs.cpSync(staged, path.join(parentDir, 'node_modules', ...segments), { recursive: true });
        fs.rmSync(staged, { recursive: true });

        const result = runChecks(tmpDir, 'win32', 'x64');

        const gateway = gatewayResult(result);
        expect(gateway).toMatchObject({ passed: false, severity: 'fatal' });
        expect((gateway as { detail?: string }).detail).toContain(dependency);
        expect(result.hasFatal).toBe(true);
      },
    );
  });

  it('blocks packaging when the core runtime manifest has no compiled identity proof', () => {
    populateWin32Artifacts(tmpDir);
    const manifestPath = path.join(
      tmpDir,
      '.bundle-resources',
      'core-runtime',
      'codebuddy-runtime.json',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      corePackage: { version?: string };
    };
    delete manifest.corePackage.version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = runChecks(tmpDir, 'win32', 'x64');
    const runtimeManifest = result.results.find((entry: { relPath: string }) =>
      entry.relPath.endsWith('codebuddy-runtime.json')
    );

    expect(runtimeManifest).toMatchObject({ passed: false, severity: 'fatal' });
    expect((runtimeManifest as { detail?: string }).detail).toContain('corePackage.version');
    expect(result.hasFatal).toBe(true);
  });

  it('blocks packaging when the staged adapter cannot resolve a bare ESM dependency', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(
      path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules', 'chalk'),
      { recursive: true },
    );

    const result = runChecks(tmpDir, 'win32', 'x64');
    const adapter = result.results.find((entry: { relPath: string }) =>
      entry.relPath.endsWith('desktop/codebuddy-engine-adapter.js')
    );

    expect(adapter).toMatchObject({ passed: false, severity: 'fatal' });
    expect((adapter as { detail?: string }).detail).toContain('chalk');
    expect(result.hasFatal).toBe(true);
  });

  // The fixture parent stands for the repository root: a real checkout keeps
  // node_modules above cowork/.bundle-resources/core-runtime, <resources>/dist does not.
  describe('staged imports ignore ancestor node_modules', () => {
    const stagedImportResults = (result: { results: Array<{ relPath: string }> }) =>
      result.results.filter((entry) =>
        /core-runtime\/dist\/(desktop\/codebuddy-engine-adapter|agent\/codebuddy-agent)\.js$/.test(
          entry.relPath,
        ),
      );

    it('blocks packaging when a staged ESM dependency only resolves from an ancestor', () => {
      populateWin32Artifacts(tmpDir);
      const runtimeChalk = path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules', 'chalk');
      fs.cpSync(runtimeChalk, path.join(parentDir, 'node_modules', 'chalk'), { recursive: true });
      fs.rmSync(runtimeChalk, { recursive: true });

      const probes = stagedImportResults(runChecks(tmpDir, 'win32', 'x64'));

      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(probe).toMatchObject({ passed: false, severity: 'fatal' });
        expect((probe as { detail?: string }).detail).toContain("Cannot find package 'chalk'");
      }
    });

    it('blocks packaging when a staged CommonJS require only resolves from an ancestor', () => {
      populateWin32Artifacts(tmpDir);
      const runtimeChalk = path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules', 'chalk');
      makeFile(path.join(runtimeChalk, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      makeFile(
        path.join(runtimeChalk, 'index.cjs'),
        "require('ancestor-only-cjs'); module.exports = { blue(value) { return value; } };",
      );
      makeFile(path.join(parentDir, 'node_modules', 'ancestor-only-cjs', 'index.js'), 'module.exports = 1;');

      const probes = stagedImportResults(runChecks(tmpDir, 'win32', 'x64'));

      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(probe).toMatchObject({ passed: false, severity: 'fatal' });
        expect((probe as { detail?: string }).detail).toContain("Cannot find module 'ancestor-only-cjs'");
      }
    });

    it('keeps optional fallbacks working when the optional package only exists in an ancestor', () => {
      populateWin32Artifacts(tmpDir);
      const runtimeModules = path.join(tmpDir, '.bundle-resources', 'core-runtime', 'node_modules');
      makeFile(
        path.join(runtimeModules, 'chalk', 'index.js'),
        [
          "import accelerator from 'optional-accelerator';",
          "try { await import('ancestor-only-esm'); throw new Error('ancestor ESM leaked'); }",
          "catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }",
          "if (accelerator !== 'MODULE_NOT_FOUND') throw new Error(`ancestor CJS leaked: ${accelerator}`);",
          'export default { blue(value) { return value; } };',
        ].join('\n'),
      );
      makeFile(path.join(runtimeModules, 'optional-accelerator', 'package.json'), JSON.stringify({ main: 'index.js' }));
      makeFile(
        path.join(runtimeModules, 'optional-accelerator', 'index.js'),
        "try { require('ancestor-only-cjs'); module.exports = 'leaked'; } catch (error) { module.exports = error.code; }",
      );
      makeFile(path.join(parentDir, 'node_modules', 'ancestor-only-cjs', 'index.js'), 'module.exports = 1;');
      makeFile(
        path.join(parentDir, 'node_modules', 'ancestor-only-esm', 'package.json'),
        JSON.stringify({ type: 'module', exports: './index.js' }),
      );
      makeFile(path.join(parentDir, 'node_modules', 'ancestor-only-esm', 'index.js'), 'export default 1;');

      const probes = stagedImportResults(runChecks(tmpDir, 'win32', 'x64'));

      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(probe).toMatchObject({ passed: true, severity: 'fatal' });
      }
    });
  });

  describe('staged import diagnostics', () => {
    const runtime = () => path.join(tmpDir, '.bundle-resources', 'core-runtime');
    const adapterPath = () =>
      fs.realpathSync(path.join(runtime(), 'dist', 'desktop', 'codebuddy-engine-adapter.js'));
    const adapterResult = (result: { results: Array<{ relPath: string; passed: boolean; detail?: string }> }) =>
      result.results.find((entry) => entry.relPath.endsWith('dist/desktop/codebuddy-engine-adapter.js'))!;

    it('names a package missing everywhere and its importer without the hook data: URL', () => {
      populateWin32Artifacts(tmpDir);
      fs.rmSync(path.join(runtime(), 'node_modules', 'chalk'), { recursive: true });

      const detail = adapterResult(runChecks(tmpDir, 'win32', 'x64')).detail ?? '';

      const [headline] = detail.split('\n');
      expect(headline.startsWith('Error [ERR_MODULE_NOT_FOUND]: ')).toBe(true);
      expect(headline).toContain("Cannot find package 'chalk'");
      expect(headline).toContain(`imported from ${adapterPath()}`);
      expect(detail).not.toContain('data:');
      expect(detail.length).toBeLessThan(2_000);
    });

    it('names the importer of an ESM import refused outside the staged runtime', () => {
      populateWin32Artifacts(tmpDir);
      const stagedChalk = path.join(runtime(), 'node_modules', 'chalk');
      fs.cpSync(stagedChalk, path.join(parentDir, 'node_modules', 'chalk'), { recursive: true });
      fs.rmSync(stagedChalk, { recursive: true });

      const detail = adapterResult(runChecks(tmpDir, 'win32', 'x64')).detail ?? '';

      const [headline] = detail.split('\n');
      expect(headline).toContain(
        `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'chalk' imported from ${adapterPath()}`,
      );
      expect(headline).toContain('only resolvable outside the staged runtime');
      expect(detail).not.toContain('data:');
    });

    it('names the importer of a refused CommonJS require without echoing the probe source', () => {
      populateWin32Artifacts(tmpDir);
      const stagedChalk = path.join(runtime(), 'node_modules', 'chalk');
      makeFile(path.join(stagedChalk, 'package.json'), JSON.stringify({ main: 'index.cjs' }));
      makeFile(
        path.join(stagedChalk, 'index.cjs'),
        "require('ancestor-only-cjs'); module.exports = { blue(value) { return value; } };",
      );
      makeFile(path.join(parentDir, 'node_modules', 'ancestor-only-cjs', 'index.js'), 'module.exports = 1;');

      const detail = adapterResult(runChecks(tmpDir, 'win32', 'x64')).detail ?? '';

      const [headline] = detail.split('\n');
      expect(headline).toContain(
        `Error [MODULE_NOT_FOUND]: Cannot find module 'ancestor-only-cjs' required from ${fs.realpathSync(path.join(stagedChalk, 'index.cjs'))}`,
      );
      expect(detail).not.toContain('${request}');
      expect(detail).not.toContain('data:');
    });

    it('terminates promptly with its diagnostic when failing CommonJS left an active handle', () => {
      populateWin32Artifacts(tmpDir);
      const activeHandlePackage = path.join(runtime(), 'node_modules', 'active-handle-cjs');
      makeFile(
        path.join(activeHandlePackage, 'package.json'),
        JSON.stringify({ main: 'index.cjs' }),
      );
      makeFile(
        path.join(activeHandlePackage, 'index.cjs'),
        "setInterval(() => {}, 60_000); require('absent-after-timer');",
      );
      makeFile(
        path.join(runtime(), 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
        "import 'active-handle-cjs'; export class CodeBuddyEngineAdapter {}",
      );
      const startedAt = Date.now();

      const detail = adapterResult(runChecks(tmpDir, 'win32', 'x64')).detail ?? '';

      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(detail).toContain("Error [MODULE_NOT_FOUND]: Cannot find module 'absent-after-timer'");
      expect(detail).not.toContain('ETIMEDOUT');
      expect(detail.length).toBeLessThanOrEqual(2_000);
    }, 35_000);

    it('keeps fallback codes for optional packages missing everywhere', () => {
      populateWin32Artifacts(tmpDir);
      const runtimeModules = path.join(runtime(), 'node_modules');
      makeFile(
        path.join(runtimeModules, 'chalk', 'index.js'),
        [
          "import accelerator from 'optional-accelerator';",
          "try { await import('absent-everywhere-esm'); throw new Error('absent ESM loaded'); }",
          "catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }",
          "if (accelerator !== 'MODULE_NOT_FOUND') throw new Error(`absent CJS code: ${accelerator}`);",
          'export default { blue(value) { return value; } };',
        ].join('\n'),
      );
      makeFile(path.join(runtimeModules, 'optional-accelerator', 'package.json'), JSON.stringify({ main: 'index.js' }));
      makeFile(
        path.join(runtimeModules, 'optional-accelerator', 'index.js'),
        "try { require('absent-everywhere-cjs'); module.exports = 'loaded'; } catch (error) { module.exports = error.code; }",
      );

      expect(adapterResult(runChecks(tmpDir, 'win32', 'x64'))).toMatchObject({ passed: true });
    });

    it("keeps Node's source frame for a staged module syntax error", () => {
      populateWin32Artifacts(tmpDir);
      makeFile(path.join(runtime(), 'node_modules', 'chalk', 'index.js'), 'export default ;');

      const detail = adapterResult(runChecks(tmpDir, 'win32', 'x64')).detail ?? '';

      const stagedChalkUrl = pathToFileURL(
        fs.realpathSync(path.join(runtime(), 'node_modules', 'chalk', 'index.js')),
      ).href;
      expect(detail).toContain(`${stagedChalkUrl}:1`);
      expect(detail).toContain("SyntaxError: Unexpected token ';'");
    });
  });

  it('reports hasFatal when dist-electron directory is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-electron'), { recursive: true });

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when better-sqlite3 Electron binding is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'));

    const result = runChecks(tmpDir, 'win32', 'x64');
    const sqliteCheck = result.results.find(
      (r: { relPath: string; severity: string }) =>
        r.relPath === 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    );

    expect(sqliteCheck).toMatchObject({
      passed: false,
      severity: 'fatal',
    });
    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when darwin node binary is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'resources/node/darwin-arm64/bin/node'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when win32 node.exe is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'resources/node/win32-x64/node.exe'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when wsl-agent index.js is missing', () => {
    populateWin32Artifacts(tmpDir);
    fs.rmSync(path.join(tmpDir, 'dist-wsl-agent/index.js'));

    const result = runChecks(tmpDir, 'win32', 'x64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('reports hasFatal when lima-agent index.js is missing', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');
    fs.rmSync(path.join(tmpDir, 'dist-lima-agent/index.js'));

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.failed).toBeGreaterThan(0);
    expect(result.hasFatal).toBe(true);
  });

  it('fails all checks when root directory is completely empty', () => {
    const result = runChecks(tmpDir, 'darwin', 'arm64');

    // All checks should fail or warn; none should pass
    expect(result.passed).toBe(0);
    expect(result.hasFatal).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('returns a results array with one entry per check', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(Array.isArray(result.results)).toBe(true);
    // Each result must have required fields
    for (const r of result.results) {
      expect(typeof r.label).toBe('string');
      expect(typeof r.relPath).toBe('string');
      expect(typeof r.passed).toBe('boolean');
      expect(['fatal', 'warn']).toContain(r.severity);
    }
  });

  it('passed + warnings + failed sums equal total checks', () => {
    populateDarwinArtifacts(tmpDir, 'arm64');

    const result = runChecks(tmpDir, 'darwin', 'arm64');

    expect(result.passed + result.warnings + result.failed).toBe(result.results.length);
  });

  // -------------------------------------------------------------------------
  // Linux platform
  // -------------------------------------------------------------------------

  it('includes linux-specific check on linux platform', () => {
    const result = runChecks(tmpDir, 'linux', 'x64');

    const linuxCheck = result.results.find(
      (r: { relPath: string; severity: string }) => r.relPath === 'resources/node/linux-x64'
    );
    expect(linuxCheck).toBeDefined();
    expect(linuxCheck?.severity).toBe('fatal');
  });
});
