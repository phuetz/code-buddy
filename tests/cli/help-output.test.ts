import path from 'node:path';
import { spawn } from 'node:child_process';

const CLI_TIMEOUT_MS = 30_000;

function runCli(args: string[]): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'),
      'src/index.ts',
      ...args,
    ], {
      cwd: process.cwd(),
      env: {
        ...cleanEnv,
        CODEBUDDY_DISABLE_MCP: 'true',
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(
        `CLI timed out after ${CLI_TIMEOUT_MS}ms: ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ));
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', exitCode => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

let rootHelpPromise: ReturnType<typeof runCli> | undefined;

function runRootHelp(): ReturnType<typeof runCli> {
  rootHelpPromise ??= runCli(['--help']);
  return rootHelpPromise;
}

function getCommandsBlock(stdout: string): string {
  const marker = '\nCommands:\n';
  const start = stdout.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  return stdout.slice(start + marker.length);
}

describe('CLI help output', () => {
  it('shows the canonical headless output flag and hides the legacy alias', async () => {
    const result = await runRootHelp();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('--output-format <format>');
    expect(result.stdout).not.toMatch(/^\s+--output <format>/m);
  }, CLI_TIMEOUT_MS + 5_000);

  it('flushes the complete root command block before exiting', async () => {
    const result = await runRootHelp();
    const commands = getCommandsBlock(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(commands).toMatch(/^\s+dev\s/m);
    expect(commands).toMatch(/^\s+research\s/m);
    expect(commands).toMatch(/^\s+completions\s/m);
    expect(result.stdout.endsWith('\n')).toBe(true);
  }, CLI_TIMEOUT_MS + 5_000);

  it('starts with six focused demos before the exhaustive reference', async () => {
    const result = await runRootHelp();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('Pour commencer — 6 démos')).toBe(true);
    expect(result.stdout.indexOf('Pour commencer')).toBeLessThan(result.stdout.indexOf('Usage:'));
    expect(result.stdout).toContain('1. buddy try');
    expect(result.stdout).toContain('/loop "Corrige les tests en échec"');
    expect(result.stdout).toContain('buddy research "Cartographie ce dépôt"');
    expect(result.stdout).toContain('buddy dev pr "Ajoute une petite fonctionnalité"');
    expect(result.stdout).toContain('/think deep "Propose le refactoring le plus sûr"');
    expect(result.stdout).toContain('/share create demo');
  }, CLI_TIMEOUT_MS + 5_000);

  it('hides advanced product areas only for the core profile', async () => {
    const core = await runCli(['--profile', 'core', '--help']);
    const all = await runCli(['--profile', 'all', '--help']);

    expect(core.exitCode).toBe(0);
    expect(core.stderr).toBe('');
    expect(core.stdout).toMatch(/^\s+dev\s/m);
    expect(core.stdout).toMatch(/^\s+research\s/m);
    expect(core.stdout).not.toMatch(/^\s+(companion|film|vision-train|voice|nodes)\s/m);

    expect(all.exitCode).toBe(0);
    expect(all.stdout).toMatch(/^\s+companion\s/m);
    expect(all.stdout).toMatch(/^\s+film\s/m);
    expect(all.stdout).toMatch(/^\s+vision-train\s/m);
  }, CLI_TIMEOUT_MS + 5_000);
});
