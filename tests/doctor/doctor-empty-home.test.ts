import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { registerUtilityCommands } from '../../src/commands/cli/utility-commands.js';

describe('buddy doctor empty home', () => {
  it('reports missing setup with exit code 1, actionable advice, and no raw stack in offline mode', async () => {
    const home = mkdtempSync(join(tmpdir(), 'codebuddy-doctor-empty-'));
    const previousExitCode = process.exitCode;
    const lines: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.join(' '));
    });
    try {
      vi.stubEnv('HOME', home);
      vi.stubEnv('USERPROFILE', home);
      vi.stubEnv('APPDATA', home);
      vi.stubEnv('XDG_CONFIG_HOME', home);
      vi.stubEnv('XDG_DATA_HOME', home);
      vi.stubEnv('CODEBUDDY_HOME', join(home, '.codebuddy'));
      for (const key of ['OPENAI_API_KEY', 'GROK_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OLLAMA_HOST', 'LMSTUDIO_HOST']) {
        vi.stubEnv(key, undefined);
      }
      const program = new Command();
      program.exitOverride();
      registerUtilityCommands(program);
      process.exitCode = 0;
      await program.parseAsync(['node', 'test', 'doctor', '--offline']);
      const output = lines.join('\n');

      expect(process.exitCode).toBe(1);
      expect(output).toContain('Code Buddy Doctor');
      expect(output).toMatch(/Not ready to chat yet.*buddy onboard.*buddy login/);
      expect(output).toMatch(/Summary: \d+ passed, \d+ warnings, \d+ errors/);
      expect(output).not.toMatch(/\bError:|\n\s+at \S+\s+\(/);
      expect(errors).toEqual([]);

    } finally {
      process.exitCode = previousExitCode;
      logSpy.mockRestore();
      errorSpy.mockRestore();
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
