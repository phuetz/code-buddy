/**
 * Version Detector
 *
 * Detects application and configuration versions:
 * - Package.json version
 * - Config file versions
 * - Data format versions
 * - Runtime version detection
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import semver from 'semver';
import { EventEmitter } from 'events';

export interface VersionInfo {
  version: string;
  source: string;
  detectedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface ConfigVersion {
  version: string;
  format: string;
  schema?: string;
}

export interface VersionDetectorConfig {
  dataDir?: string;
  configDir?: string;
  packageJsonPath?: string;
  versionFile?: string;
}

export interface VersionComparison {
  current: string;
  target: string;
  relation: 'equal' | 'older' | 'newer' | 'invalid';
  needsUpgrade: boolean;
  majorDiff: number;
  minorDiff: number;
  patchDiff: number;
}

const DEFAULT_CONFIG: Required<VersionDetectorConfig> = {
  dataDir: path.join(os.homedir(), '.codebuddy'),
  configDir: path.join(os.homedir(), '.codebuddy', 'config'),
  packageJsonPath: path.join(process.cwd(), 'package.json'),
  versionFile: 'version.json',
};

/**
 * Version Detector class
 */
export class VersionDetector extends EventEmitter {
  private config: Required<VersionDetectorConfig>;
  private cachedVersions: Map<string, VersionInfo> = new Map();
  private initialized: boolean = false;

  constructor(config: VersionDetectorConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize version detector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.detectAllVersions();
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Detect all available versions
   */
  async detectAllVersions(): Promise<Map<string, VersionInfo>> {
    this.cachedVersions.clear();

    // Detect package version
    try {
      const pkgVersion = await this.detectPackageVersion();
      if (pkgVersion) {
        this.cachedVersions.set('package', pkgVersion);
      }
    } catch {
      // Ignore if package.json not found
    }

    // Detect stored version
    try {
      const storedVersion = await this.detectStoredVersion();
      if (storedVersion) {
        this.cachedVersions.set('stored', storedVersion);
      }
    } catch {
      // Ignore if version file not found
    }

    // Detect config version
    try {
      const configVersion = await this.detectConfigVersion();
      if (configVersion) {
        this.cachedVersions.set('config', configVersion);
      }
    } catch {
      // Ignore if config not found
    }

    this.emit('versions:detected', this.cachedVersions);
    return this.cachedVersions;
  }

  /**
   * Detect package.json version
   */
  async detectPackageVersion(): Promise<VersionInfo | null> {
    if (!await fs.pathExists(this.config.packageJsonPath)) {
      return null;
    }

    try {
      const pkg = await fs.readJson(this.config.packageJsonPath);
      const version = pkg.version;

      if (!version || !semver.valid(version)) {
        return null;
      }

      return {
        version,
        source: 'package.json',
        detectedAt: new Date(),
        metadata: {
          name: pkg.name,
          description: pkg.description,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect stored version from version file
   */
  async detectStoredVersion(): Promise<VersionInfo | null> {
    const versionPath = path.join(this.config.dataDir, this.config.versionFile);

    if (!await fs.pathExists(versionPath)) {
      return null;
    }

    try {
      const data = await fs.readJson(versionPath);
      const version = data.version;

      if (!version || !semver.valid(version)) {
        return null;
      }

      return {
        version,
        source: 'version.json',
        detectedAt: new Date(data.detectedAt || Date.now()),
        metadata: data.metadata,
      };
    } catch {
      return null;
    }
  }

  /**
   * Detect config file version
   */
  async detectConfigVersion(): Promise<VersionInfo | null> {
    const configPath = path.join(this.config.configDir, 'settings.json');

    if (!await fs.pathExists(configPath)) {
      return null;
    }

    try {
      const config = await fs.readJson(configPath);
      const version = config._version || config.version || config.configVersion;

      if (!version) {
        return null;
      }

      // Handle non-semver versions
      const semverVersion = semver.valid(version) || semver.coerce(version)?.version;

      if (!semverVersion) {
        return null;
      }

      return {
        version: semverVersion,
        source: 'config',
        detectedAt: new Date(),
        metadata: {
          originalVersion: version,
          format: config._format || 'json',
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Get package version
   */
  getPackageVersion(): string | null {
    return this.cachedVersions.get('package')?.version || null;
  }

  /**
   * Get stored version
   */
  getStoredVersion(): string | null {
    return this.cachedVersions.get('stored')?.version || null;
  }

  /**
   * Get config version
   */
  getConfigVersion(): string | null {
    return this.cachedVersions.get('config')?.version || null;
  }

  /**
   * Get current version (prioritize package > stored > config)
   */
  getCurrentVersion(): string {
    return (
      this.getPackageVersion() ||
      this.getStoredVersion() ||
      this.getConfigVersion() ||
      '0.0.0'
    );
  }

  /**
   * Store current version
   */
  async storeVersion(version: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!semver.valid(version)) {
      throw new Error(`Invalid version: ${version}`);
    }

    await fs.ensureDir(this.config.dataDir);

    const versionPath = path.join(this.config.dataDir, this.config.versionFile);
    const data = {
      version,
      detectedAt: new Date().toISOString(),
      metadata,
    };

    await fs.writeJson(versionPath, data, { spaces: 2 });

    this.cachedVersions.set('stored', {
      version,
      source: 'version.json',
      detectedAt: new Date(),
      metadata,
    });

    this.emit('version:stored', version);
  }

  /**
   * Compare two versions
   */
  compareVersions(current: string, target: string): VersionComparison {
    const currentValid = semver.valid(current);
    const targetValid = semver.valid(target);

    if (!currentValid || !targetValid) {
      return {
        current,
        target,
        relation: 'invalid',
        needsUpgrade: false,
        majorDiff: 0,
        minorDiff: 0,
        patchDiff: 0,
      };
    }

    const cmp = semver.compare(current, target);
    let relation: VersionComparison['relation'];

    if (cmp === 0) {
      relation = 'equal';
    } else if (cmp < 0) {
      relation = 'older';
    } else {
      relation = 'newer';
    }

    const currentParsed = semver.parse(current)!;
    const targetParsed = semver.parse(target)!;

    return {
      current,
      target,
      relation,
      needsUpgrade: relation === 'older',
      majorDiff: targetParsed.major - currentParsed.major,
      minorDiff: targetParsed.minor - currentParsed.minor,
      patchDiff: targetParsed.patch - currentParsed.patch,
    };
  }

  /**
   * Check if upgrade is needed from stored to package version
   */
  needsUpgrade(): boolean {
    const storedVersion = this.getStoredVersion() || '0.0.0';
    const packageVersion = this.getPackageVersion();

    if (!packageVersion) {
      return false;
    }

    return semver.lt(storedVersion, packageVersion);
  }

  /**
   * Get upgrade path between versions
   */
  getUpgradePath(from: string, to: string): string[] {
    if (!semver.valid(from) || !semver.valid(to)) {
      return [];
    }

    if (semver.gte(from, to)) {
      return [];
    }

    // Generate intermediate major/minor versions
    const path: string[] = [];
    const fromParsed = semver.parse(from)!;
    const toParsed = semver.parse(to)!;

    let current = { ...fromParsed };

    // First handle major versions
    while (current.major < toParsed.major) {
      current.major++;
      current.minor = 0;
      current.patch = 0;
      path.push(`${current.major}.0.0`);
    }

    // Then handle minor versions
    while (current.minor < toParsed.minor) {
      current.minor++;
      current.patch = 0;
      path.push(`${current.major}.${current.minor}.0`);
    }

    // Finally add target version if not already added
    if (path.length === 0 || path[path.length - 1] !== to) {
      path.push(to);
    }

    return path;
  }

  /**
   * Validate version string
   */
  isValidVersion(version: string): boolean {
    return semver.valid(version) !== null;
  }

  /**
   * Coerce string to valid semver
   */
  coerceVersion(version: string): string | null {
    const coerced = semver.coerce(version);
    return coerced?.version || null;
  }

  /**
   * Parse version into components
   */
  parseVersion(version: string): {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    build: string[];
  } | null {
    const parsed = semver.parse(version);
    if (!parsed) return null;

    return {
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
      prerelease: parsed.prerelease.map(String),
      build: [...parsed.build],
    };
  }

  /**
   * Check if version satisfies range
   */
  satisfiesRange(version: string, range: string): boolean {
    return semver.satisfies(version, range);
  }

  /**
   * Get all cached versions
   */
  getAllVersions(): Map<string, VersionInfo> {
    return new Map(this.cachedVersions);
  }

  /**
   * Get version by source
   */
  getVersion(source: string): VersionInfo | undefined {
    return this.cachedVersions.get(source);
  }

  /**
   * Clear version cache
   */
  clearCache(): void {
    this.cachedVersions.clear();
    this.emit('cache:cleared');
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cachedVersions.clear();
    this.initialized = false;
    this.removeAllListeners();
  }
}

// Singleton instance
let versionDetector: VersionDetector | null = null;

/**
 * Get or create version detector
 */
export function getVersionDetector(config?: VersionDetectorConfig): VersionDetector {
  if (!versionDetector) {
    versionDetector = new VersionDetector(config);
  }
  return versionDetector;
}

/**
 * Reset version detector singleton
 */
export function resetVersionDetector(): void {
  if (versionDetector) {
    versionDetector.dispose();
  }
  versionDetector = null;
}

export default VersionDetector;
