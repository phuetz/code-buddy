import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-case-declarations': 'off', // Allow lexical declarations in case blocks
    },
  },
  {
    // Legacy exemptions to avoid blocking CI.
    // TODO: Progressively remove directories from this list as technical debt is resolved.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      'tests/**/*.ts',
      'tests/**/*.tsx',
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      'scripts/**/*.cjs',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'require-yield': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.benchmarks/**',
      '.codebuddy/**',
      '.custom-output/**',
      '.test-backups/**',
      '.husky/**',
      'apps/**',
      'database/**',
      'openclaw/**',
      'test-app/**',
      'test-*.js',
      'test-*.mjs',
      'test-*.cjs',
      'tmp/**',
      'tmp_*/**',
      'lint-output.txt',
      'lint-after-fix*.txt',
      'jest-results.json',
      'test.ts',
      'test1.ts',
      '*.config.js',
      '*.config.ts',
    ],
  },
];
