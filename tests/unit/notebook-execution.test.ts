/**
 * Tests for Notebook Tool - Jupyter Kernel Execution
 *
 * Tests:
 * - execute_cell returns cell output
 * - execute_all runs cells in order
 * - kernel_start/stop lifecycle
 * - Error handling for missing jupyter
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
const mockExecFile = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('util', () => ({
  promisify: (fn: unknown) => {
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        (fn as (...a: unknown[]) => void)(...args, (err: Error | null, ...results: unknown[]) => {
          if (err) reject(err);
          else if (results.length <= 1) resolve(results[0]);
          else resolve({ stdout: results[0], stderr: results[1] });
        });
      });
    };
  },
}));

// Mock VFS
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('../../src/services/vfs/unified-vfs-router.js', () => ({
  UnifiedVfsRouter: {
    Instance: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs for cleanup in executeCell
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      existsSync: vi.fn().mockReturnValue(false),
      unlinkSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
  };
});

import { NotebookTool } from '../../src/tools/notebook-tool.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeNotebook(cells: Array<{ type: 'code' | 'markdown'; source: string; outputs?: unknown[] }>) {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.10.0' },
    },
    cells: cells.map(c => ({
      cell_type: c.type,
      source: c.source.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line),
      metadata: {},
      execution_count: null,
      outputs: c.outputs || [],
    })),
  });
}

function makeExecutedNotebook(cells: Array<{ type: 'code' | 'markdown'; source: string; outputs?: unknown[]; execution_count?: number }>) {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.10.0' },
    },
    cells: cells.map(c => ({
      cell_type: c.type,
      source: c.source.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line),
      metadata: {},
      execution_count: c.execution_count ?? null,
      outputs: c.outputs || [],
    })),
  });
}

describe('Notebook Tool - Execution', () => {
  let tool: NotebookTool;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh tool instance each test to reset jupyterAvailable
    tool = new NotebookTool();
  });

  // ==========================================================================
  // Error handling - missing jupyter
  // ==========================================================================

  describe('missing jupyter', () => {
    it('should return error when jupyter is not installed (execute_cell)', async () => {
      // Make execFile reject to simulate missing jupyter
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error) => void;
        cb(new Error('ENOENT: jupyter not found'));
      });

      mockReadFile.mockResolvedValue(makeNotebook([
        { type: 'code', source: 'print("hello")' },
      ]));

      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
        cellIndex: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('jupyter');
    });

    it('should return error when jupyter is not installed (execute_all)', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error) => void;
        cb(new Error('ENOENT: jupyter not found'));
      });

      const result = await tool.execute({
        action: 'execute_all',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('jupyter');
    });

    it('should return error when jupyter is not installed (kernel_start)', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error) => void;
        cb(new Error('ENOENT: jupyter not found'));
      });

      const result = await tool.execute({
        action: 'kernel_start',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('jupyter');
    });
  });

  // ==========================================================================
  // execute_cell
  // ==========================================================================

  describe('execute_cell', () => {
    it('should require cellIndex parameter', async () => {
      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cellIndex');
    });

    it('should return error for non-code cell', async () => {
      // First call: jupyter --version check
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        if (callCount === 1) {
          // jupyter --version
          cb(null, '6.5.0', '');
        } else {
          cb(null, '', '');
        }
      });

      mockReadFile.mockResolvedValue(makeNotebook([
        { type: 'markdown', source: '# Title' },
      ]));

      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
        cellIndex: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('markdown');
      expect(result.error).toContain('not a code cell');
    });

    it('should return error for out-of-range cellIndex', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '6.5.0', '');
      });

      mockReadFile.mockResolvedValue(makeNotebook([
        { type: 'code', source: 'x = 1' },
      ]));

      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
        cellIndex: 5,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('out of range');
    });

    it('should execute a cell and return output', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '', '');
      });

      const notebook = makeNotebook([
        { type: 'code', source: 'print("hello world")' },
      ]);

      const executedNotebook = makeExecutedNotebook([
        {
          type: 'code',
          source: 'print("hello world")',
          execution_count: 1,
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello world\n'] }],
        },
      ]);

      // First read: load notebook, second read: load temp executed result
      mockReadFile
        .mockResolvedValueOnce(notebook)
        .mockResolvedValueOnce(executedNotebook);

      mockWriteFile.mockResolvedValue(undefined);

      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
        cellIndex: 0,
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('executed successfully');
      expect(result.content).toContain('hello world');
    });

    it('should fail when the executed cell records an error output', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '', '');
      });

      const notebook = makeNotebook([
        { type: 'code', source: '1 / 0' },
      ]);

      const executedNotebook = makeExecutedNotebook([
        {
          type: 'code',
          source: '1 / 0',
          execution_count: 1,
          outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: [] }],
        },
      ]);

      mockReadFile
        .mockResolvedValueOnce(notebook)
        .mockResolvedValueOnce(executedNotebook);

      mockWriteFile.mockResolvedValue(undefined);

      const result = await tool.execute({
        action: 'execute_cell',
        path: 'test.ipynb',
        cellIndex: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('executed with errors');
      expect(result.error).toContain('ZeroDivisionError');
    });
  });

  // ==========================================================================
  // execute_all
  // ==========================================================================

  describe('execute_all', () => {
    it('should execute all cells and return summary', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '', '');
      });

      const executedNotebook = makeExecutedNotebook([
        {
          type: 'code',
          source: 'x = 1',
          execution_count: 1,
          outputs: [{ output_type: 'execute_result', data: { 'text/plain': ['1'] } }],
        },
        { type: 'markdown', source: '# Section' },
        {
          type: 'code',
          source: 'print(x + 1)',
          execution_count: 2,
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['2\n'] }],
        },
      ]);

      mockReadFile.mockResolvedValue(executedNotebook);

      const result = await tool.execute({
        action: 'execute_all',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('Executed all cells');
      expect(result.content).toContain('Code cells: 2');
      expect(result.content).toContain('Cells with output: 2');
      expect(result.content).toContain('Cells with errors: 0');
    });

    it('should report cells with errors', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '', '');
      });

      const executedNotebook = makeExecutedNotebook([
        {
          type: 'code',
          source: '1/0',
          execution_count: 1,
          outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: [] }],
        },
      ]);

      mockReadFile.mockResolvedValue(executedNotebook);

      const result = await tool.execute({
        action: 'execute_all',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cells with errors: 1');
      expect(result.error).toContain('ZeroDivisionError');
    });
  });

  // ==========================================================================
  // kernel_start / kernel_stop
  // ==========================================================================

  describe('kernel_start / kernel_stop lifecycle', () => {
    it('should stop kernel when none is running', async () => {
      const result = await tool.execute({
        action: 'kernel_stop',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('No kernel');
    });

    it('should start kernel with default python3', async () => {
      // Mock jupyter --version check
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '6.5.0', '');
      });

      // Mock the spawn for kernel process
      const mockProcess = {
        pid: 12345,
        killed: false,
        stderr: { on: vi.fn(), removeListener: vi.fn() },
        stdout: { on: vi.fn(), removeListener: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      const result = await tool.execute({
        action: 'kernel_start',
        path: 'test.ipynb',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('started');
      expect(result.content).toContain('12345');
    });

    it('should return message if kernel already running', async () => {
      // First call: jupyter --version
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '6.5.0', '');
      });

      const mockProcess = {
        pid: 12345,
        killed: false,
        stderr: { on: vi.fn(), removeListener: vi.fn() },
        stdout: { on: vi.fn(), removeListener: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      // Start kernel
      await tool.execute({ action: 'kernel_start', path: 'test.ipynb' });

      // Try to start again
      const result = await tool.execute({ action: 'kernel_start', path: 'test.ipynb' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('already running');
    });

    it('should accept custom kernel name', async () => {
      let callCount = 0;
      mockExecFile.mockImplementation((...args: unknown[]) => {
        callCount++;
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '6.5.0', '');
      });

      const mockProcess = {
        pid: 99999,
        killed: false,
        stderr: { on: vi.fn(), removeListener: vi.fn() },
        stdout: { on: vi.fn(), removeListener: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      const result = await tool.execute({
        action: 'kernel_start',
        path: 'test.ipynb',
        kernelName: 'julia-1.8',
      });

      expect(result.success).toBe(true);
      expect(result.content).toContain('julia-1.8');
    });

    it('should fail if kernel process exits during startup', async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as (err: Error | null, stdout: string, stderr: string) => void;
        cb(null, '6.5.0', '');
      });

      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const mockProcess = {
        pid: 777,
        killed: false,
        exitCode: null,
        stderr: { on: vi.fn(), removeListener: vi.fn() },
        stdout: { on: vi.fn(), removeListener: vi.fn() },
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          const current = listeners.get(event) ?? [];
          current.push(listener);
          listeners.set(event, current);
          return mockProcess;
        }),
        removeListener: vi.fn(),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = tool.execute({
        action: 'kernel_start',
        path: 'test.ipynb',
      });
      setTimeout(() => {
        for (const listener of listeners.get('close') ?? []) {
          listener(1, null);
        }
      }, 0);

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('closed during startup');
      expect(result.error).toContain('code=1');
    });
  });
});
