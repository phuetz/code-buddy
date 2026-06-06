/**
 * Unit tests for the CODEBUDDY_EMBEDDED policy helpers.
 *
 * The bootstrap in `cowork/src/main/index.ts` is too heavy to import
 * directly (it triggers Electron, DB init, MCP, etc.), so we test the
 * pure helpers extracted into `engine/embedded-mode.ts` and rely on
 * code review + an end-to-end check to verify the bootstrap calls them
 * correctly.
 */

import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyEngineLoadError,
  isEmbeddedOptOut,
  resolveEnginePath,
  resolveEnginePathWithDiagnostic,
  shouldLoadEngine,
} from '../src/main/engine/embedded-mode';

describe('isEmbeddedOptOut', () => {
  it('returns false when the env var is unset (default-on)', () => {
    expect(isEmbeddedOptOut({})).toBe(false);
  });

  it("returns false for the historical opt-in value '1'", () => {
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '1' })).toBe(false);
  });

  it("returns true ONLY for the explicit opt-out '0'", () => {
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '0' })).toBe(true);
  });

  it("does not interpret 'false' / '' / 'no' as opt-out (avoid surprises)", () => {
    // We deliberately accept only the exact string '0' so users get
    // predictable behaviour and don't accidentally disable embedded mode
    // by setting an empty string or another falsy-looking value.
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: '' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'false' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'no' })).toBe(false);
    expect(isEmbeddedOptOut({ CODEBUDDY_EMBEDDED: 'off' })).toBe(false);
  });
});

describe('classifyEngineLoadError', () => {
  it("classifies 'MODULE_NOT_FOUND' as 'missing'", () => {
    const err = Object.assign(new Error('not found'), { code: 'MODULE_NOT_FOUND' });
    expect(classifyEngineLoadError(err)).toBe('missing');
  });

  it("classifies 'ERR_MODULE_NOT_FOUND' as 'missing' (ESM resolver)", () => {
    const err = Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' });
    expect(classifyEngineLoadError(err)).toBe('missing');
  });

  it("classifies any other error as 'broken' (worth surfacing)", () => {
    const syntaxErr = new SyntaxError('Unexpected token');
    expect(classifyEngineLoadError(syntaxErr)).toBe('broken');

    const genericErr = new Error('boom');
    expect(classifyEngineLoadError(genericErr)).toBe('broken');

    const codedErr = Object.assign(new Error('perm'), { code: 'EACCES' });
    expect(classifyEngineLoadError(codedErr)).toBe('broken');
  });

  it("classifies non-Error throws as 'broken' (defensive)", () => {
    expect(classifyEngineLoadError(null)).toBe('broken');
    expect(classifyEngineLoadError(undefined)).toBe('broken');
    expect(classifyEngineLoadError('string error')).toBe('broken');
    expect(classifyEngineLoadError(42)).toBe('broken');
  });
});

describe('resolveEnginePath', () => {
  it('uses envOverride verbatim when explicitly set', () => {
    expect(
      resolveEnginePath({
        envOverride: '/custom/dist',
        isPackaged: true,
        resourcesPath: '/should/be/ignored',
        appPath: '/should/be/ignored',
      }),
    ).toBe('/custom/dist');
  });

  it("ignores empty envOverride (treats '' as unset, not as override)", () => {
    // '' might happen if the user sets `CODEBUDDY_ENGINE_PATH=` to
    // "unset" the variable from a parent shell — we should respect the
    // packaged/dev fallback rather than silently routing to root.
    expect(
      resolveEnginePath({
        envOverride: '',
        isPackaged: true,
        resourcesPath: '/app/resources',
        appPath: '/app/resources/app.asar',
      }),
    ).toBe(path.join('/app/resources', 'dist'));
  });

  it('uses resourcesPath/dist when packaged', () => {
    // This is the production case: the packaged Electron app has the
    // engine shipped via electron-builder extraResources.
    expect(
      resolveEnginePath({
        isPackaged: true,
        resourcesPath: '/Applications/Cowork.app/Contents/Resources',
        appPath: '/Applications/Cowork.app/Contents/Resources/app.asar',
      }),
    ).toBe(path.join('/Applications/Cowork.app/Contents/Resources', 'dist'));
  });

  it('uses appPath/../dist when not packaged (dev / npm run dev)', () => {
    // Dev mode: app.getAppPath() points to the cowork/ source dir; the
    // sibling dist/ at the repo root holds the built parent CLI.
    expect(
      resolveEnginePath({
        isPackaged: false,
        resourcesPath: '/should/be/ignored',
        appPath: '/repo/cowork',
      }),
    ).toBe(path.resolve('/repo/cowork', '..', 'dist'));
  });

  it('respects envOverride priority even in packaged mode', () => {
    // Sanity check: if a packaged build wants to point at a custom
    // location (e.g. a remotely-loaded engine for staging), the env
    // var still wins.
    expect(
      resolveEnginePath({
        envOverride: '/staging/engine',
        isPackaged: true,
        resourcesPath: '/app/resources',
        appPath: '/app/resources/app.asar',
      }),
    ).toBe('/staging/engine');
  });
});

describe('resolveEnginePathWithDiagnostic', () => {
  it("reports 'env-override' layer when CODEBUDDY_ENGINE_PATH is set", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        envOverride: '/custom/dist',
        isPackaged: false,
        resourcesPath: '/foo',
        appPath: '/foo/cowork',
      }),
    ).toEqual({ path: '/custom/dist', layer: 'env-override' });
  });

  it("reports 'packaged' layer when isPackaged=true and no env override", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: true,
        resourcesPath: '/Applications/Cowork.app/Contents/Resources',
        appPath: '/Applications/Cowork.app/Contents/Resources/app.asar',
      }),
    ).toEqual({
      path: path.join('/Applications/Cowork.app/Contents/Resources', 'dist'),
      layer: 'packaged',
    });
  });

  it("reports 'dev' layer when neither env override nor packaged nor mainBundleDir", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/repo/cowork',
      }),
    ).toEqual({
      path: path.resolve('/repo/cowork', '..', 'dist'),
      layer: 'dev',
    });
  });

  it("reports 'dev-from-bundle' layer when mainBundleDir is supplied (preferred over appPath)", () => {
    // The bundle lives at <repo>/cowork/dist-electron/main/; three up + dist = <repo>/dist
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/somewhere/wrong',  // ← intentionally wrong, should be ignored
        mainBundleDir: '/repo/cowork/dist-electron/main',
      }),
    ).toEqual({
      path: path.resolve('/repo/cowork/dist-electron/main', '..', '..', '..', 'dist'),
      layer: 'dev-from-bundle',
    });
    // sanity — the result is /repo/dist regardless of what appPath was
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/somewhere/wrong',
        mainBundleDir: '/repo/cowork/dist-electron/main',
      }).path,
    ).toBe(path.resolve('/repo/cowork/dist-electron/main', '..', '..', '..', 'dist'));
  });

  it("env-override wins over mainBundleDir even when both are present", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        envOverride: '/custom/dist',
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/ignored',
        mainBundleDir: '/repo/cowork/dist-electron/main',
      }),
    ).toEqual({ path: '/custom/dist', layer: 'env-override' });
  });

  it("packaged mode wins over mainBundleDir (production extraResources)", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: true,
        resourcesPath: '/app/resources',
        appPath: '/app/resources/app.asar',
        mainBundleDir: '/app/resources/app.asar/dist-electron/main',
      }),
    ).toEqual({
      path: path.join('/app/resources', 'dist'),
      layer: 'packaged',
    });
  });

  it("treats empty mainBundleDir as unset (falls back to dev layer)", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/repo/cowork',
        mainBundleDir: '',
      }),
    ).toEqual({
      path: path.resolve('/repo/cowork', '..', 'dist'),
      layer: 'dev',
    });
  });

  it("treats empty envOverride as unset (falls through to packaged/dev)", () => {
    expect(
      resolveEnginePathWithDiagnostic({
        envOverride: '',
        isPackaged: false,
        resourcesPath: '/ignored',
        appPath: '/repo/cowork',
      }),
    ).toEqual({
      path: path.resolve('/repo/cowork', '..', 'dist'),
      layer: 'dev',
    });
  });

  it('resolveEnginePath stays a thin wrapper that returns just the path string', () => {
    const args = {
      envOverride: '/custom/dist',
      isPackaged: false,
      resourcesPath: '/foo',
      appPath: '/foo/cowork',
    };
    expect(resolveEnginePath(args)).toBe(resolveEnginePathWithDiagnostic(args).path);
  });
});

describe('shouldLoadEngine — Settings × env precedence (Phase 4)', () => {
  it("returns true when user mode is 'auto' and env is unset (default-on)", () => {
    expect(shouldLoadEngine('auto', {})).toBe(true);
    expect(shouldLoadEngine(undefined, {})).toBe(true);
  });

  it("returns false when user mode is 'auto' and env opts out", () => {
    expect(shouldLoadEngine('auto', { CODEBUDDY_EMBEDDED: '0' })).toBe(false);
  });

  it("returns true when user mode is 'force-on' regardless of env", () => {
    expect(shouldLoadEngine('force-on', { CODEBUDDY_EMBEDDED: '0' })).toBe(true);
    expect(shouldLoadEngine('force-on', {})).toBe(true);
  });

  it("returns false when user mode is 'force-off' regardless of env", () => {
    expect(shouldLoadEngine('force-off', {})).toBe(false);
    expect(shouldLoadEngine('force-off', { CODEBUDDY_EMBEDDED: '1' })).toBe(false);
  });

  it("treats undefined / unknown user mode as 'auto'", () => {
    expect(shouldLoadEngine(undefined, { CODEBUDDY_EMBEDDED: '0' })).toBe(false);
  });
});

describe('pre-build-check engine adapter entry', () => {
  // Lightweight regression test: verify that the engine adapter is on
  // the fatal-checks list across all platforms. If this entry is ever
  // removed by accident, packaged Cowork binaries silently regress to
  // pi-coding-agent in production — exactly the bug we just fixed.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { buildCheckList } = require('../scripts/pre-build-check.js') as {
    buildCheckList: (
      platform: string,
      arch: string,
    ) => Array<{ label: string; relPath: string; severity: 'fatal' | 'warn' }>;
  };

  it.each(['darwin', 'win32', 'linux'])(
    'lists the Code Buddy core engine adapter as a fatal check on %s',
    (platform) => {
      const checks = buildCheckList(platform, 'x64');
      const entry = checks.find((c) =>
        c.relPath.includes('dist/desktop/codebuddy-engine-adapter'),
      );
      expect(entry).toBeDefined();
      expect(entry?.severity).toBe('fatal');
    },
  );
});
