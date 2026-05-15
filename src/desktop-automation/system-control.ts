/**
 * System Control Module
 *
 * Enterprise-grade system-level controls for desktop automation.
 * Cross-platform support for Linux, macOS, and Windows.
 *
 * Features:
 * - Volume control (get/set/mute)
 * - Brightness control
 * - System notifications
 * - Power management (sleep, lock, shutdown)
 * - Display management
 * - Network status
 */

import { execSync, exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export interface VolumeInfo {
  level: number; // 0-100
  muted: boolean;
  device?: string;
}

export interface BrightnessInfo {
  level: number; // 0-100
  display?: string;
}

export interface NotificationOptions {
  title: string;
  body: string;
  icon?: string;
  sound?: boolean;
  timeout?: number; // ms
  urgency?: 'low' | 'normal' | 'critical';
  actions?: Array<{ id: string; label: string }>;
}

export interface NotificationResult {
  id: string;
  sent: boolean;
  error?: string;
}

export interface PowerAction {
  type: 'sleep' | 'lock' | 'shutdown' | 'restart' | 'hibernate' | 'logout';
  delay?: number; // seconds
  force?: boolean;
}

export interface DisplayInfo {
  id: string;
  name: string;
  resolution: { width: number; height: number };
  refreshRate: number;
  primary: boolean;
  connected: boolean;
  brightness?: number;
}

export interface NetworkInfo {
  connected: boolean;
  type?: 'wifi' | 'ethernet' | 'cellular' | 'unknown';
  ssid?: string;
  ip?: string;
  gateway?: string;
}

export interface BatteryInfo {
  present: boolean;
  charging: boolean;
  level: number; // 0-100
  timeRemaining?: number; // minutes
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  memory: {
    total: number;
    free: number;
    used: number;
  };
  cpu: {
    model: string;
    cores: number;
    usage?: number;
  };
}

// ============================================================================
// Platform Detection
// ============================================================================

type Platform = 'darwin' | 'linux' | 'win32';

function getPlatform(): Platform {
  return process.platform as Platform;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRequiredNumber(raw: string, context: string): number {
  const value = Number.parseFloat(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`Unable to parse ${context}: ${JSON.stringify(raw.trim())}`);
  }
  return value;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

// ============================================================================
// System Control Class
// ============================================================================

export class SystemControl extends EventEmitter {
  private platform: Platform;

  constructor() {
    super();
    this.platform = getPlatform();
  }

  // ============================================================================
  // Volume Control
  // ============================================================================

  /**
   * Get current volume level
   */
  async getVolume(): Promise<VolumeInfo> {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSVolume();
      case 'linux':
        return this.getLinuxVolume();
      case 'win32':
        return this.getWindowsVolume();
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Set volume level (0-100)
   */
  async setVolume(level: number): Promise<void> {
    const clampedLevel = Math.max(0, Math.min(100, level));

    switch (this.platform) {
      case 'darwin':
        await this.setMacOSVolume(clampedLevel);
        break;
      case 'linux':
        await this.setLinuxVolume(clampedLevel);
        break;
      case 'win32':
        await this.setWindowsVolume(clampedLevel);
        break;
    }

    this.emit('volume-changed', { level: clampedLevel });
  }

  /**
   * Mute/unmute audio
   */
  async setMute(muted: boolean): Promise<void> {
    switch (this.platform) {
      case 'darwin':
        await this.setMacOSMute(muted);
        break;
      case 'linux':
        await this.setLinuxMute(muted);
        break;
      case 'win32':
        await this.setWindowsMute(muted);
        break;
    }

    this.emit('mute-changed', { muted });
  }

  /**
   * Toggle mute state
   */
  async toggleMute(): Promise<boolean> {
    const current = await this.getVolume();
    await this.setMute(!current.muted);
    return !current.muted;
  }

  // ============================================================================
  // Brightness Control
  // ============================================================================

  /**
   * Get current brightness level
   */
  async getBrightness(): Promise<BrightnessInfo> {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSBrightness();
      case 'linux':
        return this.getLinuxBrightness();
      case 'win32':
        return this.getWindowsBrightness();
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  /**
   * Set brightness level (0-100)
   */
  async setBrightness(level: number): Promise<void> {
    const clampedLevel = Math.max(0, Math.min(100, level));

    switch (this.platform) {
      case 'darwin':
        await this.setMacOSBrightness(clampedLevel);
        break;
      case 'linux':
        await this.setLinuxBrightness(clampedLevel);
        break;
      case 'win32':
        await this.setWindowsBrightness(clampedLevel);
        break;
    }

    this.emit('brightness-changed', { level: clampedLevel });
  }

  // ============================================================================
  // Notifications
  // ============================================================================

  /**
   * Send system notification
   */
  async notify(options: NotificationOptions): Promise<NotificationResult> {
    const id = `notif-${Date.now()}`;

    try {
      switch (this.platform) {
        case 'darwin':
          await this.notifyMacOS(options);
          break;
        case 'linux':
          await this.notifyLinux(options);
          break;
        case 'win32':
          await this.notifyWindows(options);
          break;
      }

      this.emit('notification-sent', { id, options });
      return { id, sent: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { id, sent: false, error: errorMessage };
    }
  }

  // ============================================================================
  // Power Management
  // ============================================================================

  /**
   * Execute power action
   */
  async power(action: PowerAction): Promise<void> {
    logger.info('Executing power action', { action });

    const delay = action.delay || 0;

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }

    switch (this.platform) {
      case 'darwin':
        await this.powerMacOS(action);
        break;
      case 'linux':
        await this.powerLinux(action);
        break;
      case 'win32':
        await this.powerWindows(action);
        break;
    }

    this.emit('power-action', { action });
  }

  /**
   * Lock the screen
   */
  async lock(): Promise<void> {
    await this.power({ type: 'lock' });
  }

  /**
   * Put system to sleep
   */
  async sleep(): Promise<void> {
    await this.power({ type: 'sleep' });
  }

  // ============================================================================
  // Display Info
  // ============================================================================

  /**
   * Get display information
   */
  async getDisplays(): Promise<DisplayInfo[]> {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSDisplays();
      case 'linux':
        return this.getLinuxDisplays();
      case 'win32':
        return this.getWindowsDisplays();
      default:
        return [];
    }
  }

  // ============================================================================
  // Network Status
  // ============================================================================

  /**
   * Get network status
   */
  async getNetworkStatus(): Promise<NetworkInfo> {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSNetwork();
      case 'linux':
        return this.getLinuxNetwork();
      case 'win32':
        return this.getWindowsNetwork();
      default:
        return { connected: false };
    }
  }

  // ============================================================================
  // Battery Status
  // ============================================================================

  /**
   * Get battery information
   */
  async getBattery(): Promise<BatteryInfo> {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSBattery();
      case 'linux':
        return this.getLinuxBattery();
      case 'win32':
        return this.getWindowsBattery();
      default:
        return { present: false, charging: false, level: 0 };
    }
  }

  // ============================================================================
  // System Info
  // ============================================================================

  /**
   * Get system information
   */
  async getSystemInfo(): Promise<SystemInfo> {
    const os = await import('os');

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
      },
      cpu: {
        model: os.cpus()[0]?.model || 'Unknown',
        cores: os.cpus().length,
      },
    };
  }

  // ============================================================================
  // macOS Implementation
  // ============================================================================

  private async getMacOSVolume(): Promise<VolumeInfo> {
    try {
      const output = execSync(
        `osascript -e 'output volume of (get volume settings)'`,
        { encoding: 'utf-8' }
      );
      const mutedOutput = execSync(
        `osascript -e 'output muted of (get volume settings)'`,
        { encoding: 'utf-8' }
      );
      const level = parseRequiredNumber(output, 'macOS volume');

      return {
        level,
        muted: mutedOutput.trim() === 'true',
      };
    } catch (error) {
      logger.error('Failed to get macOS volume', { error });
      throw new Error(`Failed to get macOS volume: ${getErrorMessage(error)}`);
    }
  }

  private async setMacOSVolume(level: number): Promise<void> {
    execSync(`osascript -e 'set volume output volume ${level}'`);
  }

  private async setMacOSMute(muted: boolean): Promise<void> {
    execSync(`osascript -e 'set volume output muted ${muted}'`);
  }

  private async getMacOSBrightness(): Promise<BrightnessInfo> {
    try {
      // Try using brightness command if available
      const output = execSync(`brightness -l 2>/dev/null | grep 'display' | head -1 | awk '{print $4}'`, {
        encoding: 'utf-8',
      });
      const level = parseRequiredNumber(output, 'macOS brightness') * 100;
      return { level: Math.round(level) };
    } catch (error) {
      throw new Error(`Failed to get macOS brightness: ${getErrorMessage(error)}`);
    }
  }

  private async setMacOSBrightness(level: number): Promise<void> {
    try {
      const brightnessValue = level / 100;
      execSync(`brightness ${brightnessValue} 2>/dev/null`);
    } catch (error) {
      throw new Error(`Failed to set macOS brightness: ${getErrorMessage(error)}`);
    }
  }

  private async notifyMacOS(options: NotificationOptions): Promise<void> {
    const title = options.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const body = options.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let script = `display notification "${body}" with title "${title}"`;
    if (options.sound) {
      script += ' sound name "default"';
    }

    execFileSync('osascript', ['-e', script]);
  }

  private async powerMacOS(action: PowerAction): Promise<void> {
    switch (action.type) {
      case 'sleep':
        execSync('pmset sleepnow');
        break;
      case 'lock':
        execSync('osascript -e \'tell application "System Events" to keystroke "q" using {control down, command down}\'');
        break;
      case 'shutdown':
        execSync(`osascript -e 'tell app "System Events" to shut down'`);
        break;
      case 'restart':
        execSync(`osascript -e 'tell app "System Events" to restart'`);
        break;
      case 'logout':
        execSync(`osascript -e 'tell app "System Events" to log out'`);
        break;
    }
  }

  private async getMacOSDisplays(): Promise<DisplayInfo[]> {
    try {
      const output = execSync(`system_profiler SPDisplaysDataType -json`, { encoding: 'utf-8' });
      const data = JSON.parse(output);
      const displays: DisplayInfo[] = [];

      const graphics = data.SPDisplaysDataType || [];
      for (const gpu of graphics) {
        const ndrvs = gpu.spdisplays_ndrvs || [];
        for (let i = 0; i < ndrvs.length; i++) {
          const display = ndrvs[i];
          const resolution = display._spdisplays_resolution || '';
          const [width, height] = resolution.split(' x ').map((s: string) => parseInt(s, 10));

          if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
            logger.debug('Skipping macOS display with invalid resolution', { display });
            continue;
          }

          displays.push({
            id: `display-${i}`,
            name: display._name || `Display ${i + 1}`,
            resolution: { width, height },
            refreshRate: 60,
            primary: i === 0,
            connected: true,
          });
        }
      }

      return displays;
    } catch (error) {
      logger.warn('Failed to get macOS displays', { error });
      return [];
    }
  }

  private async getMacOSNetwork(): Promise<NetworkInfo> {
    try {
      const output = execSync(`networksetup -getinfo Wi-Fi 2>/dev/null || networksetup -getinfo Ethernet`, {
        encoding: 'utf-8',
      });

      const ipMatch = output.match(/IP address: ([\d.]+)/);
      const routerMatch = output.match(/Router: ([\d.]+)/);

      return {
        connected: !!ipMatch,
        type: output.includes('Wi-Fi') ? 'wifi' : 'ethernet',
        ip: ipMatch?.[1],
        gateway: routerMatch?.[1],
      };
    } catch {
      return { connected: false };
    }
  }

  private async getMacOSBattery(): Promise<BatteryInfo> {
    try {
      const output = execSync(`pmset -g batt`, { encoding: 'utf-8' });
      const percentMatch = output.match(/(\d+)%/);
      const charging = output.includes('AC Power') || output.includes('charging');

      return {
        present: true,
        charging,
        level: percentMatch ? parseInt(percentMatch[1], 10) : 0,
      };
    } catch {
      return { present: false, charging: false, level: 0 };
    }
  }

  // ============================================================================
  // Linux Implementation
  // ============================================================================

  private async getLinuxVolume(): Promise<VolumeInfo> {
    try {
      // Try pactl (PulseAudio) first, then amixer (ALSA)
      let output: string;
      let muted = false;

      try {
        output = execSync(`pactl get-sink-volume @DEFAULT_SINK@ | grep -oP '\\d+(?=%)' | head -1`, {
          encoding: 'utf-8',
        });
        const muteOutput = execSync(`pactl get-sink-mute @DEFAULT_SINK@`, { encoding: 'utf-8' });
        muted = muteOutput.includes('yes');
      } catch {
        output = execSync(`amixer sget Master | grep -oP '\\d+(?=%)' | head -1`, { encoding: 'utf-8' });
        const muteOutput = execSync(`amixer sget Master | grep -oP '\\[(on|off)\\]' | head -1`, { encoding: 'utf-8' });
        muted = muteOutput.includes('off');
      }

      const level = parseRequiredNumber(output, 'Linux volume');

      return {
        level,
        muted,
      };
    } catch (error) {
      logger.error('Failed to get Linux volume', { error });
      throw new Error(`Failed to get Linux volume: ${getErrorMessage(error)}`);
    }
  }

  private async setLinuxVolume(level: number): Promise<void> {
    try {
      execSync(`pactl set-sink-volume @DEFAULT_SINK@ ${level}%`);
    } catch {
      execSync(`amixer sset Master ${level}%`);
    }
  }

  private async setLinuxMute(muted: boolean): Promise<void> {
    try {
      execSync(`pactl set-sink-mute @DEFAULT_SINK@ ${muted ? 1 : 0}`);
    } catch {
      execSync(`amixer sset Master ${muted ? 'mute' : 'unmute'}`);
    }
  }

  private async getLinuxBrightness(): Promise<BrightnessInfo> {
    try {
      const maxBrightness = parseRequiredNumber(
        execSync(`cat /sys/class/backlight/*/max_brightness 2>/dev/null | head -1`, { encoding: 'utf-8' }),
        'Linux max brightness'
      );
      const currentBrightness = parseRequiredNumber(
        execSync(`cat /sys/class/backlight/*/brightness 2>/dev/null | head -1`, { encoding: 'utf-8' }),
        'Linux current brightness'
      );

      if (maxBrightness <= 0) {
        throw new Error('Linux max brightness is zero');
      }

      const level = Math.round((currentBrightness / maxBrightness) * 100);
      return { level };
    } catch (error) {
      throw new Error(`Failed to get Linux brightness: ${getErrorMessage(error)}`);
    }
  }

  private async setLinuxBrightness(level: number): Promise<void> {
    let xrandrError: unknown;
    try {
      // Try xrandr first
      const output = execSync(`xrandr --query | grep ' connected' | awk '{print $1}' | head -1`, {
        encoding: 'utf-8',
      });
      const display = output.trim();
      if (!display) {
        throw new Error('No connected display reported by xrandr');
      }
      if (!/^[a-zA-Z0-9\-_]+$/.test(display)) {
        throw new Error(`Unexpected xrandr display name: ${display}`);
      }
      execFileSync('xrandr', ['--output', display, '--brightness', String(level / 100)]);
      return;
    } catch (error) {
      xrandrError = error;
      try {
        // Try brightnessctl
        execSync(`brightnessctl set ${level}%`);
      } catch (brightnessError) {
        logger.warn('No brightness control available on Linux', { xrandrError, brightnessError });
        throw new Error(`Failed to set Linux brightness: ${getErrorMessage(brightnessError)}`);
      }
    }
  }

  private async notifyLinux(options: NotificationOptions): Promise<void> {
    const args = [
      `"${options.title}"`,
      `"${options.body}"`,
    ];

    if (options.icon) {
      args.push(`-i "${options.icon}"`);
    }

    if (options.timeout) {
      args.push(`-t ${options.timeout}`);
    }

    if (options.urgency) {
      args.push(`-u ${options.urgency}`);
    }

    execSync(`notify-send ${args.join(' ')}`);
  }

  private async powerLinux(action: PowerAction): Promise<void> {
    switch (action.type) {
      case 'sleep':
        execSync('systemctl suspend');
        break;
      case 'lock':
        try {
          execSync('loginctl lock-session');
        } catch {
          execSync('xdg-screensaver lock');
        }
        break;
      case 'shutdown':
        execSync('systemctl poweroff');
        break;
      case 'restart':
        execSync('systemctl reboot');
        break;
      case 'hibernate':
        execSync('systemctl hibernate');
        break;
      case 'logout':
        try {
          execSync('loginctl terminate-user $USER');
        } catch {
          execSync('pkill -KILL -u $USER');
        }
        break;
    }
  }

  private async getLinuxDisplays(): Promise<DisplayInfo[]> {
    try {
      const output = execSync(`xrandr --query`, { encoding: 'utf-8' });
      const displays: DisplayInfo[] = [];
      const lines = output.split('\n');

      let currentDisplay: Partial<DisplayInfo> | null = null;

      for (const line of lines) {
        const displayMatch = line.match(/^(\S+) connected (primary )?(\d+x\d+)/);
        if (displayMatch) {
          const [, name, primary, resolution] = displayMatch;
          const [width, height] = resolution.split('x').map(s => parseInt(s, 10));

          currentDisplay = {
            id: name,
            name,
            resolution: { width, height },
            primary: !!primary,
            connected: true,
            refreshRate: 60,
          };
          displays.push(currentDisplay as DisplayInfo);
        }
      }

      return displays;
    } catch (error) {
      logger.warn('Failed to get Linux displays', { error });
      return [];
    }
  }

  private async getLinuxNetwork(): Promise<NetworkInfo> {
    try {
      const output = execSync(`ip route get 1.1.1.1 2>/dev/null | head -1`, { encoding: 'utf-8' });
      const ipMatch = output.match(/src ([\d.]+)/);
      const gatewayMatch = output.match(/via ([\d.]+)/);
      const deviceMatch = output.match(/dev (\S+)/);

      let type: NetworkInfo['type'] = 'unknown';
      if (deviceMatch) {
        const device = deviceMatch[1];
        if (device.startsWith('wl')) type = 'wifi';
        else if (device.startsWith('eth') || device.startsWith('en')) type = 'ethernet';
      }

      return {
        connected: !!ipMatch,
        type,
        ip: ipMatch?.[1],
        gateway: gatewayMatch?.[1],
      };
    } catch {
      return { connected: false };
    }
  }

  private async getLinuxBattery(): Promise<BatteryInfo> {
    try {
      const status = execSync(`cat /sys/class/power_supply/BAT*/status 2>/dev/null | head -1`, {
        encoding: 'utf-8',
      }).trim();
      const capacity = execSync(`cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -1`, {
        encoding: 'utf-8',
      }).trim();

      return {
        present: true,
        charging: status === 'Charging' || status === 'Full',
        level: parseInt(capacity, 10) || 0,
      };
    } catch {
      return { present: false, charging: false, level: 0 };
    }
  }

  // ============================================================================
  // Windows Implementation
  // ============================================================================

  private async getWindowsVolume(): Promise<VolumeInfo> {
    try {
      const output = execSync(
        `powershell -Command "(Get-AudioDevice -PlaybackVolume)"`,
        { encoding: 'utf-8' }
      );
      const level = parseRequiredNumber(output, 'Windows volume');

      return {
        level,
        muted: false, // Would need additional PowerShell to check
      };
    } catch (error) {
      throw new Error(`Failed to get Windows volume: ${getErrorMessage(error)}`);
    }
  }

  private async setWindowsVolume(level: number): Promise<void> {
    try {
      execSync(`powershell -Command "Set-AudioDevice -PlaybackVolume ${level}"`);
    } catch {
      // Fallback using nircmd
      execSync(`nircmd.exe setsysvolume ${Math.round(level * 655.35)}`);
    }
  }

  private async setWindowsMute(muted: boolean): Promise<void> {
    try {
      execSync(`powershell -Command "Set-AudioDevice -PlaybackMute:$${muted}"`);
    } catch {
      execSync(`nircmd.exe mutesysvolume ${muted ? 1 : 0}`);
    }
  }

  private async getWindowsBrightness(): Promise<BrightnessInfo> {
    try {
      const output = execSync(
        `powershell -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"`,
        { encoding: 'utf-8' }
      );
      return { level: parseRequiredNumber(output, 'Windows brightness') };
    } catch (error) {
      throw new Error(`Failed to get Windows brightness: ${getErrorMessage(error)}`);
    }
  }

  private async setWindowsBrightness(level: number): Promise<void> {
    try {
      execSync(
        `powershell -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${level})"`
      );
    } catch (error) {
      throw new Error(`Failed to set Windows brightness: ${getErrorMessage(error)}`);
    }
  }

  private async notifyWindows(options: NotificationOptions): Promise<void> {
    const ps = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $textNodes = $template.GetElementsByTagName("text")
      $textNodes.Item(0).AppendChild($template.CreateTextNode("${options.title.replace(/"/g, '""')}")) > $null
      $textNodes.Item(1).AppendChild($template.CreateTextNode("${options.body.replace(/"/g, '""')}")) > $null
      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("CodeBuddy").Show($toast)
    `;

    execSync(`powershell -Command "${ps.replace(/\n/g, '; ')}"`, { windowsHide: true });
  }

  private async powerWindows(action: PowerAction): Promise<void> {
    switch (action.type) {
      case 'sleep':
        execSync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
        break;
      case 'lock':
        execSync('rundll32.exe user32.dll,LockWorkStation');
        break;
      case 'shutdown':
        execSync(`shutdown /s /t ${action.delay || 0}${action.force ? ' /f' : ''}`);
        break;
      case 'restart':
        execSync(`shutdown /r /t ${action.delay || 0}${action.force ? ' /f' : ''}`);
        break;
      case 'hibernate':
        execSync('shutdown /h');
        break;
      case 'logout':
        execSync('shutdown /l');
        break;
    }
  }

  private async getWindowsDisplays(): Promise<DisplayInfo[]> {
    try {
      const output = execSync(
        `powershell -Command "Get-WmiObject -Class Win32_VideoController | Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json"`,
        { encoding: 'utf-8' }
      );

      const data = JSON.parse(output);
      const displays = Array.isArray(data) ? data : [data];

      return displays.flatMap((d, i) => {
        const width = Number(d.CurrentHorizontalResolution);
        const height = Number(d.CurrentVerticalResolution);
        const refreshRate = Number(d.CurrentRefreshRate);

        if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
          logger.debug('Skipping Windows display with invalid resolution', { display: d });
          return [];
        }

        return [{
          id: `display-${i}`,
          name: d.Name || `Display ${i + 1}`,
          resolution: { width, height },
          refreshRate: isPositiveInteger(refreshRate) ? refreshRate : 0,
          primary: i === 0,
          connected: true,
        }];
      });
    } catch (error) {
      logger.warn('Failed to get Windows displays', { error });
      return [];
    }
  }

  private async getWindowsNetwork(): Promise<NetworkInfo> {
    try {
      const output = execSync(
        `powershell -Command "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1 | ConvertTo-Json"`,
        { encoding: 'utf-8' }
      );

      const data = JSON.parse(output);

      return {
        connected: true,
        type: data.InterfaceAlias?.includes('Wi-Fi') ? 'wifi' : 'ethernet',
        ip: data.IPv4Address?.[0]?.IPAddress,
        gateway: data.IPv4DefaultGateway?.[0]?.NextHop,
      };
    } catch {
      return { connected: false };
    }
  }

  private async getWindowsBattery(): Promise<BatteryInfo> {
    try {
      const output = execSync(
        `powershell -Command "Get-WmiObject -Class Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json"`,
        { encoding: 'utf-8' }
      );

      const data = JSON.parse(output);

      return {
        present: true,
        charging: data.BatteryStatus === 2,
        level: data.EstimatedChargeRemaining || 0,
      };
    } catch {
      return { present: false, charging: false, level: 0 };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let systemControlInstance: SystemControl | null = null;

export function getSystemControl(): SystemControl {
  if (!systemControlInstance) {
    systemControlInstance = new SystemControl();
  }
  return systemControlInstance;
}

export function resetSystemControl(): void {
  systemControlInstance = null;
}

export default SystemControl;
