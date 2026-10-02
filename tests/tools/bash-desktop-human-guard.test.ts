import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { executeStreaming } from '../../src/tools/bash/streaming-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

const sandbox = vi.hoisted(() => vi.fn());
vi.mock('../../src/tools/bash/execution-policy.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/tools/bash/execution-policy.js')>();
  return { ...actual, evaluateShellExecution: async () => ({ action: 'sandbox', reason: 'fixture' }),
    executeInWorkspaceSandbox: sandbox };
});
vi.mock('../../src/tools/bash/rtk-rewrite.js', () => ({ rewriteCommandWithRtk: (command: string) => ({ command, rewritten: false }) }));

describe('Grok desktop shell before sandbox', () => {
  const service = ConfirmationService.getInstance(); const human = vi.fn();
  beforeEach(() => {
    resetPermissionModeManager(); service.resetSession(); getPermissionModeManager().setMode('dontAsk');
    human.mockReset().mockResolvedValue({ confirmed: false }); service.setInteractiveBridge(human);
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true'); service.setSessionFlag('allOperations', true);
    sandbox.mockReset().mockResolvedValue({ available: true,
      result: { stdout: 'desktop actuator reached', stderr: '', exitCode: 0, backend: 'fixture', timedOut: false } });
  });
  afterEach(() => { service.setInteractiveBridge(null); resetPermissionModeManager(); vi.unstubAllEnvs(); });
  const commands = ['xdotool key Return', "xdo'to'ol key Return", 'xdo"to"ol key Return', 'xte \'key Return\'', 'wtype -k Return', String.raw`xdo\tool key Return`, '/usr/bin/wtype -k Return'];
  it.each(commands)('buffered desktop command %s cannot reach sandbox after refusal', async command => {
    const result = await new BashTool().execute(command);
    expect({ success: result.success, sandboxDispatches: sandbox.mock.calls.length }).toEqual({ success: false, sandboxDispatches: 0 });
    expect(result.error).toMatch(/human confirmation/);
    expect(sandbox).not.toHaveBeenCalled(); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
  });
  it.each(commands)('streaming desktop command %s cannot reach sandbox after refusal', async command => {
    const iterator = executeStreaming(command, 1000, {
      getCurrentDirectory: () => process.cwd(), getRunningProcesses: () => new Set(),
      getSandboxManager: () => ({ validateCommand: () => ({ valid: true }) }),
    });
    let next = await iterator.next(); while (!next.done) next = await iterator.next();
    expect({ success: next.value.success, sandboxDispatches: sandbox.mock.calls.length }).toEqual({ success: false, sandboxDispatches: 0 });
    expect(next.value.error).toMatch(/human confirmation/);
    expect(sandbox).not.toHaveBeenCalled(); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
  });
  it('Grok cloned Bash(xdotool *) rule cannot waive the desktop guard', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'bash-project-guard-'));
    mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({
      permissions: { allow: ['Bash(xdotool *)'] },
    }));
    try {
      getPermissionModeManager().setMode('default'); service.resetSession();
      vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'false');
      const command = 'xdotool key Return';
      const outer = await service.requestConfirmation({ operation: 'Run command', filename: command,
        toolName: 'bash', toolArgs: { command }, detail: { cwd: directory } }, 'tool');
      expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
      vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true');
      const result = await new BashTool().execute(command, 1000, directory);
      expect({ success: result.success, sandboxDispatches: sandbox.mock.calls.length })
        .toEqual({ success: false, sandboxDispatches: 0 });
      expect(human).toHaveBeenCalledTimes(1); expect(human.mock.calls[0]?.[0].forcePrompt).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('approved desktop command reaches the sandbox once', async () => {
    human.mockResolvedValue({ confirmed: true });
    expect((await new BashTool().execute('xdotool key Return')).success).toBe(true);
    expect(sandbox).toHaveBeenCalledTimes(1); expect(human).toHaveBeenCalledTimes(1);
  });
  it('ordinary read command retains its sandbox route without a desktop prompt', async () => {
    expect((await new BashTool().execute('pwd')).success).toBe(true);
    expect(sandbox).toHaveBeenCalledTimes(1); expect(human).not.toHaveBeenCalled();
  });
});
