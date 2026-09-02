import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildGitHubInstallCommand, createUpdateCommand } from '../../src/commands/update.js';

// Mock child_process.execSync
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('update --tag / --from-source', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildGitHubInstallCommand', () => {
    it('constructs correct command for main branch', () => {
      expect(buildGitHubInstallCommand('main')).toBe(
        'npm install -g github:phuetz/code-buddy#main'
      );
    });

    it('constructs correct command for a version tag', () => {
      expect(buildGitHubInstallCommand('v1.2.3')).toBe(
        'npm install -g github:phuetz/code-buddy#v1.2.3'
      );
    });

    it('constructs correct command for an arbitrary branch', () => {
      expect(buildGitHubInstallCommand('feature/new-thing')).toBe(
        'npm install -g github:phuetz/code-buddy#feature/new-thing'
      );
    });
  });

  describe('--tag option via Commander', () => {
    it('--tag main calls execSync with GitHub install command', async () => {
      const { execSync } = await import('child_process');
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--tag', 'main']);

      expect(execSync).toHaveBeenCalledWith(
        'npm install -g github:phuetz/code-buddy#main',
        { stdio: 'inherit' }
      );
    });

    it('--tag v2.0.0 calls execSync with the correct ref', async () => {
      const { execSync } = await import('child_process');
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--tag', 'v2.0.0']);

      expect(execSync).toHaveBeenCalledWith(
        'npm install -g github:phuetz/code-buddy#v2.0.0',
        { stdio: 'inherit' }
      );
    });

    it('displays development install warning when --tag is used', async () => {
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--tag', 'main']);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Installing from GitHub (development install)')
      );
    });

    it('skips channel switching logic when --tag is provided', async () => {
      // If channel logic ran, it would import UpdateChannelManager.
      // With --tag, it should not be imported at all.
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      // This should succeed without needing UpdateChannelManager
      await cmd.parseAsync(['node', 'test', '--tag', 'main']);

      // Verify no channel-related output
      const allLogCalls = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(allLogCalls).not.toContain('Channel:');
      expect(allLogCalls).not.toContain('Latest:');
    });
  });

  describe('--from-source alias', () => {
    it('--from-source maps to --tag main', async () => {
      const { execSync } = await import('child_process');
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--from-source']);

      expect(execSync).toHaveBeenCalledWith(
        'npm install -g github:phuetz/code-buddy#main',
        { stdio: 'inherit' }
      );
    });

    it('--from-source displays the development install warning', async () => {
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--from-source']);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Installing from GitHub (development install)')
      );
    });

    it('--from-source shows ref as main in output', async () => {
      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--from-source']);

      const allLogCalls = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(allLogCalls).toContain('Ref: main');
    });
  });

  describe('error handling', () => {
    it('calls process.exit(1) on install failure', async () => {
      const { execSync } = await import('child_process');
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('npm failed');
      });

      const cmd = createUpdateCommand();
      cmd.exitOverride();

      await cmd.parseAsync(['node', 'test', '--tag', 'main']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('GitHub install failed')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('--check via the npm registry', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      process.exitCode = 0;
    });

    it('uses the registry version and publication date', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            'dist-tags': { latest: '2.0.1' },
            time: { '2.0.1': '2026-09-01T12:34:56.000Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const cmd = createUpdateCommand();
      cmd.exitOverride();
      await cmd.parseAsync(['node', 'test', '--check']);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://registry.npmjs.org/%40phuetz%2Fcode-buddy',
        expect.any(Object),
      );
      const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Registry: npm');
      expect(output).toContain('Package: @phuetz/code-buddy');
      expect(output).toContain('Latest:  2.0.1 (2026-09-01T12:34:56.000Z)');
      expect(output).not.toContain(new Date().toISOString().slice(0, 10));
    });

    it('reports an unreachable registry without inventing a release', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
      vi.stubGlobal('fetch', fetchMock);

      const cmd = createUpdateCommand();
      cmd.exitOverride();
      await cmd.parseAsync(['node', 'test', '--check']);

      const errors = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(errors).toContain('npm registry unreachable');
      expect(process.exitCode).toBe(1);
      const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).not.toContain('Latest:');
    });

    it('does not call a lower registry version an available update', async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            'dist-tags': { latest: '1.6.1' },
            time: { '1.6.1': '2026-06-25T13:14:01.864Z' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const cmd = createUpdateCommand();
      cmd.exitOverride();
      await cmd.parseAsync(['node', 'test', '--check']);

      const output = consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Registry release is older than the current version: 2.0.0 > 1.6.1');
      expect(output).not.toContain('Update available:');
    });
  });
});
