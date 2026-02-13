/**
 * Tests for ProcessTool
 *
 * Covers: list, poll, log, write, kill, clear, remove, trackProcess,
 * getManagedProcesses, singleton helpers.
 */

import { execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { ProcessTool, getProcessTool, resetProcessTool } from '../../src/tools/process-tool.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedExecSync = execSync as jest.MockedFunction<typeof execSync>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake ChildProcess with readable stdout/stderr emitters and writable stdin. */
function createMockChildProcess(opts?: {
  stdinDestroyed?: boolean;
  noStdin?: boolean;
  noStdout?: boolean;
  noStderr?: boolean;
}): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;

  if (!opts?.noStdout) {
    (proc as any).stdout = new EventEmitter();
  } else {
    (proc as any).stdout = null;
  }

  if (!opts?.noStderr) {
    (proc as any).stderr = new EventEmitter();
  } else {
    (proc as any).stderr = null;
  }

  if (!opts?.noStdin) {
    (proc as any).stdin = {
      write: jest.fn(),
      destroyed: opts?.stdinDestroyed ?? false,
    };
  } else {
    (proc as any).stdin = null;
  }

  (proc as any).pid = 9999;
  (proc as any).kill = jest.fn();
  return proc;
}

const PS_HEADER = 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND';

function psLine(user: string, pid: number, cmd: string): string {
  return `${user}    ${pid}  0.0  0.1  12345  6789 ?        Ss   10:00   0:01 ${cmd}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProcessTool', () => {
  let tool: ProcessTool;

  beforeEach(() => {
    tool = new ProcessTool();
    jest.clearAllMocks();
  });

  // =========================================================================
  // list()
  // =========================================================================

  describe('list()', () => {
    it('should return process list without filter', async () => {
      const psOutput = [
        PS_HEADER,
        psLine('root', 1, '/sbin/init'),
        psLine('user', 100, 'node server.js'),
      ].join('\n');

      mockedExecSync.mockReturnValue(psOutput);

      const result = await tool.list();

      expect(result.success).toBe(true);
      expect(result.output).toContain(PS_HEADER);
      expect(result.output).toContain('/sbin/init');
      expect(result.output).toContain('node server.js');
      expect(result.output).toContain('2 process(es) found');
      expect(mockedExecSync).toHaveBeenCalledWith('ps aux', {
        encoding: 'utf-8',
        timeout: 5000,
      });
    });

    it('should filter processes by keyword (case-insensitive)', async () => {
      const psOutput = [
        PS_HEADER,
        psLine('root', 1, '/sbin/init'),
        psLine('user', 100, 'node server.js'),
        psLine('user', 200, 'python app.py'),
      ].join('\n');

      mockedExecSync.mockReturnValue(psOutput);

      const result = await tool.list('NODE');

      expect(result.success).toBe(true);
      expect(result.output).toContain('node server.js');
      expect(result.output).not.toContain('python app.py');
      expect(result.output).toContain('1 process(es) found');
    });

    it('should return empty filtered result when no processes match', async () => {
      const psOutput = [
        PS_HEADER,
        psLine('root', 1, '/sbin/init'),
      ].join('\n');

      mockedExecSync.mockReturnValue(psOutput);

      const result = await tool.list('nonexistent');

      expect(result.success).toBe(true);
      expect(result.output).toContain('0 process(es) found');
    });

    it('should cap output at 50 lines and indicate truncation', async () => {
      const lines = [PS_HEADER];
      for (let i = 1; i <= 60; i++) {
        lines.push(psLine('user', i, `process-${i}`));
      }

      mockedExecSync.mockReturnValue(lines.join('\n'));

      const result = await tool.list();

      expect(result.success).toBe(true);
      // Should contain header + first 50 data lines
      expect(result.output).toContain('process-50');
      expect(result.output).not.toContain('process-51');
      expect(result.output).toContain('60 process(es) found');
      expect(result.output).toContain('showing first 50');
    });

    it('should not show truncation note when 50 or fewer processes', async () => {
      const lines = [PS_HEADER];
      for (let i = 1; i <= 50; i++) {
        lines.push(psLine('user', i, `process-${i}`));
      }

      mockedExecSync.mockReturnValue(lines.join('\n'));

      const result = await tool.list();

      expect(result.success).toBe(true);
      expect(result.output).not.toContain('showing first 50');
    });

    it('should return error when execSync throws', async () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = await tool.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to list processes');
      expect(result.error).toContain('Command failed');
    });

    it('should handle non-Error thrown values gracefully', async () => {
      mockedExecSync.mockImplementation(() => {
        throw 'string error';
      });

      const result = await tool.list();

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });
  });

  // =========================================================================
  // poll()
  // =========================================================================

  describe('poll()', () => {
    it('should report process is running when kill(pid, 0) succeeds', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const result = await tool.poll(1234);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Process 1234 is running');
      expect(spy).toHaveBeenCalledWith(1234, 0);

      spy.mockRestore();
    });

    it('should include managed process info when process is tracked', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
      const mockProc = createMockChildProcess();
      tool.trackProcess(5678, 'npm start', mockProc);

      const result = await tool.poll(5678);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Process 5678 is running');
      expect(result.output).toContain('managed: "npm start"');

      spy.mockRestore();
    });

    it('should report process is not running when kill(pid, 0) throws', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });

      const result = await tool.poll(9999);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Process 9999 is not running');

      spy.mockRestore();
    });
  });

  // =========================================================================
  // log()
  // =========================================================================

  describe('log()', () => {
    it('should return error for unmanaged process', async () => {
      const result = await tool.log(1234);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Process 1234 is not a managed process');
    });

    it('should return stdout lines by default', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // Simulate stdout data
      mockProc.stdout!.emit('data', Buffer.from('line1\nline2\nline3\n'));

      const result = await tool.log(100);

      expect(result.success).toBe(true);
      expect(result.output).toContain('line1');
      expect(result.output).toContain('line2');
      expect(result.output).toContain('line3');
    });

    it('should return stderr lines when opts.stderr is true', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      mockProc.stderr!.emit('data', Buffer.from('err1\nerr2\n'));

      const result = await tool.log(100, { stderr: true });

      expect(result.success).toBe(true);
      expect(result.output).toContain('err1');
      expect(result.output).toContain('err2');
    });

    it('should limit returned lines to opts.lines', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // Emit many lines
      const manyLines = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n') + '\n';
      mockProc.stdout!.emit('data', Buffer.from(manyLines));

      const result = await tool.log(100, { lines: 5 });

      expect(result.success).toBe(true);
      // Should only contain the last 5 lines
      const outputLines = result.output!.split('\n');
      expect(outputLines).toHaveLength(5);
      expect(result.output).toContain('line-45');
      expect(result.output).toContain('line-49');
    });

    it('should default to last 100 lines when opts.lines is not specified', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const manyLines = Array.from({ length: 200 }, (_, i) => `line-${i}`).join('\n') + '\n';
      mockProc.stdout!.emit('data', Buffer.from(manyLines));

      const result = await tool.log(100);

      expect(result.success).toBe(true);
      const outputLines = result.output!.split('\n');
      expect(outputLines).toHaveLength(100);
      expect(result.output).toContain('line-100');
      expect(result.output).toContain('line-199');
      expect(result.output).not.toContain('line-99\n');
    });

    it('should return "(no output)" when buffer is empty', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.log(100);

      expect(result.success).toBe(true);
      expect(result.output).toBe('(no output)');
    });
  });

  // =========================================================================
  // write()
  // =========================================================================

  describe('write()', () => {
    it('should return error for unmanaged process', async () => {
      const result = await tool.write(1234, 'hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Process 1234 is not a managed process');
    });

    it('should return error when stdin is null', async () => {
      const mockProc = createMockChildProcess({ noStdin: true });
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.write(100, 'hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('stdin is not writable');
    });

    it('should return error when stdin is destroyed', async () => {
      const mockProc = createMockChildProcess({ stdinDestroyed: true });
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.write(100, 'hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('stdin is not writable');
    });

    it('should write input plus newline to stdin', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.write(100, 'test input');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Wrote 11 bytes'); // 'test input' (10) + '\n' (1) = 11
      expect((mockProc.stdin as any).write).toHaveBeenCalledWith('test input\n');
    });

    it('should return error when stdin.write throws', async () => {
      const mockProc = createMockChildProcess();
      (mockProc.stdin as any).write = jest.fn(() => {
        throw new Error('Broken pipe');
      });
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.write(100, 'data');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to write to process 100');
      expect(result.error).toContain('Broken pipe');
    });
  });

  // =========================================================================
  // kill()
  // =========================================================================

  describe('kill()', () => {
    it('should send SIGTERM by default', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const result = await tool.kill(1234);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Sent SIGTERM to process 1234');
      expect(spy).toHaveBeenCalledWith(1234, 'SIGTERM');

      spy.mockRestore();
    });

    it('should send custom signal when specified', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);

      const result = await tool.kill(1234, 'SIGKILL');

      expect(result.success).toBe(true);
      expect(result.output).toContain('Sent SIGKILL to process 1234');
      expect(spy).toHaveBeenCalledWith(1234, 'SIGKILL');

      spy.mockRestore();
    });

    it('should return error when process.kill throws', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('EPERM');
      });

      const result = await tool.kill(1234);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to kill process 1234');
      expect(result.error).toContain('EPERM');

      spy.mockRestore();
    });
  });

  // =========================================================================
  // clear()
  // =========================================================================

  describe('clear()', () => {
    it('should return error for unmanaged process', async () => {
      const result = await tool.clear(1234);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Process 1234 is not a managed process');
    });

    it('should clear both stdout and stderr buffers', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // Populate buffers
      mockProc.stdout!.emit('data', Buffer.from('out1\nout2\n'));
      mockProc.stderr!.emit('data', Buffer.from('err1\n'));

      const result = await tool.clear(100);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Cleared 2 stdout and 1 stderr lines');

      // Verify buffers are empty
      const logResult = await tool.log(100);
      expect(logResult.output).toBe('(no output)');

      const errLogResult = await tool.log(100, { stderr: true });
      expect(errLogResult.output).toBe('(no output)');
    });

    it('should report zero lines when buffers are already empty', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.clear(100);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Cleared 0 stdout and 0 stderr lines');
    });
  });

  // =========================================================================
  // remove()
  // =========================================================================

  describe('remove()', () => {
    it('should return error for unmanaged process', async () => {
      const result = await tool.remove(1234);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Process 1234 is not a managed process');
    });

    it('should untrack a managed process', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const result = await tool.remove(100);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Untracked process 100');
      expect(tool.getManagedProcesses().has(100)).toBe(false);
    });

    it('should not affect other managed processes', async () => {
      const mockProc1 = createMockChildProcess();
      const mockProc2 = createMockChildProcess();
      tool.trackProcess(100, 'node app1.js', mockProc1);
      tool.trackProcess(200, 'node app2.js', mockProc2);

      await tool.remove(100);

      expect(tool.getManagedProcesses().has(100)).toBe(false);
      expect(tool.getManagedProcesses().has(200)).toBe(true);
    });
  });

  // =========================================================================
  // trackProcess()
  // =========================================================================

  describe('trackProcess()', () => {
    it('should register a process in the managed map', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const managed = tool.getManagedProcesses();
      expect(managed.has(100)).toBe(true);

      const entry = managed.get(100)!;
      expect(entry.pid).toBe(100);
      expect(entry.command).toBe('node app.js');
      expect(entry.process).toBe(mockProc);
      expect(entry.stdoutLines).toEqual([]);
      expect(entry.stderrLines).toEqual([]);
      expect(entry.startedAt).toBeInstanceOf(Date);
    });

    it('should capture stdout data into the buffer', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      mockProc.stdout!.emit('data', Buffer.from('hello world\n'));

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.stdoutLines).toEqual(['hello world']);
    });

    it('should capture stderr data into the buffer', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      mockProc.stderr!.emit('data', Buffer.from('warning: something\n'));

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.stderrLines).toEqual(['warning: something']);
    });

    it('should filter out empty lines from data events', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // '\n\nline1\n\nline2\n\n' should only keep 'line1' and 'line2'
      mockProc.stdout!.emit('data', Buffer.from('\n\nline1\n\nline2\n\n'));

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.stdoutLines).toEqual(['line1', 'line2']);
    });

    it('should trim stdout buffer to maxBufferLines (1000)', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // Emit 1100 lines at once
      const bulkData = Array.from({ length: 1100 }, (_, i) => `line-${i}`).join('\n') + '\n';
      mockProc.stdout!.emit('data', Buffer.from(bulkData));

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.stdoutLines.length).toBe(1000);
      // Should keep the last 1000 lines (line-100 through line-1099)
      expect(entry.stdoutLines[0]).toBe('line-100');
      expect(entry.stdoutLines[999]).toBe('line-1099');
    });

    it('should trim stderr buffer to maxBufferLines (1000)', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      const bulkData = Array.from({ length: 1100 }, (_, i) => `err-${i}`).join('\n') + '\n';
      mockProc.stderr!.emit('data', Buffer.from(bulkData));

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.stderrLines.length).toBe(1000);
      expect(entry.stderrLines[0]).toBe('err-100');
    });

    it('should handle process exit event without error', () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(100, 'node app.js', mockProc);

      // Should not throw
      expect(() => {
        mockProc.emit('exit', 0);
      }).not.toThrow();
    });

    it('should handle null stdout/stderr gracefully', () => {
      const mockProc = createMockChildProcess({ noStdout: true, noStderr: true });

      // trackProcess uses optional chaining (proc.stdout?.on), so this should not throw
      expect(() => {
        tool.trackProcess(100, 'node app.js', mockProc);
      }).not.toThrow();

      expect(tool.getManagedProcesses().has(100)).toBe(true);
    });

    it('should overwrite a previously tracked process with the same PID', () => {
      const mockProc1 = createMockChildProcess();
      const mockProc2 = createMockChildProcess();

      tool.trackProcess(100, 'first-cmd', mockProc1);
      tool.trackProcess(100, 'second-cmd', mockProc2);

      const entry = tool.getManagedProcesses().get(100)!;
      expect(entry.command).toBe('second-cmd');
      expect(entry.process).toBe(mockProc2);
    });
  });

  // =========================================================================
  // getManagedProcesses()
  // =========================================================================

  describe('getManagedProcesses()', () => {
    it('should return an empty map when no processes are tracked', () => {
      expect(tool.getManagedProcesses().size).toBe(0);
    });

    it('should return all tracked processes', () => {
      const mockProc1 = createMockChildProcess();
      const mockProc2 = createMockChildProcess();
      tool.trackProcess(100, 'cmd1', mockProc1);
      tool.trackProcess(200, 'cmd2', mockProc2);

      const managed = tool.getManagedProcesses();
      expect(managed.size).toBe(2);
      expect(managed.has(100)).toBe(true);
      expect(managed.has(200)).toBe(true);
    });
  });

  // =========================================================================
  // Singleton: getProcessTool() / resetProcessTool()
  // =========================================================================

  describe('getProcessTool() / resetProcessTool()', () => {
    afterEach(() => {
      resetProcessTool();
    });

    it('should return the same instance on repeated calls', () => {
      const a = getProcessTool();
      const b = getProcessTool();
      expect(a).toBe(b);
    });

    it('should return a new instance after resetProcessTool()', () => {
      const a = getProcessTool();
      resetProcessTool();
      const b = getProcessTool();
      expect(a).not.toBe(b);
    });

    it('should return a ProcessTool instance', () => {
      expect(getProcessTool()).toBeInstanceOf(ProcessTool);
    });
  });

  // =========================================================================
  // Integration-style: combined operations
  // =========================================================================

  describe('combined operations', () => {
    it('should track, log, clear, and remove a process in sequence', async () => {
      const mockProc = createMockChildProcess();
      tool.trackProcess(42, 'npm test', mockProc);

      // Emit data
      mockProc.stdout!.emit('data', Buffer.from('PASS test1\nPASS test2\n'));
      mockProc.stderr!.emit('data', Buffer.from('Warning: deprecated\n'));

      // Log stdout
      const logResult = await tool.log(42);
      expect(logResult.success).toBe(true);
      expect(logResult.output).toContain('PASS test1');

      // Log stderr
      const errResult = await tool.log(42, { stderr: true });
      expect(errResult.success).toBe(true);
      expect(errResult.output).toContain('Warning: deprecated');

      // Clear logs
      const clearResult = await tool.clear(42);
      expect(clearResult.success).toBe(true);
      expect(clearResult.output).toContain('Cleared 2 stdout and 1 stderr');

      // Verify cleared
      const emptyLog = await tool.log(42);
      expect(emptyLog.output).toBe('(no output)');

      // Remove
      const removeResult = await tool.remove(42);
      expect(removeResult.success).toBe(true);

      // Verify removed
      const afterRemove = await tool.log(42);
      expect(afterRemove.success).toBe(false);
    });

    it('should handle write followed by kill on a managed process', async () => {
      const spy = jest.spyOn(process, 'kill').mockImplementation((() => true) as any);
      const mockProc = createMockChildProcess();
      tool.trackProcess(55, 'python repl.py', mockProc);

      // Write
      const writeResult = await tool.write(55, 'print("hello")');
      expect(writeResult.success).toBe(true);

      // Kill
      const killResult = await tool.kill(55, 'SIGINT');
      expect(killResult.success).toBe(true);
      expect(killResult.output).toContain('SIGINT');

      spy.mockRestore();
    });
  });
});
