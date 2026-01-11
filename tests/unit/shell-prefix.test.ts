/**
 * Unit tests for ShellPrefix handler
 */

import {
  isShellCommand,
  extractCommand,
  executeShellCommand,
  executeInteractiveCommand,
  formatShellResult,
  isInteractiveCommand,
} from '../../src/commands/shell-prefix';
import { exec, spawn } from 'child_process';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));

describe('ShellPrefix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isShellCommand()', () => {
    it('should return true for input starting with !', () => {
      expect(isShellCommand('!ls -la')).toBe(true);
      expect(isShellCommand('  !git status')).toBe(true);
    });

    it('should return false for regular input', () => {
      expect(isShellCommand('hello')).toBe(false);
      expect(isShellCommand('/help')).toBe(false);
    });
  });

  describe('extractCommand()', () => {
    it('should remove ! prefix', () => {
      expect(extractCommand('!ls')).toBe('ls');
      expect(extractCommand('! git commit')).toBe('git commit');
    });
  });

  describe('executeShellCommand()', () => {
    it('should execute command and return success', async () => {
      (exec as unknown as jest.Mock).mockImplementation((cmd, options, cb) => {
        cb(null, { stdout: 'output', stderr: '' });
      });

      const result = await executeShellCommand('ls');

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('output');
      expect(exec).toHaveBeenCalled();
    });

    it('should return failure on error', async () => {
      (exec as unknown as jest.Mock).mockImplementation((cmd, options, cb) => {
        const error = new Error('fail');
        (error as any).code = 1;
        (error as any).stderr = 'error msg';
        cb(error, '', 'error msg');
      });

      const result = await executeShellCommand('false');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('error msg');
    });

    it('should handle timeout', async () => {
      (exec as unknown as jest.Mock).mockImplementation((cmd, options, cb) => {
        const error = new Error('timeout');
        (error as any).killed = true;
        cb(error, { stdout: 'partial', stderr: '' });
      });

      const result = await executeShellCommand('sleep 100', process.cwd(), 10);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain('timed out');
    });
  });

  describe('executeInteractiveCommand()', () => {
    it('should spawn process and return exit code', async () => {
      const mockChild = {
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        }),
      };
      (spawn as jest.Mock).mockReturnValue(mockChild);

      const code = await executeInteractiveCommand('vim');

      expect(code).toBe(0);
      expect(spawn).toHaveBeenCalledWith('vim', [], expect.objectContaining({
        shell: true,
        stdio: 'inherit',
      }));
    });
  });

  describe('formatShellResult()', () => {
    it('should format successful result', () => {
      const result = {
        success: true,
        stdout: 'file.txt\n',
        stderr: '',
        exitCode: 0,
        duration: 100,
      };
      const output = formatShellResult('ls', result);
      expect(output).toContain('$ ls');
      expect(output).toContain('file.txt');
      expect(output).toContain('100ms');
    });

    it('should format error result', () => {
      const result = {
        success: false,
        stdout: '',
        stderr: 'not found',
        exitCode: 127,
        duration: 50,
      };
      const output = formatShellResult('unknown', result);
      expect(output).toContain('Error: not found');
      expect(output).toContain('Exit code: 127');
    });
  });

  describe('isInteractiveCommand()', () => {
    it('should detect known interactive commands', () => {
      expect(isInteractiveCommand('vim test.ts')).toBe(true);
      expect(isInteractiveCommand('top')).toBe(true);
      expect(isInteractiveCommand('git rebase -i HEAD~2')).toBe(true);
    });

    it('should return false for non-interactive commands', () => {
      expect(isInteractiveCommand('ls -la')).toBe(false);
      expect(isInteractiveCommand('cat file.txt')).toBe(false);
    });
  });
});
