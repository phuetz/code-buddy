import { EventEmitter } from 'events';

const { mockExecSync, mockSpawn, mockSpawnSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn().mockReturnValue(Buffer.from('')),
  mockSpawn: vi.fn(),
  mockSpawnSync: vi.fn().mockReturnValue({
    status: 0,
    stdout: Buffer.from(''),
    stderr: Buffer.from(''),
  }),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
}));

import { DockerSandbox } from '../../src/sandbox/docker-sandbox.js';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe('DockerSandbox probe cache', () => {
  const originalDockerContext = process.env.DOCKER_CONTEXT;

  beforeEach(() => {
    DockerSandbox.invalidateProbeCache();
    vi.clearAllMocks();
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    });
    delete process.env.DOCKER_CONTEXT;
  });

  afterEach(() => {
    DockerSandbox.invalidateProbeCache();
    vi.restoreAllMocks();
    if (originalDockerContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = originalDockerContext;
  });

  it('coalesces concurrent daemon probes and reuses a positive result', async () => {
    const results = await Promise.all([
      DockerSandbox.isAvailableCached(),
      DockerSandbox.isAvailableCached(),
      DockerSandbox.isAvailableCached(),
    ]);

    expect(results).toEqual([true, true, true]);
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    await expect(DockerSandbox.isAvailableCached()).resolves.toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('keys image probes by Docker context and coalesces identical requests', async () => {
    const image = 'codebuddy-workspace-sandbox:1';
    const first = await Promise.all([
      DockerSandbox.hasLocalImageCached(image),
      DockerSandbox.hasLocalImageCached(image),
    ]);

    expect(first).toEqual([true, true]);
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);

    process.env.DOCKER_CONTEXT = 'remote-builder';
    await expect(DockerSandbox.hasLocalImageCached(image)).resolves.toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  it('expires positive entries and never caches probe failures', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    await expect(DockerSandbox.isAvailableCached({ ttlMs: 100 })).resolves.toBe(true);
    now = 1_099;
    await expect(DockerSandbox.isAvailableCached({ ttlMs: 100 })).resolves.toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    now = 1_100;
    await expect(DockerSandbox.isAvailableCached({ ttlMs: 100 })).resolves.toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(2);

    DockerSandbox.invalidateProbeCache();
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('daemon stopped');
    });
    await expect(DockerSandbox.isAvailableCached()).resolves.toBe(false);
    await expect(DockerSandbox.isAvailableCached()).resolves.toBe(true);
    expect(mockExecSync).toHaveBeenCalledTimes(4);
  });

  it('invalidates daemon and image assumptions after Docker run exit 125', async () => {
    const image = 'codebuddy-workspace-sandbox:1';
    await DockerSandbox.isAvailableCached();
    await DockerSandbox.hasLocalImageCached(image);
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);

    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    const sandbox = new DockerSandbox({ image });
    const execution = sandbox.execute('true');
    proc.stderr.emit('data', Buffer.from('docker daemon unavailable'));
    proc.emit('close', 125);
    await execution;

    await DockerSandbox.isAvailableCached();
    await DockerSandbox.hasLocalImageCached(image);
    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });
});
