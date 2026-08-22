import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runWatchdog } from '../../src/scheduler/watchdog-handlers.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-test-'));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // ignore
  }
}

describe('runWatchdog', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('errors when no checks are configured', async () => {
    const result = await runWatchdog({ checks: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toBe(1);
  });

  describe('disk', () => {
    it('reports ok when free space is above the threshold', async () => {
      const result = await runWatchdog({
        checks: [{ type: 'disk', path: tmpDir, minFreeBytes: 0 }],
      });
      expect(result.ok).toBe(true);
      expect(result.checks[0]?.status).toBe('ok');
      expect(result.checks[0]?.details.freeBytes).toBeGreaterThanOrEqual(0);
    });

    it('alerts when free space is below an impossible threshold', async () => {
      const result = await runWatchdog({
        checks: [{ type: 'disk', path: tmpDir, minFreeBytes: Number.MAX_SAFE_INTEGER }],
      });
      expect(result.ok).toBe(false);
      expect(result.alerts).toBe(1);
      expect(result.checks[0]?.status).toBe('alert');
    });
  });

  describe('http', () => {
    it('reports ok for a healthy status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
      const result = await runWatchdog({
        checks: [{ type: 'http', url: 'https://example.test/health' }],
      });
      expect(result.ok).toBe(true);
      expect(result.checks[0]?.details.statusCode).toBe(200);
    });

    it('alerts for a failing status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 503 } as Response);
      const result = await runWatchdog({
        checks: [{ type: 'http', url: 'https://example.test/health' }],
      });
      expect(result.ok).toBe(false);
      expect(result.checks[0]?.status).toBe('alert');
    });

    it('alerts when the server is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
      const result = await runWatchdog({
        checks: [{ type: 'http', url: 'https://example.test/health' }],
      });
      expect(result.ok).toBe(false);
      expect(result.checks[0]?.status).toBe('alert');
    });
  });

  describe('repo', () => {
    it('errors on a non-git directory', async () => {
      const result = await runWatchdog({ checks: [{ type: 'repo', repoDir: tmpDir }] });
      expect(result.checks[0]?.status).toBe('error');
    });

    it('reports clean vs dirty for a real repo', async () => {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });

      const clean = await runWatchdog({ checks: [{ type: 'repo', repoDir: tmpDir }] });
      expect(clean.checks[0]?.status).toBe('ok');

      fs.writeFileSync(path.join(tmpDir, 'untracked.txt'), 'x', 'utf8');
      const dirty = await runWatchdog({ checks: [{ type: 'repo', repoDir: tmpDir }] });
      expect(dirty.checks[0]?.status).toBe('alert');
      expect(dirty.checks[0]?.details.dirty).toBe(true);

      const dirtyAllowed = await runWatchdog({
        checks: [{ type: 'repo', repoDir: tmpDir, expectClean: false }],
      });
      expect(dirtyAllowed.checks[0]?.status).toBe('ok');
    });
  });

  describe('build', () => {
    it('reports ok when the build command exits zero', async () => {
      const result = await runWatchdog({
        checks: [{ type: 'build', command: { executable: 'node', args: ['-e', 'process.exit(0)'] } }],
      });
      expect(result.ok).toBe(true);
      expect(result.checks[0]?.status).toBe('ok');
    });

    it('alerts when the build command fails', async () => {
      const result = await runWatchdog({
        checks: [{ type: 'build', command: { executable: 'node', args: ['-e', 'process.exit(2)'] } }],
      });
      expect(result.ok).toBe(false);
      expect(result.checks[0]?.status).toBe('alert');
      expect(result.checks[0]?.details.exitCode).toBe(2);
    });

    it('errors when the build executable is not allowed', async () => {
      const result = await runWatchdog({
        checks: [{ type: 'build', command: { executable: 'rm', args: ['-rf', '/'] } }],
      });
      expect(result.checks[0]?.status).toBe('error');
    });
  });

  it('aggregates multiple checks and counts alerts/errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200 } as Response);
    const result = await runWatchdog({
      checks: [
        { type: 'disk', path: tmpDir, minFreeBytes: 0 },
        { type: 'http', url: 'https://example.test/ok' },
        { type: 'build', command: { executable: 'node', args: ['-e', 'process.exit(1)'] } },
      ],
    });
    expect(result.checks).toHaveLength(3);
    expect(result.alerts).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('alert');
  });
});
