import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateCronPreCheck } from '../../src/scheduler/pre-check-runner.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'precheck-test-'));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // ignore
  }
}

describe('evaluateCronPreCheck', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  describe('file_changed', () => {
    it('runs on first observation and returns a fingerprint', async () => {
      const file = path.join(tmpDir, 'seed.txt');
      fs.writeFileSync(file, 'v1', 'utf8');

      const result = await evaluateCronPreCheck({ type: 'file_changed', paths: [file] });
      expect(result.shouldRun).toBe(true);
      expect(result.reason).toMatch(/first run/i);
      expect(typeof result.fingerprint).toBe('string');
      expect(result.fingerprint).toHaveLength(64);
    });

    it('skips when content is unchanged', async () => {
      const file = path.join(tmpDir, 'seed.txt');
      fs.writeFileSync(file, 'stable', 'utf8');

      const first = await evaluateCronPreCheck({ type: 'file_changed', paths: [file] });
      const second = await evaluateCronPreCheck({
        type: 'file_changed',
        paths: [file],
        lastFingerprint: first.fingerprint,
      });

      expect(second.shouldRun).toBe(false);
      expect(second.reason).toMatch(/unchanged/i);
      expect(second.fingerprint).toBe(first.fingerprint);
    });

    it('runs when content changed since the last fingerprint', async () => {
      const file = path.join(tmpDir, 'seed.txt');
      fs.writeFileSync(file, 'before', 'utf8');
      const first = await evaluateCronPreCheck({ type: 'file_changed', paths: [file] });

      fs.writeFileSync(file, 'after', 'utf8');
      const second = await evaluateCronPreCheck({
        type: 'file_changed',
        paths: [file],
        lastFingerprint: first.fingerprint,
      });

      expect(second.shouldRun).toBe(true);
      expect(second.reason).toMatch(/changed/i);
      expect(second.fingerprint).not.toBe(first.fingerprint);
    });

    it('treats a disappearing file as a change', async () => {
      const file = path.join(tmpDir, 'seed.txt');
      fs.writeFileSync(file, 'present', 'utf8');
      const first = await evaluateCronPreCheck({ type: 'file_changed', paths: [file] });

      fs.rmSync(file);
      const second = await evaluateCronPreCheck({
        type: 'file_changed',
        paths: [file],
        lastFingerprint: first.fingerprint,
      });
      expect(second.shouldRun).toBe(true);
    });

    it('fingerprints directory contents', async () => {
      const dir = path.join(tmpDir, 'watched');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a', 'utf8');
      const first = await evaluateCronPreCheck({ type: 'file_changed', paths: [dir] });

      const unchanged = await evaluateCronPreCheck({
        type: 'file_changed',
        paths: [dir],
        lastFingerprint: first.fingerprint,
      });
      expect(unchanged.shouldRun).toBe(false);

      fs.writeFileSync(path.join(dir, 'b.txt'), 'b', 'utf8');
      const changed = await evaluateCronPreCheck({
        type: 'file_changed',
        paths: [dir],
        lastFingerprint: first.fingerprint,
      });
      expect(changed.shouldRun).toBe(true);
    });

    it('fails open with no paths', async () => {
      const result = await evaluateCronPreCheck({ type: 'file_changed', paths: [] });
      expect(result.shouldRun).toBe(true);
      expect(result.evidence.failOpen).toBe(true);
    });
  });

  describe('command', () => {
    it('runs when guard command exits zero (default exit_zero)', async () => {
      const result = await evaluateCronPreCheck({
        type: 'command',
        command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
      });
      expect(result.shouldRun).toBe(true);
      expect(result.evidence.exitCode).toBe(0);
    });

    it('skips when guard command exits non-zero (exit_zero)', async () => {
      const result = await evaluateCronPreCheck({
        type: 'command',
        command: { executable: 'node', args: ['-e', 'process.exit(3)'] },
      });
      expect(result.shouldRun).toBe(false);
      expect(result.evidence.exitCode).toBe(3);
    });

    it('inverts the gate with exit_nonzero', async () => {
      const runsOnFailure = await evaluateCronPreCheck({
        type: 'command',
        runWhen: 'exit_nonzero',
        command: { executable: 'node', args: ['-e', 'process.exit(1)'] },
      });
      expect(runsOnFailure.shouldRun).toBe(true);

      const skipsOnSuccess = await evaluateCronPreCheck({
        type: 'command',
        runWhen: 'exit_nonzero',
        command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
      });
      expect(skipsOnSuccess.shouldRun).toBe(false);
    });

    it('gates on stdout change', async () => {
      const first = await evaluateCronPreCheck({
        type: 'command',
        runWhen: 'stdout_changed',
        command: { executable: 'node', args: ['-e', 'console.log("same")'] },
      });
      expect(first.shouldRun).toBe(true);
      expect(typeof first.fingerprint).toBe('string');

      const unchanged = await evaluateCronPreCheck({
        type: 'command',
        runWhen: 'stdout_changed',
        command: { executable: 'node', args: ['-e', 'console.log("same")'] },
        lastFingerprint: first.fingerprint,
      });
      expect(unchanged.shouldRun).toBe(false);

      const changed = await evaluateCronPreCheck({
        type: 'command',
        runWhen: 'stdout_changed',
        command: { executable: 'node', args: ['-e', 'console.log("different")'] },
        lastFingerprint: first.fingerprint,
      });
      expect(changed.shouldRun).toBe(true);
    });

    it('fails open when the executable is not allowed', async () => {
      const result = await evaluateCronPreCheck({
        type: 'command',
        command: { executable: 'rm', args: ['-rf', '/'] },
      });
      expect(result.shouldRun).toBe(true);
      expect(result.evidence.error).toBe('executable_not_allowed');
    });
  });

  it('fails open on an unknown pre-check type', async () => {
    // @ts-expect-error — exercising the runtime guard for bad config
    const result = await evaluateCronPreCheck({ type: 'nonsense' });
    expect(result.shouldRun).toBe(true);
    expect(result.evidence.error).toBe('unknown_type');
  });
});
