import { vi } from 'vitest';

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
