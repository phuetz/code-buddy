import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { HookRunner } from '../../src/hooks/hook-runner.js';
import type { ExtendedHook } from '../../src/hooks/hook-types.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

type MockProcess = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockProcess(stdout: string, exitCode = 0): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('HookRunner command shell selection', () => {
  it('uses the native shell for command hooks on the current platform', async () => {
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(createMockProcess('ok') as unknown as ReturnType<typeof spawn>);

    const runner = new HookRunner('__no_hooks_config__');
    runner.addHook({
      event: 'PreToolUse',
      handler: {
        type: 'command',
        command: 'echo ok',
      },
    } satisfies ExtendedHook);

    const result = await runner.run('PreToolUse', { toolName: 'bash' });

    const expectedShell = process.platform === 'win32' ? 'cmd' : 'sh';
    const expectedFlag = process.platform === 'win32' ? '/c' : '-c';
    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      expectedShell,
      [expectedFlag, 'echo ok'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] })
    );
  });
});
