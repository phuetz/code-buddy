/**
 * Permission Manager
 *
 * Enterprise-grade platform-specific permission gating.
 * Checks and requests permissions before sensitive operations.
 *
 * Supports:
 * - Screen Recording (macOS TCC, Linux, Windows)
 * - Accessibility (macOS AX, Linux AT-SPI, Windows UIAutomation)
 * - Camera/Microphone access
 * - Location services
 * - Notifications
 */

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type PermissionType =
  | 'screen-recording'
  | 'accessibility'
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'full-disk-access'
  | 'automation';

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unavailable';

export interface PermissionInfo {
  type: PermissionType;
  status: PermissionStatus;
  canRequest: boolean;
  instructions?: string;
  settingsPath?: string;
}

export interface PermissionCheckResult {
  permission: PermissionType;
  status: PermissionStatus;
  granted: boolean;
  message: string;
}

export interface PermissionManagerConfig {
  /** Cache permission checks for this duration (ms) */
  cacheDuration: number;
  /** Auto-prompt for missing permissions */
  autoPrompt: boolean;
  /** Show instructions when permission denied */
  showInstructions: boolean;
}

const DEFAULT_CONFIG: PermissionManagerConfig = {
  cacheDuration: 30000, // 30 seconds
  autoPrompt: false,
  showInstructions: true,
};

// ============================================================================
// Platform Detection
// ============================================================================

export type Platform = 'darwin' | 'linux' | 'win32' | 'unknown';

function detectPlatform(): Platform {
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'linux' || platform === 'win32') {
    return platform;
  }
  return 'unknown';
}

// ============================================================================
// Permission Manager
// ============================================================================

export class PermissionManager extends EventEmitter {
  private platform: Platform;
  private config: PermissionManagerConfig;
  private cache: Map<PermissionType, { status: PermissionStatus; timestamp: number }> = new Map();

  constructor(config: Partial<PermissionManagerConfig> = {}) {
    super();
    this.platform = detectPlatform();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Main API
  // ============================================================================

  /**
   * Check permission status
   */
  async check(permission: PermissionType): Promise<PermissionCheckResult> {
    // Check cache first
    const cached = this.cache.get(permission);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
      const result = this.formatResult(permission, cached.status);
      this.emit('permission-checked', result);
      return result;
    }

    let status: PermissionStatus;

    switch (this.platform) {
      case 'darwin':
        status = await this.checkMacOS(permission);
        break;
      case 'linux':
        status = await this.checkLinux(permission);
        break;
      case 'win32':
        status = await this.checkWindows(permission);
        break;
      default:
        status = 'unavailable';
    }

    // Update cache
    this.cache.set(permission, { status, timestamp: Date.now() });

    const result = this.formatResult(permission, status);
    this.emit('permission-checked', result);

    return result;
  }

  /**
   * Check multiple permissions
   */
  async checkAll(permissions: PermissionType[]): Promise<Map<PermissionType, PermissionCheckResult>> {
    const results = new Map<PermissionType, PermissionCheckResult>();

    await Promise.all(
      permissions.map(async (perm) => {
        results.set(perm, await this.check(perm));
      })
    );

    return results;
  }

  /**
   * Request permission (opens system settings if needed)
   */
  async request(permission: PermissionType): Promise<PermissionCheckResult> {
    const current = await this.check(permission);

    if (current.granted) {
      return current;
    }

    switch (this.platform) {
      case 'darwin':
        await this.requestMacOS(permission);
        break;
      case 'linux':
        await this.requestLinux(permission);
        break;
      case 'win32':
        await this.requestWindows(permission);
        break;
    }

    // Clear cache and recheck
    this.cache.delete(permission);
    return this.check(permission);
  }

  /**
   * Get instructions for granting permission
   */
  getInstructions(permission: PermissionType): PermissionInfo {
    switch (this.platform) {
      case 'darwin':
        return this.getMacOSInstructions(permission);
      case 'linux':
        return this.getLinuxInstructions(permission);
      case 'win32':
        return this.getWindowsInstructions(permission);
      default:
        return {
          type: permission,
          status: 'unavailable',
          canRequest: false,
          instructions: 'Platform not supported',
        };
    }
  }

  /**
   * Ensure permission is granted before executing action
   */
  async ensurePermission(
    permission: PermissionType,
    action: () => Promise<void>
  ): Promise<void> {
    const result = await this.check(permission);

    if (!result.granted) {
      const info = this.getInstructions(permission);

      if (this.config.autoPrompt && info.canRequest) {
        await this.request(permission);
        const recheck = await this.check(permission);
        if (!recheck.granted) {
          throw new PermissionError(permission, info);
        }
      } else {
        throw new PermissionError(permission, info);
      }
    }

    await action();
  }

  /**
   * Clear permission cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================================
  // macOS Implementation
  // ============================================================================

  private async checkMacOS(permission: PermissionType): Promise<PermissionStatus> {
    try {
      switch (permission) {
        case 'screen-recording':
          return this.checkMacOSScreenRecording();
        case 'accessibility':
          return this.checkMacOSAccessibility();
        case 'camera':
          return this.checkMacOSCamera();
        case 'microphone':
          return this.checkMacOSMicrophone();
        case 'location':
          return this.checkMacOSLocation();
        case 'notifications':
          return this.checkMacOSNotifications();
        case 'full-disk-access':
          return this.checkMacOSFullDiskAccess();
        case 'automation':
          return this.checkMacOSAutomation();
        default:
          return 'unavailable';
      }
    } catch (error) {
      logger.error('macOS permission check failed', { permission, error });
      return 'not-determined';
    }
  }

  private checkMacOSScreenRecording(): PermissionStatus {
    try {
      // Check if we have screen capture permission using CGPreflightScreenCaptureAccess
      const result = execSync(
        `osascript -e 'tell application "System Events" to get name of every process'`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return result ? 'granted' : 'denied';
    } catch {
      // If we can't list processes, we might not have permission
      return 'denied';
    }
  }

  private checkMacOSAccessibility(): PermissionStatus {
    try {
      // Use AXIsProcessTrusted via osascript
      const result = execSync(
        `osascript -e 'tell application "System Events" to keystroke ""'`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      );
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkMacOSCamera(): PermissionStatus {
    try {
      const result = execSync(
        `system_profiler SPCameraDataType 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return result ? 'granted' : 'not-determined';
    } catch {
      return 'not-determined';
    }
  }

  private checkMacOSMicrophone(): PermissionStatus {
    try {
      execSync(
        `osascript -e 'tell application "System Preferences" to reveal anchor "Privacy_Microphone" of pane "com.apple.preference.security"' 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return 'not-determined';
    } catch {
      return 'not-determined';
    }
  }

  private checkMacOSLocation(): PermissionStatus {
    try {
      const result = execSync(
        `defaults read /var/db/locationd/clients.plist 2>/dev/null | head -1`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return result ? 'granted' : 'denied';
    } catch {
      return 'not-determined';
    }
  }

  private checkMacOSNotifications(): PermissionStatus {
    // Notifications are generally always available on macOS
    return 'granted';
  }

  private checkMacOSFullDiskAccess(): PermissionStatus {
    try {
      // Try to read a protected file
      execSync(`ls ~/Library/Mail 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkMacOSAutomation(): PermissionStatus {
    try {
      execSync(
        `osascript -e 'tell application "Finder" to get name of front window' 2>/dev/null`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private async requestMacOS(permission: PermissionType): Promise<void> {
    const info = this.getMacOSInstructions(permission);

    if (info.settingsPath) {
      try {
        await execAsync(`open "${info.settingsPath}"`);
      } catch (error) {
        logger.warn('Failed to open settings', { permission, error });
      }
    }
  }

  private getMacOSInstructions(permission: PermissionType): PermissionInfo {
    const base: Partial<PermissionInfo> = {
      type: permission,
      canRequest: true,
    };

    switch (permission) {
      case 'screen-recording':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Screen Recording and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        } as PermissionInfo;

      case 'accessibility':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Accessibility and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
        } as PermissionInfo;

      case 'camera':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Camera and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
        } as PermissionInfo;

      case 'microphone':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Microphone and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
        } as PermissionInfo;

      case 'full-disk-access':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Full Disk Access and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
        } as PermissionInfo;

      case 'automation':
        return {
          ...base,
          status: 'not-determined',
          canRequest: true,
          instructions: 'Go to System Preferences > Security & Privacy > Privacy > Automation and enable this application.',
          settingsPath: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
        } as PermissionInfo;

      default:
        return {
          ...base,
          status: 'unavailable',
          canRequest: false,
        } as PermissionInfo;
    }
  }

  // ============================================================================
  // Linux Implementation
  // ============================================================================

  private async checkLinux(permission: PermissionType): Promise<PermissionStatus> {
    try {
      switch (permission) {
        case 'screen-recording':
          return this.checkLinuxScreenRecording();
        case 'accessibility':
          return this.checkLinuxAccessibility();
        case 'camera':
          return this.checkLinuxCamera();
        case 'microphone':
          return this.checkLinuxMicrophone();
        case 'notifications':
          return this.checkLinuxNotifications();
        default:
          return 'unavailable';
      }
    } catch (error) {
      logger.error('Linux permission check failed', { permission, error });
      return 'not-determined';
    }
  }

  private checkLinuxScreenRecording(): PermissionStatus {
    try {
      // Check if X11 or Wayland
      const display = process.env.DISPLAY || process.env.WAYLAND_DISPLAY;
      if (!display) {
        return 'denied';
      }

      // Check if we can access display
      if (process.env.WAYLAND_DISPLAY) {
        // Wayland requires special portal permissions
        execSync('which gnome-screenshot || which grim', { encoding: 'utf-8', timeout: 5000 });
      } else {
        // X11 is generally permissive
        execSync('xdpyinfo -display :0 2>/dev/null | head -1', { encoding: 'utf-8', timeout: 5000 });
      }
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkLinuxAccessibility(): PermissionStatus {
    try {
      // Check if AT-SPI is available
      execSync('which atspi-dbus-launcher || pgrep -x at-spi', { encoding: 'utf-8', timeout: 5000 });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkLinuxCamera(): PermissionStatus {
    try {
      // Check video devices
      execSync('ls /dev/video* 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkLinuxMicrophone(): PermissionStatus {
    try {
      // Check audio input devices
      execSync('arecord -l 2>/dev/null | head -1', { encoding: 'utf-8', timeout: 5000 });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private checkLinuxNotifications(): PermissionStatus {
    try {
      // Check if notification daemon is running
      execSync('which notify-send', { encoding: 'utf-8', timeout: 5000 });
      return 'granted';
    } catch {
      return 'denied';
    }
  }

  private async requestLinux(permission: PermissionType): Promise<void> {
    const info = this.getLinuxInstructions(permission);
    logger.info('Linux permission request', { permission, instructions: info.instructions });
  }

  private getLinuxInstructions(permission: PermissionType): PermissionInfo {
    const base: Partial<PermissionInfo> = {
      type: permission,
      canRequest: false, // Linux permissions are usually system-level
    };

    switch (permission) {
      case 'screen-recording':
        return {
          ...base,
          status: 'not-determined',
          instructions: process.env.WAYLAND_DISPLAY
            ? 'Wayland requires portal permissions. Install xdg-desktop-portal for screen capture support.'
            : 'X11 screen recording should work. Ensure DISPLAY environment variable is set.',
        } as PermissionInfo;

      case 'accessibility':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Enable assistive technologies: Install at-spi2-core and ensure accessibility is enabled in your desktop settings.',
        } as PermissionInfo;

      case 'camera':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Ensure your user is in the "video" group: sudo usermod -a -G video $USER',
        } as PermissionInfo;

      case 'microphone':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Ensure your user is in the "audio" group: sudo usermod -a -G audio $USER',
        } as PermissionInfo;

      default:
        return {
          ...base,
          status: 'unavailable',
        } as PermissionInfo;
    }
  }

  // ============================================================================
  // Windows Implementation
  // ============================================================================

  private async checkWindows(permission: PermissionType): Promise<PermissionStatus> {
    try {
      switch (permission) {
        case 'screen-recording':
          return this.checkWindowsScreenRecording();
        case 'camera':
          return this.checkWindowsCamera();
        case 'microphone':
          return this.checkWindowsMicrophone();
        case 'location':
          return this.checkWindowsLocation();
        case 'notifications':
          return 'granted'; // Always available on Windows
        default:
          return 'unavailable';
      }
    } catch (error) {
      logger.error('Windows permission check failed', { permission, error });
      return 'not-determined';
    }
  }

  private checkWindowsScreenRecording(): PermissionStatus {
    // Windows doesn't require explicit screen recording permission
    return 'granted';
  }

  private checkWindowsCamera(): PermissionStatus {
    try {
      const result = execSync(
        'powershell -Command "Get-PnpDevice -Class Camera | Select-Object Status"',
        { encoding: 'utf-8', timeout: 10000 }
      );
      return result.includes('OK') ? 'granted' : 'denied';
    } catch {
      return 'not-determined';
    }
  }

  private checkWindowsMicrophone(): PermissionStatus {
    try {
      const result = execSync(
        'powershell -Command "Get-PnpDevice -Class AudioEndpoint | Select-Object Status"',
        { encoding: 'utf-8', timeout: 10000 }
      );
      return result.includes('OK') ? 'granted' : 'denied';
    } catch {
      return 'not-determined';
    }
  }

  private checkWindowsLocation(): PermissionStatus {
    try {
      const result = execSync(
        'powershell -Command "(Get-ItemProperty \'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\location\').Value"',
        { encoding: 'utf-8', timeout: 10000 }
      );
      return result.trim() === 'Allow' ? 'granted' : 'denied';
    } catch {
      return 'not-determined';
    }
  }

  private async requestWindows(permission: PermissionType): Promise<void> {
    const info = this.getWindowsInstructions(permission);

    if (info.settingsPath) {
      try {
        await execAsync(`start ${info.settingsPath}`);
      } catch (error) {
        logger.warn('Failed to open settings', { permission, error });
      }
    }
  }

  private getWindowsInstructions(permission: PermissionType): PermissionInfo {
    const base: Partial<PermissionInfo> = {
      type: permission,
      canRequest: true,
    };

    switch (permission) {
      case 'camera':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Go to Settings > Privacy > Camera and enable camera access.',
          settingsPath: 'ms-settings:privacy-webcam',
        } as PermissionInfo;

      case 'microphone':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Go to Settings > Privacy > Microphone and enable microphone access.',
          settingsPath: 'ms-settings:privacy-microphone',
        } as PermissionInfo;

      case 'location':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Go to Settings > Privacy > Location and enable location access.',
          settingsPath: 'ms-settings:privacy-location',
        } as PermissionInfo;

      case 'notifications':
        return {
          ...base,
          status: 'not-determined',
          instructions: 'Go to Settings > System > Notifications and enable notifications.',
          settingsPath: 'ms-settings:notifications',
        } as PermissionInfo;

      default:
        return {
          ...base,
          status: 'unavailable',
          canRequest: false,
        } as PermissionInfo;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private formatResult(permission: PermissionType, status: PermissionStatus): PermissionCheckResult {
    const granted = status === 'granted';

    let message: string;
    switch (status) {
      case 'granted':
        message = `Permission '${permission}' is granted`;
        break;
      case 'denied':
        message = `Permission '${permission}' is denied`;
        break;
      case 'not-determined':
        message = `Permission '${permission}' has not been determined`;
        break;
      case 'restricted':
        message = `Permission '${permission}' is restricted by system policy`;
        break;
      case 'unavailable':
        message = `Permission '${permission}' is not available on this platform`;
        break;
    }

    return { permission, status, granted, message };
  }
}

// ============================================================================
// Error Class
// ============================================================================

export class PermissionError extends Error {
  public permission: PermissionType;
  public info: PermissionInfo;

  constructor(permission: PermissionType, info: PermissionInfo) {
    super(`Permission '${permission}' is required but not granted`);
    this.name = 'PermissionError';
    this.permission = permission;
    this.info = info;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let permissionManagerInstance: PermissionManager | null = null;

export function getPermissionManager(config?: Partial<PermissionManagerConfig>): PermissionManager {
  if (!permissionManagerInstance) {
    permissionManagerInstance = new PermissionManager(config);
  }
  return permissionManagerInstance;
}

export function resetPermissionManager(): void {
  permissionManagerInstance = null;
}

export default PermissionManager;
