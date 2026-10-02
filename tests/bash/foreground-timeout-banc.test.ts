import { afterEach, expect, it, vi } from 'vitest';
import { BASH_TOOL, TERMINAL_TOOL } from '../../src/codebuddy/tool-definitions/core-tools.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import * as executionPolicy from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

afterEach(() => { vi.restoreAllMocks(); getPermissionModeManager().setMode('default'); });

it.each([BASH_TOOL, TERMINAL_TOOL])('expose le délai au modèle pour $function.name', tool => {
  const timeout = tool.function.parameters.properties.timeout;
  expect(timeout).toMatchObject({ type: 'number' });
  expect(timeout?.description).toContain('600000');
  expect(timeout?.description).toContain('foreground');
  expect(tool.function.parameters.required).not.toContain('timeout');
});

it.each([false, true])('guide la reprise après timeout sans détacher la commande (streaming=%s)', async streaming => {
  getPermissionModeManager().setMode('dontAsk');
  const execute = vi.spyOn(executionPolicy, 'executeInWorkspaceSandbox').mockResolvedValue({
    available: true,
    result: { exitCode: 124, stdout: 'partial output', stderr: '', duration: 45000, timedOut: true, backend: 'landlock', sandboxed: true },
  });
  const tool = new BashTool();
  try {
    let result;
    if (streaming) {
      const stream = tool.executeStreaming('echo timeout-fixture', 45000);
      let step = await stream.next();
      while (!step.done) step = await stream.next();
      result = step.value;
    } else result = await tool.execute('echo timeout-fixture', 45000);
    expect(execute.mock.calls[0]?.[2]).toBe(45000);
    expect(result.success).toBe(false);
    expect(result.output).toBe('partial output');
    expect(result.error).toContain('45000ms');
    expect(result.error).toContain('timeout parameter');
    expect(result.error).toContain('600000');
    expect(result.error).toContain('foreground');
  } finally { tool.dispose(); }
});

it.each([0, -1, 600001])('refuse un délai invalide avant exécution en streaming (%s)', async timeout => {
  getPermissionModeManager().setMode('dontAsk');
  const execute = vi.spyOn(executionPolicy, 'executeInWorkspaceSandbox').mockResolvedValue({ available: false });
  const tool = new BashTool();
  try {
    const stream = tool.executeStreaming('echo timeout-fixture', timeout);
    let step = await stream.next();
    while (!step.done) step = await stream.next();
    expect(step.value.success).toBe(false);
    expect(step.value.error).toContain('timeout');
    expect(execute).not.toHaveBeenCalled();
  } finally { tool.dispose(); }
});
