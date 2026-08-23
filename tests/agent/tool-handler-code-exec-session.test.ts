import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolHandler } from '../../src/agent/tool-handler.js';
import { resetPermissionModeManager } from '../../src/security/permission-modes.js';
import { resetTrustFolderManager } from '../../src/security/trust-folders.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import {
  approveSandboxUnavailableEscalations,
  clearSandboxEscalationBridge,
} from '../helpers/sandbox-escalation-bridge.js';
import { canonical, canonicalShellPath } from '../helpers/shell-path.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { clearAllCodeExecSessions } from '../../src/tools/code-exec-tool.js';
import { getFormalToolRegistry, resetBashInstance } from '../../src/tools/registry/index.js';
import type { ITool, IToolExecutionContext } from '../../src/tools/registry/types.js';

const REPO_ROOT = fs.realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
);

const HOST_ENV_KEYS = ['HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP'] as const;

const hostEnvSnapshot: Record<(typeof HOST_ENV_KEYS)[number], string | undefined> = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  TMPDIR: process.env.TMPDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
};

function restoreHostProcess(): void {
  if (process.cwd() !== REPO_ROOT) {
    process.chdir(REPO_ROOT);
  }
  for (const key of HOST_ENV_KEYS) {
    const previous = hostEnvSnapshot[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

const PROBE_TOOL = 'code_exec_recovery_scope_probe';

function toolCall(id: string, code: string) {
  return {
    id,
    type: 'function' as const,
    function: {
      name: 'code_exec',
      arguments: JSON.stringify({ code }),
    },
  };
}

function bashCall(id: string, command: string) {
  return {
    id,
    type: 'function' as const,
    function: {
      name: 'bash',
      arguments: JSON.stringify({ command }),
    },
  };
}

describe('ToolHandler code_exec logical-session isolation', () => {
  let handler: ToolHandler;
  let workDir: string;
  const observedScopes: string[] = [];

  beforeEach(() => {
    // Previous files in the same vitest fork can leave process.cwd(), HOME,
    // the bash singleton cwd, or trust enforcement behind. Restore first so
    // this file's session dirs are not created under a mutated host state.
    restoreHostProcess();
    resetBashInstance();
    resetTrustFolderManager();
    resetPermissionModeManager();
    clearAllCodeExecSessions();
    observedScopes.splice(0);
    // The bash `pwd` below runs through the real ConfirmationService; hosts
    // without a sandbox backend (Windows CI) escalate it to an exact grant.
    approveSandboxUnavailableEscalations(ConfirmationService.getInstance());
    // Repo-local tmp (gitignored): Linux bubblewrap mounts a tmpfs over `/tmp`,
    // so a cwd under os.tmpdir() disappears inside the sandbox. git rev-parse
    // from this path still finds the workspace, so the bind stays visible.
    workDir = makeTmpDir('code-exec-session-', path.join(REPO_ROOT, 'tmp'));
    const isolatedHome = path.join(workDir, 'home');
    fs.mkdirSync(isolatedHome, { recursive: true });
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    process.env.TMPDIR = workDir;
    process.env.TEMP = workDir;
    process.env.TMP = workDir;
    handler = new ToolHandler({
      checkpointManager: {
        checkpointBeforeCreate: vi.fn(),
        checkpointBeforeEdit: vi.fn(),
      } as never,
      hooksManager: {
        executeHooks: vi.fn().mockResolvedValue([]),
      } as never,
      marketplace: {
        executeTool: vi.fn(),
        getTools: vi.fn(() => []),
      } as never,
      repairCoordinator: {
        isRepairEnabled: vi.fn(() => false),
      } as never,
    });
    handler.setWorkingDirectory(workDir);
    handler.setConfirmationCallback(async () => true);

    const probe: ITool = {
      name: PROBE_TOOL,
      description: 'Observe the nested recovery scope',
      getSchema: () => ({
        name: PROBE_TOOL,
        description: 'Observe the nested recovery scope',
        parameters: { type: 'object', properties: {} },
      }),
      execute: async (_input: Record<string, unknown>, context?: IToolExecutionContext) => {
        const scope = context?.extra?.recoverySessionId;
        observedScopes.push(typeof scope === 'string' ? scope : 'missing');
        return { success: true, output: String(scope) };
      },
      getMetadata: () => ({
        name: PROBE_TOOL,
        description: 'Observe the nested recovery scope',
        category: 'utility',
        keywords: ['probe'],
        priority: 1,
        requiresConfirmation: false,
      }),
    };
    getFormalToolRegistry().register(probe, { override: true });
  });

  afterEach(() => {
    getFormalToolRegistry().unregister(PROBE_TOOL);
    clearAllCodeExecSessions();
    resetBashInstance();
    resetTrustFolderManager();
    resetPermissionModeManager();
    clearSandboxEscalationBridge(ConfirmationService.getInstance());
    restoreHostProcess();
    removeTmpDir(workDir);
  });

  it('propagates executionExtra to tools called from code_exec', async () => {
    const result = await handler.executeTool(
      toolCall(
        'outer-probe',
        `const result = await tools.${PROBE_TOOL}({}); text(String(result));`,
      ),
      { recoverySessionId: 'logical-session-a' },
    );

    expect(result.success).toBe(true);
    expect(observedScopes).toEqual(['logical-session-a']);
  });

  it('keeps code_exec store/load private when one host handler swaps sessions', async () => {
    const writeA = await handler.executeTool(
      toolCall('store-a', 'store("private", "A-only");'),
      { recoverySessionId: 'logical-session-a' },
    );
    expect(writeA.success).toBe(true);

    const readB = await handler.executeTool(
      toolCall('read-b', 'text(String(load("private")));'),
      { recoverySessionId: 'logical-session-b' },
    );
    expect(readB.success).toBe(true);
    expect(readB.output).toContain('undefined');
    expect(readB.output).not.toContain('A-only');

    const readA = await handler.executeTool(
      toolCall('read-a', 'text(String(load("private")));'),
      { recoverySessionId: 'logical-session-a' },
    );
    expect(readA.success).toBe(true);
    expect(readA.output).toContain('A-only');
  });

  it('owns cd state locally and restores it without changing the host process cwd', async () => {
    const hostCwd = process.cwd();
    // `cd` stores the canonical (realpath) cwd; makeTmpDir already realpaths so
    // restore/compare use the same spelling (os.tmpdir() is a symlink on macOS).
    const realSessionA = makeTmpDir('session-a-', workDir);
    const realSessionB = makeTmpDir('session-b-', workDir);

    handler.setRecoverySessionId('logical-session-a');
    const changed = await handler.executeTool(bashCall('cd-a', `cd ${realSessionA}`));
    expect(changed.success).toBe(true);
    expect(handler.getWorkingDirectory()).toBe(realSessionA);
    expect(process.cwd()).toBe(hostCwd);

    handler.restoreWorkingDirectory(realSessionB);
    handler.setRecoverySessionId('logical-session-b');
    const pwdB = await handler.executeTool(bashCall('pwd-b', 'pwd'));
    if (!pwdB.success) console.error('[macos-diag] pwd in restored cwd', realSessionB, ':', pwdB.error);
    expect(pwdB.success).toBe(true);
    // Match on the unique mkdtemp leaf: `pwd` prints the shell's spelling of the
    // directory (MSYS `/c/Users/...` on Windows), not the Node one.
    expect(pwdB.output).toContain(path.basename(realSessionB));
    expect(pwdB.output).not.toContain(path.basename(realSessionA));
    expect(handler.getRecoverySessionId()).toBe('logical-session-b');

    handler.restoreWorkingDirectory(realSessionA);
    handler.setRecoverySessionId('logical-session-a');
    const pwdA = await handler.executeTool(bashCall('pwd-a', 'pwd'));
    // `pwd` prints the shell's spelling (MSYS `/tmp/...` under Git Bash).
    expect(canonicalShellPath(pwdA.output ?? '')).toBe(canonical(realSessionA));
    expect(handler.getRecoverySessionId()).toBe('logical-session-a');
    expect(process.cwd()).toBe(hostCwd);
  });
});
