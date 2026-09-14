import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { computeDistDigest } = require('../../../scripts/runtime-manifest-utils.cjs') as {
  computeDistDigest: (root: string) => {
    algorithm: string;
    scope: string;
    value: string;
    fileCount: number;
  };
};
const {
  COWORK_REQUIRED_OPTIONAL_DEPENDENCIES,
  collectInstalledRuntimePackagePaths,
  copyTreeWithHardlinks,
  prepareCoreRuntime,
  readCorePackageIdentity,
  resolveInstalledDependencyPath,
  resolveSourceRevision,
} = require(
  '../../scripts/prepare-core-runtime.js',
) as {
  resolveInstalledDependencyPath: (
    coreRoot: string,
    fromPackagePath: string,
    dependencyName: string,
  ) => string | null;
  COWORK_REQUIRED_OPTIONAL_DEPENDENCIES: readonly string[];
  collectInstalledRuntimePackagePaths: (
    coreRoot: string,
    options?: {
      platform?: string;
      arch?: string;
      includeRootOptional?: boolean;
      requiredOptionalDependencies?: readonly string[];
    },
  ) => string[];
  copyTreeWithHardlinks: (
    source: string,
    destination: string,
    options?: {
      excludeNestedNodeModules?: boolean;
      sourceBoundary?: string;
      destinationBoundary?: string;
    },
  ) => void;
  prepareCoreRuntime: (options: {
    coreRoot: string;
    coworkRoot: string;
    runtimeRoot: string;
    platform?: string;
    arch?: string;
    includeRootOptional?: boolean;
    requiredOptionalDependencies?: readonly string[];
    useCoworkNativeOverrides?: boolean;
    env?: Record<string, string | undefined>;
    spawnSync?: (...args: unknown[]) => {
      status: number | null;
      stdout?: string;
      error?: Error;
    };
  }) => {
    runtimeRoot: string;
    packagePaths: string[];
    manifest: {
      schemaVersion: number;
      corePackage: { name: string; version: string; description: string };
      sourceRevision: string | null;
      sourceRevisionOrigin?: string;
      sourceDirty: boolean | null;
      distDigest: {
        algorithm: string;
        scope: string;
        value: string;
        fileCount: number;
      };
      runtime: {
        kind: string;
        compiled: boolean;
        moduleFormat: string;
        distPath: string;
        entrypoint: string;
      };
      requiredOptionalDependencies: string[];
      nativeOverrides: string[];
    };
  };
  resolveSourceRevision: (
    coreRoot: string,
    options?: {
      env?: Record<string, string | undefined>;
      spawnSync?: (...args: unknown[]) => {
        status: number | null;
        stdout?: string;
        error?: Error;
      };
    },
  ) => { revision: string; origin: string; dirty: boolean | null } | null;
  readCorePackageIdentity: (coreRoot: string) => {
    name: string;
    version: string;
    description: string;
  };
};

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-runtime-test-'));
  temporaryRoots.push(root);
  return root;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writePackage(root: string, packagePath: string, packageJson: object, index = ''): void {
  writeFile(path.join(root, packagePath, 'package.json'), JSON.stringify(packageJson));
  if (index) writeFile(path.join(root, packagePath, 'index.js'), index);
}

/** Root optional packages Cowork stages for its slash-command gateway. */
const COWORK_REQUIRED_OPTIONAL = {
  '@google/generative-ai': '^0.21.0',
  'string-width': '^7.2.0',
};

function installCoworkRequiredOptional(coreRoot: string): void {
  writePackage(
    coreRoot,
    'node_modules/@google/generative-ai',
    { name: '@google/generative-ai', main: 'index.js' },
    'exports.GoogleGenerativeAI = class GoogleGenerativeAI {};',
  );
  writePackage(
    coreRoot,
    'node_modules/string-width',
    { name: 'string-width', type: 'module', exports: './index.js' },
    'export default (value) => value.length;',
  );
}

function writeCoreRuntimeManifest(
  coreRoot: string,
  corePackage: { name: string; version: string; description: string },
): void {
  writeFile(
    path.join(coreRoot, 'codebuddy-runtime.json'),
    JSON.stringify({
      schemaVersion: 2,
      corePackage,
      sourceRevision: null,
      sourceDirty: null,
      distDigest: computeDistDigest(coreRoot),
      runtime: {
        kind: 'codebuddy-core',
        compiled: true,
        moduleFormat: 'esm',
        distPath: 'dist',
        entrypoint: 'dist/desktop/codebuddy-engine-adapter.js',
      },
    }),
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('collectInstalledRuntimePackagePaths', () => {
  function dependencyFixture(): string {
    const root = temporaryRoot();
    writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { 'fixture-a': '1.0.0' },
        optionalDependencies: { 'fixture-root-optional': '1.0.0' },
      }),
    );
    writePackage(root, 'node_modules/fixture-a', {
      dependencies: { 'fixture-b': '1.0.0' },
      optionalDependencies: { 'fixture-linux-helper': '1.0.0' },
    });
    writePackage(root, 'node_modules/fixture-b', {});
    writePackage(root, 'node_modules/fixture-linux-helper', {
      os: ['linux'],
      cpu: ['x64'],
    });
    writePackage(root, 'node_modules/fixture-root-optional', {});
    return root;
  }

  it('keeps the required closure and platform helpers without seeding root optional features', () => {
    expect(
      collectInstalledRuntimePackagePaths(dependencyFixture(), {
        platform: 'linux',
        arch: 'x64',
      }),
    ).toEqual([
      'node_modules/fixture-a',
      'node_modules/fixture-b',
      'node_modules/fixture-linux-helper',
    ]);
  });

  it('can include root optional features explicitly and filters foreign native targets', () => {
    expect(
      collectInstalledRuntimePackagePaths(dependencyFixture(), {
        platform: 'darwin',
        arch: 'arm64',
        includeRootOptional: true,
      }),
    ).toEqual([
      'node_modules/fixture-a',
      'node_modules/fixture-b',
      'node_modules/fixture-root-optional',
    ]);
  });

  it('rejects dependency names that could escape node_modules', () => {
    const parent = temporaryRoot();
    const coreRoot = path.join(parent, 'core');
    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({ dependencies: { '../../outside-dep': '1.0.0' } }),
    );
    writePackage(parent, 'outside-dep', { name: 'outside-dep', version: '1.0.0' });

    expect(() => collectInstalledRuntimePackagePaths(coreRoot)).toThrow(
      /Invalid installed dependency name/,
    );
  });

  describe('Cowork-required optional dependencies', () => {
    function requiredOptionalFixture(): string {
      const root = temporaryRoot();
      writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          dependencies: { 'fixture-a': '1.0.0' },
          optionalDependencies: { ...COWORK_REQUIRED_OPTIONAL, 'fixture-root-optional': '1.0.0' },
        }),
      );
      writePackage(root, 'node_modules/fixture-a', {});
      writePackage(root, 'node_modules/fixture-root-optional', {});
      writePackage(root, 'node_modules/@google/generative-ai', {});
      writePackage(root, 'node_modules/string-width', { dependencies: { 'strip-ansi': '^7.1.0' } });
      // string-width needs strip-ansi 7 nested; the hoisted strip-ansi 6 is not in its closure.
      writePackage(root, 'node_modules/string-width/node_modules/strip-ansi', {
        dependencies: { 'ansi-regex': '^6.0.1' },
      });
      writePackage(root, 'node_modules/strip-ansi', {});
      writePackage(root, 'node_modules/ansi-regex', {});
      return root;
    }

    it('stages exactly the Cowork list with its installed closure, not every root optional', () => {
      expect(COWORK_REQUIRED_OPTIONAL_DEPENDENCIES).toEqual(Object.keys(COWORK_REQUIRED_OPTIONAL));
      expect(
        collectInstalledRuntimePackagePaths(requiredOptionalFixture(), {
          platform: 'linux',
          arch: 'x64',
          requiredOptionalDependencies: COWORK_REQUIRED_OPTIONAL_DEPENDENCIES,
        }),
      ).toEqual([
        'node_modules/@google/generative-ai',
        'node_modules/ansi-regex',
        'node_modules/fixture-a',
        'node_modules/string-width',
        'node_modules/string-width/node_modules/strip-ansi',
      ]);
    });

    it('names a required optional dependency missing from the source install', () => {
      const root = requiredOptionalFixture();
      fs.rmSync(path.join(root, 'node_modules', 'string-width'), { recursive: true });

      expect(() =>
        collectInstalledRuntimePackagePaths(root, {
          requiredOptionalDependencies: COWORK_REQUIRED_OPTIONAL_DEPENDENCIES,
        }),
      ).toThrow(
        'Cowork-required optional dependency is not installed: string-width ' +
          '(the packaged slash-command gateway imports it; run npm install without --omit=optional)',
      );
    });

    it('refuses a required dependency the core package does not declare', () => {
      expect(() =>
        collectInstalledRuntimePackagePaths(requiredOptionalFixture(), {
          requiredOptionalDependencies: ['ansi-regex'],
        }),
      ).toThrow(/Cowork-required dependency ansi-regex is not declared by the core package/);
    });

    it('fails instead of silently skipping a required dependency filtered out for the target', () => {
      const root = requiredOptionalFixture();
      writePackage(root, 'node_modules/@google/generative-ai', { os: ['win32'] });

      expect(() =>
        collectInstalledRuntimePackagePaths(root, {
          platform: 'linux',
          arch: 'x64',
          requiredOptionalDependencies: COWORK_REQUIRED_OPTIONAL_DEPENDENCIES,
        }),
      ).toThrow(
        'Cowork-required optional dependency does not support linux/x64: node_modules/@google/generative-ai',
      );
    });
  });
});

describe('resolveInstalledDependencyPath', () => {
  function nestedFixture(): string {
    const root = temporaryRoot();
    for (const packagePath of [
      'node_modules/a',
      'node_modules/a/node_modules/b',
      'node_modules/a/node_modules/b/node_modules/c',
      'node_modules/a/node_modules/d',
      'node_modules/d',
      'node_modules/e',
      'node_modules/@s/p',
      'node_modules/@s/p/node_modules/@s/q',
      'node_modules/@s/q',
      'packages/app/node_modules/f',
    ]) {
      writePackage(root, packagePath, {});
    }
    return root;
  }

  it('resolves nearest-first and walks up through enclosing packages to the root', () => {
    const root = nestedFixture();

    expect(resolveInstalledDependencyPath(root, 'node_modules/a/node_modules/b', 'c')).toBe(
      'node_modules/a/node_modules/b/node_modules/c',
    );
    expect(resolveInstalledDependencyPath(root, 'node_modules/a/node_modules/b', 'd')).toBe(
      'node_modules/a/node_modules/d',
    );
    expect(resolveInstalledDependencyPath(root, 'node_modules/a/node_modules/b/node_modules/c', 'e')).toBe(
      'node_modules/e',
    );
    expect(resolveInstalledDependencyPath(root, 'node_modules/@s/p', '@s/q')).toBe(
      'node_modules/@s/p/node_modules/@s/q',
    );
    expect(resolveInstalledDependencyPath(root, 'packages/app', 'f')).toBe('packages/app/node_modules/f');
  });

  it('returns null once the root node_modules lookup misses, from any depth', () => {
    const root = nestedFixture();

    for (const fromPackagePath of ['', 'node_modules/a', 'node_modules/a/node_modules/b/node_modules/c', 'packages/app']) {
      expect(resolveInstalledDependencyPath(root, fromPackagePath, 'missing')).toBeNull();
    }
    expect(fs.existsSync(path.join(root, 'node_modules', 'missing'))).toBe(false);
  });

  it('terminates when the core root is the filesystem root', () => {
    const filesystemRoot = path.parse(os.tmpdir()).root;
    const absent = `codebuddy-absent-${process.pid}-${Date.now()}`;

    expect(
      resolveInstalledDependencyPath(filesystemRoot, 'node_modules/a/node_modules/b/node_modules/c', absent),
    ).toBeNull();
    expect(resolveInstalledDependencyPath(filesystemRoot, '', `@codebuddy-absent/${absent}`)).toBeNull();
  });

  it('keeps refusing lookups that escape the core root', () => {
    expect(() => resolveInstalledDependencyPath(nestedFixture(), '../escape', 'a')).toThrow(
      /Installed dependency path escapes its allowed root/,
    );
  });
});

describe('copyTreeWithHardlinks confinement', () => {
  it.runIf(process.platform !== 'win32')(
    'refuses a nested package symlink that escapes the package root',
    () => {
      const parent = temporaryRoot();
      const source = path.join(parent, 'package');
      const outside = path.join(parent, 'private-host-directory');
      const destination = path.join(parent, 'staged-package');
      writeFile(path.join(source, 'index.js'), 'export const safe = true;\n');
      writeFile(path.join(outside, 'secret.txt'), 'PRIVATE_HOST_SECRET');
      fs.symlinkSync(outside, path.join(source, 'escape'), 'dir');

      expect(() => copyTreeWithHardlinks(source, destination)).toThrow(
        /Runtime copy source escapes its allowed root/,
      );
      expect(fs.existsSync(path.join(destination, 'escape', 'secret.txt'))).toBe(false);
    },
  );

  it.runIf(process.platform !== 'win32')(
    'allows an installed package root link but still confines its nested links',
    () => {
      const parent = temporaryRoot();
      const workspacePackage = path.join(parent, 'workspace-package');
      const installedLink = path.join(parent, 'node_modules', 'fixture-package');
      const destination = path.join(parent, 'staged-package');
      writeFile(path.join(workspacePackage, 'index.js'), 'export const linked = true;\n');
      fs.mkdirSync(path.dirname(installedLink), { recursive: true });
      fs.symlinkSync(workspacePackage, installedLink, 'dir');

      copyTreeWithHardlinks(installedLink, destination);

      expect(fs.readFileSync(path.join(destination, 'index.js'), 'utf8')).toContain('linked');
    },
  );
});

describe('prepareCoreRuntime', () => {
  it('rejects an unrelated package masquerading as the core runtime', () => {
    const root = temporaryRoot();
    writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: '@evil/code-buddy',
      version: '1.0.0',
      description: 'not Code Buddy',
    }));

    expect(() => readCorePackageIdentity(root)).toThrow(/Unexpected Code Buddy package name/);
  });

  it('resolves source provenance from CI metadata or Git and degrades outside Git', () => {
    const envRevision = 'A'.repeat(40);
    expect(
      resolveSourceRevision('/source/archive', {
        env: { CODEBUDDY_SOURCE_REVISION: envRevision },
        spawnSync: () => {
          throw new Error('Git should not run when explicit provenance exists');
        },
      }),
    ).toEqual({
      revision: envRevision.toLowerCase(),
      origin: 'env:CODEBUDDY_SOURCE_REVISION',
      dirty: null,
    });

    const gitRevision = 'b'.repeat(40);
    expect(
      resolveSourceRevision('/source/checkout', {
        env: {},
        spawnSync: (_command: unknown, args: unknown) =>
          Array.isArray(args) && args[0] === 'rev-parse'
            ? { status: 0, stdout: `${gitRevision}\n` }
            : { status: 0, stdout: '' },
      }),
    ).toEqual({ revision: gitRevision, origin: 'git', dirty: false });

    expect(
      resolveSourceRevision('/source/archive', {
        env: {},
        spawnSync: () => ({ status: 128, stdout: '' }),
      }),
    ).toBeNull();
  });

  it('fails closed instead of packaging host-native bindings for another architecture', () => {
    const root = temporaryRoot();
    const targetArch = process.arch === 'x64' ? 'arm64' : 'x64';

    expect(() =>
      prepareCoreRuntime({
        coreRoot: path.join(root, 'core'),
        coworkRoot: path.join(root, 'cowork'),
        runtimeRoot: path.join(root, 'runtime'),
        platform: process.platform,
        arch: targetArch,
      }),
    ).toThrow(/Cross-target core runtime staging is unsafe/);
  });

  it('stops before writing a runtime when a Cowork-required optional dependency is missing', () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');
    const corePackage = {
      name: '@phuetz/code-buddy',
      version: '1.0.0',
      description: 'Slash gateway fixture',
    };
    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({ ...corePackage, optionalDependencies: COWORK_REQUIRED_OPTIONAL }),
    );
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export class CodeBuddyEngineAdapter {}',
    );
    installCoworkRequiredOptional(coreRoot);
    fs.rmSync(path.join(coreRoot, 'node_modules', '@google'), { recursive: true });
    writeCoreRuntimeManifest(coreRoot, corePackage);

    expect(() =>
      prepareCoreRuntime({ coreRoot, coworkRoot, runtimeRoot, useCoworkNativeOverrides: false }),
    ).toThrow(/Cowork-required optional dependency is not installed: @google\/generative-ai/);
    expect(fs.existsSync(runtimeRoot)).toBe(false);
  });

  it('creates an isolated ESM runtime whose bare dependency resolves outside the source tree', async () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');

    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({
        name: '@phuetz/code-buddy',
        version: '9.8.7',
        description: 'Compiled Code Buddy fixture',
        dependencies: { 'fixture-a': '1.0.0' },
        optionalDependencies: COWORK_REQUIRED_OPTIONAL,
      }),
    );
    installCoworkRequiredOptional(coreRoot);
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      "import value from 'fixture-a'; if (value !== 42) throw new Error('bad dependency'); export class CodeBuddyEngineAdapter {}",
    );
    writePackage(
      coreRoot,
      'node_modules/fixture-a',
      { type: 'module', exports: './index.js', dependencies: { 'fixture-b': '1.0.0' } },
      "import value from 'fixture-b'; export default value + 1;",
    );
    writePackage(
      coreRoot,
      'node_modules/fixture-b',
      { type: 'module', exports: './index.js' },
      'export default 41;',
    );
    writeCoreRuntimeManifest(coreRoot, {
      name: '@phuetz/code-buddy',
      version: '9.8.7',
      description: 'Compiled Code Buddy fixture',
    });

    const result = prepareCoreRuntime({
      coreRoot,
      coworkRoot,
      runtimeRoot,
      platform: 'linux',
      arch: 'x64',
      useCoworkNativeOverrides: false,
      env: {},
      spawnSync: () => ({ status: 128, stdout: '' }),
    });

    expect(result.packagePaths).toEqual([
      'node_modules/@google/generative-ai',
      'node_modules/fixture-a',
      'node_modules/fixture-b',
      'node_modules/string-width',
    ]);
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'dist', 'package.json'), 'utf8')),
    ).toMatchObject({ type: 'module' });
    expect(result.manifest).toMatchObject({
      schemaVersion: 2,
      corePackage: {
        name: '@phuetz/code-buddy',
        version: '9.8.7',
        description: 'Compiled Code Buddy fixture',
      },
      sourceRevision: null,
      sourceDirty: null,
      distDigest: expect.objectContaining({ algorithm: 'sha256' }),
      runtime: {
        kind: 'codebuddy-core',
        compiled: true,
        moduleFormat: 'esm',
        distPath: 'dist',
        entrypoint: 'dist/desktop/codebuddy-engine-adapter.js',
      },
      requiredOptionalDependencies: ['@google/generative-ai', 'string-width'],
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'codebuddy-runtime.json'), 'utf8')),
    ).toEqual(result.manifest);
    await expect(
      import(
        `${pathToFileURL(
          path.join(runtimeRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
        ).href}?test=${Date.now()}`
      ),
    ).resolves.toMatchObject({ CodeBuddyEngineAdapter: expect.any(Function) });
  });

  it('replaces the host-Node SQLite build with Cowork\'s Electron binding', () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');
    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({
        name: '@phuetz/code-buddy',
        version: '1.0.0',
        description: 'SQLite runtime fixture',
        dependencies: { 'better-sqlite3': '1.0.0' },
        optionalDependencies: COWORK_REQUIRED_OPTIONAL,
      }),
    );
    installCoworkRequiredOptional(coreRoot);
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export class CodeBuddyEngineAdapter {}',
    );
    writePackage(coreRoot, 'node_modules/better-sqlite3', { version: 'node-build' });
    writeFile(
      path.join(
        coreRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'node-abi',
    );
    writePackage(coworkRoot, 'node_modules/better-sqlite3', { version: 'electron-build' });
    writeFile(
      path.join(
        coworkRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'electron-abi',
    );
    writeCoreRuntimeManifest(coreRoot, {
      name: '@phuetz/code-buddy',
      version: '1.0.0',
      description: 'SQLite runtime fixture',
    });

    const result = prepareCoreRuntime({ coreRoot, coworkRoot, runtimeRoot });

    expect(result.manifest.nativeOverrides).toEqual(['better-sqlite3']);
    expect(
      fs.readFileSync(
        path.join(
          runtimeRoot,
          'node_modules',
          'better-sqlite3',
          'build',
          'Release',
          'better_sqlite3.node',
        ),
        'utf8',
      ),
    ).toBe('electron-abi');
  });

  it('stages Cowork SQLite when the core declares it as optional', () => {
    const root = temporaryRoot();
    const coreRoot = path.join(root, 'core');
    const coworkRoot = path.join(root, 'cowork');
    const runtimeRoot = path.join(coworkRoot, '.bundle-resources', 'core-runtime');
    writeFile(
      path.join(coreRoot, 'package.json'),
      JSON.stringify({
        name: '@phuetz/code-buddy',
        version: '1.0.0',
        description: 'Optional SQLite runtime fixture',
        optionalDependencies: { 'better-sqlite3': '1.0.0', ...COWORK_REQUIRED_OPTIONAL },
      }),
    );
    installCoworkRequiredOptional(coreRoot);
    writeFile(
      path.join(coreRoot, 'dist', 'desktop', 'codebuddy-engine-adapter.js'),
      'export class CodeBuddyEngineAdapter {}',
    );
    writePackage(coreRoot, 'node_modules/better-sqlite3', { version: 'node-build' });
    writeFile(
      path.join(
        coreRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'node-abi',
    );
    writePackage(coworkRoot, 'node_modules/better-sqlite3', { version: 'electron-build' });
    writeFile(
      path.join(
        coworkRoot,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node',
      ),
      'electron-abi',
    );
    writeCoreRuntimeManifest(coreRoot, {
      name: '@phuetz/code-buddy',
      version: '1.0.0',
      description: 'Optional SQLite runtime fixture',
    });

    const result = prepareCoreRuntime({ coreRoot, coworkRoot, runtimeRoot });

    expect(result.manifest.nativeOverrides).toEqual(['better-sqlite3']);
    expect(
      fs.readFileSync(
        path.join(
          runtimeRoot,
          'node_modules',
          'better-sqlite3',
          'build',
          'Release',
          'better_sqlite3.node',
        ),
        'utf8',
      ),
    ).toBe('electron-abi');
  });
});
