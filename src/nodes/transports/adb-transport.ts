/**
 * ADB Transport
 *
 * Executes commands and transfers files to Android devices via ADB.
 * Uses spawn('adb', ...) for all operations.
 */

import { spawn } from 'child_process';
import type {
  DeviceTransport,
  DeviceCapability,
  ExecuteResult,
  ExecuteOptions,
  TransportConfig,
} from './base-transport.js';
import { logger } from '../../utils/logger.js';

export class ADBTransport implements DeviceTransport {
  readonly type = 'adb' as const;
  private connected = false;
  private config: TransportConfig;

  constructor(config: TransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // If address is provided, connect to network device
    if (this.config.address) {
      const target = this.config.port
        ? `${this.config.address}:${this.config.port}`
        : this.config.address;
      const result = await this.adb(['connect', target]);
      if (result.exitCode !== 0 && !result.stdout.includes('connected')) {
        throw new Error(`ADB connect failed: ${result.stderr || result.stdout}`);
      }
    }

    // Verify device is accessible
    const result = await this.adb(['shell', 'echo', 'connected']);
    if (result.exitCode !== 0) {
      throw new Error(`ADB device not accessible: ${result.stderr}`);
    }
    this.connected = true;
    logger.info('ADB transport connected', { device: this.config.deviceId });
  }

  async disconnect(): Promise<void> {
    if (this.config.address) {
      const target = this.config.port
        ? `${this.config.address}:${this.config.port}`
        : this.config.address;
      await this.adb(['disconnect', target]);
    }
    this.connected = false;
    logger.info('ADB transport disconnected', { device: this.config.deviceId });
  }

  async execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult> {
    const args = this.baseArgs();
    const timeout = options?.timeout ?? 30000;

    let fullCommand = command;
    if (options?.cwd) {
      fullCommand = `cd ${options.cwd} && ${command}`;
    }

    args.push('shell', fullCommand);

    return new Promise<ExecuteResult>((resolve) => {
      const proc = spawn('adb', args, { timeout });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
      });

      proc.on('error', (err) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });
    });
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const args = this.baseArgs();
    args.push('push', localPath, remotePath);

    const result = await this.adb(args);
    if (result.exitCode !== 0) {
      throw new Error(`ADB push failed: ${result.stderr}`);
    }
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const args = this.baseArgs();
    args.push('pull', remotePath, localPath);

    const result = await this.adb(args);
    if (result.exitCode !== 0) {
      throw new Error(`ADB pull failed: ${result.stderr}`);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getCapabilities(): Promise<DeviceCapability[]> {
    return [
      'system_run', 'system_info', 'file_transfer', 'file_browse',
      'screenshot', 'screen_record',
      'camera', 'camera_list', 'camera_snap',
      'notification_list',
      'contacts', 'contacts_search',
      'calendar', 'calendar_events',
      'sensors', 'sensor_data',
      'battery', 'network_info',
      'clipboard', 'input_text',
      'app_list', 'app_launch',
    ];
  }

  // ==========================================================================
  // Android Platform APIs
  // ==========================================================================

  /**
   * List available cameras on the device.
   */
  async listCameras(): Promise<{ id: string; facing: string }[]> {
    const result = await this.execute(
      'dumpsys media.camera | grep -E "Camera ID|Facing"'
    );
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return [];
    }

    const cameras: { id: string; facing: string }[] = [];
    const lines = result.stdout.split('\n');
    let currentId = '';
    for (const line of lines) {
      const idMatch = line.match(/Camera ID[:\s]+(\d+)/i);
      if (idMatch) {
        currentId = idMatch[1];
      }
      const facingMatch = line.match(/Facing[:\s]+(BACK|FRONT|EXTERNAL)/i);
      if (facingMatch && currentId) {
        cameras.push({ id: currentId, facing: facingMatch[1].toLowerCase() });
        currentId = '';
      }
    }
    return cameras;
  }

  /**
   * Capture a photo using the device camera.
   * Returns the remote file path of the captured image.
   */
  async capturePhoto(cameraId?: string): Promise<string> {
    const remotePath = `/sdcard/DCIM/codebuddy_snap_${Date.now()}.jpg`;
    // Use am start with intent to capture
    const cameraArg = cameraId
      ? `--ei android.intent.extras.CAMERA_FACING ${cameraId === '1' ? '1' : '0'}`
      : '';
    const captureCmd = [
      `am start -a android.media.action.STILL_IMAGE_CAMERA ${cameraArg}`,
      'sleep 2',
      `screencap -p ${remotePath}`,
    ].join(' && ');

    const result = await this.execute(captureCmd);
    if (result.exitCode !== 0) {
      logger.warn('Camera capture failed', { stderr: result.stderr });
      throw new Error(`Camera capture failed: ${result.stderr}`);
    }
    return remotePath;
  }

  /**
   * List device contacts (requires appropriate permissions).
   */
  async listContacts(query?: string): Promise<{ name: string; phone?: string; email?: string }[]> {
    const cmd = query
      ? `content query --uri content://com.android.contacts/contacts --projection display_name --where "display_name LIKE '%${query.replace(/'/g, "''")}%'"`
      : 'content query --uri content://com.android.contacts/contacts --projection display_name';

    const result = await this.execute(cmd);
    if (result.exitCode !== 0) {
      logger.warn('Failed to list contacts', { stderr: result.stderr });
      return [];
    }

    const contacts: { name: string; phone?: string; email?: string }[] = [];
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const nameMatch = line.match(/display_name=([^,\n]+)/);
      if (nameMatch) {
        contacts.push({ name: nameMatch[1].trim() });
      }
    }
    return contacts;
  }

  /**
   * Get calendar events for the next N days.
   */
  async getCalendarEvents(days: number = 7): Promise<{ title: string; start: string; end: string }[]> {
    const now = Date.now();
    const end = now + days * 24 * 60 * 60 * 1000;
    const cmd = `content query --uri content://com.android.calendar/events --projection title:dtstart:dtend --where "dtstart>=${now} AND dtend<=${end}" --sort "dtstart ASC"`;

    const result = await this.execute(cmd);
    if (result.exitCode !== 0) {
      logger.warn('Failed to get calendar events', { stderr: result.stderr });
      return [];
    }

    const events: { title: string; start: string; end: string }[] = [];
    const lines = result.stdout.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      const titleMatch = line.match(/title=([^,]+)/);
      const startMatch = line.match(/dtstart=(\d+)/);
      const endMatch = line.match(/dtend=(\d+)/);
      if (titleMatch) {
        events.push({
          title: titleMatch[1].trim(),
          start: startMatch ? new Date(parseInt(startMatch[1])).toISOString() : '',
          end: endMatch ? new Date(parseInt(endMatch[1])).toISOString() : '',
        });
      }
    }
    return events;
  }

  /**
   * List current notifications on the device.
   */
  async listNotifications(): Promise<{ app: string; title: string; text: string; time: number }[]> {
    const result = await this.execute('dumpsys notification --noredact');
    if (result.exitCode !== 0) {
      logger.warn('Failed to list notifications', { stderr: result.stderr });
      return [];
    }

    const notifications: { app: string; title: string; text: string; time: number }[] = [];
    const blocks = result.stdout.split(/NotificationRecord\(/);

    for (const block of blocks) {
      const pkgMatch = block.match(/pkg=([^\s]+)/);
      const titleMatch = block.match(/android\.title=([^\n]+)/);
      const textMatch = block.match(/android\.text=([^\n]+)/);
      const timeMatch = block.match(/postTime=(\d+)/);

      if (pkgMatch) {
        notifications.push({
          app: pkgMatch[1],
          title: titleMatch ? titleMatch[1].trim() : '',
          text: textMatch ? textMatch[1].trim() : '',
          time: timeMatch ? parseInt(timeMatch[1]) : 0,
        });
      }
    }
    return notifications;
  }

  /**
   * Read sensor data from the device.
   */
  async getSensorData(sensor: string): Promise<Record<string, number>> {
    const result = await this.execute(
      `dumpsys sensorservice | grep -A 5 "${sensor}"`
    );
    if (result.exitCode !== 0) {
      logger.warn('Failed to get sensor data', { sensor, stderr: result.stderr });
      return {};
    }

    const data: Record<string, number> = {};
    const regex = /(\w+)\s*=\s*([-\d.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(result.stdout)) !== null) {
      data[match[1]] = parseFloat(match[2]);
    }
    return data;
  }

  /**
   * Get battery information.
   */
  async getBatteryInfo(): Promise<{ level: number; charging: boolean; temperature: number }> {
    const result = await this.execute('dumpsys battery');
    if (result.exitCode !== 0) {
      logger.warn('Failed to get battery info', { stderr: result.stderr });
      return { level: -1, charging: false, temperature: 0 };
    }

    const output = result.stdout;
    const levelMatch = output.match(/level:\s*(\d+)/);
    const statusMatch = output.match(/status:\s*(\d+)/);
    const tempMatch = output.match(/temperature:\s*(\d+)/);

    return {
      level: levelMatch ? parseInt(levelMatch[1]) : -1,
      // Status 2 = charging, 5 = full
      charging: statusMatch ? [2, 5].includes(parseInt(statusMatch[1])) : false,
      // Temperature is in tenths of a degree
      temperature: tempMatch ? parseInt(tempMatch[1]) / 10 : 0,
    };
  }

  /**
   * Get network connection info.
   */
  async getNetworkInfo(): Promise<{ type: string; ssid?: string; ip?: string }> {
    const result = await this.execute('dumpsys connectivity | head -30');
    if (result.exitCode !== 0) {
      return { type: 'unknown' };
    }

    const output = result.stdout;
    let type = 'unknown';
    if (output.includes('WIFI')) type = 'wifi';
    else if (output.includes('MOBILE')) type = 'mobile';
    else if (output.includes('ETHERNET')) type = 'ethernet';

    // Get Wi-Fi SSID
    let ssid: string | undefined;
    const wifiResult = await this.execute('dumpsys wifi | grep "mWifiInfo"');
    if (wifiResult.exitCode === 0) {
      const ssidMatch = wifiResult.stdout.match(/SSID:\s*"?([^",\s]+)"?/);
      if (ssidMatch) ssid = ssidMatch[1];
    }

    // Get IP address
    let ip: string | undefined;
    const ipResult = await this.execute('ip addr show wlan0 | grep "inet "');
    if (ipResult.exitCode === 0) {
      const ipMatch = ipResult.stdout.match(/inet\s+([\d.]+)/);
      if (ipMatch) ip = ipMatch[1];
    }

    return { type, ssid, ip };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private baseArgs(): string[] {
    const args: string[] = [];
    if (this.config.deviceId) {
      args.push('-s', this.config.deviceId);
    }
    return args;
  }

  private adb(args: string[]): Promise<ExecuteResult> {
    return new Promise<ExecuteResult>((resolve) => {
      const proc = spawn('adb', args, { timeout: 30000 });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ exitCode: code ?? 1, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() });
      });

      proc.on('error', (err) => {
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });
    });
  }
}
