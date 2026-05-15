import { EventEmitter } from 'events';
import { execFileSync, spawn } from 'child_process';
import { DockerCliClient } from '../../../src/security/docker-sandbox/index.js';

const { mockExecFileSync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}));

type MockProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  kill: ReturnType<typeof vi.fn>;
};

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedSpawn = vi.mocked(spawn);

function createMockProcess(): MockProcess {
  const child = new EventEmitter() as MockProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function mockDockerRun(result: { stdout?: string; stderr?: string; code?: number }): MockProcess {
  const child = createMockProcess();
  mockedSpawn.mockReturnValueOnce(child as ReturnType<typeof spawn>);

  queueMicrotask(() => {
    if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
    if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
    child.emit('close', result.code ?? 0);
  });

  return child;
}

describe('DockerCliClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks Docker availability with the real docker CLI', async () => {
    mockedExecFileSync.mockReturnValue(Buffer.from(''));

    await expect(new DockerCliClient().isAvailable()).resolves.toBe(true);

    expect(mockedExecFileSync).toHaveBeenCalledWith('docker', ['info'], { stdio: 'ignore' });
  });

  it('reports Docker unavailable when docker info fails', async () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('docker missing');
    });

    await expect(new DockerCliClient().isAvailable()).resolves.toBe(false);
  });

  it('creates a long-running real Docker container instead of an in-memory mock', async () => {
    mockDockerRun({ stdout: 'container-real-id\n' });

    const id = await new DockerCliClient().createContainer({
      image: 'node:22-slim',
      name: 'codebuddy-test',
      networkMode: 'none',
      labels: { 'codebuddy.sandbox': 'true' },
    });

    expect(id).toBe('container-real-id');
    expect(mockedSpawn).toHaveBeenCalledWith('docker', [
      'create',
      '--name',
      'codebuddy-test',
      '--network',
      'none',
      '--label',
      'codebuddy.sandbox=true',
      'node:22-slim',
      'sh',
      '-c',
      'while true; do sleep 3600; done',
    ], expect.any(Object));
  });

  it('returns real docker exec exit codes and stderr', async () => {
    mockDockerRun({ stderr: 'command failed', code: 7 });

    const result = await new DockerCliClient().exec('abc123', ['bad-command']);

    expect(result).toEqual({
      exitCode: 7,
      stdout: '',
      stderr: 'command failed',
    });
  });

  it('parses Docker stats output into numeric metrics', async () => {
    mockDockerRun({
      stdout: JSON.stringify({
        CPUPerc: '2.50%',
        MemUsage: '10MiB / 512MiB',
        NetIO: '1kB / 2kB',
        BlockIO: '3MB / 4MB',
      }) + '\n',
    });

    const stats = await new DockerCliClient().getStats('abc123');

    expect(stats).toEqual({
      cpuPercent: 2.5,
      memoryUsage: 10 * 1024 * 1024,
      memoryLimit: 512 * 1024 * 1024,
      networkRx: 1000,
      networkTx: 2000,
      blockRead: 3_000_000,
      blockWrite: 4_000_000,
    });
  });

  it('rejects incomplete Docker stats instead of reporting zero metrics', async () => {
    mockDockerRun({
      stdout: JSON.stringify({
        CPUPerc: '2.50%',
      }) + '\n',
    });

    await expect(new DockerCliClient().getStats('abc123')).rejects.toThrow(
      'Unable to parse Docker size pair for memory'
    );
  });

  it('maps Docker inspect status values to sandbox container statuses', async () => {
    mockDockerRun({ stdout: 'exited\n' });

    await expect(new DockerCliClient().getStatus('abc123')).resolves.toBe('stopped');
  });
});
