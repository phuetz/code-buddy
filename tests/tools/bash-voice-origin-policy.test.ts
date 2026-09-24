import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetExecPolicy } from '../../src/sandbox/execpolicy.js';
import { clearPermissionsCache } from '../../src/security/declarative-rules.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { PolicyEngine } from '../../src/security/policy-engine.js';
import { withTurnOriginAsync } from '../../src/security/turn-origin.js';
import { BashTool } from '../../src/tools/bash/bash-tool.js';
import { evaluateShellExecution } from '../../src/tools/bash/execution-policy.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';

// A voice turn runs on speech the microphone only HEARD. Before this rule, a
// workspace mutation (`rm`, `mv`, `truncate`…) classified `sandbox` ran
// without any prompt in the default posture, voice or not (audit 2026-09-24).
describe('shell policy for voice-originated turns', () => {
  let repo: string;

  beforeEach(() => {
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
    PolicyEngine.getInstance().releaseKillSwitch();
    getPermissionModeManager().setMode('default');
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-voice-policy-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    // A directory name that exists nowhere else: even with a wrong working
    // directory, the destructive command below could not touch real files.
    fs.mkdirSync(path.join(repo, 'zz-voix-temoin'));
    fs.writeFileSync(path.join(repo, 'zz-voix-temoin', 'precieux.ts'), 'export const x = 1;\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetExecPolicy();
    resetPermissionModeManager();
    clearPermissionsCache();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('turns a workspace mutation into an approval request on a voice turn', async () => {
    const voice = await withTurnOriginAsync('voice', () => evaluateShellExecution('rm -rf zz-voix-temoin', repo));
    expect(voice.action).toBe('ask');
    expect(voice.reason).toMatch(/voice turn/i);
  });

  it('leaves the same mutation unchanged outside a voice turn', async () => {
    const coding = await evaluateShellExecution('rm -rf zz-voix-temoin', repo);
    expect(coding.action).toBe('sandbox');
  });

  it('still lets a voice turn read without approval', async () => {
    const read = await withTurnOriginAsync('voice', () => evaluateShellExecution('ls zz-voix-temoin', repo));
    expect(read.action).toBe('sandbox');
  });

  it('respects an explicit permissive voice posture', async () => {
    const decision = await withTurnOriginAsync('voice', () =>
      getPermissionModeManager().withModeAsync('bypassPermissions', () =>
        evaluateShellExecution('rm -rf zz-voix-temoin', repo),
      ),
    );
    expect(decision.action).toBe('sandbox');
  });

  it('asks a human through BashTool and keeps the file when nobody approves', async () => {
    const confirm = vi
      .spyOn(ConfirmationService.getInstance(), 'requestConfirmation')
      .mockResolvedValue({ confirmed: false } as never);
    const tool = new BashTool();
    try {
      // The working directory is passed explicitly: BashTool otherwise uses the
      // process cwd captured at construction, which is not the throwaway repo.
      const result = await withTurnOriginAsync('voice', () =>
        tool.execute('rm -rf zz-voix-temoin', 30_000, repo),
      );
      expect(result.success).toBe(false);
    } finally {
      tool.dispose();
    }
    expect(confirm).toHaveBeenCalled();
    expect(fs.existsSync(path.join(repo, 'zz-voix-temoin', 'precieux.ts'))).toBe(true);
  });
});
