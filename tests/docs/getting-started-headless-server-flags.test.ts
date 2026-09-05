/**
 * INCONNU1 — an unknown user following ONLY docs/getting-started.md hit two
 * real gaps: `-o/--output-last-message`, `--output-schema` (HEADLESS1) and
 * `buddy server --no-auth` (SERV1) are real, working CLI flags that were not
 * mentioned anywhere in getting-started.md or README.md, so a first-time
 * reader had no documented way to exercise them.
 *
 * This test locks the fix: the flags must be documented, and the doc text
 * must not drift from what `buddy --help` / `buddy server --help` actually
 * expose.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gettingStartedPath = path.join(repoRoot, 'docs', 'getting-started.md');
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

function isolatedEnv(): NodeJS.ProcessEnv {
  const home = path.join(repoRoot, 'node_modules', '.inconnu1-getting-started-home');
  fs.mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CODEBUDDY_HOME: path.join(home, '.codebuddy'),
    NO_COLOR: '1',
  };
  delete env.FORCE_COLOR;
  return env;
}

function runBuddyHelp(args: string[]): string {
  try {
    return execFileSync(tsxBin, ['src/index.ts', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: isolatedEnv(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    const execError = error as { stdout?: string };
    return execError.stdout ?? '';
  }
}

describe('getting-started.md documents the headless output flags and server --no-auth (INCONNU1)', () => {
  const gettingStarted = fs.readFileSync(gettingStartedPath, 'utf8');

  it('mentions -o/--output-last-message and --output-schema in the Headless Mode section', () => {
    const headlessIdx = gettingStarted.indexOf('## Headless Mode');
    expect(headlessIdx).toBeGreaterThan(-1);
    const nextSectionIdx = gettingStarted.indexOf('\n## ', headlessIdx + 1);
    const section = gettingStarted.slice(headlessIdx, nextSectionIdx > -1 ? nextSectionIdx : undefined);
    expect(section).toContain('--output-last-message');
    expect(section).toContain('--output-schema');
  });

  it('documents buddy server --no-auth with a curl example against /v1/chat/completions', () => {
    expect(gettingStarted).toContain('--no-auth');
    expect(gettingStarted).toContain('/v1/chat/completions');
    expect(gettingStarted).toMatch(/buddy server[^\n]*--no-auth/);
  });

  it('the documented headless flags are real options of `buddy --help`', () => {
    expect(fs.existsSync(tsxBin), 'tsx is required to spawn the CLI from source').toBe(true);
    const help = runBuddyHelp(['--help']);
    expect(help).toContain('--output-last-message');
    expect(help).toContain('--output-schema');
  }, 30_000);

  it('the documented --no-auth flag is a real option of `buddy server --help`', () => {
    expect(fs.existsSync(tsxBin), 'tsx is required to spawn the CLI from source').toBe(true);
    const help = runBuddyHelp(['server', '--help']);
    expect(help).toContain('--no-auth');
  }, 30_000);
});
