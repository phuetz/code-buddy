import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeUnixOnly, describeWindowsOnly } from '../test-utils.js';
import { getShellConfiguration } from '../../src/utils/shell-configuration.js';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('../../src/utils/confirmation-service.js', () => ({
  ConfirmationService: {
    getInstance: () => ({ requestConfirmation: vi.fn() }),
  },
}));

vi.mock('../../src/utils/input-validator.js', () => ({
  validateCommand: () => ({ valid: true }),
}));

vi.mock('../../src/tools/bash/command-validator.js', () => ({
  validateCommand: () => ({ valid: true }),
  getFilteredEnv: () => ({}),
}));

vi.mock('../../src/security/shell-env-policy.js', () => ({
  getShellEnvPolicy: () => ({ buildEnv: (env: NodeJS.ProcessEnv) => env }),
}));

vi.mock('../../src/tools/bash/rtk-rewrite.js', () => ({
  rewriteCommandWithRtk: async (command: string) => ({
    originalCommand: command,
    command,
    rewritten: false,
    reason: 'test',
  }),
}));

vi.mock('../../src/tools/bash/execution-policy.js', () => ({
  evaluateShellExecution: async (command: string) => ({
    action: 'allow',
    reason: 'test',
    approvalKey: `test:${command}`,
  }),
  executableIdentitiesStillMatch: () => true,
  executeInWorkspaceSandbox: vi.fn(),
  isSandboxBoundaryFailure: () => false,
}));

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 1234;
  kill = vi.fn(() => true);
}

async function assertStreamingSpawn(): Promise<void> {
  const child = new FakeChildProcess();
  mocks.spawn.mockReturnValue(child as unknown as ChildProcess);
  const { executeStreaming } = await import('../../src/tools/bash/streaming-executor.js');
  const command = 'Write-Output "spawn arguments"';
  const generator = executeStreaming(command, 1000, {
    getCurrentDirectory: () => process.cwd(),
    getSandboxManager: () => ({ validateCommand: () => ({ valid: true }) }),
    getRunningProcesses: () => new Set<ChildProcess>(),
  });

  setImmediate(() => child.emit('close', 0));
  const result = await generator.next();
  expect(result.done).toBe(true);

  const shellConfiguration = getShellConfiguration();
  const dispatchedCommand = shellConfiguration.shell === 'bash'
    ? expect.stringContaining(command)
    : command;
  expect(mocks.spawn).toHaveBeenCalledWith(
    shellConfiguration.executable,
    [...shellConfiguration.argsPrefix, dispatchedCommand],
    expect.objectContaining({ shell: false }),
  );
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('streaming shell dispatch', () => {
  describeUnixOnly('on Unix', () => {
    it('passes the configured Bash executable and arguments to spawn', assertStreamingSpawn);
  });

  describeWindowsOnly('on Windows', () => {
    it('passes the configured PowerShell executable and arguments to spawn', assertStreamingSpawn);
  });
});
