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

vi.mock('../../src/security/sandbox.js', () => ({
  getSandboxManager: () => ({ validateCommand: () => ({ valid: true }) }),
}));

vi.mock('../../src/utils/self-healing.js', () => ({
  getSelfHealingEngine: () => ({ attemptHealing: vi.fn() }),
  SelfHealingEngine: class {},
}));

vi.mock('../../src/utils/test-output-parser.js', () => ({
  parseTestOutput: () => ({ isTestOutput: false }),
  isLikelyTestOutput: () => false,
}));

vi.mock('../../src/utils/disposable.js', () => ({
  registerDisposable: vi.fn(),
  Disposable: class {},
}));

vi.mock('../../src/utils/input-validator.js', () => ({
  bashToolSchemas: { execute: {} },
  validateWithSchema: () => ({ valid: true }),
  validateCommand: () => ({ valid: true }),
  sanitizeForShell: (value: string) => value,
}));

vi.mock('../../src/utils/ripgrep-path.js', () => ({
  getRipgrepPath: () => 'rg',
}));

vi.mock('../../src/tools/bash/command-validator.js', () => ({
  validateCommand: () => ({ valid: true }),
  getFilteredEnv: () => ({}),
}));

vi.mock('../../src/security/shell-env-policy.js', () => ({
  getShellEnvPolicy: () => ({ buildEnv: (env: NodeJS.ProcessEnv) => env }),
}));

vi.mock('../../src/tools/bash/streaming-executor.js', () => ({
  executeStreaming: vi.fn(),
}));

vi.mock('../../src/security/bash-parser.js', () => ({
  parseBashCommand: () => ({
    commands: [],
    pipes: [],
    redirects: [],
    isValid: true,
  }),
}));

vi.mock('../../src/checkpoints/checkpoint-manager.js', () => ({
  getCheckpointManager: () => ({ checkpointBeforeEdit: vi.fn() }),
}));

vi.mock('../../src/security/audit-logger.js', () => ({
  auditLogger: { logFileOperation: vi.fn() },
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

async function assertBufferedSpawn(): Promise<void> {
  const child = new FakeChildProcess();
  mocks.spawn.mockReturnValue(child as unknown as ChildProcess);
  const { BashTool } = await import('../../src/tools/bash/bash-tool.js');
  const tool = new BashTool();
  const command = 'Write-Output "spawn arguments"';

  setImmediate(() => child.emit('close', 0));
  await tool.execute(command);

  const shellConfiguration = getShellConfiguration();
  const dispatchedCommand = shellConfiguration.shell === 'bash'
    ? expect.stringContaining(command)
    : command;
  expect(mocks.spawn).toHaveBeenCalledWith(
    shellConfiguration.executable,
    [...shellConfiguration.argsPrefix, dispatchedCommand],
    expect.objectContaining({ shell: false }),
  );
  tool.dispose();
}

beforeEach(() => {
  mocks.spawn.mockReset();
});

describe('buffered shell dispatch', () => {
  describeUnixOnly('on Unix', () => {
    it('passes the configured Bash executable and arguments to spawn', assertBufferedSpawn);
  });

  describeWindowsOnly('on Windows', () => {
    it('passes the configured PowerShell executable and arguments to spawn', assertBufferedSpawn);
  });
});
