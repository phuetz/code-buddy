import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { BackgroundTaskManager } from '../../src/agent/background-tasks.js';

vi.mock('child_process', () => {
  const impl = {
  spawn: vi.fn(),
};
  return { ...impl, default: impl };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockChildProcess(pid: number = 12345): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter;
  Object.defineProperty(proc, 'pid', { value: pid, writable: true });
  Object.defineProperty(proc, 'stdout', { value: new EventEmitter(), writable: true });
  Object.defineProperty(proc, 'stderr', { value: new EventEmitter(), writable: true });
  proc.kill = vi.fn().mockReturnValue(true);
  return proc;
}

describe('BackgroundTaskManager (agent)', () => {
  let manager: BackgroundTaskManager;
  let mockSpawn: import('vitest').MockedFunction<typeof spawn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BackgroundTaskManager();
    mockSpawn = spawn as import('vitest').MockedFunction<typeof spawn>;
  });

  afterEach(() => {
    manager.cleanup();
  });

  it('launchTask uses platform-appropriate shell arguments', () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    manager.launchTask('echo hello');

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = mockSpawn.mock.calls[0];

    if (process.platform === 'win32') {
      expect(String(cmd).toLowerCase()).toContain('cmd');
      expect(args).toEqual(['/d', '/s', '/c', 'echo hello']);
      expect(options?.detached).toBe(false);
    } else {
      expect(cmd).toBe('sh');
      expect(args).toEqual(['-c', 'echo hello']);
      expect(options?.detached).toBe(true);
    }

    expect(options?.windowsHide).toBe(true);
    expect(options?.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('killTask targets process group on Unix and child on Windows', () => {
    const child = createMockChildProcess();
    mockSpawn.mockReturnValue(child);

    const id = manager.launchTask('sleep 60');
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as typeof process.kill);

    try {
      const killed = manager.killTask(id);
      expect(killed).toBe(true);

      if (process.platform === 'win32') {
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      } else {
        expect(processKillSpy).toHaveBeenCalledWith(-12345, 'SIGTERM');
      }
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('killTask swallows kill errors and still marks task as failed', () => {
    const child = createMockChildProcess();
    child.kill = vi.fn().mockImplementation(function() {
      throw new Error('kill failed');
    });
    mockSpawn.mockReturnValue(child);

    const id = manager.launchTask('sleep 60');
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(function() {
      throw new Error('group kill failed');
    });

    try {
      expect(() => manager.killTask(id)).not.toThrow();
      const task = manager.getTask(id);
      expect(task?.status).toBe('failed');
      expect(task?.exitCode).toBe(137);
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('killTask returns false when task does not exist', () => {
    expect(manager.killTask('bg-999')).toBe(false);
  });
});

