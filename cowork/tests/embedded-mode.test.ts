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
