import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { EventEmitter } from 'node:events';
import * as fs from 'fs';
import { execFileSync, execSync, spawn } from 'child_process';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock fs (selective)
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import {
  CodeExplorerManager,
  getCodeExplorerManager,
  clearCodeExplorerManagerCache,
} from '../../src/plugins/code-explorer/CodeExplorerManager.js';

describe('CodeExplorerManager', () => {
  let manager: CodeExplorerManager;
  const testRepoPath = '/test/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    clearCodeExplorerManagerCache();
    manager = new CodeExplorerManager(testRepoPath);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('isInstalled', () => {
    it('should return true when code-explorer CLI is available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from('1.0.0'),
      );

      expect(manager.isInstalled()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('code-explorer --version', {
        stdio: 'pipe',
        timeout: 10_000,
        cwd: path.resolve(testRepoPath),
      });
    });

    it('should return false when code-explorer CLI is not available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('command not found');
        },
      );

      expect(manager.isInstalled()).toBe(false);
    });
  });

  describe('binary fallback (code-explorer | gitnexus)', () => {
    const onlyGitnexus = (cmd: unknown) => {
      if (String(cmd).startsWith('gitnexus')) return Buffer.from('gitnexus 0.1.0');
      throw new Error('command not found');
    };

    it('falls back to gitnexus when code-explorer is not on PATH', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(onlyGitnexus);

      expect(manager.isInstalled()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('code-explorer --version', expect.anything());
      expect(execSync).toHaveBeenCalledWith('gitnexus --version', expect.anything());
    });

    it('analyze spawns the resolved gitnexus binary', async () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(onlyGitnexus);
      const mockOn = vi.fn().mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: mockOn,
      });

      await manager.analyze();

      expect(spawn).toHaveBeenCalledWith('gitnexus', ['analyze'], expect.anything());
    });

    it('caches the probe — a second isInstalled() does not re-probe PATH', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from('1.0.0'));

      manager.isInstalled();
      manager.isInstalled();

      expect(execSync).toHaveBeenCalledTimes(1);
    });

    it('reports a clear error when neither binary exists', async () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('command not found');
      });

      expect(manager.isInstalled()).toBe(false);
      await expect(manager.analyze()).rejects.toThrow(
        /neither code-explorer nor gitnexus/,
      );
    });
  });

  describe('isRepoIndexed', () => {
    it('should return true when .codeexplorer directory exists', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );

      expect(manager.isRepoIndexed()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        path.join(path.resolve(testRepoPath), '.codeexplorer'),
      );
    });

    it('should return false when .codeexplorer directory does not exist', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );

      expect(manager.isRepoIndexed()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return default stats when meta.json does not exist', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        false,
      );

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 0,
        relations: 0,
        processes: 0,
        clusters: 0,
        indexed: false,
        stale: false,
      });
    });

    it('should parse stats from meta.json when present', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 150,
          relations: 300,
          processes: 5,
          clusters: 8,
          stale: false,
        }),
      );

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 150,
        relations: 300,
        processes: 5,
        clusters: 8,
        indexed: true,
        stale: false,
      });
    });

    it('should handle stale flag in meta.json', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 50,
          relations: 100,
          processes: 2,
          clusters: 3,
          stale: true,
        }),
      );

      const stats = manager.getStats();
      expect(stats.stale).toBe(true);
      expect(stats.indexed).toBe(true);
    });

    it('should return defaults when meta.json is malformed', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue('not valid json{{{');

      const stats = manager.getStats();
      expect(stats).toEqual({
        symbols: 0,
        relations: 0,
        processes: 0,
        clusters: 0,
        indexed: false,
        stale: false,
      });
    });

    it('should handle missing numeric fields gracefully', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );
      (
        fs.readFileSync as unknown as ReturnType<typeof vi.fn>
      ).mockReturnValue(
        JSON.stringify({
          symbols: 'not a number',
          relations: null,
        }),
      );

      const stats = manager.getStats();
      expect(stats.symbols).toBe(0);
      expect(stats.relations).toBe(0);
      expect(stats.indexed).toBe(true);
    });
  });

  describe('auto-index', () => {
    const staleMeta = JSON.stringify({
      lastCommit: 'a'.repeat(40),
      indexedAt: '2026-07-01T00:00:00.000Z',
      stats: {},
    });

    beforeEach(() => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReset();
      vi.mocked(execSync).mockReturnValue(Buffer.from('1.0.0'));
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(staleMeta);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('starts one detached incremental refresh when explicitly enabled', () => {
      vi.stubEnv('CODEBUDDY_CODE_EXPLORER_AUTOINDEX', 'true');
      const child = { on: vi.fn(), unref: vi.fn() };
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);

      expect(manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '2')).toMatchObject({ stale: true, commitsBehind: 2 });
      manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '2');

      expect(spawn).toHaveBeenCalledTimes(1);
      expect(spawn).toHaveBeenCalledWith('code-explorer', ['analyze', '--incremental'], {
        cwd: path.resolve(testRepoPath),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(child.unref).toHaveBeenCalledOnce();
    });

    it('does not launch an indexer when Git freshness is unverified', () => {
      vi.stubEnv('CODEBUDDY_CODE_EXPLORER_AUTOINDEX', 'true');
      expect(manager.getFreshness(() => { throw new Error('Git unavailable'); }))
        .toMatchObject({ stale: true, unverified: true });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not refresh by default', () => {
      vi.stubEnv('CODEBUDDY_CODE_EXPLORER_AUTOINDEX', 'false');

      expect(manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '1').stale).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('never refreshes when a read-only caller disables auto-index', () => {
      vi.stubEnv('CODEBUDDY_CODE_EXPLORER_AUTOINDEX', 'true');

      expect(manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '3', { autoIndex: false })).toMatchObject({
        stale: true,
        commitsBehind: 3,
      });
      expect(spawn).not.toHaveBeenCalled();
    });

    it('keeps freshness fail-open when the background launch fails', () => {
      vi.stubEnv('CODEBUDDY_CODE_EXPLORER_AUTOINDEX', 'true');
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('spawn failed');
      });

      expect(() => manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '1')).not.toThrow();
      expect(manager.getFreshness(args => args.startsWith('rev-parse') ? 'b'.repeat(40) : '1')).toMatchObject({ stale: true, commitsBehind: 1 });
    });
  });

  describe('generateDiagram', () => {
    it('returns Mermaid emitted by the indexed CLI without writing a file', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from('1.0.0'));
      (execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        'Diagram generated\nflowchart LR\n  Entry --> Service\n',
      );

      expect(manager.generateDiagram('createService')).toBe(
        'flowchart LR\n  Entry --> Service',
      );
      expect(execFileSync).toHaveBeenCalledWith(
        'code-explorer',
        [
          'diagram',
          'createService',
          '--type',
          'flowchart',
          '--format',
          'mermaid',
          '--path',
          path.resolve(testRepoPath),
        ],
        expect.objectContaining({ cwd: path.resolve(testRepoPath), encoding: 'utf-8' }),
      );
    });

    it('fails open when no index exists', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

      expect(manager.generateDiagram('createService')).toBe('');
      expect(execFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getRepoPath', () => {
    it('should return the resolved repo path', () => {
      expect(manager.getRepoPath()).toBe(path.resolve(testRepoPath));
    });
  });

  describe('isMCPRunning', () => {
    it('should return false when no MCP server is started', () => {
      expect(manager.isMCPRunning()).toBe(false);
    });
  });

  describe('analyze', () => {
    beforeEach(() => {
      // analyze() now resolves the binary first — make the PATH probe succeed
      // (clearAllMocks does not drop implementations set by earlier tests).
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from('1.0.0'),
      );
    });

    function processFixture() {
      return Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    }

    it('shares simultaneous identical requests across managers for the same repo', async () => {
      const child = processFixture();
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
      const requests = [manager.analyze({ incremental: true }), new CodeExplorerManager(testRepoPath).analyze({ incremental: true })];
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(['analyze', '--incremental']);
      child.emit('close', 0);
      await Promise.all(requests);
    });

    it('serializes different options while preserving the requested forced rebuild', async () => {
      const first = processFixture();
      const second = processFixture();
      vi.mocked(spawn).mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
        .mockReturnValueOnce(second as unknown as ReturnType<typeof spawn>);
      const initial = manager.analyze();
      const forced = new CodeExplorerManager(testRepoPath).analyze({ force: true });
      expect(spawn).toHaveBeenCalledTimes(1);
      first.emit('close', 0);
      await initial;
      await Promise.resolve();
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(vi.mocked(spawn).mock.calls[1]?.[1]).toEqual(['analyze', '--force']);
      second.emit('close', 0);
      await forced;
    });

    it('propagates a shared failure and allows a later retry', async () => {
      const first = processFixture();
      const second = processFixture();
      vi.mocked(spawn).mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
        .mockReturnValueOnce(second as unknown as ReturnType<typeof spawn>);
      const results = Promise.allSettled([manager.analyze(), manager.analyze()]);
      first.emit('close', 1);
      expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']);
      const retry = manager.analyze();
      second.emit('close', 0);
      await retry;
      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('does not serialize independent repositories', async () => {
      const first = processFixture();
      const second = processFixture();
      vi.mocked(spawn).mockReturnValueOnce(first as unknown as ReturnType<typeof spawn>)
        .mockReturnValueOnce(second as unknown as ReturnType<typeof spawn>);
      const requests = [manager.analyze(), new CodeExplorerManager('/another/repo').analyze()];
      expect(spawn).toHaveBeenCalledTimes(2);
      first.emit('close', 0); second.emit('close', 0);
      await Promise.all(requests);
    });

    it('bounds stderr while retaining the final diagnostic', async () => {
      const child = processFixture();
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
      const result = manager.analyze().catch((error: Error) => error.message);
      child.stderr.emit('data', Buffer.from('x'.repeat(100000) + 'FINAL_DIAGNOSTIC'));
      child.emit('close', 1);
      const message = await result;
      expect(message).toContain('FINAL_DIAGNOSTIC');
      expect(message!.length).toBeLessThan(66000);
    });

    it('should spawn code-explorer analyze', async () => {
      const mockOn = vi.fn();
      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };

      const mockChild = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      // Simulate successful exit
      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze();

      expect(spawn).toHaveBeenCalledWith(
        'code-explorer',
        ['analyze'],
        expect.objectContaining({
          cwd: path.resolve(testRepoPath),
          shell: true,
        }),
      );
    });

    it('should pass --force flag when requested', async () => {
      const mockOn = vi.fn();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze({ force: true });

      expect(spawn).toHaveBeenCalledWith(
        'code-explorer',
        ['analyze', '--force'],
        expect.anything(),
      );
    });

    it('should pass --with-skills flag when requested', async () => {
      const mockOn = vi.fn();
      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(0));
        }
      });

      await manager.analyze({ withSkills: true });

      expect(spawn).toHaveBeenCalledWith(
        'code-explorer',
        ['analyze', '--with-skills'],
        expect.anything(),
      );
    });

    it('should reject when analyze exits with non-zero code', async () => {
      const mockOn = vi.fn();
      const mockStderr = {
        on: vi.fn().mockImplementation((event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') {
            setImmediate(() => cb(Buffer.from('some error')));
          }
        }),
      };

      const mockChild = {
        stdout: { on: vi.fn() },
        stderr: mockStderr,
        on: mockOn,
      };

      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockChild,
      );

      mockOn.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === 'close') {
          setImmediate(() => cb(1));
        }
      });

      await expect(manager.analyze()).rejects.toThrow(
        /CodeExplorer analyze exited with code 1/,
      );
    });
  });

  describe('dispose', () => {
    it('should not throw when no MCP server is running', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});

describe('getCodeExplorerManager (singleton)', () => {
  beforeEach(() => {
    clearCodeExplorerManagerCache();
  });

  afterEach(() => {
    clearCodeExplorerManagerCache();
  });

  it('should return the same instance for the same path', () => {
    const a = getCodeExplorerManager('/test/path');
    const b = getCodeExplorerManager('/test/path');
    expect(a).toBe(b);
  });

  it('should return different instances for different paths', () => {
    const a = getCodeExplorerManager('/test/path-a');
    const b = getCodeExplorerManager('/test/path-b');
    expect(a).not.toBe(b);
  });
});
