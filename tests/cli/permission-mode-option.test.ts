import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  hoistPermissionModeOption,
  installPermissionModeActionHook,
  parseCliPermissionMode,
} from '../../src/cli/permission-mode-option.js';

function runCli(args: string[], timeoutMs = 30_000): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete env.FORCE_COLOR;
  // Le worker vitest porte NODE_ENV=test/VITEST=true, et sous NODE_ENV=test le
  // logger n'écrit rien : le CLI enfant doit tourner comme chez un utilisateur,
  // sinon ce test validerait du silence.
  delete env.NODE_ENV;
  delete env.VITEST;
  env.NO_COLOR = '1';
  env.CODEBUDDY_DISABLE_MCP = 'true';
  env.CI = '1';

  const child = spawn(
    process.execPath,
    [path.resolve('node_modules/tsx/dist/cli.mjs'), 'src/index.ts', ...args],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

describe('global --permission-mode routing', () => {
  it.each([
    ['flow', ['flow', 'goal']],
    ['research', ['research', 'topic']],
    ['film', ['film', 'status', 'demo']],
    ['dev', ['dev', 'explain']],
    ['improve', ['improve', 'status']],
    ['science', ['science', 'hypothesis']],
    ['papers', ['papers', 'ask', 'question']],
    ['meeting', ['meeting', 'notes.txt']],
    ['evolve', ['evolve', 'status']],
    ['autonomous-code', ['autonomous-code', 'status']],
  ])('hoists the option for the %s command family', (_name, commandTokens) => {
    const argv = [
      'node',
      'buddy',
      ...commandTokens,
      '--permission-mode',
      'acceptEdits',
    ];

    expect(hoistPermissionModeOption(argv)).toEqual([
      'node',
      'buddy',
      '--permission-mode',
      'acceptEdits',
      ...commandTokens,
    ]);
  });

  it('applies the hoisted posture before a nested command action', async () => {
    const program = new Command();
    const applyMode = vi.fn();
    let modeDuringAction: string | undefined;
    program.exitOverride();
    program.option('--permission-mode <mode>');
    installPermissionModeActionHook(program, (mode) => {
      applyMode(mode);
      modeDuringAction = mode;
    });
    program.command('dev').command('explain').action(() => {
      expect(modeDuringAction).toBe('acceptEdits');
    });

    await program.parseAsync(hoistPermissionModeOption([
      'node',
      'buddy',
      'dev',
      'explain',
      '--permission-mode=acceptEdits',
    ]));

    expect(applyMode).toHaveBeenCalledTimes(1);
    expect(applyMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('does not reinterpret literal arguments after --', () => {
    const argv = [
      'node',
      'buddy',
      'research',
      '--',
      '--permission-mode',
      'acceptEdits',
    ];
    expect(hoistPermissionModeOption(argv)).toEqual(argv);
  });

  it('rejects an invalid mode during option parsing', () => {
    expect(() => parseCliPermissionMode('nimportequoi')).toThrow(
      'expected one of default, plan, acceptEdits, dontAsk, bypassPermissions (received "nimportequoi")',
    );
  });
});

describe('global --permission-mode — vrai processus CLI', () => {
  // Appliquer une posture nominale n'est pas une erreur : la confirmation vient
  // de PermissionModeManager.setMode (INFO, ou WARN escaladé pour bypass) et
  // aucune ligne ERROR ne doit apparaître. Le doublon `cli.error` d'index.ts
  // affichait « ❌ ERROR Permission mode: <mode> » sur chaque commande.
  it('n’imprime aucune ligne ERROR en appliquant une posture valide', async () => {
    const result = await runCli(['--permission-mode', 'plan', 'run', 'list']);
    const output = result.stdout + result.stderr;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(output).not.toMatch(/ERROR[^\n]*Permission mode/i);
  }, 45_000);
});
