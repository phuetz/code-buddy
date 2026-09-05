/**
 * GK31 — the public README must only name commands that `buddy --help`
 * actually exposes, and environment variables the source reads.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmePath = path.join(repoRoot, 'README.md');

/**
 * Resolve tsx's JavaScript entry point, never the `node_modules/.bin/tsx` shim.
 * On Windows that shim is an extensionless shell script (the executable one is
 * `tsx.cmd`), so `execFileSync` without a shell dies inside CreateProcess: the
 * result carries `status: null` and null stdout/stderr, which every command
 * then reports as an indistinguishable "exit 1 with no output".
 */
function resolveTsxCli(): string {
  try {
    return createRequire(import.meta.url).resolve('tsx/cli');
  } catch {
    return path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  }
}

const tsxCli = resolveTsxCli();

function isolatedEnv(): NodeJS.ProcessEnv {
  const home = path.join(repoRoot, 'node_modules', '.gk31-readme-home');
  fs.mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CODEBUDDY_HOME: path.join(home, '.codebuddy'),
    NO_COLOR: '1',
  };
  if (process.platform === 'win32') {
    // os.homedir() reads USERPROFILE on Windows, so HOME alone would leave the
    // spawned CLI pointed at the CI runner's real profile.
    env.USERPROFILE = home;
  }
  delete env.FORCE_COLOR;
  return env;
}

function runBuddy(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync(process.execPath, [tsxCli, 'src/index.ts', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: isolatedEnv(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string | null;
      stderr?: string | null;
      status?: number | null;
      message?: string;
    };
    const stdout = execError.stdout ?? '';
    const stderr = execError.stderr ?? '';
    if (typeof execError.status === 'number') {
      return { stdout, stderr, exitCode: execError.status };
    }
    // No exit status means the child never ran to completion (spawn error,
    // timeout, signal). Reporting a bare "exit 1" with empty output here is what
    // made the Windows failure undiagnosable, so carry the reason through.
    const reason = `[no exit status] ${execError.message ?? 'unknown spawn failure'}`;
    return { stdout, stderr: stderr ? `${stderr}\n${reason}` : reason, exitCode: 1 };
  }
}

function buddyCommandsIn(text: string): string[] {
  const names = new Set<string>();
  const re = /(?:^|[^\w/-])buddy\s+([a-z][a-z0-9-]*)/g;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    if (name) names.add(name.toLowerCase());
  }
  return [...names].sort();
}

function envVarsIn(text: string): string[] {
  const names = new Set<string>();
  const re = /\b(CODEBUDDY_[A-Z0-9_]+|OLLAMA_HOST|JWT_SECRET|YOLO_MODE)\b/g;
  for (const match of text.matchAll(re)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names].sort();
}

function commandNamesFromHelp(help: string): Set<string> {
  const names = new Set<string>();
  const commandsIdx = help.search(/^Commands:/m);
  const section = commandsIdx >= 0 ? help.slice(commandsIdx) : help;
  for (const line of section.split(/\r?\n/)) {
    const match = /^\s{2}([\w|-]+)/.exec(line);
    const token = match?.[1];
    if (!token || token.startsWith('-')) continue;
    for (const part of token.split('|')) {
      if (part) names.add(part);
    }
  }
  return names;
}

function sourceReadsEnv(name: string): boolean {
  const needles = [`process.env.${name}`, `process.env['${name}']`, `process.env["${name}"]`];
  for (const needle of needles) {
    try {
      execFileSync('git', ['grep', '-F', '-q', needle, '--', 'src'], { cwd: repoRoot });
      return true;
    } catch {
      // git grep exits 1 when there is no match
    }
  }
  return false;
}

describe('README truth (GK31)', () => {
  const readme = fs.readFileSync(readmePath, 'utf8');

  it('points a stranger at getting-started and states license + opt-in + not-ready', () => {
    expect(readme).toContain('docs/getting-started.md');
    expect(readme).toMatch(/^## License/m);
    expect(readme).toMatch(/^## Opt-in/m);
    expect(readme).toMatch(/^## Not ready/m);
    expect(readme).toMatch(/Business Source License 1\.1/);
    expect(readme).not.toMatch(/\/(?:Users|home)\/[^\s`]+/);
  });

  it('only names buddy commands that appear in buddy --help', () => {
    expect(fs.existsSync(tsxCli), 'tsx is required to spawn the CLI from source').toBe(true);

    const help = runBuddy(['--help']);
    expect(help.exitCode, help.stderr).toBe(0);
    expect(help.stdout).toMatch(/Usage: buddy/);

    const listed = commandNamesFromHelp(help.stdout);
    const cited = buddyCommandsIn(readme);
    expect(cited.length).toBeGreaterThan(0);

    const missing = cited.filter((name) => !listed.has(name));
    expect(missing, `README commands missing from buddy --help: ${missing.join(', ')}`).toEqual([]);
  });

  it('each cited buddy command answers --help with exit 0', () => {
    const cited = buddyCommandsIn(readme);
    const failures: string[] = [];

    for (const name of cited) {
      const result = runBuddy([name, '--help']);
      if (result.exitCode !== 0) {
        failures.push(
          `${name}: exit ${result.exitCode} stderr=${(result.stderr || result.stdout).slice(0, 240)}`,
        );
      }
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('each cited environment variable is read by src/', () => {
    const cited = envVarsIn(readme);
    expect(cited.length).toBeGreaterThan(0);

    const unread = cited.filter((name) => !sourceReadsEnv(name));
    expect(unread, `README env vars with no process.env read in src/: ${unread.join(', ')}`).toEqual(
      [],
    );
  });
});
