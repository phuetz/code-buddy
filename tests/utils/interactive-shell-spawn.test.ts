import { describe, expect, it, vi } from 'vitest';
import { describeUnixOnly, describeWindowsOnly } from '../test-utils.js';
import {
  InteractiveBashTool,
  resolveBashExecutable,
  type PTYModule,
  type PTYShell,
} from '../../src/tools/interactive-bash.js';
import { getShellConfiguration } from '../../src/utils/shell-configuration.js';

function createPtyHarness(): {
  module: PTYModule;
  spawn: ReturnType<typeof vi.fn>;
  exit: (exitCode: number) => void;
} {
  let exitHandler: ((event: { exitCode: number }) => void) | undefined;
  const shell: PTYShell = {
    onData: vi.fn(),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      exitHandler = handler;
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
  const spawn = vi.fn(() => shell);
  return {
    module: { spawn },
    spawn,
    exit: (exitCode: number) => exitHandler?.({ exitCode }),
  };
}

async function assertInteractiveSpawn(): Promise<void> {
  const harness = createPtyHarness();
  const tool = new InteractiveBashTool(harness.module);
  const command = 'Write-Output "pty arguments"';
  const execution = tool.executeInteractive(command, { cwd: process.cwd() });

  const shellConfiguration = getShellConfiguration();
  const executable = shellConfiguration.shell === 'bash'
    ? resolveBashExecutable()
    : shellConfiguration.executable;
  expect(harness.spawn).toHaveBeenCalledWith(
    executable,
    [...shellConfiguration.argsPrefix, command],
    expect.objectContaining({ cwd: process.cwd() }),
  );

  harness.exit(0);
  await execution;
}

describe('interactive shell dispatch', () => {
  describeUnixOnly('on Unix', () => {
    it('passes the resolved Bash executable and arguments to PTY spawn', assertInteractiveSpawn);
  });

  describeWindowsOnly('on Windows', () => {
    it('passes the configured PowerShell executable and arguments to PTY spawn', assertInteractiveSpawn);
  });
});
