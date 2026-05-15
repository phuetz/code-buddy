import { EventEmitter } from 'events';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  spawn: mockSpawn,
}));

import {
  COMMAND_COMPLETED_WITH_NO_OUTPUT,
  ToolExecutor,
} from '../src/main/tools/tool-executor';
import { SandboxToolExecutor } from '../src/main/tools/sandbox-tool-executor';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

const mockPathResolver = {
  getMounts: () => [{ real: '/tmp/workspace', virtual: '/mnt/workspace' }],
  resolve: (sessionId: string, virtualPath: string) => {
    if (virtualPath.startsWith('/mnt/workspace')) {
      return virtualPath.replace('/mnt/workspace', '/tmp/workspace');
    }
    return null;
  },
};

describe('tool command output fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels ToolExecutor command success with no stdout explicitly', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executor = new ToolExecutor(mockPathResolver as any);
    const promise = executor.executeCommand('s1', 'true', '/tmp/workspace');

    proc.emit('close', 0);

    await expect(promise).resolves.toBe(COMMAND_COMPLETED_WITH_NO_OUTPUT);
  });

  it('labels legacy bash success with no stdout explicitly', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);

    const executor = new ToolExecutor(mockPathResolver as any);
    const promise = (executor as any).bash('true', {
      sessionId: 's1',
      cwd: '/tmp/workspace',
    });

    proc.emit('close', 0);

    await expect(promise).resolves.toEqual({
      success: true,
      output: COMMAND_COMPLETED_WITH_NO_OUTPUT,
    });
  });

  it('labels SandboxToolExecutor command success with no stdout explicitly', async () => {
    const sandboxAdapter = {
      executeCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    };

    const executor = new SandboxToolExecutor(mockPathResolver as any, sandboxAdapter as any);

    await expect(executor.executeCommand('s1', 'true', '/mnt/workspace')).resolves.toBe(
      COMMAND_COMPLETED_WITH_NO_OUTPUT
    );
  });
});
