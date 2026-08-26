import { DaemonManager, resetDaemonManager } from '../../src/daemon/daemon-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('DaemonManager', () => {
  let manager: DaemonManager;
  let tmpDir: string;

  beforeEach(async () => {
    resetDaemonManager();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-test-'));
    manager = new DaemonManager({
      pidFile: path.join(tmpDir, 'test.pid'),
      logFile: path.join(tmpDir, 'test.log'),
      maxRestarts: 3,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('should report not running when no PID file exists', async () => {
    const status = await manager.status();
    expect(status.running).toBe(false);
    expect(status.pid).toBeUndefined();
  });

  it('should read and write PID files', async () => {
    // Write a PID file manually
    await fs.mkdir(path.dirname(manager.getConfig().pidFile), { recursive: true });
    await fs.writeFile(manager.getConfig().pidFile, '12345');

    const pid = await manager.readPid();
    expect(pid).toBe(12345);
  });

  it('should return null for invalid PID file', async () => {
    await fs.mkdir(path.dirname(manager.getConfig().pidFile), { recursive: true });
    await fs.writeFile(manager.getConfig().pidFile, 'notanumber');

    const pid = await manager.readPid();
    expect(pid).toBeNull();
  });

  it('should detect running processes', () => {
    // Current process should be running
    expect(manager.isProcessRunning(process.pid)).toBe(true);
    // Non-existent PID should not be running
    expect(manager.isProcessRunning(999999999)).toBe(false);
  });

  it('should return config', () => {
    const config = manager.getConfig();
    expect(config.maxRestarts).toBe(3);
    expect(config.pidFile).toContain('test.pid');
  });

  it('should return empty logs when no log file', async () => {
    const logs = await manager.logs();
    expect(logs).toBe('(no logs available)');
  });

  it('should read log file when it exists', async () => {
    await fs.mkdir(path.dirname(manager.getConfig().logFile), { recursive: true });
    await fs.writeFile(manager.getConfig().logFile, 'line1\nline2\nline3');

    const logs = await manager.logs(2);
    expect(logs).toBe('line2\nline3');
  });

  it('should track restart count', async () => {
    const status = await manager.status();
    expect(status.restartCount).toBe(0);
  });

  it('should throw when starting and already running', async () => {
    // Write current process PID
    await fs.mkdir(path.dirname(manager.getConfig().pidFile), { recursive: true });
    await fs.writeFile(manager.getConfig().pidFile, String(process.pid));

    await expect(manager.start(false)).rejects.toThrow(/already running/);
  });
});
