/**
 * Jest Setup File
 * Handles global test setup and cleanup to prevent worker leaks
 */

// Increase timeout for slower operations
jest.setTimeout(10000);

// Clean up any lingering timers after each test
afterEach(() => {
  jest.clearAllTimers();
});

// Global cleanup after all tests
afterAll(async () => {
  // Clear all timers
  jest.useRealTimers();

  // Give async operations a moment to complete
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // Keep warn and error for important messages
    warn: console.warn,
    error: console.error,
  };
}
