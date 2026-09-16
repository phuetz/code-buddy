import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import Module, { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { alasqlReactNativeModules, mainProcessExternals } from '../vite.config';

type ResolveFilename = (request: unknown, ...rest: unknown[]) => string;
type AlasqlBundle = { alasql: ((sql: string) => unknown) & { utils: { isReactNative: boolean } } };

const coworkRoot = path.resolve(import.meta.dirname, '..');
const viteConfigContent = readFileSync(path.join(coworkRoot, 'vite.config.ts'), 'utf8');
const probeEntry = path.join(coworkRoot, 'alasql-main-probe-entry.js');
const coworkRequire = createRequire(path.join(coworkRoot, 'package.json'));

function resolveFromCowork(id: string): string | null {
  try {
    return coworkRequire.resolve(id);
  } catch {
    return null;
  }
}

const alasqlNodeEntry = resolveFromCowork('alasql');
const installedReactNative = resolveFromCowork('react-native');

/**
 * Loads the bundle while intercepting every mobile module request. `resolveMobile`
 * returns the file to load for a request, or null to report MODULE_NOT_FOUND.
 */
function loadBundle(bundlePath: string, resolveMobile: (request: string) => string | null) {
  const moduleInternals = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolve = moduleInternals._resolveFilename;
  const requested: string[] = [];
  moduleInternals._resolveFilename = function (this: unknown, request: unknown, ...rest: unknown[]) {
    if (request === 'alasql') throw new Error('AlaSQL must be bundled, not required at runtime');
    if (typeof request === 'string' && alasqlReactNativeModules.includes(request)) {
      requested.push(request);
      const resolved = resolveMobile(request);
      if (resolved) return resolved;
      const error = new Error(`Cannot find module '${request}'`) as NodeJS.ErrnoException;
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }
    return originalResolve.call(this, request, ...rest);
  };
  try {
    const bundleRequire = createRequire(bundlePath);
    delete bundleRequire.cache[bundlePath];
    const { alasql } = bundleRequire(bundlePath) as AlasqlBundle;
    return { alasql, requested };
  } finally {
    moduleInternals._resolveFilename = originalResolve;
  }
}

describe('Electron main build configuration for AlaSQL React Native modules', () => {
  it('leaves the mobile requires to the CommonJS plugin ignore list, not to externals', () => {
    expect(viteConfigContent).toContain('ignore: alasqlReactNativeModules');
    expect(viteConfigContent).toContain('external: mainProcessExternals');
    for (const id of [...alasqlReactNativeModules, 'alasql']) {
      expect(mainProcessExternals).not.toContain(id);
    }
  });
});

// AlaSQL is an optional dependency of the repository root. Without it the
// Electron main build never reaches its React Native requires, so there is
// nothing to bundle or run.
describe.skipIf(!alasqlNodeEntry)('Electron main bundle with AlaSQL', () => {
  let outDir = '';
  let bundlePath = '';

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'cowork-alasql-main-'));
    bundlePath = path.join(outDir, 'probe.cjs');
    await build({
      configFile: false,
      logLevel: 'silent',
      root: coworkRoot,
      publicDir: false,
      plugins: [
        {
          name: 'alasql-main-probe-entry',
          resolveId: (id) => (id === probeEntry ? probeEntry : null),
          load: (id) => (id === probeEntry ? "import alasql from 'alasql';\nexport { alasql };\n" : null),
        },
      ],
      // Same resolution as vite-plugin-electron for the main process.
      resolve: { conditions: ['node'], mainFields: ['module', 'jsnext:main', 'jsnext'] },
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        lib: { entry: probeEntry, formats: ['cjs'], fileName: () => 'probe.cjs' },
        commonjsOptions: { ignore: alasqlReactNativeModules },
        rollupOptions: { external: mainProcessExternals, output: { interop: 'auto' } },
      },
    });
  }, 120_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it('covers every React Native module required by the AlaSQL node entry', () => {
    const source = readFileSync(alasqlNodeEntry as string, 'utf8');
    const required = new Set(
      [...source.matchAll(/require\(\s*['"](react-native[^'"]*)['"]\s*\)/g)].map((match) => match[1]),
    );

    expect([...required].sort()).toEqual([...alasqlReactNativeModules].sort());
  });

  it('runs SQL from the bundle when the React Native modules are absent', () => {
    const { alasql, requested } = loadBundle(bundlePath, () => null);

    expect(alasql('SELECT 2 + 3 AS answer')).toEqual([{ answer: 5 }]);
    expect(alasql.utils.isReactNative).toBe(false);
    // Only the guarded probe runs; the mobile file-system modules stay lazy.
    expect(requested).toEqual(['react-native']);
  });

  // A development checkout installs the Flow sources of react-native next to AlaSQL.
  it.skipIf(!installedReactNative)(
    'runs SQL from the bundle when the installed react-native cannot be loaded by Node',
    () => {
      const { alasql, requested } = loadBundle(bundlePath, (request) =>
        request === 'react-native' ? installedReactNative : null,
      );

      expect(alasql('SELECT 2 + 3 AS answer')).toEqual([{ answer: 5 }]);
      expect(alasql.utils.isReactNative).toBe(false);
      expect(requested).toEqual(['react-native']);
    },
  );
});
