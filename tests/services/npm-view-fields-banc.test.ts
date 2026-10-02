import { afterEach, expect, it, vi } from 'vitest';
import { capabilityAllowsSegment } from '../../src/sandbox/shell-capabilities.js';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';

afterEach(() => { vi.unstubAllEnvs(); getPermissionModeManager().setMode('default'); });

it('autorise la lecture multichamp npm refusée pendant le banc B', async () => {
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'tests,npm-registry');
  getPermissionModeManager().setMode('dontAsk');
  const decision = await evaluateShellExecution('npm view undici@6.28.1 version time --json 2>&1 | tail -5', process.cwd());
  expect(decision.capabilityRefusal).toBeUndefined();
  expect(decision.action).toBe('sandbox');
});

it.each([
  ['undici', 'version', 'time', '--registry=https://example.com'],
  ['undici', 'version', 'time', '--userconfig=/tmp/config'],
  ['undici', 'version', 'time', '--prefix=/tmp/other'],
  ['https://example.com/pkg.tgz', 'version', 'time', '--json'],
])('ne permet pas une option de portée ni une autre source : %j', (...args) => {
  expect(capabilityAllowsSegment(['npm', 'view', ...args], new Set(['npm-registry']))).toBe(false);
});

it('ne donne aucun accès registre sans accord explicite', () => {
  expect(capabilityAllowsSegment(['npm', 'view', 'undici', 'version', 'time', '--json'], new Set(['tests']))).toBe(false);
});
