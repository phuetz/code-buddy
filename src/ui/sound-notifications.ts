/**
 * Sound Notifications
 *
 * Optional sound notifications for events:
 * - Task completion
 * - Errors
 * - User attention needed
 * - Success/failure indicators
 */

import { exec } from 'child_process';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export type NotificationSound =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'complete'
  | 'attention'
  | 'message'
  | 'bell';

export interface SoundConfig {
  /** Enable sound notifications */
  enabled: boolean;
  /** Volume level (0-100) */
  volume: number;
  /** Custom sound files */
  customSounds: Record<NotificationSound, string | undefined>;
  /** Muted times (24h format, e.g., ["22:00-08:00"]) */
  mutedTimes: string[];
}

const DEFAULT_CONFIG: SoundConfig = {
  enabled: true,
  volume: 50,
  customSounds: {
    success: undefined,
    error: undefined,
    warning: undefined,
    info: undefined,
    complete: undefined,
    attention: undefined,
    message: undefined,
    bell: undefined,
  },
  mutedTimes: [],
};

/**
 * Terminal bell frequencies for different sounds (Hz)
 */
const SOUND_FREQUENCIES: Record<NotificationSound, number[]> = {
  success: [523, 659, 784], // C5, E5, G5 - happy chord
  error: [262, 196], // C4, G3 - descending
  warning: [440, 440], // A4, A4 - double beep
  info: [523], // C5 - single
  complete: [523, 659, 784, 1047], // C5, E5, G5, C6 - ascending
  attention: [880, 880, 880], // A5 triple
  message: [440, 523], // A4, C5 - ascending
  bell: [440], // A4 - standard bell
};

/**
 * Sound Notification Manager
 */
export class SoundNotificationManager {
  private config: SoundConfig;
  private configPath: string;
  private platform: NodeJS.Platform;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.codebuddy', 'sounds.json');
    this.config = { ...DEFAULT_CONFIG };
    this.platform = os.platform();
    this.loadConfig();
  }

  /**
   * Play a notification sound
   */
  async play(sound: NotificationSound): Promise<void> {
    if (!this.config.enabled) return;
    if (this.isMuted()) return;

    // Check for custom sound file
    const customPath = this.config.customSounds[sound];
    if (customPath && await fs.pathExists(customPath)) {
      await this.playFile(customPath);
      return;
    }

    // Use system sounds
    await this.playSystemSound(sound);
  }

  /**
   * Play success sound
   */
  async success(): Promise<void> {
    await this.play('success');
  }

  /**
   * Play error sound
   */
  async error(): Promise<void> {
    await this.play('error');
  }

  /**
   * Play warning sound
   */
  async warning(): Promise<void> {
    await this.play('warning');
  }

  /**
   * Play info sound
   */
  async info(): Promise<void> {
    await this.play('info');
  }

  /**
   * Play completion sound
   */
  async complete(): Promise<void> {
    await this.play('complete');
  }

  /**
   * Play attention sound
   */
  async attention(): Promise<void> {
    await this.play('attention');
  }

  /**
   * Play message sound
   */
  async message(): Promise<void> {
    await this.play('message');
  }

  /**
   * Play bell
   */
  async bell(): Promise<void> {
    await this.play('bell');
  }

  /**
   * Simple terminal bell (works everywhere)
   */
  async terminalBell(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.isMuted()) return;

    process.stdout.write('\x07');
  }

  /**
   * Enable/disable sounds
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    this.saveConfig();
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set volume
   */
  setVolume(volume: number): void {
    this.config.volume = Math.max(0, Math.min(100, volume));
    this.saveConfig();
  }

  /**
   * Get volume
   */
  getVolume(): number {
    return this.config.volume;
  }

  /**
   * Set custom sound file
   */
  async setCustomSound(sound: NotificationSound, filePath: string): Promise<boolean> {
    if (!await fs.pathExists(filePath)) {
      return false;
    }
    this.config.customSounds[sound] = filePath;
    this.saveConfig();
    return true;
  }

  /**
   * Clear custom sound
   */
  clearCustomSound(sound: NotificationSound): void {
    this.config.customSounds[sound] = undefined;
    this.saveConfig();
  }

  /**
   * Add muted time range
   */
  addMutedTime(range: string): void {
    if (!this.config.mutedTimes.includes(range)) {
      this.config.mutedTimes.push(range);
      this.saveConfig();
    }
  }

  /**
   * Remove muted time range
   */
  removeMutedTime(range: string): void {
    this.config.mutedTimes = this.config.mutedTimes.filter(t => t !== range);
    this.saveConfig();
  }

  /**
   * Check if currently muted by time
   */
  isMuted(): boolean {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const range of this.config.mutedTimes) {
      const [start, end] = range.split('-');
      if (!start || !end) continue;

      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);

      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (startMinutes <= endMinutes) {
        // Same day range
        if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
          return true;
        }
      } else {
        // Overnight range (e.g., 22:00-08:00)
        if (currentMinutes >= startMinutes || currentMinutes <= endMinutes) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get config
   */
  getConfig(): SoundConfig {
    return { ...this.config };
  }

  /**
   * Test all sounds
   */
  async testAllSounds(): Promise<void> {
    const sounds: NotificationSound[] = [
      'bell', 'info', 'message', 'warning', 'success', 'error', 'complete', 'attention'
    ];

    for (const sound of sounds) {
      logger.info(`Playing: ${sound}`);
      await this.play(sound);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Play a sound file
   */
  private async playFile(filePath: string): Promise<void> {
    return new Promise((resolve) => {
      let command: string;

      switch (this.platform) {
        case 'darwin':
          command = `afplay -v ${this.config.volume / 100} "${filePath}"`;
          break;
        case 'win32':
          command = `powershell -c "(New-Object Media.SoundPlayer '${filePath}').PlaySync()"`;
          break;
        default: // Linux
          command = `paplay "${filePath}" 2>/dev/null || aplay "${filePath}" 2>/dev/null || true`;
          break;
      }

      exec(command, () => resolve());
    });
  }

  /**
   * Play system sound
   */
  private async playSystemSound(sound: NotificationSound): Promise<void> {
    const frequencies = SOUND_FREQUENCIES[sound];

    switch (this.platform) {
      case 'darwin':
        await this.playMacSound(frequencies);
        break;
      case 'win32':
        await this.playWindowsSound(frequencies);
        break;
      default:
        await this.playLinuxSound(frequencies);
        break;
    }
  }

  /**
   * Play sound on macOS
   */
  private async playMacSound(frequencies: number[]): Promise<void> {
    // Use osascript to generate beeps
    const beeps = frequencies.map(f => {
      const duration = 0.1;
      return `beep`;
    }).join('; delay 0.1; ');

    return new Promise((resolve) => {
      exec(`osascript -e '${beeps}'`, () => resolve());
    });
  }

  /**
   * Play sound on Windows
   */
  private async playWindowsSound(frequencies: number[]): Promise<void> {
    const beeps = frequencies.map(f =>
      `[console]::beep(${f}, 100)`
    ).join('; ');

    return new Promise((resolve) => {
      exec(`powershell -c "${beeps}"`, () => resolve());
    });
  }

  /**
   * Play sound on Linux
   */
  private async playLinuxSound(frequencies: number[]): Promise<void> {
    // Try different methods
    const methods = [
      // paplay with system sounds
      () => {
        const soundFile = frequencies[0] > 500
          ? '/usr/share/sounds/freedesktop/stereo/complete.oga'
          : '/usr/share/sounds/freedesktop/stereo/bell.oga';
        return `paplay ${soundFile} 2>/dev/null`;
      },
      // Terminal bell
      () => {
        process.stdout.write('\x07');
        return 'true';
      },
    ];

    for (const method of methods) {
      const command = method();
      try {
        await new Promise<void>((resolve, reject) => {
          exec(command, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        return;
      } catch {
        continue;
      }
    }

    // Fallback: terminal bell
    process.stdout.write('\x07');
  }

  /**
   * Load config from file
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readJsonSync(this.configPath);
        this.config = { ...DEFAULT_CONFIG, ...data };
      }
    } catch {
      // Use defaults
    }
  }

  /**
   * Save config to file
   */
  private saveConfig(): void {
    try {
      fs.ensureDirSync(path.dirname(this.configPath));
      fs.writeJsonSync(this.configPath, this.config, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let soundManager: SoundNotificationManager | null = null;

/**
 * Get or create sound notification manager
 */
export function getSoundManager(): SoundNotificationManager {
  if (!soundManager) {
    soundManager = new SoundNotificationManager();
  }
  return soundManager;
}

/**
 * Quick sound helpers
 */
export async function playSuccess(): Promise<void> {
  await getSoundManager().success();
}

export async function playError(): Promise<void> {
  await getSoundManager().error();
}

export async function playWarning(): Promise<void> {
  await getSoundManager().warning();
}

export async function playComplete(): Promise<void> {
  await getSoundManager().complete();
}

export async function playBell(): Promise<void> {
  await getSoundManager().bell();
}

export default SoundNotificationManager;
