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

const workerConfig =
  process.platform === 'win32'
    ? {
        execArgv: ['--max-old-space-size=8192'],
        maxWorkers: 2,
      }
    : {
        execArgv: ['--max-old-space-size=8192'],
      };

export default defineConfig({
  plugins: [jestCompatTransform()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
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
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'tests/_archived/**'],
    pool: 'forks',
    vmMemoryLimit: '2048MB',
    ...workerConfig,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@jest/globals': path.resolve(__dirname, './tests/support/jest-globals.ts'),
    },
  },
});
