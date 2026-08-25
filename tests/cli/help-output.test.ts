import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

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
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', exitCode => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

describe('CLI help output', () => {
  it('shows the canonical headless output flag and hides the legacy alias', async () => {
    const result = await runCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('--output-format <format>');
    expect(result.stdout).not.toMatch(/^\s+--output <format>/m);
  }, 30_000);

  it('starts with six focused demos before the exhaustive reference', async () => {
    const result = await runCli(['--help']);

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
  }, 30_000);

  it('keeps help free of startup telemetry when persisted authored tools are reloaded', async () => {
    const workDir = await mkdtemp(path.join(process.cwd(), '.tmp-help-output-'));
    const storeDir = path.join(workDir, '.codebuddy', 'self-improvement');
    await mkdir(storeDir, { recursive: true });
    await writeFile(path.join(storeDir, 'authored-tools.json'), JSON.stringify({
      schemaVersion: 1,
      tools: [
        {
          name: 'authored__help_probe',
          description: 'Return a fixed value for the CLI help telemetry test.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          language: 'javascript',
          code: "process.stdout.write('ok');",
        },
      ],
    }));

    try {
      const result = await runCli(['mcp', '--help'], {
        cwd: workDir,
        env: {
          CODEBUDDY_LOAD_AUTHORED_TOOLS: 'true',
          NODE_ENV: 'development',
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('Usage: buddy mcp');
      expect(result.stdout).not.toContain('[self-improve]');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps profile application telemetry out of help output', async () => {
    const result = await runCli(['--profile', 'core', '--help'], {
      env: { NODE_ENV: 'development' },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.startsWith('Pour commencer — 6 démos')).toBe(true);
    expect(result.stdout).not.toContain('Applied config profile');
  }, 30_000);

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
  }, 30_000);
});
