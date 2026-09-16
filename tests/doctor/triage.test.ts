/**
 * P7 — `buddy triage`: local redacted bundle, real doctor/redaction modules.
 * Network and child_process primitives are spied (CommonJS objects, synced to ESM).
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTriagePrompt, TRIAGE_PROMPT_MAX_BYTES, writeTriageBundle } from '../../src/doctor/triage.js';
import { registerTriageCommand } from '../../src/commands/cli/triage-command.js';
import { scanFileForSecrets } from '../../src/security/secrets-detector.js';

const SK = 'sk-test-TRIAGEfixtureABCDEFGHIJKLMNOPQRSTUV0123';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0cmlhZ2UtZml4dHVyZSJ9.c2lnbmF0dXJlLXRyaWFnZS1maXh0dXJlLXZhbHVl';
const DB_PASSWORD = 'Hunter2-fixture-pass';
const DB_URL = `postgres://app:${DB_PASSWORD}@db.internal:5432/prod`;
const ENV_KEYS = ['HOME', 'USERPROFILE', 'LOG_FILE', 'OPENAI_API_KEY', 'DATABASE_URL', 'CODEBUDDY_RUNS_DIR'];

describe('buddy triage (P7)', () => {
  let tmp: string;
  let home: string;
  let repo: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-p7-'));
    home = path.join(tmp, 'home');
    repo = path.join(tmp, 'repo');
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    fs.mkdirSync(path.join(home, '.codebuddy', 'logs'), { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.CODEBUDDY_RUNS_DIR = path.join(home, '.codebuddy', 'runs');
    delete process.env.LOG_FILE;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;
    fs.writeFileSync(path.join(repo, '.env'), `OPENAI_API_KEY=${SK}\nSESSION_JWT="${JWT}"\nDATABASE_URL=${DB_URL}\nLOG_LEVEL=debug\n`);
    fs.writeFileSync(path.join(home, '.codebuddy', 'settings.json'), JSON.stringify({ model: 'gpt-5.5', apiKey: SK, baseURL: DB_URL }));
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      if (i % 997 === 0) lines.push(`[2026-09-15] ERROR provider auth failed key=${SK} bearer ${JWT} url ${DB_URL}`);
      else lines.push(`[2026-09-15] INFO line ${i} ${'x'.repeat(60)}`);
    }
    lines.push('[2026-09-15] ERROR LAST-LINE-MARKER tool timeout');
    fs.writeFileSync(path.join(home, '.codebuddy', 'logs', 'codebuddy.log'), `${lines.join('\n')}\n`);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    process.exitCode = 0;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function spyNetwork() {
    const cjs = createRequire(import.meta.url);
    const spies = [
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden in test')),
      vi.spyOn(cjs('node:http'), 'request'),
      vi.spyOn(cjs('node:https'), 'request'),
      vi.spyOn(cjs('node:net'), 'connect'),
      vi.spyOn(cjs('node:net'), 'createConnection'),
    ];
    return () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  }

  function spyChildProcesses() {
    const cp = createRequire(import.meta.url)('node:child_process');
    const names = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const;
    const spies = names.map((name) => vi.spyOn(cp, name).mockImplementation(() => { throw new Error(`child_process.${name} forbidden in triage`); }));
    syncBuiltinESMExports();
    return () => Object.fromEntries(names.map((name, i) => [name, spies[i]!.mock.calls.length]));
  }

  const failedRun = { runId: 'run_fixture_1', status: 'failed', startedAt: Date.parse('2026-09-15T08:00:00Z'), eventCount: 12, objective: `deploy with token ${JWT}` };

  it('real offline doctor + fake .env: no secret value in the files, ≤ 8 KiB prompt, 0700/0600, no network, no child process', async () => {
    const network = spyNetwork();
    const children = spyChildProcesses();
    const result = await writeTriageBundle({ cwd: repo, homeDir: home, env: {}, deps: { listRuns: () => [failedRun] }, buddyVersion: '2.0.0' });

    expect(network()).toBe(0);
    expect(children()).toEqual({ spawn: 0, spawnSync: 0, exec: 0, execSync: 0, execFile: 0, execFileSync: 0, fork: 0 });

    const json = fs.readFileSync(result.jsonPath, 'utf8');
    const prompt = fs.readFileSync(result.promptPath, 'utf8');
    for (const secret of [SK, JWT, DB_PASSWORD, DB_URL, 'eyJzdWIiOiJ0cmlhZ2Ut']) {
      expect(json).not.toContain(secret);
      expect(prompt).not.toContain(secret);
    }
    expect(scanFileForSecrets(result.jsonPath)).toEqual([]);
    expect(scanFileForSecrets(result.promptPath)).toEqual([]);

    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(TRIAGE_PROMPT_MAX_BYTES);
    expect(result.promptBytes).toBe(Buffer.byteLength(prompt, 'utf8'));
    expect(prompt).toContain('LAST-LINE-MARKER');
    expect(prompt).toContain('run_fixture_1');

    if (process.platform !== 'win32') {
      expect(fs.statSync(result.dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(result.jsonPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(result.promptPath).mode & 0o777).toBe(0o600);
    }

    const bundle = JSON.parse(json);
    expect(bundle.networkUsed).toBe(false);
    expect(bundle.doctor.offline).toBe(true);
    expect(bundle.config.files).toEqual(expect.arrayContaining([
      { file: '.env', keys: ['DATABASE_URL', 'LOG_LEVEL', 'OPENAI_API_KEY', 'SESSION_JWT'] },
      { file: path.join('~', '.codebuddy', 'settings.json'), keys: ['apiKey', 'baseURL', 'model'] },
    ]));
    expect(bundle.logs.lines.length).toBe(200);
    expect(result.redactions).toBeGreaterThan(0);
    expect(json).not.toContain(home);
    expect(prompt).not.toContain(home);
    expect(result.suggestedCommand).toBe(`buddy -p "$(cat '${result.promptPath}')"`);
  });

  it('secret values from the process environment are masked too', async () => {
    const leaky = 'plain-value-no-known-pattern-42';
    fs.appendFileSync(path.join(home, '.codebuddy', 'logs', 'codebuddy.log'), `note ${leaky}\n`);
    const result = await writeTriageBundle({ cwd: repo, homeDir: home, env: { MY_SERVICE_TOKEN: leaky }, deps: { listRuns: () => [] } });
    expect(fs.readFileSync(result.jsonPath, 'utf8')).not.toContain(leaky);
    expect(fs.readFileSync(result.promptPath, 'utf8')).not.toContain(leaky);
  });

  it('fails closed: a section the redactor misses is withheld, a throwing redactor writes nothing', async () => {
    const outParent = path.join(tmp, 'out');
    const stub = { runDoctor: async () => ({ checks: [], report: { version: 1 as const, generatedAt: 'x', offline: true, summary: { passed: 0, warnings: 0, errors: 0, optionalNotInstalled: 0 }, checks: [] } }), listRuns: () => [] };
    // A redactor that detects the marker but fails to replace it: the log section must be withheld.
    const detectOnly = (text: string) => ({ redacted: text, count: text.includes('LAST-LINE-MARKER') ? 1 : 0 });
    const withheld = await writeTriageBundle({ cwd: repo, homeDir: home, env: {}, outParent, deps: { ...stub, redact: detectOnly } });
    expect(withheld.withheld).toEqual(['logs']);
    expect(fs.readFileSync(withheld.promptPath, 'utf8')).not.toContain('LAST-LINE-MARKER');

    const before = fs.readdirSync(outParent).length;
    await expect(writeTriageBundle({ cwd: repo, homeDir: home, env: {}, outParent, deps: { ...stub, redact: () => { throw new Error('engine down'); } } }))
      .rejects.toThrow('engine down');
    expect(fs.readdirSync(outParent).length).toBe(before);
  });

  it('prompt stays ≤ 8 KiB even with huge doctor messages and multibyte text', () => {
    const bundle = {
      version: 1 as const, generatedAt: 'x', networkUsed: false as const,
      versions: { node: 'v22', buddy: '2.0.0', os: 'linux' },
      doctor: { version: 1 as const, generatedAt: 'x', offline: true, summary: { passed: 0, warnings: 400, errors: 0, optionalNotInstalled: 0 },
        checks: Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, section: 'core' as const, name: `Check ${i}`, status: 'warn' as const, message: 'é'.repeat(80), fixable: false, optional: false })) },
      failedRuns: [], logs: { file: null, lines: ['ü'.repeat(300)] }, config: { files: [] }, redactions: 0, withheld: [],
    };
    const prompt = buildTriagePrompt(bundle);
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(TRIAGE_PROMPT_MAX_BYTES);
    expect(prompt).not.toContain('�');
  });

  it('doctor noSubprocess mode: PATH lookup and .git detection without child processes', async () => {
    const { commandExistsOnPath, runDoctorChecks } = await import('../../src/doctor/index.js');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'rg'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'not-exec'), '', { mode: 0o644 });
    expect(commandExistsOnPath('rg', { PATH: bin })).toBe(true);
    expect(commandExistsOnPath('not-exec', { PATH: bin })).toBe(process.platform === 'win32');
    expect(commandExistsOnPath('missing-tool', { PATH: bin })).toBe(false);

    const children = spyChildProcesses();
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, 'sub'));
    const checks = await runDoctorChecks(path.join(repo, 'sub'), { offline: true, noSubprocess: true });
    expect(checks.find((c) => c.name === 'Git')?.message).toMatch(/inside a git repo/);
    expect(checks.find((c) => c.name === 'Native sandbox (kernel)')?.message).toMatch(/not probed/);
    expect(children()).toEqual({ spawn: 0, spawnSync: 0, exec: 0, execSync: 0, execFile: 0, execFileSync: 0, fork: 0 });
  });

  it('CLI --json outside a TTY prints a summary and launches no child process', async () => {
    spyNetwork();
    const children = spyChildProcesses();
    const out = path.join(tmp, 'cli-out');
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')); });
    const program = new Command().option('-d, --directory <dir>');
    registerTriageCommand(program);
    await program.parseAsync(['node', 'buddy', '-d', repo, 'triage', '--json', '--out', out]);
    const summary = JSON.parse(logs.join('\n'));
    expect(summary).toMatchObject({ networkUsed: false, agentLaunched: false });
    expect(summary.promptBytes).toBeLessThanOrEqual(TRIAGE_PROMPT_MAX_BYTES);
    expect(summary.dir.startsWith(out)).toBe(true);
    expect(children()).toEqual({ spawn: 0, spawnSync: 0, exec: 0, execSync: 0, execFile: 0, execFileSync: 0, fork: 0 });
    expect(process.exitCode ?? 0).toBe(0);
  });
});
