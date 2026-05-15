/**
 * Tests for Tailscale, Dashboard, Device Nodes, Message Tool, Gateway Tool
 *
 * Covers: TailscaleManager, Dashboard, DeviceNodeManager, MessageTool, GatewayTool
 */

// ============================================================================
// Mocks
// ============================================================================

jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock device transports to avoid real SSH/ADB connections
const mockTransport = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  isConnected: jest.fn().mockReturnValue(true),
  getCapabilities: jest.fn().mockResolvedValue(['system_run']),
  execute: jest.fn().mockResolvedValue({ stdout: 'stub: executed', stderr: '', exitCode: 0 }),
};

jest.mock('../../src/nodes/transports/ssh-transport.js', () => ({
  SSHTransport: jest.fn().mockImplementation(function() { return { ...mockTransport }; }),
}));
jest.mock('../../src/nodes/transports/adb-transport.js', () => ({
  ADBTransport: jest.fn().mockImplementation(function() { return { ...mockTransport }; }),
}));
jest.mock('../../src/nodes/transports/local-transport.js', () => ({
  LocalTransport: jest.fn().mockImplementation(function() { return { ...mockTransport }; }),
}));

// Mock fs to prevent device-node from persisting/loading to/from disk
jest.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn((p: string) => {
      if (typeof p === 'string' && p.includes('devices.json')) return false;
      return actual.existsSync(p);
    }),
    writeFileSync: jest.fn((...fsArgs: Parameters<typeof actual.writeFileSync>) => {
      const [p] = fsArgs;
      if (typeof p === 'string' && p.includes('devices.json')) return;
      return actual.writeFileSync(...fsArgs);
    }),
  };
});

// Mock child_process.execFile for Tailscale CLI calls
const mockExecFile = jest.fn();
jest.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, execFile: mockExecFile };
});
jest.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: () => (...args: unknown[]) => {
      // Promisified execFile — call mockExecFile and wrap in Promise
      return new Promise((resolve, reject) => {
        const cb = (err: Error | null, result: unknown) => err ? reject(err) : resolve(result);
        mockExecFile(...args, cb);
      });
    },
  };
});

// ============================================================================
// Feature 1: Tailscale Integration
// ============================================================================

describe('TailscaleManager', () => {
  let TailscaleManager: typeof import('../../src/integrations/tailscale').TailscaleManager;

  beforeEach(async () => {
    jest.resetModules();
    mockExecFile.mockReset();
    // Default: tailscale commands succeed
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      if (args[0] === 'version') {
        cb(null, { stdout: '1.62.0\n', stderr: '' });
      } else if (args[0] === 'status') {
        cb(null, { stdout: JSON.stringify({
          BackendState: 'Running',
          Self: { HostName: 'dev-box', TailscaleIPs: ['100.64.0.1'] },
          MagicDNSSuffix: 'tailnet.ts.net',
        }), stderr: '' });
      } else {
        // serve, funnel, etc.
        cb(null, { stdout: '', stderr: '' });
      }
    });
    const mod = await import('../../src/integrations/tailscale.js');
    TailscaleManager = mod.TailscaleManager;
    TailscaleManager.resetInstance();
  });

  it('should be a singleton', () => {
    const a = TailscaleManager.getInstance();
    const b = TailscaleManager.getInstance();
    expect(a).toBe(b);
  });

  it('should reset singleton', () => {
    const a = TailscaleManager.getInstance();
    TailscaleManager.resetInstance();
    const b = TailscaleManager.getInstance();
    expect(a).not.toBe(b);
  });

  it('should report installed', async () => {
    const mgr = TailscaleManager.getInstance();
    expect(await mgr.isInstalled()).toBe(true);
  });

  it('should return status', async () => {
    const mgr = TailscaleManager.getInstance();
    const status = await mgr.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(true);
    expect(status.hostname).toBe('dev-box');
    expect(status.tailnetName).toBe('tailnet.ts.net');
    expect(status.ip).toBe('100.64.0.1');
  });

  it('should serve on a port', async () => {
    const mgr = TailscaleManager.getInstance();
    const ok = await mgr.serve(3000);
    expect(ok).toBe(true);
    expect(mgr.isServing()).toBe(true);
    const config = mgr.getConfig();
    expect(config).not.toBeNull();
    expect(config!.mode).toBe('serve');
    expect(config!.port).toBe(3000);
  });

  it('should serve with a path', async () => {
    const mgr = TailscaleManager.getInstance();
    const ok = await mgr.serve(8080, '/api');
    expect(ok).toBe(true);
    expect(mgr.isServing()).toBe(true);
    expect(mgr.getConfig()!.port).toBe(8080);
  });

  it('should funnel on a port', async () => {
    const mgr = TailscaleManager.getInstance();
    const ok = await mgr.funnel(443);
    expect(ok).toBe(true);
    expect(mgr.isServing()).toBe(true);
    expect(mgr.getConfig()!.mode).toBe('funnel');
    expect(mgr.getConfig()!.port).toBe(443);
  });

  it('should stop serving', async () => {
    const mgr = TailscaleManager.getInstance();
    await mgr.serve(3000);
    expect(mgr.isServing()).toBe(true);
    await mgr.stop();
    expect(mgr.isServing()).toBe(false);
  });

  it('should return serve URL when serving', async () => {
    const mgr = TailscaleManager.getInstance();
    await mgr.getStatus(); // populate cachedStatus
    await mgr.serve(3000);
    const url = mgr.getServeUrl();
    expect(url).toBe('https://dev-box.tailnet.ts.net');
  });

  it('should generate auth headers without authKey', () => {
    const mgr = TailscaleManager.getInstance();
    const headers = mgr.generateAuthHeaders();
    // No authKey set, no cached status => empty headers
    expect(headers['Authorization']).toBeUndefined();
  });

  it('should set config with hostname', async () => {
    const mgr = TailscaleManager.getInstance();
    mgr.setConfig({ hostname: 'my-box', port: 3000 });
    await mgr.serve(3000);
    // getServeUrl uses cachedStatus hostname or config hostname
    const url = mgr.getServeUrl();
    expect(url).toContain('my-box');
  });
});

// ============================================================================
// Feature 2: Dashboard
// ============================================================================

describe('Dashboard', () => {
  let Dashboard: typeof import('../../src/server/dashboard').Dashboard;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/server/dashboard.js');
    Dashboard = mod.Dashboard;
    Dashboard.resetInstance();
  });

  it('should be a singleton', () => {
    const a = Dashboard.getInstance();
    const b = Dashboard.getInstance();
    expect(a).toBe(b);
  });

  it('should reset singleton', () => {
    const a = Dashboard.getInstance();
    Dashboard.resetInstance();
    const b = Dashboard.getInstance();
    expect(a).not.toBe(b);
  });

  it('should start and report running', () => {
    const dash = new Dashboard();
    dash.start();
    expect(dash.isRunning()).toBe(true);
  });

  it('should stop and report not running', () => {
    const dash = new Dashboard();
    dash.start();
    dash.stop();
    expect(dash.isRunning()).toBe(false);
  });

  it('should use default port 8080', () => {
    const dash = new Dashboard();
    expect(dash.getPort()).toBe(8080);
  });

  it('should use custom port from config', () => {
    const dash = new Dashboard({ port: 9090 });
    expect(dash.getPort()).toBe(9090);
  });

  it('should override port on start', () => {
    const dash = new Dashboard();
    dash.start(4000);
    expect(dash.getPort()).toBe(4000);
  });

  it('should return correct URL', () => {
    const dash = new Dashboard({ port: 3001 });
    expect(dash.getUrl()).toBe('http://localhost:3001');
  });

  it('should return status with uptime', () => {
    const dash = new Dashboard();
    dash.start();
    const status = dash.getStatus();
    expect(status.running).toBe(true);
    expect(status.port).toBe(8080);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.connectedClients).toBe(0);
  });

  it('should return zero uptime when stopped', () => {
    const dash = new Dashboard();
    const status = dash.getStatus();
    expect(status.uptime).toBe(0);
  });

  it('should generate HTML with all sections', () => {
    const dash = new Dashboard();
    const html = dash.generateDashboardHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Agent Status');
    expect(html).toContain('Active Sessions');
    expect(html).toContain('Channel Status');
    expect(html).toContain('Tool Usage');
    expect(html).toContain('Memory Stats');
    expect(html).toContain('System Health');
  });

  it('should return metrics object', () => {
    const dash = new Dashboard();
    const metrics = dash.getMetrics();
    expect(metrics.agent.status).toBe('idle');
    expect(metrics.channels).toContain('telegram');
    expect(metrics.tools).toBe(25);
    expect(metrics.sessions).toBe(0);
  });

  it('should track connected clients', () => {
    const dash = new Dashboard();
    dash.start();
    dash.setConnectedClients(5);
    const status = dash.getStatus();
    expect(status.connectedClients).toBe(5);
  });
});

// ============================================================================
// Feature 3: Device Node System
// ============================================================================

describe('DeviceNodeManager', () => {
  let DeviceNodeManager: typeof import('../../src/nodes/device-node').DeviceNodeManager;

  beforeEach(async () => {
    jest.resetModules();
    mockTransport.connect.mockReset();
    mockTransport.connect.mockResolvedValue(undefined);
    mockTransport.disconnect.mockReset();
    mockTransport.disconnect.mockResolvedValue(undefined);
    mockTransport.isConnected.mockReset();
    mockTransport.isConnected.mockReturnValue(true);
    mockTransport.getCapabilities.mockReset();
    mockTransport.getCapabilities.mockResolvedValue(['system_run']);
    mockTransport.execute.mockReset();
    mockTransport.execute.mockResolvedValue({ stdout: 'stub: executed', stderr: '', exitCode: 0 });
    const mod = await import('../../src/nodes/device-node.js');
    DeviceNodeManager = mod.DeviceNodeManager;
    DeviceNodeManager.resetInstance();
  });

  // Helper: pair device and set capabilities directly (bypasses transport auto-detect)
  async function pairWithCaps(mgr: InstanceType<typeof DeviceNodeManager>, id: string, name: string, transport: 'ssh' | 'adb' | 'local', caps: string[]) {
    const device = await mgr.pairDevice(id, name, transport);
    device.capabilities = caps as typeof device.capabilities;
    return device;
  }

  it('should be a singleton', () => {
    const a = DeviceNodeManager.getInstance();
    const b = DeviceNodeManager.getInstance();
    expect(a).toBe(b);
  });

  it('should pair a device', async () => {
    const mgr = DeviceNodeManager.getInstance();
    const device = await pairWithCaps(mgr, 'mac1', 'My Mac', 'ssh', ['camera', 'system_run']);
    expect(device.id).toBe('mac1');
    expect(device.name).toBe('My Mac');
    expect(device.paired).toBe(true);
    expect(device.capabilities).toContain('camera');
  });

  it('should reject failed pairing instead of registering fallback capabilities', async () => {
    mockTransport.connect.mockRejectedValueOnce(new Error('connection refused'));

    const mgr = DeviceNodeManager.getInstance();

    await expect(mgr.pairDevice('bad1', 'Broken Device', 'ssh')).rejects.toThrow(
      'Device pairing failed for Broken Device (bad1): connection refused'
    );
    expect(mgr.getDevice('bad1')).toBeUndefined();
    expect(mgr.isDevicePaired('bad1')).toBe(false);
  });

  it('should unpair a device', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('mac1', 'My Mac', 'ssh');
    expect(mgr.unpairDevice('mac1')).toBe(true);
    expect(mgr.getDevice('mac1')).toBeUndefined();
  });

  it('should return false when unpairing unknown device', () => {
    const mgr = DeviceNodeManager.getInstance();
    expect(mgr.unpairDevice('nope')).toBe(false);
  });

  it('should get device by id', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('iphone1', 'iPhone', 'adb');
    const device = mgr.getDevice('iphone1');
    expect(device).toBeDefined();
    expect(device!.type).toBe('android');
  });

  it('should list all devices', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('d1', 'Device 1', 'ssh');
    await mgr.pairDevice('d2', 'Device 2', 'adb');
    expect(mgr.listDevices()).toHaveLength(2);
  });

  it('should list only paired devices', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('d1', 'Device 1', 'ssh');
    expect(mgr.listPairedDevices()).toHaveLength(1);
  });

  it('should check if device is paired', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('d1', 'Device 1', 'ssh');
    expect(mgr.isDevicePaired('d1')).toBe(true);
    expect(mgr.isDevicePaired('d99')).toBe(false);
  });

  it('should take camera snap', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'cam1', 'Camera Phone', 'adb', ['camera']);
    const snapPath = await mgr.cameraSnap('cam1');
    expect(snapPath).not.toBeNull();
    expect(snapPath).toContain('snap-cam1-');
    expect(snapPath).toContain('.jpg');
  });

  it('should return null for camera snap without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'nocam', 'No Camera', 'adb', ['location']);
    expect(await mgr.cameraSnap('nocam')).toBeNull();
  });

  it('should screen record', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'sr1', 'Screen Recorder', 'ssh', ['screen_record']);
    const recPath = await mgr.screenRecord('sr1', 30);
    expect(recPath).not.toBeNull();
    expect(recPath).toContain('.mp4');
  });

  it('should return null for screen record without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'nosr', 'No Screen', 'adb', ['camera']);
    expect(await mgr.screenRecord('nosr')).toBeNull();
  });

  it('should get location', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'loc1', 'Location Device', 'ssh', ['location']);
    mockTransport.execute.mockResolvedValueOnce({ stdout: '{"lat":48.8566,"lon":2.3522}', stderr: '', exitCode: 0 });

    const coords = await mgr.getLocation('loc1');

    expect(coords).toEqual({ lat: 48.8566, lon: 2.3522 });
  });

  it('should return null for invalid location output instead of fabricated coordinates', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'badloc', 'Bad Location', 'ssh', ['location']);
    mockTransport.execute.mockResolvedValueOnce({ stdout: 'not json', stderr: '', exitCode: 0 });

    expect(await mgr.getLocation('badloc')).toBeNull();
  });

  it('should return null for location without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'noloc', 'No Location', 'ssh', ['camera']);
    expect(await mgr.getLocation('noloc')).toBeNull();
  });

  it('should not report notification delivery without an implemented transport action', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'notif1', 'Notifier', 'adb', ['notifications']);
    expect(mgr.sendNotification('notif1', 'Hello', 'World')).toBe(false);
  });

  it('should return false for notification without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'nonotif', 'No Notif', 'adb', ['camera']);
    expect(mgr.sendNotification('nonotif', 'Hello', 'World')).toBe(false);
  });

  it('should run system command', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'mac1', 'Mac', 'ssh', ['system_run']);
    const result = await mgr.systemRun('mac1', 'ls -la');
    expect(result).not.toBeNull();
  });

  it('should reject system run without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'nocap1', 'No Cap', 'adb', ['camera']);
    const result = await mgr.systemRun('nocap1', 'ls');
    expect(result).toBeNull();
  });

  it('should generate cryptographic pairing token', () => {
    const mgr = DeviceNodeManager.getInstance();
    const token = mgr.generatePairingToken();
    expect(token.token).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
    expect(token.expiresAt).toBeGreaterThan(Date.now());
    expect(token.consumed).toBe(false);

    // Legacy generatePairingCode() still works (returns token string)
    const code = mgr.generatePairingCode();
    expect(code).toMatch(/^[0-9a-f]{32}$/);
  });

  it('should update last seen', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await mgr.pairDevice('d1', 'Device', 'local');
    const before = mgr.getDevice('d1')!.lastSeen;
    const result = mgr.updateLastSeen('d1');
    expect(result).toBe(true);
    expect(mgr.getDevice('d1')!.lastSeen).toBeGreaterThanOrEqual(before);
  });

  it('should return false for updateLastSeen on unknown device', () => {
    const mgr = DeviceNodeManager.getInstance();
    expect(mgr.updateLastSeen('nope')).toBe(false);
  });
});

// ============================================================================
// Feature 4: Cross-Channel Message Tool
// ============================================================================

describe('MessageTool', () => {
  let MessageTool: typeof import('../../src/tools/message-tool').MessageTool;
  const target = { channel: 'discord', chatId: 'general' };
  const createTransport = () => ({
    supportedChannels: ['telegram', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'teams', 'webchat'],
    send: () => ({ success: true, action: 'send' as const, messageId: 'msg-1' }),
    react: (_target: unknown, messageId: string) => ({ success: true, action: 'react' as const, messageId }),
    pin: (_target: unknown, messageId: string) => ({ success: true, action: 'pin' as const, messageId }),
    threadCreate: () => ({ success: true, action: 'thread_create' as const, messageId: 'thread-1' }),
    search: () => ({ success: true, action: 'search' as const }),
    roleAdd: () => ({ success: true, action: 'role_add' as const }),
    kick: () => ({ success: true, action: 'kick' as const }),
    ban: () => ({ success: true, action: 'ban' as const }),
  });

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/tools/message-tool.js');
    MessageTool = mod.MessageTool;
    MessageTool.resetInstance();
    MessageTool.getInstance({ transport: createTransport() });
  });

  it('should be a singleton', () => {
    const a = MessageTool.getInstance();
    const b = MessageTool.getInstance();
    expect(a).toBe(b);
  });

  it('should send a message', () => {
    const tool = MessageTool.getInstance();
    const result = tool.send(target, 'Hello world');
    expect(result.success).toBe(true);
    expect(result.action).toBe('send');
    expect(result.messageId).toBe('msg-1');
  });

  it('should fail message actions when no transport is configured', () => {
    MessageTool.resetInstance();
    const tool = MessageTool.getInstance();
    const result = tool.send(target, 'Hello world');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Message transport is not configured');
    expect(tool.getActions()).toHaveLength(0);
  });

  it('should react to a message', () => {
    const tool = MessageTool.getInstance();
    const result = tool.react(target, 'msg-1', '👍');
    expect(result.success).toBe(true);
    expect(result.action).toBe('react');
  });

  it('should pin a message', () => {
    const tool = MessageTool.getInstance();
    const result = tool.pin(target, 'msg-1');
    expect(result.success).toBe(true);
    expect(result.action).toBe('pin');
  });

  it('should create a thread', () => {
    const tool = MessageTool.getInstance();
    const result = tool.threadCreate(target, 'msg-1', 'Thread text');
    expect(result.success).toBe(true);
    expect(result.action).toBe('thread_create');
    expect(result.messageId).toBe('thread-1');
  });

  it('should search messages', () => {
    const tool = MessageTool.getInstance();
    const result = tool.search(target, 'test query');
    expect(result.success).toBe(true);
    expect(result.action).toBe('search');
  });

  it('should add a role', () => {
    const tool = MessageTool.getInstance();
    const result = tool.roleAdd(target, 'user-1', 'admin');
    expect(result.success).toBe(true);
    expect(result.action).toBe('role_add');
  });

  it('should kick a user', () => {
    const tool = MessageTool.getInstance();
    const result = tool.kick(target, 'user-1', 'spam');
    expect(result.success).toBe(true);
    expect(result.action).toBe('kick');
  });

  it('should ban a user', () => {
    const tool = MessageTool.getInstance();
    const result = tool.ban(target, 'user-1', 'abuse');
    expect(result.success).toBe(true);
    expect(result.action).toBe('ban');
  });

  it('should kick without reason', () => {
    const tool = MessageTool.getInstance();
    const result = tool.kick(target, 'user-2');
    expect(result.success).toBe(true);
  });

  it('should record all actions', () => {
    const tool = MessageTool.getInstance();
    tool.send(target, 'msg');
    tool.react(target, 'msg-1', '🎉');
    tool.pin(target, 'msg-1');
    const actions = tool.getActions();
    expect(actions).toHaveLength(3);
    expect(actions[0].action).toBe('send');
    expect(actions[1].action).toBe('react');
    expect(actions[2].action).toBe('pin');
  });

  it('should return supported channels', () => {
    const tool = MessageTool.getInstance();
    const channels = tool.getSupportedChannels();
    expect(channels).toContain('telegram');
    expect(channels).toContain('discord');
    expect(channels).toContain('slack');
    expect(channels).toContain('whatsapp');
    expect(channels.length).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================================
// Feature 5: Gateway Self-Management Tool
// ============================================================================

describe('GatewayTool', () => {
  let GatewayTool: typeof import('../../src/tools/gateway-tool').GatewayTool;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import('../../src/tools/gateway-tool.js');
    GatewayTool = mod.GatewayTool;
    GatewayTool.resetInstance();
  });

  it('should be a singleton', () => {
    const a = GatewayTool.getInstance();
    const b = GatewayTool.getInstance();
    expect(a).toBe(b);
  });

  it('should report not running initially', () => {
    const gw = GatewayTool.getInstance();
    const status = gw.getStatus();
    expect(status.running).toBe(false);
    expect(status.uptime).toBe(0);
  });

  it('should start and report running', () => {
    const gw = GatewayTool.getInstance();
    gw.start();
    expect(gw.getStatus().running).toBe(true);
  });

  it('should restart and reset uptime', () => {
    const gw = GatewayTool.getInstance();
    gw.start();
    gw.restart();
    expect(gw.getStatus().running).toBe(true);
    expect(gw.getUptime()).toBeGreaterThanOrEqual(0);
  });

  it('should return version', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getVersion()).toBe('0.1.16');
  });

  it('should return empty config initially', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getConfig()).toEqual({});
  });

  it('should update config', () => {
    const gw = GatewayTool.getInstance();
    gw.updateConfig('maxSessions', 100);
    expect(gw.getConfig()).toEqual({ maxSessions: 100 });
  });

  it('should get and set channel count', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getChannelCount()).toBe(0);
    gw.setChannelCount(5);
    expect(gw.getChannelCount()).toBe(5);
  });

  it('should get and set session count', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getSessionCount()).toBe(0);
    gw.setSessionCount(10);
    expect(gw.getSessionCount()).toBe(10);
  });

  it('should return healthy when running', () => {
    const gw = GatewayTool.getInstance();
    gw.start();
    const health = gw.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.checks.api).toBe(true);
    expect(health.checks.database).toBe(true);
    expect(health.checks.llm).toBe(true);
    expect(health.checks.memory).toBe(true);
  });

  it('should return unhealthy when not running', () => {
    const gw = GatewayTool.getInstance();
    const health = gw.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.checks.api).toBe(false);
  });

  it('should have memory usage in status', () => {
    const gw = GatewayTool.getInstance();
    gw.start();
    const status = gw.getStatus();
    expect(typeof status.memoryUsage).toBe('number');
  });

  it('should return zero uptime when not started', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getUptime()).toBe(0);
  });

  it('should include version in status', () => {
    const gw = GatewayTool.getInstance();
    expect(gw.getStatus().version).toBe('0.1.16');
  });
});
