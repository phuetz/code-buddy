import path from 'node:path';
import { spawn } from 'node:child_process';
import { Command } from 'commander';
import {
  addLazyCommandGroup,
  getNonInteractiveUnknownCommand,
} from '../../src/cli/command-routing';

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCli(args: string[]): Promise<CliResult> {
  const child = spawn(process.execPath, [
    path.resolve('node_modules/tsx/dist/cli.mjs'),
    'src/index.ts',
    ...args,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEBUDDY_DISABLE_MCP: 'true',
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 10_000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

describe('CLI command routing', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('propagates aliases through one lazy stub and replaces it before re-parse', async () => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    let loaderCalls = 0;
    let statusCalls = 0;

    addLazyCommandGroup(
      program,
      'autonomy',
      'Autonomous fleet loop',
      async () => {
        loaderCalls += 1;
        const realCommand = program.command('autonomy').alias('colab');
        realCommand.command('status').action(() => {
          statusCalls += 1;
        });
      },
      ['colab'],
    );

    expect(program.commands).toHaveLength(1);
    expect(program.commands[0]?.name()).toBe('autonomy');
    expect(program.commands[0]?.aliases()).toEqual(['colab']);

    process.argv = ['node', 'buddy', 'colab', 'status'];
    await program.parseAsync(process.argv);

    expect(loaderCalls).toBe(1);
    expect(statusCalls).toBe(1);
    expect(program.commands).toHaveLength(1);
    expect(program.commands[0]?.name()).toBe('autonomy');
    expect(program.commands[0]?.aliases()).toContain('colab');
  });

  it('keeps quoted free-form positionals outside the unknown-command heuristic', () => {
    expect(getNonInteractiveUnknownCommand({
      positionalArgs: ['résume ce dépôt'],
      hasExplicitPrompt: false,
      stdinIsTTY: false,
      stdoutIsTTY: false,
    })).toBeUndefined();
  });

  it('fails fast for a command-like positional in a non-interactive process', async () => {
    const result = await runCli(['commande-inexistante']);

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'Commande inconnue « commande-inexistante ». Voir buddy --help',
    );
  }, 30_000);
});
