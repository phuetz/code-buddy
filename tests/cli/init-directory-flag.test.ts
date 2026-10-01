import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

describe('buddy --init --directory', () => {
  const tsxLoader = fileURLToPath(import.meta.resolve('tsx'));
  it('initializes the specified directory, not the current one', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codebuddy-init-test-'));
    const dirA = join(tmp, 'A');
    const dirB = join(tmp, 'B');

    // Create directories
    mkdirSync(dirA);
    mkdirSync(dirB);

    try {
      const result = spawnSync(process.execPath, ['--import', tsxLoader,
        join(process.cwd(), 'src/index.ts'),
        '-d', dirB,
        '--init'
      ], {
        cwd: dirA,
        env: { ...process.env, HOME: tmp }
      });

      expect(result.status).toBe(0);

      // Check that dirB was initialized
      expect(existsSync(join(dirB, '.codebuddy'))).toBe(true);
      expect(existsSync(join(dirB, 'AGENTS.md'))).toBe(true);

      // Check that dirA was NOT initialized
      expect(existsSync(join(dirA, '.codebuddy'))).toBe(false);
      expect(existsSync(join(dirA, 'AGENTS.md'))).toBe(false);

    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails properly if directory does not exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codebuddy-init-test-fail-'));
    const dirA = join(tmp, 'A');
    const dirB = join(tmp, 'B'); // Intentionally not created

    // Create directory A only
    mkdirSync(dirA);

    try {
      const result = spawnSync(process.execPath, ['--import', tsxLoader,
        join(process.cwd(), 'src/index.ts'),
        '-d', dirB,
        '--init'
      ], {
        cwd: dirA,
        env: { ...process.env, HOME: tmp }
      });

      expect(result.status).toBe(1);
      expect(result.stderr.toString(), `stdout=${result.stdout.toString()} error=${result.error?.message}`).toContain('error: cannot change directory to');

    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
