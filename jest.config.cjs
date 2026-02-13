/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  // Exclude heavy tests from default runs (run with: npm test -- --testPathPattern=heavy)
  testPathIgnorePatterns: [
    '/node_modules/',
    '\\.heavy\\.test\\.ts$'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      diagnostics: {
        // Skip type-checking for files with dynamic import patterns that cause TS errors
        // (e.g. sharp.default in screenshot-annotator uses ESM interop not in type defs)
        exclude: ['**/screenshot-annotator.ts', '**/openclaw-commands.ts'],
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Mock ESM-only modules that Jest can't handle
    '^string-width$': '<rootDir>/tests/__mocks__/string-width.js',
    '^strip-ansi$': '<rootDir>/tests/__mocks__/strip-ansi.js',
    // Path aliases (must match tsconfig.json paths)
    '^@agent/(.*)$': '<rootDir>/src/agent/$1',
    '^@tools/(.*)$': '<rootDir>/src/tools/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@channels/(.*)$': '<rootDir>/src/channels/$1',
    '^@server/(.*)$': '<rootDir>/src/server/$1',
    '^@persistence/(.*)$': '<rootDir>/src/persistence/$1',
    '^@security/(.*)$': '<rootDir>/src/security/$1',
    '^@daemon/(.*)$': '<rootDir>/src/daemon/$1',
    '^@analytics/(.*)$': '<rootDir>/src/analytics/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/ui/**/*.tsx',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
  testTimeout: 10000,
  // Setup file for global test configuration and cleanup
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
  // Force exit after tests complete to avoid hanging on async operations
  forceExit: true,
  // Detect open handles to identify resource leaks
  detectOpenHandles: false, // Set to true for debugging leaks
};
