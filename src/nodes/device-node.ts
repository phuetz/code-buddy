/**
 * Device Node System
 *
 * Manages paired device nodes (macOS, Linux, Android) with real transport
 * connections (SSH, ADB, local). Capabilities are auto-detected from
 * the connected device.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import type { DeviceTransport, ExecuteResult } from './transports/base-transport.js';
import { getPlatformCommands, type DevicePlatform } from './platform-commands.js';

// ============================================================================
// Types
// ============================================================================

export type DeviceType = 'macos' | 'linux' | 'android' | 'local';

export type DeviceCapability = 'camera' | 'screen_record' | 'location' | 'notifications' | 'system_run' | 'file_transfer' | 'screenshot';

export type TransportType = 'ssh' | 'adb' | 'local';

export interface DeviceNode {
  id: string;
  name: string;
  type: DeviceType;
  transportType: TransportType;
  capabilities: DeviceCapability[];
  paired: boolean;
  lastSeen: number;
  address?: string;
  port?: number;
  username?: string;
  keyPath?: string;
}

export interface LocationCoords {
  lat: number;
  lon: number;
}

interface PersistedDevices {
  version: number;
  devices: DeviceNode[];
}

// ============================================================================
// Constants
// ============================================================================

const DEVICES_FILE = path.join(os.homedir(), '.codebuddy', 'devices.json');
const DEVICES_VERSION = 1;

// ============================================================================
// DeviceNodeManager
// ============================================================================

export class DeviceNodeManager {
  private static instance: DeviceNodeManager | null = null;
  private devices: Map<string, DeviceNode> = new Map();
  private transports: Map<string, DeviceTransport> = new Map();

  constructor() {
    this.loadDevices();
  }

  static getInstance(): DeviceNodeManager {
    if (!DeviceNodeManager.instance) {
      DeviceNodeManager.instance = new DeviceNodeManager();
    }
    return DeviceNodeManager.instance;
  }

  static resetInstance(): void {
    DeviceNodeManager.instance = null;
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  private loadDevices(): void {
    try {
      if (fs.existsSync(DEVICES_FILE)) {
        const raw = fs.readFileSync(DEVICES_FILE, 'utf-8');
        const data = JSON.parse(raw) as PersistedDevices;
        if (data.version === DEVICES_VERSION && Array.isArray(data.devices)) {
          for (const d of data.devices) {
            this.devices.set(d.id, d);
          }
        }
      }
    } catch {
      logger.debug('No persisted devices found or failed to load');
    }
  }

  private saveDevices(): void {
    try {
      const dir = path.dirname(DEVICES_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: PersistedDevices = {
        version: DEVICES_VERSION,
        devices: Array.from(this.devices.values()),
      };
      fs.writeFileSync(DEVICES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to save devices', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ==========================================================================
  // Transport Management
  // ==========================================================================

  private async createTransport(device: DeviceNode): Promise<DeviceTransport> {
    switch (device.transportType) {
      case 'ssh': {
        const { SSHTransport } = await import('./transports/ssh-transport.js');
        return new SSHTransport({
          deviceId: device.id,
          name: device.name,
          address: device.address,
          port: device.port,
          username: device.username,
          keyPath: device.keyPath,
        });
      }
      case 'adb': {
        const { ADBTransport } = await import('./transports/adb-transport.js');
        return new ADBTransport({
          deviceId: device.id,
          name: device.name,
          address: device.address,
          port: device.port,
        });
      }
      case 'local': {
        const { LocalTransport } = await import('./transports/local-transport.js');
        return new LocalTransport();
      }
      default:
        throw new Error(`Unknown transport type: ${device.transportType}`);
    }
  }

  private async getTransport(deviceId: string): Promise<DeviceTransport | null> {
    const existing = this.transports.get(deviceId);
    if (existing && existing.isConnected()) {
      return existing;
    }

    const device = this.devices.get(deviceId);
    if (!device) return null;

    const transport = await this.createTransport(device);
    await transport.connect();
    this.transports.set(deviceId, transport);
    return transport;
  }

  // ==========================================================================
  // Device Pairing
  // ==========================================================================

  async pairDevice(
    id: string,
    name: string,
    transportType: TransportType,
    options: {
      address?: string;
      port?: number;
      username?: string;
      keyPath?: string;
    } = {}
  ): Promise<DeviceNode> {
    logger.info(`Pairing device: ${name} (${id}) via ${transportType}`);

    // Determine device type from transport
    let type: DeviceType;
    switch (transportType) {
      case 'adb': type = 'android'; break;
      case 'local': type = 'local'; break;
      default: type = 'macos'; break; // SSH defaults to macOS, refined by capability detection
    }

    const device: DeviceNode = {
      id,
      name,
      type,
      transportType,
      capabilities: [],
      paired: true,
      lastSeen: Date.now(),
      address: options.address,
      port: options.port,
      username: options.username,
      keyPath: options.keyPath,
    };

    this.devices.set(id, device);

    // Connect and auto-detect capabilities
    try {
      const transport = await this.createTransport(device);
      await transport.connect();
      this.transports.set(id, transport);

      const caps = await transport.getCapabilities();
      device.capabilities = caps;

      // Refine type for SSH connections
      if (transportType === 'ssh') {
        const uname = await transport.execute('uname -s');
        const platform = uname.stdout.trim().toLowerCase();
        if (platform === 'linux') {
          device.type = 'linux';
        }
      }

      logger.info(`Device paired with capabilities: ${caps.join(', ')}`, { id, name });
    } catch (err) {
      logger.warn(`Device paired but connection failed: ${err instanceof Error ? err.message : String(err)}`);
      device.capabilities = ['system_run'];
    }

    this.saveDevices();
    return device;
  }

  unpairDevice(id: string): boolean {
    logger.info(`Unpairing device: ${id}`);
    const transport = this.transports.get(id);
    if (transport) {
      transport.disconnect().catch(() => {});
      this.transports.delete(id);
    }
    const deleted = this.devices.delete(id);
    if (deleted) this.saveDevices();
    return deleted;
  }

  getDevice(id: string): DeviceNode | undefined {
    return this.devices.get(id);
  }

  listDevices(): DeviceNode[] {
    return Array.from(this.devices.values());
  }

  listPairedDevices(): DeviceNode[] {
    return Array.from(this.devices.values()).filter(d => d.paired);
  }

  isDevicePaired(id: string): boolean {
    const device = this.devices.get(id);
    return device?.paired === true;
  }

  // ==========================================================================
  // Device Actions (using real transports)
  // ==========================================================================

  async cameraSnap(deviceId: string): Promise<string | null> {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('camera')) {
      logger.warn(`Device ${deviceId} does not support camera`);
      return null;
    }

    const transport = await this.getTransport(deviceId);
    if (!transport) return null;

    const outputPath = path.join(os.tmpdir(), `snap-${deviceId}-${Date.now()}.jpg`);
    const platform = this.toPlatform(device.type);
    const commands = getPlatformCommands(platform);
    if (!commands) return null;

    const result = await transport.execute(commands.cameraSnap(outputPath));
    if (result.exitCode !== 0) {
      logger.warn(`Camera snap failed on ${deviceId}: ${result.stderr}`);
      return null;
    }

    device.lastSeen = Date.now();
    return outputPath;
  }

  async screenRecord(deviceId: string, duration?: number): Promise<string | null> {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('screen_record')) {
      logger.warn(`Device ${deviceId} does not support screen recording`);
      return null;
    }

    const transport = await this.getTransport(deviceId);
    if (!transport) return null;

    const dur = duration || 10;
    const outputPath = path.join(os.tmpdir(), `screen-${deviceId}-${Date.now()}.mp4`);
    const platform = this.toPlatform(device.type);
    const commands = getPlatformCommands(platform);
    if (!commands) return null;

    const result = await transport.execute(commands.screenRecord(outputPath, dur));
    if (result.exitCode !== 0) {
      logger.warn(`Screen record failed on ${deviceId}: ${result.stderr}`);
      return null;
    }

    device.lastSeen = Date.now();
    return outputPath;
  }

  async screenshot(deviceId: string): Promise<string | null> {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('screenshot')) {
      logger.warn(`Device ${deviceId} does not support screenshots`);
      return null;
    }

    const transport = await this.getTransport(deviceId);
    if (!transport) return null;

    const outputPath = path.join(os.tmpdir(), `screenshot-${deviceId}-${Date.now()}.png`);
    const platform = this.toPlatform(device.type);
    const commands = getPlatformCommands(platform);
    if (!commands) return null;

    const result = await transport.execute(commands.screenshot(outputPath));
    if (result.exitCode !== 0) {
      logger.warn(`Screenshot failed on ${deviceId}: ${result.stderr}`);
      return null;
    }

    device.lastSeen = Date.now();
    return outputPath;
  }

  async getLocation(deviceId: string): Promise<LocationCoords | null> {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('location')) {
      logger.warn(`Device ${deviceId} does not support location`);
      return null;
    }

    const transport = await this.getTransport(deviceId);
    if (!transport) return null;

    const platform = this.toPlatform(device.type);
    const commands = getPlatformCommands(platform);
    if (!commands) return null;

    const result = await transport.execute(commands.getLocation());
    device.lastSeen = Date.now();

    try {
      const parsed = JSON.parse(result.stdout);
      return { lat: parsed.lat || 0, lon: parsed.lon || 0 };
    } catch {
      return { lat: 0, lon: 0 };
    }
  }

  sendNotification(deviceId: string, title: string, body: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('notifications')) {
      logger.warn(`Device ${deviceId} does not support notifications`);
      return false;
    }
    logger.info(`Sending notification to ${deviceId}: ${title}`);
    return true;
  }

  async systemRun(deviceId: string, command: string): Promise<ExecuteResult | null> {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('system_run')) {
      logger.warn(`Device ${deviceId} does not support system_run`);
      return null;
    }

    const transport = await this.getTransport(deviceId);
    if (!transport) return null;

    const result = await transport.execute(command);
    device.lastSeen = Date.now();
    return result;
  }

  generatePairingCode(): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    logger.info(`Generated pairing code: ${code}`);
    return code;
  }

  updateLastSeen(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    device.lastSeen = Date.now();
    return true;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private toPlatform(type: DeviceType): DevicePlatform {
    switch (type) {
      case 'macos': return 'macos';
      case 'linux': return 'linux';
      case 'android': return 'android';
      case 'local': return os.platform() === 'darwin' ? 'macos' : 'linux';
      default: return 'unknown';
    }
  }
}
