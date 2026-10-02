import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../fixtures/b-malformed-npm-shell.json';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });

it('renvoie un refus corrigeable pour la commande mal citée de B au lieu de demander un terminal', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const result = await evaluateShellExecution(fixture.command.replace('WORKSPACE_PLACEHOLDER', process.cwd()), process.cwd());
  expect(result.action).toBe('ask');
  expect(result.capabilityRefusal).toContain('CAPABILITY_DENIED');
  expect(result.capabilityRefusal).toContain('No command was executed');
});

it('préserve la demande interactive et les refus durs', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,npm-registry');
  getPermissionModeManager().setMode('default');
  const interactive = await evaluateShellExecution(fixture.command.replace('WORKSPACE_PLACEHOLDER', process.cwd()), process.cwd());
  expect(interactive.action).toBe('ask');
  expect(interactive.capabilityRefusal).toBeUndefined();
  getPermissionModeManager().setMode('dontAsk');
  const denied = await evaluateShellExecution('rm -rf /', process.cwd());
  expect(denied.action).toBe('deny');
  expect(denied.capabilityRefusal).toBeUndefined();
});
