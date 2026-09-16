/**
 * End of a run when the sandbox process does NOT close.
 *
 * A real child always closes once the redundant `disconnect()` is gone, so this
 * path is driven with a scripted child double: `spawn` returns a process that
 * answers the execute message, emits `exit` on kill, and never emits `close`.
 * The run must then be reported as a failure that names the unterminated
 * sandbox — never as the success the script would otherwise have produced.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

interface FakeOptions { emitClose: boolean }
const fakeOptions: FakeOptions = { emitClose: true };

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const spawn = vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    Object.assign(child, {
      pid: 4242,
      connected: true,
      killed: false,
      exitCode: null,
      signalCode: null,
      stderr: new EventEmitter(),
      stdio: [null, null, new EventEmitter(), null],
      disconnect: () => { child.connected = false; },
      kill: () => {
        if (child.killed) return true;
        child.killed = true;
        child.signalCode = 'SIGKILL';
        setTimeout(() => {
          child.emit('exit', null, 'SIGKILL');
          if (fakeOptions.emitClose) child.emit('close', null, 'SIGKILL');
        }, 5);
        return true;
      },
      send: (message: { type?: string }, callback?: (error: Error | null) => void) => {
        callback?.(null);
        if (message?.type === 'execute') {
          setTimeout(() => {
            child.emit('message', {
              type: 'done',
              snapshotJson: JSON.stringify({ output: 'script observable output', yielded: false, storeEntries: [] }),
            });
          }, 5);
        }
        return true;
      },
    });
    return child as unknown as ReturnType<typeof actual.spawn>;
  });
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const { CodeExecTool } = await import('../../src/tools/code-exec-tool.js');

describe('a sandbox process that never closes', () => {
  it('is reported as a failure naming the unterminated sandbox, not as the script success', async () => {
    fakeOptions.emitClose = false;

    const result = await new CodeExecTool().execute({ code: 'text("ok")' });

    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/did not terminate within \d+ms/);
    expect(String(result.error)).toMatch(/workspace may still be locked/);
    // The script's own output is preserved in the diagnosis, not silently dropped.
    expect(String(result.error)).toContain('script observable output');
  }, 15_000);

  it('a child that closes normally still reports the script success', async () => {
    fakeOptions.emitClose = true;

    const result = await new CodeExecTool().execute({ code: 'text("ok")' });

    expect(result.success, result.error).toBe(true);
    expect(String(result.output)).toContain('script observable output');
    expect(String(result.output)).not.toMatch(/did not terminate/);
  }, 15_000);
});
