/**
 * Tests for `buddy lsp` CLI commands.
 *
 * Covers:
 * - `lsp status` (human + --json) driven by mocked `commandExists`
 * - `lsp diagnostics <file>` happy path (mocked client)
 * - `lsp diagnostics` fail-clean branches: file missing, unsupported type,
 *   server binary not installed (distinct from "no diagnostics").
 *
 * The real `LSPClient` static methods (getSupportedLanguages /
 * getDefaultConfig / detectLanguage) are kept via requireActual so `status`
 * exercises the genuine DEFAULT_CONFIGS. Only `getLSPClient` is overridden to
 * return a stub that never spawns a real server. `commandExists` is mocked for
 * deterministic availability.
 */

import { Command } from 'commander';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCommandExists = jest.fn<Promise<boolean>, [string]>();
jest.mock('../../src/utils/command-exists.js', () => ({
  commandExists: (cmd: string) => mockCommandExists(cmd),
}));

const mockGetDiagnostics = jest.fn();
const mockEnsureServerForFile = jest.fn();
const mockDetectLanguage = jest.fn();
const mockStopAll = jest.fn().mockResolvedValue(undefined);
const mockClient = {
  getDiagnostics: mockGetDiagnostics,
  ensureServerForFile: mockEnsureServerForFile,
  detectLanguage: mockDetectLanguage,
  stopAll: mockStopAll,
};

jest.mock('../../src/lsp/lsp-client.js', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLSPClient: jest.fn(() => mockClient),
  };
});

const mockExistsSync = jest.fn<boolean, [string]>();
jest.mock('fs', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default as object), existsSync: (p: string) => mockExistsSync(p) },
    existsSync: (p: string) => mockExistsSync(p),
  };
});

// Import after mocks are registered.
import { registerLspCommands } from '../../src/commands/cli/lsp-command';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
let processExitSpy: jest.SpyInstance;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  registerLspCommands(program);
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
}

function getErrorOutput(): string {
  return consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
}

describe('buddy lsp CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(function () {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(function () {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      // Do not actually exit.
    }) as unknown as (code?: string | number | null | undefined) => never);
    // Default: file exists, language detected as typescript.
    mockExistsSync.mockReturnValue(true);
    mockDetectLanguage.mockReturnValue('typescript');
    mockEnsureServerForFile.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // =========================================================================
  // status
  // =========================================================================

  describe('lsp status', () => {
    it('lists supported servers with availability markers', async () => {
      // typescript available, everything else missing.
      mockCommandExists.mockImplementation((cmd: string) =>
        Promise.resolve(cmd === 'typescript-language-server'),
      );

      await createProgram().parseAsync(['node', 'test', 'lsp', 'status']);

      const out = getLogOutput();
      expect(out).toContain('typescript');
      expect(out).toContain('typescript-language-server');
      expect(out).toContain('[ok ]');
      expect(out).toContain('[missing]');
      expect(mockCommandExists).toHaveBeenCalledWith('typescript-language-server');
    });

    it('emits machine-readable JSON with --json', async () => {
      mockCommandExists.mockResolvedValue(false);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'status', '--json']);

      const out = getLogOutput();
      const parsed = JSON.parse(out) as {
        servers: Array<{ language: string; command: string; available: boolean }>;
      };
      expect(Array.isArray(parsed.servers)).toBe(true);
      expect(parsed.servers.length).toBeGreaterThan(0);
      const ts = parsed.servers.find((s) => s.language === 'typescript');
      expect(ts).toBeDefined();
      expect(ts?.command).toBe('typescript-language-server');
      expect(ts?.available).toBe(false);
    });
  });

  // =========================================================================
  // diagnostics
  // =========================================================================

  describe('lsp diagnostics', () => {
    it('stops the server after rendering diagnostics', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockGetDiagnostics.mockResolvedValue([]);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts', '--json']);

      expect(mockStopAll).toHaveBeenCalledTimes(1);
    });

    it('reports a diagnostic timeout and stops the server instead of declaring the file clean', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockGetDiagnostics.mockRejectedValue(new Error('No diagnostics received for foo.ts'));
      const previousExitCode = process.exitCode;
      try {
        await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts', '--json']);
        expect(JSON.parse(getLogOutput())).toMatchObject({ error: 'diagnostics_failed' });
        expect(process.exitCode).toBe(1);
        expect(mockStopAll).toHaveBeenCalledTimes(1);
      } finally {
        process.exitCode = previousExitCode;
      }
    });

    it('prints diagnostics when the server is installed and reports issues', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockGetDiagnostics.mockResolvedValue([
        {
          file: 'foo.ts',
          line: 3,
          column: 5,
          severity: 'error',
          message: "Cannot find name 'bar'.",
          source: 'ts',
        },
      ]);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts']);

      const out = getLogOutput();
      expect(out).toContain('1 found');
      expect(out).toContain('ERROR');
      expect(out).toContain("Cannot find name 'bar'.");
      expect(mockGetDiagnostics).toHaveBeenCalledWith('foo.ts');
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('emits JSON diagnostics with --json', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockGetDiagnostics.mockResolvedValue([]);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts', '--json']);

      const out = getLogOutput();
      const parsed = JSON.parse(out) as { file: string; language: string; diagnostics: unknown[] };
      expect(parsed.file).toBe('foo.ts');
      expect(parsed.language).toBe('typescript');
      expect(parsed.diagnostics).toEqual([]);
    });

    it('reports a clean file when installed server returns no diagnostics', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockGetDiagnostics.mockResolvedValue([]);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts']);

      expect(getLogOutput()).toContain('No diagnostics');
      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('does not report a clean file when an installed server fails to start', async () => {
      mockCommandExists.mockResolvedValue(true);
      mockEnsureServerForFile.mockResolvedValue(false);
      mockGetDiagnostics.mockResolvedValue([]);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts', '--json']);

      expect(JSON.parse(getLogOutput())).toMatchObject({ error: 'server_start_failed' });
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(mockGetDiagnostics).not.toHaveBeenCalled();
    });

    it('fails cleanly when the file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'missing.ts']);

      expect(getErrorOutput()).toContain('File not found');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(mockGetDiagnostics).not.toHaveBeenCalled();
    });

    it('fails cleanly for an unsupported file type', async () => {
      mockDetectLanguage.mockReturnValue(null);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'notes.txt']);

      expect(getErrorOutput()).toContain('Unsupported file type');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(mockGetDiagnostics).not.toHaveBeenCalled();
    });

    it('fails cleanly (distinct from clean) when the server binary is not installed', async () => {
      mockCommandExists.mockResolvedValue(false);

      await createProgram().parseAsync(['node', 'test', 'lsp', 'diagnostics', 'foo.ts']);

      const err = getErrorOutput();
      expect(err).toContain('not installed');
      expect(err).toContain('typescript-language-server');
      expect(processExitSpy).toHaveBeenCalledWith(1);
      // Must NOT have queried diagnostics — that is what makes this branch
      // distinguishable from a genuinely clean file.
      expect(mockGetDiagnostics).not.toHaveBeenCalled();
    });
  });
});
