/**
 * Helpers for deciding whether to load the embedded Code Buddy engine
 * adapter from the Electron main process bootstrap.
 *
 * Extracted from `cowork/src/main/index.ts` so the policy is unit-testable
 * without booting the full Electron environment.
 *
 * Policy (post-2026-05 invert):
 *   - Default ON: any Cowork entry point that can resolve the engine
 *     bundle (buddy gui, npm run dev, packaged app double-click, IDE
 *     launch, etc.) gets the embedded Code Buddy core agentic loop.
 *   - Opt-out: `CODEBUDDY_EMBEDDED=0` disables it explicitly. Anything
 *     else (unset, '1', '', 'true', 'yes', etc.) leaves embedded ON.
 *   - Graceful fallback: if the engine module isn't shipped (e.g. user
 *     ran cowork without building the parent first), `MODULE_NOT_FOUND`
 *     is the expected signal and is logged at info level rather than as
 *     a warning.
 *
 * @module cowork/main/engine/embedded-mode
 */

import * as path from 'path';

/**
 * Whether the user has opted out of embedded mode via env var.
 *
 * Only `'0'` opts out — every other value (including the historical
 * `'1'`, an empty string, or undefined) keeps the default-on behaviour.
 * This preserves backward compatibility with the launcher (which still
 * sets `CODEBUDDY_EMBEDDED=1`) while flipping the default for everyone
 * else.
 */
export function isEmbeddedOptOut(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_EMBEDDED === '0';
}

/**
 * Return-shape from `classifyEngineLoadError`. Lets the caller decide
 * the log level without re-implementing the error classification.
 */
export type EngineLoadErrorClass = 'missing' | 'broken';

/**
 * Distinguish "engine not shipped at this path" (expected, log at info)
 * from "engine present but failed to load" (real bug, log at warn).
 *
 * Node's dynamic `import()` throws errors with `code === 'MODULE_NOT_FOUND'`
 * (CJS resolver) or `code === 'ERR_MODULE_NOT_FOUND'` (ESM resolver) when
 * the resolved file does not exist. Anything else means the file was
 * found but blew up while loading — that's a bug worth surfacing.
 */
export function classifyEngineLoadError(err: unknown): EngineLoadErrorClass {
  if (!err || typeof err !== 'object') return 'broken';
  const code = (err as { code?: unknown }).code;
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
    return 'missing';
  }
  return 'broken';
}

/**
 * Inputs for `resolveEnginePath`. Pure data — the function takes
 * Electron-derived values as plain arguments so it can be tested
 * without booting Electron.
 */
export interface ResolveEnginePathInput {
  /** Value of `process.env.CODEBUDDY_ENGINE_PATH` (override). */
  envOverride?: string;
  /** Value of `app.isPackaged`. */
  isPackaged: boolean;
  /** Value of `process.resourcesPath` (only meaningful when packaged). */
  resourcesPath: string;
  /** Value of `app.getAppPath()`. */
  appPath: string;
}

/**
 * Resolve the directory under which the Code Buddy core engine ships
 * (i.e. the directory containing `desktop/codebuddy-engine-adapter.js`).
 *
 * Three layers, narrow → broad:
 *   1. `CODEBUDDY_ENGINE_PATH` env override — used verbatim when set
 *      to a non-empty string. Empty strings are treated as unset to
 *      avoid silently disabling auto-resolution.
 *   2. **Packaged mode** (`app.isPackaged === true`): the engine ships
 *      via `extraResources` at `<install>/resources/dist/`. Resolved
 *      via `process.resourcesPath`.
 *   3. **Dev / unpackaged**: the engine ships next to `cowork/` at
 *      `<repo>/dist/`. Resolved via `app.getAppPath()` + `..`. This is
 *      the path used by `npm run dev` and by the `buddy gui` launcher.
 *
 * Pure function. No imports of `electron`. Caller passes whatever
 * Electron's runtime exposes.
 */
export function resolveEnginePath(args: ResolveEnginePathInput): string {
  if (args.envOverride !== undefined && args.envOverride !== '') {
    return args.envOverride;
  }
  if (args.isPackaged) {
    return path.join(args.resourcesPath, 'dist');
  }
  return path.resolve(args.appPath, '..', 'dist');
}
