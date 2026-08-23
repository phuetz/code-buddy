import { Command } from 'commander';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { registerUtilityCommands } from '../../src/commands/cli/utility-commands.js';

const doctorMocks = vi.hoisted(() => ({
  runDoctorChecks: vi.fn(async () => []),
  runFixes: vi.fn(async () => []),
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
    expect(doctorMocks.runDoctorChecks).toHaveBeenCalledWith(targetDir);
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
