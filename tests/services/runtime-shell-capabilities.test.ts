import { afterEach, expect, it, vi } from 'vitest';
import { getRuntimeSettingsSnapshot, formatRuntimeSettingsContext } from '../../src/services/runtime-settings-context.js';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });
it('expose la capacité npm réellement accordée au modèle sans donner de registre ni credential arbitraire', () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local,npm-registry');
  vi.stubEnv('OPENAI_API_KEY', 'SECRET_SENTINEL');
  const snapshot = getRuntimeSettingsSnapshot({ surface: 'cli' });
  expect(snapshot.shellCapabilities).toMatchObject({ configured: ['tests', 'git-local', 'npm-registry'], network: 'closed' });
  const context = formatRuntimeSettingsContext({ surface: 'cli' });
  expect(context).toContain('npm install --package-lock-only --ignore-scripts');
  expect(context).toContain('requires approval');
  expect(context).not.toContain('SECRET_SENTINEL');
  expect(getRuntimeSettingsSnapshot({ surface: 'http' }).shellCapabilities).toBeUndefined();
});
it('explique le npm install du replay 35B comme capacité refusée avec une alternative accordée', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const decision = await evaluateShellExecution('HOME=/tmp/isolated npm install', process.cwd());
  expect(decision.action).toBe('ask');
  expect(decision.capabilityRefusal).toContain('CAPABILITY_DENIED');
  expect(decision.capabilityRefusal).toContain('npm install --package-lock-only --ignore-scripts');
});

it('classe le checkout refusé du replay B sans demander de terminal', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,git-local,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const decision = await evaluateShellExecution('git checkout package-lock.json', process.cwd());
  expect(decision.action).toBe('ask');
  expect(decision.capabilityRefusal).toContain('CAPABILITY_DENIED');
  expect(decision.capabilityRefusal).toContain('git add');
  expect(decision.capabilityRefusal).toContain('git show');
});
