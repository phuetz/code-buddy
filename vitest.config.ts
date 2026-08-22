import { defineConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';

function resolveTestSourceSpecifier(importerId: string, specifier: string): string | null {
  if (!specifier.startsWith('.') || !specifier.includes('/src/')) {
    return null;
  }

  const importerDir = path.dirname(importerId);
  const resolved = path.resolve(importerDir, specifier);
  const ext = path.extname(resolved);
  const candidates: string[] = [];

  if (ext) {
    candidates.push(resolved);
    if (ext === '.js') {
      candidates.push(resolved.slice(0, -3) + '.ts', resolved.slice(0, -3) + '.tsx');
    }
  } else {
    candidates.push(
      resolved + '.js',
      resolved + '.ts',
      resolved + '.tsx',
      path.join(resolved, 'index.js'),
      path.join(resolved, 'index.ts'),
      path.join(resolved, 'index.tsx')
    );
  }

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  return match ? match.replace(/\\/g, '/') : null;
}

function jestCompatTransform() {
  const testFilePattern = /[\\/](tests|src)[\\/].+\.(test|spec)\.[tj]sx?$/;

  return {
    name: 'jest-compat-transform',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!testFilePattern.test(id)) {
        return null;
      }

      let next = code;
      next = next.replace(/\bjest\.mock\(/g, 'vi.mock(');
      next = next.replace(/\bjest\.unmock\(/g, 'vi.unmock(');
      next = next.replace(/\bjest\.doMock\(/g, 'vi.doMock(');
      next = next.replace(
        /(vi\.mock\(\s*['"][^'"]+['"]\s*,\s*)\(\)\s*=>/g,
        '$1async () =>'
      );
      next = next.replace(
        /(\b(?:vi\.(?:mock|doMock)|require)\(\s*)(['"])([^'"]+)\2/g,
        (match, prefix, quote, specifier) => {
          const resolved = resolveTestSourceSpecifier(id, specifier);
          return resolved ? `${prefix}${quote}${resolved}${quote}` : match;
        }
      );

      if (next === code) {
        return null;
      }

      return {
        code: next,
        map: null,
      };
    },
  };
}

// Real, no-mock integration tests (`*.real.test.ts`, `*-real*.test.ts`, and
// `real-*.test.ts`) hit live services
// (Ollama, Hermes, a browser, …) — they are slow and environment-dependent, so
// the default `npm test` skips them. Opt in with RUN_REAL_TESTS=1 to run them
// (e.g. locally with the services up, or on a real-environment runner).
const RUN_REAL_TESTS = process.env.RUN_REAL_TESTS === '1' || process.env.RUN_REAL_TESTS === 'true';

export default defineConfig({
  plugins: [jestCompatTransform()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // windows-latest runners show I/O stall bursts: on 2026-08-22 three
    // different real-I/O suites (migration-e2e, execute-code RPC, ocr-tool)
    // each crossed 20 s once on a Windows job while finishing in < 5 s on
    // every other run. Give Windows hosts a 60 s budget; Linux/macOS keep the
    // historical 20 s / 30 s (a real hang still fails, just later).
    testTimeout: process.platform === 'win32' ? 60000 : 20000,
    // Match the generous test timeout for setup/teardown hooks. Several suites do
    // heavy dynamic `import()` inside `beforeEach`; under the CPU/RAM pressure of a
    // full parallel run on constrained CI runners those imports occasionally cross
    // the Vitest default 10s hook timeout and fail spuriously (the same test passes
    // in ~3s in isolation). 30s removes the false timeout without masking a real
    // hang. See CI flakiness on macos-latest (3 vCPU / 7 GB).
    hookTimeout: process.platform === 'win32' ? 60000 : 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.{ts,js}',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/types/',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      'tests/_archived/**',
      // Skip the slow, env-dependent real-integration tests unless opted in.
      ...(RUN_REAL_TESTS ? [] : ['**/*real*.test.ts']),
    ],
    pool: 'forks',
    // Per-fork V8 heap ceiling. On windows-latest (7 GB RAM, 2 CI forks) the
    // 8 GB ceiling over-subscribes physical memory: the Node 20 Windows job of
    // the PR #95 run ended with "[vitest-pool]: Worker forks emitted error /
    // Worker exited unexpectedly" — 1596 files passed, 0 failed, one file
    // (tests/unit/hybrid-search-semantic, pure, 2.2 s in the 8 earlier runs)
    // never reported: its fork died mid-run, outside any test. 4 GB per fork
    // keeps two forks inside the runner's RAM and turns a runaway heap into a
    // visible V8 "heap out of memory" instead of a silent OS kill.
    // Linux/macOS keep 8 GB.
    execArgv: [`--max-old-space-size=${process.platform === 'win32' ? 4096 : 8192}`],
    // Bound worker concurrency on CI only. The default is one worker per CPU, and
    // each fork carries an 8 GB heap ceiling — on GitHub's constrained runners
    // (esp. macos-latest: 3 vCPU / 7 GB) that over-subscribes RAM, causing swap
    // thrash that slows module imports enough to trip hook timeouts. This is the
    // honest root-cause fix for the historically-red macOS "Run tests" job: no
    // test is skipped and no coverage is dropped — the full suite still runs, just
    // with a steadier scheduler on CI. Local/dev runs keep full parallelism.
    // (Vitest 4 moved the old `poolOptions.forks` knobs to top-level maxWorkers/
    // minWorkers.)
    ...(process.env.CI ? { maxWorkers: 2, minWorkers: 1 } : {}),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@jest/globals': path.resolve(__dirname, './tests/support/jest-globals.ts'),
    },
  },
});
