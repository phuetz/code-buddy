import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CODES } from '../../src/utils/exit-codes.js';
import {
  GracefulShutdownManager,
  signalExitCode,
} from '../../src/utils/graceful-shutdown.js';

describe('headless interrupt shutdown', () => {
  afterEach(() => {
    GracefulShutdownManager.reset();
    vi.restoreAllMocks();
    delete process.env.CODEBUDDY_HEADLESS;
  });

  it('maps SIGINT to 130 in an explicit headless run (USER_CANCELLED), not 0', () => {
    expect(signalExitCode('SIGINT', { CODEBUDDY_HEADLESS: 'true' })).toBe(EXIT_CODES.USER_CANCELLED);
  });

  it('keeps exit 0 for interactive runs and for non-TTY servers under a supervisor', () => {
    expect(signalExitCode('SIGINT', {})).toBe(0);
    expect(signalExitCode('SIGTERM', {})).toBe(0);
    expect(signalExitCode('SIGTERM', { CODEBUDDY_HEADLESS: 'true' })).toBe(0);
  });

  it('does not write shutdown progress or ANSI to a non-TTY stdout', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const manager = GracefulShutdownManager.getInstance({ showProgress: true, timeoutMs: 2000, forceExitOnTimeout: true });
    manager.registerHandler({
      name: 'session-save',
      priority: 1,
      handler: () => undefined,
    });
    await manager.shutdown({ exitCode: EXIT_CODES.USER_CANCELLED });

    const stdout = stdoutChunks.join('');
    expect(stdout).not.toContain('[shutdown]');
    expect(stdout).not.toContain('\x1b[');
    const stderr = stderrChunks.join('');
    expect(stderr).toContain('[shutdown]');
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.USER_CANCELLED);
  });
});
