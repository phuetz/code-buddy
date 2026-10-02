import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../fixtures/b-malformed-npm-shell.json';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });

const licenseSearch = 'grep -rn "installLicense\\|verifyKeyChecksum\\|LICENSE_PUBLIC_KEY\\|LICENSE_ALLOW_LEGACY" --include="*.ts" --include="*.tsx" src/ | grep -v __tests__ | grep -v node_modules';

it('rend récupérable la précaution PolicyEngine déclenchée par la recherche de C', async () => {
  getPermissionModeManager().setMode('dontAsk');
  const result = await evaluateShellExecution(licenseSearch, process.cwd());
  expect(result.action).toBe('ask');
  expect(result.capabilityRefusal).toContain('CAPABILITY_DENIED');
  expect(result.capabilityRefusal).toContain('No command was executed');
  getPermissionModeManager().setMode('default');
  expect((await evaluateShellExecution(licenseSearch, process.cwd())).capabilityRefusal).toBeUndefined();
});

it.each([false, true])('le vrai outil ne sollicite pas de terminal pour ce refus (streaming=%s)', async streaming => {
  getPermissionModeManager().setMode('dontAsk');
  const approval = vi.spyOn(ConfirmationService.getInstance(), 'requestConfirmation')
    .mockResolvedValue({ confirmed: false, feedback: 'NO_TERMINAL_FIXTURE' });
  const tool = new BashTool();
  try {
    let result;
    if (streaming) {
      const stream = tool.executeStreaming(licenseSearch, 5000);
      let step = await stream.next();
      while (!step.done) step = await stream.next();
      result = step.value;
    } else result = await tool.execute(licenseSearch, 5000);
    expect(result.success).toBe(false);
    expect(result.error).toContain('CAPABILITY_DENIED');
    expect(result).not.toHaveProperty('metadata.failure.terminal', true);
    expect(approval).not.toHaveBeenCalled();
  } finally { tool.dispose(); }
});

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
