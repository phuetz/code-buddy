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
import * as crypto from 'crypto';
import { logger } from '../utils/logger.js';
import type { DeviceTransport, ExecuteResult } from './transports/base-transport.js';
import { getPlatformCommands, type DevicePlatform } from './platform-commands.js';

// ============================================================================
// Types
// ============================================================================

export type DeviceType = 'macos' | 'linux' | 'android' | 'local';

export type DeviceCapability =
  | 'camera' | 'camera_list' | 'camera_snap'
  | 'screen_record' | 'screenshot'
  | 'location' | 'location_tracking'
  | 'notifications' | 'notification_send' | 'notification_list'
  | 'system_run' | 'system_info'
  | 'file_transfer' | 'file_browse'
  | 'contacts' | 'contacts_search'
  | 'calendar' | 'calendar_events'
  | 'sensors' | 'sensor_data'
  | 'battery' | 'network_info'
  | 'clipboard' | 'input_text'
  | 'app_list' | 'app_launch';

export type TransportType = 'ssh' | 'adb' | 'local';

export interface PairingToken {
  /** Cryptographically random token */
  token: string;
  /** When the token was created */
  createdAt: number;
  /** When the token expires (default: 5 minutes) */
  expiresAt: number;
  /** Whether the token has been consumed */
  consumed: boolean;
}

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
  /** Ephemeral pairing token (replaces static code) */
  pairingToken?: PairingToken;
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
/** Pairing token expiry: 5 minutes */
const PAIRING_TOKEN_TTL_MS = 5 * 60 * 1000;
/** Pairing token length in bytes (produces 32-char hex string) */
const PAIRING_TOKEN_BYTES = 16;

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
    let transport: DeviceTransport | null = null;
    try {
      transport = await this.createTransport(device);
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
      const message = err instanceof Error ? err.message : String(err);
      if (transport) {
        await transport.disconnect().catch(() => {});
      }
      this.transports.delete(id);
      this.devices.delete(id);
      logger.warn(`Device pairing failed: ${message}`, { id, name, transportType });
      throw new Error(`Device pairing failed for ${name} (${id}): ${message}`);
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
    const locationCommand = commands?.getLocation?.();
    if (!locationCommand) {
      logger.warn(`Device ${deviceId} has no implemented location command for platform ${platform}`);
      return null;
    }

    const result = await transport.execute(locationCommand);
    if (result.exitCode !== 0) {
      logger.warn(`Location lookup failed on ${deviceId}: ${result.stderr}`);
      return null;
    }

    try {
      const parsed = JSON.parse(result.stdout) as { lat?: unknown; lon?: unknown; latitude?: unknown; longitude?: unknown };
      const lat = Number(parsed.lat ?? parsed.latitude);
      const lon = Number(parsed.lon ?? parsed.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        logger.warn(`Location lookup returned invalid coordinates for ${deviceId}`);
        return null;
      }
      device.lastSeen = Date.now();
      return { lat, lon };
    } catch {
      logger.warn(`Location lookup returned non-JSON output for ${deviceId}`);
      return null;
    }
  }

  sendNotification(deviceId: string, title: string, body: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device || !device.capabilities.includes('notifications')) {
      logger.warn(`Device ${deviceId} does not support notifications`);
      return false;
    }
    logger.warn('Device notifications are not implemented through DeviceNodeManager transports', {
      deviceId,
      title,
      body,
    });
    return false;
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

  /**
   * @deprecated Use generatePairingToken() instead for ephemeral cryptographic tokens.
   */
  generatePairingCode(): string {
    return this.generatePairingToken().token;
  }

  /**
   * Generate an ephemeral, cryptographically random pairing token.
   * Token auto-expires after PAIRING_TOKEN_TTL_MS (5 minutes).
   * Each call rotates any previous token for the same flow.
   */
  generatePairingToken(): PairingToken {
    const token: PairingToken = {
      token: crypto.randomBytes(PAIRING_TOKEN_BYTES).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_TOKEN_TTL_MS,
      consumed: false,
    };
    logger.debug(`Generated pairing token (expires in ${PAIRING_TOKEN_TTL_MS / 1000}s)`);
    return token;
  }

  /**
   * Validate a pairing token: checks expiry and single-use.
   */
  validatePairingToken(token: PairingToken, providedToken: string): boolean {
    if (token.consumed) {
      logger.warn('Pairing token already consumed');
      return false;
    }
    if (Date.now() > token.expiresAt) {
      logger.warn('Pairing token expired');
      return false;
    }
    // Timing-safe comparison
    const expected = Buffer.from(token.token, 'utf-8');
    const actual = Buffer.from(providedToken, 'utf-8');
    if (expected.length !== actual.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, actual);
  }

  /**
   * Consume a pairing token (mark as used, preventing replay).
   */
  consumePairingToken(token: PairingToken): void {
    token.consumed = true;
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
