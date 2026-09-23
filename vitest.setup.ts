import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

// Isolation P0 (2026-09-22) + F1 (2026-09-23): tests never resolve the real ~/.codebuddy profile.
// Without an explicit CODEBUDDY_HOME, each test file gets a throwaway one. This redirects the paths
// that honour CODEBUDDY_HOME; it is NOT a security boundary (run risky suites in the sandbox runner).
// Empty or whitespace (spaces, tab, CR, LF) counts as unset. Refuse a throwaway profile that equals
// the real profile, sits inside it, or contains it (e.g. TMPDIR under ~/.codebuddy), comparing
// symlink-resolved paths (realpath when it exists, path.resolve otherwise).
const realProfile = path.join(os.homedir(), '.codebuddy');
const resolveForComparison = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const disposableOverlapsRealProfile = (disposable: string): boolean => {
  const candidate = resolveForComparison(disposable);
  const real = resolveForComparison(realProfile);
  return (
    candidate === real ||
    candidate.startsWith(real + path.sep) ||
    real.startsWith(candidate + path.sep)
  );
};
if (!process.env.CODEBUDDY_HOME?.trim()) {
  const disposable = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-vitest-home-'));
  if (!disposable || disposableOverlapsRealProfile(disposable)) {
    throw new Error(
      'garde Vitest: refus de poursuivre sans profil jetable distinct du profil réel',
    );
  }
  process.env.CODEBUDDY_HOME = disposable;
}

// Phase-4 CKG default is rust-if-binary. Keep the Vitest suite on the in-process
// TS path unless a test explicitly sets CODEBUDDY_CKG_ENGINE=rust|auto.
if (process.env.CODEBUDDY_CKG_ENGINE === undefined) {
  process.env.CODEBUDDY_CKG_ENGINE = 'ts';
}

// Mimic Jest's global object for easier migration
const jestMock = {
  fn: vi.fn,
  mock: vi.mock,
  unmock: vi.unmock,
  doMock: vi.doMock,
  spyOn: vi.spyOn,
  clearAllMocks: vi.clearAllMocks,
  resetAllMocks: vi.resetAllMocks,
  restoreAllMocks: vi.restoreAllMocks,
  useFakeTimers: vi.useFakeTimers,
  useRealTimers: vi.useRealTimers,
  setSystemTime: vi.setSystemTime,
  advanceTimersByTime: vi.advanceTimersByTime,
  runAllTimers: vi.runAllTimers,
  requireActual: vi.importActual,
  isolateModules: vi.isolateModules,
  resetModules: vi.resetModules,
  mocked: vi.mocked,
  setTimeout: (timeout: number) => vi.setConfig({ testTimeout: timeout }),
  isMockFunction: vi.isMockFunction,
};

// @ts-expect-error: Mocking globalThis.jest for compatibility
globalThis.jest = jestMock;
