import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, spawn } from 'child_process';

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
  GitNexusManager,
  getGitNexusManager,
  clearGitNexusManagerCache,
} from '../../src/plugins/gitnexus/GitNexusManager.js';
import {
  GitNexusMCPClient,
  type GitNexusMCPTransport,
} from '../../src/plugins/gitnexus/GitNexusMCPClient.js';
import type {
  GitNexusStats,
  GNQueryResult,
  GNContextResult,
  GNImpactResult,
} from '../../src/plugins/gitnexus/index.js';

describe('GitNexusManager', () => {
  let manager: GitNexusManager;
  const testRepoPath = '/test/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    clearGitNexusManagerCache();
    manager = new GitNexusManager(testRepoPath);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('isInstalled', () => {
    it('should return true when gitnexus CLI is available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        Buffer.from('1.0.0'),
      );

      expect(manager.isInstalled()).toBe(true);
      expect(execSync).toHaveBeenCalledWith('npx gitnexus --version', {
        stdio: 'pipe',
        timeout: 10_000,
        cwd: path.resolve(testRepoPath),
      });
    });

    it('should return false when gitnexus CLI is not available', () => {
      (execSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => {
          throw new Error('command not found');
        },
      );

      expect(manager.isInstalled()).toBe(false);
    });
  });

  describe('isRepoIndexed', () => {
    it('should return true when .gitnexus directory exists', () => {
      (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        true,
      );

      expect(manager.isRepoIndexed()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(
        path.join(path.resolve(testRepoPath), '.gitnexus'),
      );
    });

    it('should return false when .gitnexus directory does not exist', () => {
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
    it('should spawn npx gitnexus analyze', async () => {
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
        'npx',
        ['gitnexus', 'analyze'],
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
        'npx',
        ['gitnexus', 'analyze', '--force'],
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
        'npx',
        ['gitnexus', 'analyze', '--with-skills'],
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
        /GitNexus analyze exited with code 1/,
      );
    });
  });

  describe('dispose', () => {
    it('should not throw when no MCP server is running', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});

describe('getGitNexusManager (singleton)', () => {
  beforeEach(() => {
    clearGitNexusManagerCache();
  });

  afterEach(() => {
    clearGitNexusManagerCache();
  });

  it('should return the same instance for the same path', () => {
    const a = getGitNexusManager('/test/path');
    const b = getGitNexusManager('/test/path');
    expect(a).toBe(b);
  });

  it('should return different instances for different paths', () => {
    const a = getGitNexusManager('/test/path-a');
    const b = getGitNexusManager('/test/path-b');
    expect(a).not.toBe(b);
  });
});

describe('GitNexusMCPClient', () => {
  let client: GitNexusMCPClient;
  type TestTransport = GitNexusMCPTransport & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    readResource: ReturnType<typeof vi.fn>;
  };

  function createTransport(): TestTransport {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      callTool: vi.fn(async (name: string, input: Record<string, unknown>) => {
        switch (name) {
          case 'query':
            return {
              processes: [{ summary: `Found ${input.query}`, priority: 1, symbol_count: 2 }],
              definitions: [{ name: 'AuthService', type: 'class', filePath: 'src/auth.ts' }],
            } satisfies GNQueryResult;
          case 'context':
            return {
              symbol: {
                uid: String(input.symbol),
                kind: 'function',
                filePath: 'src/auth.ts',
                startLine: 12,
              },
              incoming: { calls: ['caller'], imports: [] },
              outgoing: { calls: ['callee'], imports: ['dep'] },
              processes: [{ name: 'auth', step: 'validate' }],
            } satisfies GNContextResult;
          case 'impact':
            return {
              target: String(input.target),
              affected: [{ name: 'AuthController', depth: 1, risk: 'medium' }],
              affectedProcesses: ['auth'],
              riskLevel: 'medium',
            } satisfies GNImpactResult;
          case 'cypher':
            return [{ n: 1 }];
          default:
            throw new Error(`Unexpected tool ${name}`);
        }
      }),
      readResource: vi.fn(async (name: string) => {
        switch (name) {
          case 'clusters':
            return [{ name: 'core', cohesion: 0.9, members: ['AuthService'], filePaths: ['src/auth.ts'] }];
          case 'processes':
            return [{ name: 'auth', steps: [{ symbol: 'AuthService', filePath: 'src/auth.ts', stepIndex: 1 }] }];
          case 'repo-context':
            return { repo: 'test-repo' };
          case 'architecture-map':
            return 'graph TD; A-->B;';
          default:
            throw new Error(`Unexpected resource ${name}`);
        }
      }),
    } as unknown as TestTransport;
  }

  beforeEach(() => {
    client = new GitNexusMCPClient('test-repo');
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('connection lifecycle', () => {
    it('should start disconnected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should reject connection without a configured transport', async () => {
      await expect(client.connect()).rejects.toThrow(
        'GitNexus MCP transport is not configured',
      );
      expect(client.isConnected()).toBe(false);
    });

    it('should disconnect cleanly', async () => {
      const transport = createTransport();
      client = new GitNexusMCPClient('test-repo', transport);

      await client.connect();
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(transport.connect).toHaveBeenCalledTimes(1);
      expect(transport.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should expose the repo name', () => {
      expect(client.getRepoName()).toBe('test-repo');
    });
  });

  describe('tools', () => {
    let transport: TestTransport;

    beforeEach(async () => {
      transport = createTransport();
      client = new GitNexusMCPClient('test-repo', transport);
      await client.connect();
    });

    it('query should call the transport', async () => {
      const result = await client.query('find authentication flow');
      expect(result.definitions[0].name).toBe('AuthService');
      expect(transport.callTool).toHaveBeenCalledWith('query', {
        query: 'find authentication flow',
        repo: 'test-repo',
      });
    });

    it('context should call the transport', async () => {
      const result = await client.context('myFunction');
      expect(result.symbol.uid).toBe('myFunction');
      expect(result.symbol.kind).toBe('function');
      expect(result.incoming.calls).toEqual(['caller']);
    });

    it('impact should call the transport', async () => {
      const result = await client.impact('src/index.ts');
      expect(result.target).toBe('src/index.ts');
      expect(result.affectedProcesses).toEqual(['auth']);
      expect(result.riskLevel).toBe('medium');
    });

    it('impact should accept direction parameter', async () => {
      const result = await client.impact('src/index.ts', 'downstream');
      expect(result.target).toBe('src/index.ts');
      expect(transport.callTool).toHaveBeenCalledWith('impact', {
        target: 'src/index.ts',
        direction: 'downstream',
        repo: 'test-repo',
      });
    });

    it('cypher should call the transport', async () => {
      const result = await client.cypher('MATCH (n) RETURN n LIMIT 5');
      expect(result).toEqual([{ n: 1 }]);
    });
  });

  describe('resources', () => {
    beforeEach(async () => {
      client = new GitNexusMCPClient('test-repo', createTransport());
      await client.connect();
    });

    it('getClusters should read transport resources', async () => {
      expect(await client.getClusters()).toEqual([{
        name: 'core',
        cohesion: 0.9,
        members: ['AuthService'],
        filePaths: ['src/auth.ts'],
      }]);
    });

    it('getProcesses should read transport resources', async () => {
      expect(await client.getProcesses()).toEqual([{
        name: 'auth',
        steps: [{ symbol: 'AuthService', filePath: 'src/auth.ts', stepIndex: 1 }],
      }]);
    });

    it('getRepoContext should read transport resources', async () => {
      expect(await client.getRepoContext()).toEqual({ repo: 'test-repo' });
    });

    it('getArchitectureMap should read transport resources', async () => {
      expect(await client.getArchitectureMap()).toBe('graph TD; A-->B;');
    });
  });

  describe('error handling', () => {
    it('should throw when calling tools without connecting', async () => {
      await expect(client.query('test')).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling context without connecting', async () => {
      await expect(client.context('sym')).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling impact without connecting', async () => {
      await expect(client.impact('file.ts')).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling cypher without connecting', async () => {
      await expect(client.cypher('MATCH (n) RETURN n')).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling getClusters without connecting', async () => {
      await expect(client.getClusters()).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling getProcesses without connecting', async () => {
      await expect(client.getProcesses()).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling getRepoContext without connecting', async () => {
      await expect(client.getRepoContext()).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });

    it('should throw when calling getArchitectureMap without connecting', async () => {
      await expect(client.getArchitectureMap()).rejects.toThrow(
        'GitNexusMCPClient is not connected',
      );
    });
  });
});
