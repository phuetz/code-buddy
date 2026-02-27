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
  SSHTransport: jest.fn().mockImplementation(() => ({ ...mockTransport })),
}));
jest.mock('../../src/nodes/transports/adb-transport.js', () => ({
  ADBTransport: jest.fn().mockImplementation(() => ({ ...mockTransport })),
}));
jest.mock('../../src/nodes/transports/local-transport.js', () => ({
  LocalTransport: jest.fn().mockImplementation(() => ({ ...mockTransport })),
}));

// Mock fs to prevent device-node from persisting/loading to/from disk
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: jest.fn((p: string) => {
      if (typeof p === 'string' && p.includes('devices.json')) return false;
      return actual.existsSync(p);
    }),
    writeFileSync: jest.fn((p: string, ...args: unknown[]) => {
      if (typeof p === 'string' && p.includes('devices.json')) return;
      return (actual.writeFileSync as Function)(p, ...args);
    }),
  };
});

// ============================================================================
// Feature 1: Tailscale Integration
// ============================================================================

describe('TailscaleManager', () => {
  let TailscaleManager: typeof import('../../src/integrations/tailscale').TailscaleManager;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/integrations/tailscale');
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

  it('should report installed', () => {
    const mgr = TailscaleManager.getInstance();
    expect(mgr.isInstalled()).toBe(true);
  });

  it('should return status', () => {
    const mgr = TailscaleManager.getInstance();
    const status = mgr.getStatus();
    expect(status.installed).toBe(true);
    expect(status.running).toBe(false);
    expect(status.hostname).toBe('my-machine');
    expect(status.tailnetName).toBe('tailnet.ts.net');
    expect(status.ip).toBe('100.64.0.1');
  });

  it('should serve on a port', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.serve(3000);
    expect(mgr.isServing()).toBe(true);
    const config = mgr.getConfig();
    expect(config).not.toBeNull();
    expect(config!.mode).toBe('serve');
    expect(config!.port).toBe(3000);
  });

  it('should serve with a path', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.serve(8080, '/api');
    expect(mgr.isServing()).toBe(true);
    expect(mgr.getConfig()!.port).toBe(8080);
  });

  it('should funnel on a port', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.funnel(443);
    expect(mgr.isServing()).toBe(true);
    expect(mgr.getConfig()!.mode).toBe('funnel');
    expect(mgr.getConfig()!.port).toBe(443);
  });

  it('should stop serving', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.serve(3000);
    expect(mgr.isServing()).toBe(true);
    mgr.stop();
    expect(mgr.isServing()).toBe(false);
  });

  it('should return serve URL when serving', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.serve(3000);
    const url = mgr.getServeUrl();
    expect(url).toBe('https://my-machine.tailnet.ts.net');
  });

  it('should return null URL when not serving', () => {
    const mgr = TailscaleManager.getInstance();
    expect(mgr.getServeUrl()).toBeNull();
  });

  it('should return null URL after stop', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.serve(3000);
    mgr.stop();
    expect(mgr.getServeUrl()).toBeNull();
  });

  it('should generate auth headers without authKey', () => {
    const mgr = TailscaleManager.getInstance();
    const headers = mgr.generateAuthHeaders();
    expect(headers['Tailscale-User-Login']).toBe('user@example.com');
    expect(headers['Tailscale-User-Name']).toBe('User');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('should generate auth headers with authKey', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.setConfig({ authKey: 'tskey-abc123' });
    const headers = mgr.generateAuthHeaders();
    expect(headers['Authorization']).toBe('Bearer tskey-abc123');
  });

  it('should return null config initially', () => {
    const mgr = TailscaleManager.getInstance();
    expect(mgr.getConfig()).toBeNull();
  });

  it('should set config with hostname', () => {
    const mgr = TailscaleManager.getInstance();
    mgr.setConfig({ hostname: 'dev-box', port: 3000 });
    mgr.serve(3000);
    expect(mgr.getServeUrl()).toBe('https://dev-box.tailnet.ts.net');
  });
});

// ============================================================================
// Feature 2: Dashboard
// ============================================================================

describe('Dashboard', () => {
  let Dashboard: typeof import('../../src/server/dashboard').Dashboard;

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/server/dashboard');
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

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/nodes/device-node');
    DeviceNodeManager = mod.DeviceNodeManager;
    DeviceNodeManager.resetInstance();
  });

  // Helper: pair device and set capabilities directly (bypasses transport auto-detect)
  async function pairWithCaps(mgr: InstanceType<typeof DeviceNodeManager>, id: string, name: string, transport: 'ssh' | 'adb' | 'local', caps: string[]) {
    const device = await mgr.pairDevice(id, name, transport);
    device.capabilities = caps as any;
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
    await pairWithCaps(mgr, 'loc1', 'Location Device', 'adb', ['location']);
    const coords = await mgr.getLocation('loc1');
    expect(coords).not.toBeNull();
  });

  it('should return null for location without capability', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'noloc', 'No Location', 'ssh', ['camera']);
    expect(await mgr.getLocation('noloc')).toBeNull();
  });

  it('should send notification', async () => {
    const mgr = DeviceNodeManager.getInstance();
    await pairWithCaps(mgr, 'notif1', 'Notifier', 'adb', ['notifications']);
    expect(mgr.sendNotification('notif1', 'Hello', 'World')).toBe(true);
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

  it('should generate 6-digit pairing code', () => {
    const mgr = DeviceNodeManager.getInstance();
    const code = mgr.generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
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

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/tools/message-tool');
    MessageTool = mod.MessageTool;
    MessageTool.resetInstance();
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
    expect(result.messageId).toBeDefined();
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
    expect(result.messageId).toContain('thread-');
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

  beforeEach(() => {
    jest.resetModules();
    const mod = require('../../src/tools/gateway-tool');
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
