import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../fixtures/b-ornith-sandbox-boundary.json';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { executeStreaming } from '../../src/tools/bash/streaming-executor.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { probeNativeSandbox } from '../sandbox/native-sandbox-ready.js';

const ready = await probeNativeSandbox();
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  getPermissionModeManager().setMode('default');
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
it.each(['buffered', 'streaming'])('refuse la relance hors sandbox sans perdre la cause (%s)', async (mode) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'boundary-banc-')); roots.push(workspace);
  fs.mkdirSync(path.join(workspace, '.codebuddy'));
  fs.writeFileSync(path.join(workspace, '.codebuddy', 'settings.json'), '{"sentinel":true}');
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const recorded = JSON.parse(fixture.assistant.tool_calls[0]!.function.arguments).command as string;
  const command = recorded.replace(fixture.workspace, workspace);
  expect((await evaluateShellExecution(command, workspace)).action).toBe('sandbox');
  if (!ready.ready) return;
  const confirmation = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation');
  let result;
  if (mode === 'buffered') {
    const tool = new BashTool();
    try { result = await tool.execute(command, 30000, workspace); } finally { tool.dispose(); }
  } else {
    const generator = executeStreaming(command, 30000, {
      getCurrentDirectory: () => workspace,
      getSandboxManager: () => ({ validateCommand: () => ({ valid: true }) }),
      getRunningProcesses: () => new Set(),
    });
    let step = await generator.next();
    while (!step.done) step = await generator.next();
    result = step.value;
  }
  expect(result?.success).toBe(false);
  expect(result?.error).toContain('CAPABILITY_DENIED');
  expect(result?.error).toMatch(/read-only file system|permission denied/i);
  expect(result?.error).not.toContain('interactive terminal');
  expect(confirmation).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(workspace, '.codebuddy', '.write_test'))).toBe(false);
  expect(fs.readFileSync(path.join(workspace, '.codebuddy', 'settings.json'), 'utf8')).toBe('{"sentinel":true}');
  expect((await evaluateShellExecution('rm -rf /', workspace)).action).toBe('deny');
}, 60000);
