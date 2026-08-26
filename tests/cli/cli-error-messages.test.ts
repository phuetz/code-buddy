import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function runCli(args: string[], timeoutMs = 15_000): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  delete env.FORCE_COLOR;
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
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

describe('CLI error messages', () => {
  it('accepts --permission-mode after a nested lazy command', async () => {
    const result = await runCli(['run', 'list', '--limit', '0', '--permission-mode', 'acceptEdits']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(text).not.toContain("unknown option '--permission-mode'");
    expect(text).toContain('No runs found.');
  }, 30_000);

  it('accepts --permission-mode after a guarded long-running command', async () => {
    const result = await runCli(['science', 'probe', '--permission-mode', 'plan']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(1);
    expect(text).not.toContain("unknown option '--permission-mode'");
  }, 20_000);

  it('also accepts the trailing global option on utility command help', async () => {
    const result = await runCli(['doctor', '--permission-mode', 'acceptEdits']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.timedOut).toBe(false);
    expect(text).not.toContain("unknown option '--permission-mode'");
    expect(text).toContain('Code Buddy Doctor');
  }, 20_000);

  it('names the received --max-turns value', async () => {
    const result = await runCli(['loop', 'x', '--max-turns', 'abc']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(1);
    expect(text).toContain('--max-turns must be a positive integer');
    expect(text).toContain('received "abc"');
  }, 20_000);

  it('does not dump a Node stack for a missing -d directory', async () => {
    const missing = path.resolve('this-directory-does-not-exist-cb2-xyzzy');
    const result = await runCli(['-d', missing, '-p', 'hi']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(1);
    expect(text).toContain(missing);
    expect(text).not.toContain('errorStack');
    expect(text).not.toMatch(/\n\s+at /);
  }, 20_000);

  it('rejects --port before listening and names the value', async () => {
    const result = await runCli(['server', '--port', 'abc']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(text).toContain('received "abc"');
    expect(text).toContain('1–65535');
    expect(text).not.toContain('WebSocket server enabled');
    expect(text).not.toContain('errorStack');
  }, 20_000);

  it('does not treat --help as a --profile name', async () => {
    const result = await runCli(['--profile', '--help']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(1);
    expect(text).toContain("option '--profile <name>' argument missing");
    expect(text).toContain('Available profiles:');
    expect(text).not.toContain('Profile "--help"');
  }, 20_000);

  it('exits 1 on backup restore without a file', async () => {
    const result = await runCli(['backup', 'restore']);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.exitCode).toBe(1);
    expect(text).toContain('Usage: backup restore <file>');
  }, 20_000);

  it('refuses an unknown voice --mode instead of starting a session', async () => {
    const result = await runCli(['voice', '--mode', 'nimportequoi'], 8_000);
    const text = `${result.stdout}\n${result.stderr}`;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(text).toContain("unknown --mode 'nimportequoi'");
    expect(text).toContain('acceptEdits');
    expect(text).not.toContain('falling back');
    expect(text).not.toContain('Voice commands');
  }, 15_000);
});
