import { vi } from 'vitest';

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
