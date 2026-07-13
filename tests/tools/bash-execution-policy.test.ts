import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetExecPolicy } from '../../src/sandbox/execpolicy.js';
import { clearPermissionsCache } from '../../src/security/declarative-rules.js';
import {
  getPermissionModeManager,
  resetPermissionModeManager,
} from '../../src/security/permission-modes.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import {
  evaluateShellExecution,
  executableIdentitiesStillMatch,
  isSandboxBoundaryFailure,
} from '../../src/tools/bash/execution-policy.js';

describe('Bash runtime execution policy', () => {
  beforeEach(() => {
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
    PolicyEngine.getInstance().releaseKillSwitch();
    getPermissionModeManager().setMode('default');
  });

  afterEach(() => {
    PolicyEngine.getInstance().releaseKillSwitch();
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
  });

  it('keeps read-only commands inside the workspace sandbox', async () => {
    await expect(evaluateShellExecution('cat README.md', process.cwd())).resolves.toMatchObject({
      action: 'sandbox',
    });
    await expect(
      evaluateShellExecution('git status --short', process.cwd())
    ).resolves.toMatchObject({
      action: 'sandbox',
    });
  });

  it('asks for exact authority when an operation crosses the sandbox boundary', async () => {
    await expect(evaluateShellExecution('npm install', process.cwd())).resolves.toMatchObject({
      action: 'ask',
    });
  });

  it('retains deterministic denials', async () => {
    await expect(evaluateShellExecution('rm -rf /', process.cwd())).resolves.toMatchObject({
      action: 'deny',
    });
  });

  it.each([2, 126, 127])('does not turn application exit %i into a host escalation', (exitCode) => {
    expect(isSandboxBoundaryFailure({
      exitCode,
      stdout: '',
      stderr: exitCode === 127 ? 'command not found' : 'permission denied',
      duration: 1,
      timedOut: false,
      backend: 'docker',
      sandboxed: true,
    })).toBe(false);
  });

  it('recognizes an explicit filesystem boundary denial', () => {
    expect(isSandboxBoundaryFailure({
      exitCode: 1,
      stdout: '',
      stderr: 'read-only file system',
      duration: 1,
      timedOut: false,
      backend: 'docker',
      sandboxed: true,
    })).toBe(true);
  });

  it('binds exact approvals to the resolved executable and detects replacement before spawn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-executable-id-'));
    const executable = path.join(dir, 'policy-probe');
    const previousPath = process.env.PATH;
    fs.writeFileSync(executable, '#!/bin/sh\necho first\n');
    fs.chmodSync(executable, 0o755);
    process.env.PATH = `${dir}${path.delimiter}${previousPath ?? ''}`;

    try {
      const first = await evaluateShellExecution('policy-probe --version', process.cwd());
      expect(first.executableIdentities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          token: 'policy-probe',
          kind: 'file',
          resolvedPath: fs.realpathSync(executable),
        }),
      ]));
      expect(executableIdentitiesStillMatch(first, process.cwd())).toBe(true);

      fs.writeFileSync(executable, '#!/bin/sh\necho replacement-with-different-size\n');
      fs.chmodSync(executable, 0o755);
      expect(executableIdentitiesStillMatch(first, process.cwd())).toBe(false);

      const second = await evaluateShellExecution('policy-probe --version', process.cwd());
      expect(second.approvalKey).not.toBe(first.approvalKey);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
