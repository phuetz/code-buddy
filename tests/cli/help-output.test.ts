import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { repoScratchRoot } from '../helpers/tmp.js';

const CLI_TIMEOUT_MS = 30_000;

interface RunCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function runCli(args: string[], options: RunCliOptions = {}): Promise<{
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
      path.resolve('src/index.ts'),
      ...args,
    ], {
      cwd: options.cwd ?? process.cwd(),
      env: {
        ...cleanEnv,
        CODEBUDDY_DISABLE_MCP: 'true',
        NO_COLOR: '1',
        ...options.env,
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
    expect(result.stdout.startsWith('Getting started — 6 demos')).toBe(true);
    expect(result.stdout.indexOf('Getting started')).toBeLessThan(result.stdout.indexOf('Usage:'));
    expect(result.stdout).toContain('1. buddy try');
    expect(result.stdout).toContain('/loop "Fix the failing tests"');
    expect(result.stdout).toContain('buddy research "Compare SQLite and PostgreSQL"');
