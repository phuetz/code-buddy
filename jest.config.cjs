/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Mock ESM-only modules that Jest can't handle
    '^string-width$': '<rootDir>/tests/__mocks__/string-width.js',
    '^strip-ansi$': '<rootDir>/tests/__mocks__/strip-ansi.js',
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
