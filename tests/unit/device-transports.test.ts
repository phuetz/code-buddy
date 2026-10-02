/**
 * Device Transport Tests
 *
 * Tests for SSH, ADB, and Local transports using mocked child_process.spawn.
 */

import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Helper to create a mock process
function createMockProcess(exitCode: number, stdout: string, stderr: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  // Schedule data emission and close after listeners are attached
  setImmediate(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });

  return proc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSpawn.mockReset();
});

describe('LocalTransport', () => {
  it('should connect successfully', async () => {
    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();

    await transport.connect();
    expect(transport.isConnected()).toBe(true);
  });

  it('should disconnect', async () => {
    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();

    await transport.connect();
    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it('should execute commands', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(0, 'hello world', ''));

    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();
    await transport.connect();

    const result = await transport.execute('echo hello world');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  it('should handle command failure', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(1, '', 'command not found'));

    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();
    await transport.connect();

    const result = await transport.execute('nonexistent');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('command not found');
  });

  it('should handle spawn error', async () => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    mockSpawn.mockImplementation(() => {
      setImmediate(() => proc.emit('error', new Error('spawn failed')));
      return proc;
    });

    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();
    await transport.connect();

    const result = await transport.execute('bad_command');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('spawn failed');
  });

  it('should no-op for file transfers', async () => {
    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();
    await transport.connect();

    // Should not throw
    await transport.uploadFile('/local/a', '/local/b');
    await transport.downloadFile('/local/a', '/local/b');
  });

  it('should detect capabilities', async () => {
    // Mock which commands for capability detection
    mockSpawn.mockImplementation((...fnArgs: unknown[]) => {
      const argsArr = (fnArgs[1] ?? []) as string[];
      const command = argsArr[argsArr.length - 1];
      if (typeof command === 'string' && command.includes('scrot')) {
        return createMockProcess(0, '/usr/bin/scrot', '');
      }
      if (typeof command === 'string' && command.includes('ffmpeg')) {
        return createMockProcess(0, '/usr/bin/ffmpeg', '');
      }
      return createMockProcess(1, '', 'not found');
    });

    const { LocalTransport } = await import('../../src/nodes/transports/local-transport.js');
    const transport = new LocalTransport();

    const caps = await transport.getCapabilities();
    expect(caps).toContain('system_run');
    // Platform-specific caps vary, just ensure array is returned
    expect(Array.isArray(caps)).toBe(true);
  });
});

describe('SSHTransport', () => {
  it('should connect via SSH', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(0, 'connected', ''));

    const { SSHTransport } = await import('../../src/nodes/transports/ssh-transport.js');
    const transport = new SSHTransport({
      deviceId: 'test-server',
      address: '192.168.1.100',
      username: 'user',
    });

    await transport.connect();
    expect(transport.isConnected()).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'ssh',
      expect.arrayContaining(['-o', 'BatchMode=yes', 'user@192.168.1.100', 'echo connected']),
      expect.any(Object)
    );
  });

  it('should fail to connect on SSH error', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(255, '', 'Connection refused'));

    const { SSHTransport } = await import('../../src/nodes/transports/ssh-transport.js');
    const transport = new SSHTransport({
      deviceId: 'bad-server',
      address: '10.0.0.1',
    });

    await expect(transport.connect()).rejects.toThrow('SSH connection failed');
  });

  it('should execute commands via SSH', async () => {
    // First call is connect, second is the actual command
    let callCount = 0;
    mockSpawn.mockImplementation(function() {
      callCount++;
      if (callCount === 1) return createMockProcess(0, 'connected', '');
      return createMockProcess(0, 'Linux', '');
    });

    const { SSHTransport } = await import('../../src/nodes/transports/ssh-transport.js');
    const transport = new SSHTransport({
      deviceId: 'server',
      address: 'example.com',
      username: 'root',
      port: 2222,
    });

    await transport.connect();
    const result = await transport.execute('uname');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Linux');
  });

  it('should use SCP for file upload', async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(function() {
      callCount++;
      return createMockProcess(0, callCount === 1 ? 'connected' : '', '');
    });

    const { SSHTransport } = await import('../../src/nodes/transports/ssh-transport.js');
    const transport = new SSHTransport({
      deviceId: 'server',
      address: 'host.com',
      username: 'user',
    });

    await transport.connect();
    await transport.uploadFile('/tmp/local.txt', '/remote/file.txt');

    // Second call should be SCP
    expect(mockSpawn).toHaveBeenCalledWith(
      'scp',
      expect.arrayContaining(['/tmp/local.txt', 'user@host.com:/remote/file.txt']),
      expect.any(Object)
    );
  });

  it('should detect capabilities via SSH', async () => {
    mockSpawn.mockImplementation((...fnArgs: unknown[]) => {
      const argsArr = (fnArgs[1] ?? []) as string[];
      const command = argsArr[argsArr.length - 1];
      if (typeof command === 'string' && command.includes('uname')) {
        return createMockProcess(0, 'Darwin', '');
      }
      if (typeof command === 'string' && command === 'echo connected') {
        return createMockProcess(0, 'connected', '');
      }
      return createMockProcess(1, '', '');
    });

    const { SSHTransport } = await import('../../src/nodes/transports/ssh-transport.js');
    const transport = new SSHTransport({
      deviceId: 'mac',
      address: 'mac.local',
    });

    await transport.connect();
    const caps = await transport.getCapabilities();
    expect(caps).toContain('system_run');
    expect(caps).toContain('file_transfer');
  });
});

describe('ADBTransport', () => {
  it('should connect to device via ADB', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(0, 'connected', ''));

    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'emulator-5554' });

    await transport.connect();
    expect(transport.isConnected()).toBe(true);
  });

  it('should fail to connect if device not accessible', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(1, '', 'device not found'));

    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'bad-device' });

    await expect(transport.connect()).rejects.toThrow('ADB device not accessible');
  });

  it('should execute ADB shell commands', async () => {
    let callCount = 0;
    mockSpawn.mockImplementation(function() {
      callCount++;
      if (callCount === 1) return createMockProcess(0, 'connected', '');
      return createMockProcess(0, 'Android 13', '');
    });

    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'pixel-7' });

    await transport.connect();
    const result = await transport.execute('getprop ro.build.version.release');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Android 13');
  });

  it('should use adb push for file upload', async () => {
    mockSpawn.mockImplementation(() => createMockProcess(0, '', ''));

    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'pixel-7' });

    await transport.uploadFile('/tmp/test.apk', '/sdcard/test.apk');
    expect(mockSpawn).toHaveBeenCalledWith(
      'adb',
      expect.arrayContaining(['-s', 'pixel-7', 'push', '/tmp/test.apk', '/sdcard/test.apk']),
      expect.any(Object)
    );
  });

  it('should return Android capabilities', async () => {
    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'pixel-7' });

    const caps = await transport.getCapabilities();
    expect(caps).toContain('system_run');
    expect(caps).toContain('screenshot');
    expect(caps).toContain('screen_record');
    expect(caps).toContain('camera');
    expect(caps).toContain('location');
  });

  it('should return structured calendar instances instead of a dispatch placeholder', async () => {
    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'pixel-7' });
    vi.spyOn(transport, 'execute').mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout:
        'Row: 0 event_id=42, title=Match France Espagne, begin=1784145600000, ' +
        'end=1784152800000, eventLocation=Stade, allDay=0',
    });

    const events = await transport.getCalendarEvents(7);

    expect(events).toEqual([{
      id: '42',
      title: 'Match France Espagne',
      start: new Date(1784145600000).toISOString(),
      end: new Date(1784152800000).toISOString(),
      allDay: false,
      location: 'Stade',
    }]);
    expect(transport.execute).toHaveBeenCalledWith(
      expect.stringContaining('content://com.android.calendar/instances/when/'),
    );
  });

  it('should distinguish calendar read failure from an empty calendar', async () => {
    const { ADBTransport } = await import('../../src/nodes/transports/adb-transport.js');
    const transport = new ADBTransport({ deviceId: 'pixel-7' });
    vi.spyOn(transport, 'execute').mockResolvedValue({
      exitCode: 1,
      stderr: 'Permission denial',
      stdout: '',
    });

    expect(await transport.getCalendarEvents()).toBeNull();
  });
});

describe('Platform Commands', () => {
  it('should return macOS commands', async () => {
    const { getPlatformCommands } = await import('../../src/nodes/platform-commands.js');
    const cmds = getPlatformCommands('macos');
    expect(cmds).not.toBeNull();
    expect(cmds!.screenshot('/tmp/ss.png')).toContain('screencapture');
    expect(cmds!.cameraSnap('/tmp/snap.jpg')).toContain('imagesnap');
  });

  it('should return Linux commands', async () => {
    const { getPlatformCommands } = await import('../../src/nodes/platform-commands.js');
    const cmds = getPlatformCommands('linux');
    expect(cmds).not.toBeNull();
    expect(cmds!.screenshot('/tmp/ss.png')).toContain('scrot');
  });

  it('should return Android commands', async () => {
    const { getPlatformCommands } = await import('../../src/nodes/platform-commands.js');
    const cmds = getPlatformCommands('android');
    expect(cmds).not.toBeNull();
    expect(cmds!.screenshot('/tmp/ss.png')).toContain('screencap');
    expect(cmds!.screenRecord('/tmp/rec.mp4', 10)).toContain('screenrecord');
  });

  it('should return null for unknown platform', async () => {
    const { getPlatformCommands } = await import('../../src/nodes/platform-commands.js');
    const cmds = getPlatformCommands('unknown');
    expect(cmds).toBeNull();
  });
});
