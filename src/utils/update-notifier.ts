/**
 * Update Notifier
 *
 * Checks for new versions and notifies users (mistral-vibe style).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import https from 'https';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface UpdateInfo {
  /** Current installed version */
  currentVersion: string;
  /** Latest available version */
  latestVersion: string;
  /** Whether an update is available */
  updateAvailable: boolean;
  /** Release notes URL */
  releaseNotesUrl?: string;
  /** Install command */
  installCommand: string;
  /** Last check time */
  lastCheck: Date;
}

export interface UpdateNotifierConfig {
  /** Whether update checking is enabled */
  enabled: boolean;
  /** Check interval in hours */
  checkIntervalHours: number;
  /** Package name on npm */
  packageName: string;
  /** Registry URL */
  registryUrl: string;
}

// ============================================================================
// Update Notifier
// ============================================================================

const CACHE_FILE = join(homedir(), '.codebuddy', 'update-cache.json');
const DEFAULT_CONFIG: UpdateNotifierConfig = {
  enabled: true,
  checkIntervalHours: 24,
  packageName: '@phuetz/code-buddy',
  registryUrl: 'https://registry.npmjs.org',
};

interface CacheData {
  latestVersion: string;
  lastCheck: string;
}

/**
 * Get current package version from package.json
 */
function getCurrentVersion(): string {
  try {
    // Try to find package.json from various locations
    // Works in both local dev and npm global install
    const possiblePaths = [
      // Local development or npx
      join(process.cwd(), 'package.json'),
      // npm global install (node_modules/@phuetz/code-buddy/package.json)
      join(process.execPath, '..', '..', 'lib', 'node_modules', '@phuetz', 'code-buddy', 'package.json'),
    ];

    for (const pkgPath of possiblePaths) {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string; version?: string };
        if (pkg.name?.includes('code-buddy')) {
          return pkg.version || '0.0.0';
        }
      }
    }
    return '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(packageName: string, registryUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const url = `${registryUrl}/${packageName}/latest`;

    const request = https.get(url, { timeout: 5000 }, (response) => {
      if (response.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.version || null);
        } catch {
          resolve(null);
        }
      });
    });

    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
  });
}

/**
 * Compare semantic versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/^v/, '').split('.').map(Number);
  const partsB = b.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  return 0;
}

/**
 * Load cached update info
 */
function loadCache(): CacheData | null {
  try {
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch {
    // Ignore cache errors
  }
  return null;
}

/**
 * Save update info to cache
 */
function saveCache(data: CacheData): void {
  try {
    const dir = dirname(CACHE_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Ignore cache save errors
  }
}

/**
 * Check if it's time to check for updates
 */
function shouldCheckForUpdates(config: UpdateNotifierConfig): boolean {
  const cache = loadCache();
  if (!cache) return true;

  const lastCheck = new Date(cache.lastCheck);
  const now = new Date();
  const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

  return hoursSinceCheck >= config.checkIntervalHours;
}

/**
 * Update Notifier class
 */
export class UpdateNotifier {
  private config: UpdateNotifierConfig;
  private updateInfo: UpdateInfo | null = null;

  constructor(config?: Partial<UpdateNotifierConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check for updates (respects check interval)
   */
  async check(): Promise<UpdateInfo | null> {
    if (!this.config.enabled) {
      return null;
    }

    const currentVersion = getCurrentVersion();

    // Check cache first
    const cache = loadCache();
    if (cache && !shouldCheckForUpdates(this.config)) {
      this.updateInfo = {
        currentVersion,
        latestVersion: cache.latestVersion,
        updateAvailable: compareVersions(currentVersion, cache.latestVersion) < 0,
        installCommand: `npm update -g ${this.config.packageName}`,
        lastCheck: new Date(cache.lastCheck),
      };
      return this.updateInfo;
    }

    // Fetch latest version
    const latestVersion = await fetchLatestVersion(
      this.config.packageName,
      this.config.registryUrl
    );

    if (!latestVersion) {
      return null;
    }

    // Save to cache
    saveCache({
      latestVersion,
      lastCheck: new Date().toISOString(),
    });

    this.updateInfo = {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
      releaseNotesUrl: `https://github.com/phuetz/code-buddy/releases/tag/v${latestVersion}`,
      installCommand: `npm update -g ${this.config.packageName}`,
      lastCheck: new Date(),
    };

    return this.updateInfo;
  }

  /**
   * Force check (ignores interval)
   */
  async forceCheck(): Promise<UpdateInfo | null> {
    const currentVersion = getCurrentVersion();
    const latestVersion = await fetchLatestVersion(
      this.config.packageName,
      this.config.registryUrl
    );

    if (!latestVersion) {
      return null;
    }

    saveCache({
      latestVersion,
      lastCheck: new Date().toISOString(),
    });

    this.updateInfo = {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(currentVersion, latestVersion) < 0,
      releaseNotesUrl: `https://github.com/phuetz/code-buddy/releases/tag/v${latestVersion}`,
      installCommand: `npm update -g ${this.config.packageName}`,
      lastCheck: new Date(),
    };

    return this.updateInfo;
  }

  /**
   * Get last check result
   */
  getUpdateInfo(): UpdateInfo | null {
    return this.updateInfo;
  }

  /**
   * Format update notification message
   */
  formatNotification(): string | null {
    if (!this.updateInfo?.updateAvailable) {
      return null;
    }

    const { currentVersion, latestVersion, installCommand, releaseNotesUrl } = this.updateInfo;

    const lines = [
      '',
      '╭────────────────────────────────────────╮',
      '│                                        │',
      `│   Update available: ${currentVersion} → ${latestVersion}`.padEnd(41) + '│',
      '│                                        │',
      `│   Run: ${installCommand}`.padEnd(41) + '│',
      '│                                        │',
    ];

    if (releaseNotesUrl) {
      lines.push(`│   ${releaseNotesUrl}`.substring(0, 40).padEnd(41) + '│');
      lines.push('│                                        │');
    }

    lines.push('╰────────────────────────────────────────╯');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Check and notify if update available (call at startup)
   */
  async checkAndNotify(output?: (msg: string) => void): Promise<void> {
    try {
      await this.check();
      const notification = this.formatNotification();
      if (notification) {
        if (output) {
          output(notification);
        } else {
          logger.info(notification);
        }
      }
    } catch {
      // Silently fail - update checks should never break the CLI
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let notifierInstance: UpdateNotifier | null = null;

export function getUpdateNotifier(): UpdateNotifier {
  if (!notifierInstance) {
    notifierInstance = new UpdateNotifier();
  }
  return notifierInstance;
}

/**
 * Quick check at startup (non-blocking)
 */
export function checkForUpdatesInBackground(): void {
  // Run check in background without awaiting
  getUpdateNotifier().check().catch(() => {
    // Ignore errors silently
  });
}

/**
 * Compare versions utility
 */
export { compareVersions };
