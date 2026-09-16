import { Command } from 'commander';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { registerUtilityCommands } from '../../src/commands/cli/utility-commands.js';

const doctorMocks = vi.hoisted(() => ({
  runDoctorChecks: vi.fn(async () => []),
  runFixes: vi.fn(async () => []),
  summarizeDoctorChecks: vi.fn(
    (checks: Array<{ status: 'ok' | 'warn' | 'error'; optional?: boolean }>) => ({
      passed: checks.filter(check => check.status === 'ok').length,
      warnings: checks.filter(check => check.status === 'warn' && !check.optional).length,
      errors: checks.filter(check => check.status === 'error').length,
      optionalNotInstalled: checks.filter(check => check.status === 'warn' && check.optional).length,
    })
  ),
}));

vi.mock('../../src/doctor/index.js', () => doctorMocks);

const ollamaMocks = vi.hoisted(() => ({
  fetchOllamaStatus: vi.fn(async () => ({
    baseUrl: 'http://localhost:11434',
    reachable: true,
    version: '0.30.0',
    models: ['phi4:latest'],
    error: null,
  })),
  buildOllamaUpdatePlan: vi.fn(() => ({
    supported: false,
    platform: 'linux',
    repoRoot: '/repo',
    scriptPath: '/repo/scripts/update-ollama-windows.ps1',
    scriptUrl: 'https://ollama.com/install.ps1',
    message: 'Windows only',
  })),
  runOllamaUpdatePlan: vi.fn(async () => {}),
}));

vi.mock('../../src/commands/ollama.js', () => ollamaMocks);

describe('utility CLI commands', () => {
  it('runs doctor checks against the global --directory target', async () => {
    const program = new Command();
    const cwd = process.cwd();
    const targetDir = path.join(cwd, '.tmp-doctor-target');
    const logs: unknown[][] = [];

    program.exitOverride();
    program.option('-d, --directory <dir>', 'set working directory', cwd);
    registerUtilityCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    try {
      await program.parseAsync(['node', 'test', '--directory', targetDir, 'doctor']);
    } finally {
      logSpy.mockRestore();
    }

    expect(logs.length).toBeGreaterThan(0);
    expect(doctorMocks.runDoctorChecks).toHaveBeenCalledWith(targetDir, { offline: false });
  });

  it('keeps the historical text output when no new flag is passed (P3 golden)', async () => {
    doctorMocks.runDoctorChecks.mockResolvedValueOnce([
      { name: 'AI provider ready', status: 'ok', message: 'ChatGPT subscription — signed in' },
      { name: 'Node.js version', status: 'ok', message: 'v24 OK' },
      { name: 'Stale lock files', status: 'warn', message: '1 stale lock', fixable: true },
      { name: 'Git', status: 'error', message: 'git not found' },
      { name: 'TTS providers', status: 'warn', message: 'none installed', optional: true },
    ]);
    const integrations = await import('../../src/doctor/integrations.js');
    const integrationSpy = vi.spyOn(integrations, 'runIntegrationChecks');
    const program = new Command();
    program.exitOverride();
    registerUtilityCommands(program);
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args.join(' ')); });
    try {
      process.exitCode = 0;
      await program.parseAsync(['node', 'test', 'doctor']);
      expect(lines).toEqual([
        '\n🔍 Code Buddy Doctor\n',
        '  ✅ Ready to chat — a provider is configured (ChatGPT subscription — signed in)',
        '     Start now:  buddy         (or try the demo:  buddy try)',
        '',
        '  ⚠️ Stale lock files: 1 stale lock [fixable]',
        '  ❌ Git: git not found',
        '  ⚠️ TTS providers: none installed',
        '\n  Summary: 2 passed, 1 warnings, 1 errors',
        '  1 optional tool(s) not installed (not a problem)',
        '  1 issue(s) can be auto-fixed with --fix',
        '',
      ]);
      expect(process.exitCode).toBe(1);
      expect(integrationSpy).not.toHaveBeenCalled();
    } finally {
      process.exitCode = 0;
      logSpy.mockRestore();
      integrationSpy.mockRestore();
    }
  });

  it('--json --offline prints a schema-valid report including integrations and passes offline', async () => {
    doctorMocks.runDoctorChecks.mockResolvedValueOnce([
      { name: 'AI provider ready', status: 'ok', message: 'ready' },
      { name: 'Git', status: 'error', message: 'git not found' },
    ]);
    const integrations = await import('../../src/doctor/integrations.js');
    const integrationSpy = vi.spyOn(integrations, 'runIntegrationChecks').mockResolvedValueOnce([
      { id: 'lm-resizer', section: 'integrations', name: 'LM Resizer', status: 'warn', message: 'lacks the tool-output protocol' },
    ]);
    const program = new Command();
    program.exitOverride();
    registerUtilityCommands(program);
    const out: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out.push(args.join(' ')); });
    try {
      process.exitCode = 0;
      await program.parseAsync(['node', 'test', 'doctor', '--json', '--offline']);
      const report = integrations.doctorJsonReportSchema.parse(JSON.parse(out.join('\n')));
      expect(report.offline).toBe(true);
      expect(report.checks.map((c) => [c.id, c.section, c.status])).toEqual([
        ['ai-provider-ready', 'core', 'ok'],
        ['git', 'core', 'error'],
        ['lm-resizer', 'integrations', 'warn'],
      ]);
      expect(doctorMocks.runDoctorChecks).toHaveBeenLastCalledWith(expect.any(String), { offline: true });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      logSpy.mockRestore();
      integrationSpy.mockRestore();
    }
  });

  it('returns a failing status when doctor finds no ready provider', async () => {
    doctorMocks.runDoctorChecks.mockResolvedValueOnce([
      {
        name: 'AI provider ready',
        status: 'warn',
        message: 'no provider configured — run `buddy login`',
      },
    ]);
    const program = new Command();
    program.exitOverride();
    registerUtilityCommands(program);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      process.exitCode = 0;
      await program.parseAsync(['node', 'test', 'doctor']);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      logSpy.mockRestore();
    }
  });

  it('registers the ollama status command', async () => {
    const program = new Command();
    const logs: unknown[][] = [];

    program.exitOverride();
    registerUtilityCommands(program);

    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args);
    });

    try {
      await program.parseAsync(['node', 'test', 'ollama', 'status']);
    } finally {
      logSpy.mockRestore();
    }

    expect(ollamaMocks.fetchOllamaStatus).toHaveBeenCalled();
    expect(logs.some((entry) => String(entry[0] ?? '').includes('Ollama status'))).toBe(true);
  });
});
