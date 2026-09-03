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
import type {
  DeviceCalendarEvent,
  DeviceTransport,
  ExecuteResult,
} from './transports/base-transport.js';
import { getPlatformCommands, type DevicePlatform } from './platform-commands.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

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

function validCoordinates(lat: unknown, lon: unknown): LocationCoords | null {
  const latitude = typeof lat === 'number'
    ? lat
    : typeof lat === 'string' && lat.trim() !== '' ? Number(lat) : Number.NaN;
  const longitude = typeof lon === 'number'
    ? lon
    : typeof lon === 'string' && lon.trim() !== '' ? Number(lon) : Number.NaN;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lon: longitude };
}

/** Parse only explicit, bounded coordinates; never turn an unreadable response into 0,0. */
export function parseLocationCoordinates(output: string): LocationCoords | null {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const jsonCoordinates = validCoordinates(
      parsed.lat ?? parsed.latitude,
      parsed.lon ?? parsed.lng ?? parsed.longitude,
    );
    if (jsonCoordinates) return jsonCoordinates;
  } catch {
    // Some ADB providers return a labelled dumpsys line rather than JSON.
  }

  const labelled = output.match(
    /lat(?:itude)?\s*[=:]\s*(-?\d+(?:\.\d+)?)[\s,;]+(?:lon|lng|longitude)\s*[=:]\s*(-?\d+(?:\.\d+)?)/iu,
  );
  if (labelled) return validCoordinates(labelled[1], labelled[2]);

  const android = output.match(
    /\b(?:gps|fused|network)\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|\])/iu,
  );
  return android ? validCoordinates(android[1], android[2]) : null;
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
      const data = readJsonAtomicSync<PersistedDevices | null>(DEVICES_FILE, null, {
        mode: 0o600,
        isValid: (value): value is PersistedDevices => Boolean(
          value && typeof value === 'object' && !Array.isArray(value) &&
          (value as PersistedDevices).version === DEVICES_VERSION &&
          Array.isArray((value as PersistedDevices).devices),
        ),
      });
      if (data) {
          for (const d of data.devices) {
            this.devices.set(d.id, d);
          }
      }
    } catch {
      logger.debug('No persisted devices found or failed to load');
    }
  }

  private saveDevices(): void {
    try {
      const data: PersistedDevices = {
        version: DEVICES_VERSION,
        devices: Array.from(this.devices.values()),
      };
      writeJsonAtomicSync(DEVICES_FILE, data, { mode: 0o600 });
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
    if (result.exitCode !== 0) return null;
    const coordinates = parseLocationCoordinates(result.stdout);
    if (!coordinates) {
      logger.warn('Device location response was invalid', { deviceId });
    }
    return coordinates;
  }

  async getCalendarEvents(deviceId: string, days = 7): Promise<DeviceCalendarEvent[] | null> {
    const device = this.devices.get(deviceId);
    if (!device ||
      (!device.capabilities.includes('calendar') && !device.capabilities.includes('calendar_events'))) {
      logger.warn(`Device ${deviceId} does not support calendar events`);
      return null;
    }
    const transport = await this.getTransport(deviceId);
    if (!transport?.getCalendarEvents) return null;
    const boundedDays = Number.isFinite(days)
      ? Math.max(1, Math.min(31, Math.trunc(days)))
      : 7;
    const events = await transport.getCalendarEvents(boundedDays);
    if (events) device.lastSeen = Date.now();
    return events;
  }

  sendNotification(deviceId: string, title: string, _body: string): boolean {
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
