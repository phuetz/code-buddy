/**
 * Advanced Configuration
 *
 * Features:
 * 1. Custom File Suggestion Provider - script-based file suggestions
 * 2. Effort Level Control - low/medium/high model parameters
 * 3. Auto-Compact Threshold - context window compaction trigger
 * 4. Fallback Model Config - automatic model fallback on errors
 * 5. Config Backup Rotation - backup/restore with rotation
 * 6. Devcontainer Support - detect and manage devcontainer configs
 * 7. Setting Sources Control - enable/disable config sources
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

// ============================================================================
// 1. Custom File Suggestion Provider
// ============================================================================

export interface FileSuggestionConfig {
  script?: string;
  maxResults: number;
}

export class FileSuggestionProvider {
  private config: FileSuggestionConfig;

  constructor(config?: Partial<FileSuggestionConfig>) {
    this.config = {
      maxResults: config?.maxResults ?? 15,
      script: config?.script,
    };
  }

  async getSuggestions(query: string): Promise<string[]> {
    if (!this.config.script) {
      logger.debug('No custom suggestion script configured');
      return [];
    }

    try {
      const { execSync } = await import('child_process');
      const output = execSync(`${this.config.script} ${JSON.stringify(query)}`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const results = output.trim().split('\n').filter(Boolean);
      return results.slice(0, this.config.maxResults);
    } catch (error: unknown) {
      logger.error('File suggestion script failed', { error: String(error) });
      return [];
    }
  }

  hasCustomProvider(): boolean {
    return !!this.config.script;
  }

  setScript(scriptPath: string): void {
    this.config.script = scriptPath;
    logger.info(`File suggestion script set to: ${scriptPath}`);
  }

  getConfig(): FileSuggestionConfig {
    return { ...this.config };
  }
}

// ============================================================================
// 2. Effort Level Control
// ============================================================================

export type EffortLevel = 'low' | 'medium' | 'high';

const EFFORT_PARAMS: Record<EffortLevel, { temperature: number; maxTokens: number; topP: number }> = {
  low: { temperature: 0.3, maxTokens: 1024, topP: 0.8 },
  medium: { temperature: 0.7, maxTokens: 4096, topP: 0.9 },
  high: { temperature: 1.0, maxTokens: 16384, topP: 1.0 },
};

export class EffortLevelManager {
  private level: EffortLevel;

  constructor(level?: EffortLevel) {
    this.level = level ?? 'medium';
  }

  setLevel(level: EffortLevel): void {
    this.level = level;
    logger.info(`Effort level set to: ${level}`);
  }

  getLevel(): EffortLevel {
    return this.level;
  }

  static fromEnv(): EffortLevel {
    const envLevel = process.env.EFFORT_LEVEL?.toLowerCase();
    if (envLevel === 'low' || envLevel === 'medium' || envLevel === 'high') {
      return envLevel;
    }
    return 'medium';
  }

  getModelParams(): { temperature: number; maxTokens: number; topP: number } {
    return { ...EFFORT_PARAMS[this.level] };
  }
}

// ============================================================================
// 3. Auto-Compact Threshold
// ============================================================================

export class AutoCompactConfig {
  private thresholdPercent: number;

  constructor(threshold?: number) {
    this.thresholdPercent = threshold ?? 80;
  }

  setThreshold(percent: number): void {
    if (percent < 0 || percent > 100) {
      throw new Error('Threshold must be between 0 and 100');
    }
    this.thresholdPercent = percent;
    logger.info(`Auto-compact threshold set to: ${percent}%`);
  }

  getThreshold(): number {
    return this.thresholdPercent;
  }

  static fromEnv(): number {
    const envVal = process.env.AUTO_COMPACT_THRESHOLD;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        return parsed;
      }
    }
    return 80;
  }

  shouldCompact(currentUsage: number, maxCapacity: number): boolean {
    if (maxCapacity <= 0) return false;
    const usagePercent = (currentUsage / maxCapacity) * 100;
    return usagePercent >= this.thresholdPercent;
  }

  getUsagePercent(current: number, max: number): number {
    if (max <= 0) return 0;
    return Math.round((current / max) * 100 * 100) / 100;
  }
}

// ============================================================================
// 4. Fallback Model Config
// ============================================================================

export interface FallbackModelConfig {
  primaryModel: string;
  fallbackModel: string;
  triggerOnOverload: boolean;
  triggerOnError: boolean;
  triggerOnTimeout: boolean;
  timeoutMs: number;
}

const DEFAULT_FALLBACK_CONFIG: FallbackModelConfig = {
  primaryModel: 'grok-3',
  fallbackModel: 'grok-3-mini',
  triggerOnOverload: true,
  triggerOnError: true,
  triggerOnTimeout: true,
  timeoutMs: 30000,
};

export class FallbackModelManager {
  private config: FallbackModelConfig;
  private fallbackActive: boolean = false;
  private fallbackCount: number = 0;

  constructor(config?: Partial<FallbackModelConfig>) {
    this.config = { ...DEFAULT_FALLBACK_CONFIG, ...config };
  }

  shouldFallback(error: { code?: string; status?: number; message?: string }): boolean {
    if (this.fallbackActive) return false;

    if (this.config.triggerOnOverload && (error.status === 429 || error.code === 'rate_limit_exceeded')) {
      return true;
    }
    if (this.config.triggerOnError && error.status && error.status >= 500) {
      return true;
    }
    if (this.config.triggerOnTimeout && (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || error.message?.includes('timeout'))) {
      return true;
    }
    return false;
  }

  getCurrentModel(): string {
    return this.fallbackActive ? this.config.fallbackModel : this.config.primaryModel;
  }

  activateFallback(): void {
    this.fallbackActive = true;
    this.fallbackCount++;
    logger.warn(`Fallback activated: using ${this.config.fallbackModel} (count: ${this.fallbackCount})`);
  }

  deactivateFallback(): void {
    this.fallbackActive = false;
    logger.info(`Fallback deactivated: returning to ${this.config.primaryModel}`);
  }

  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  getFallbackCount(): number {
    return this.fallbackCount;
  }

  getConfig(): FallbackModelConfig {
    return { ...this.config };
  }
}

// ============================================================================
// 5. Config Backup Rotation
// ============================================================================

export class ConfigBackupRotation {
  private maxBackups: number;
  private backupDir: string;

  constructor(backupDir: string, maxBackups?: number) {
    this.backupDir = backupDir;
    this.maxBackups = maxBackups ?? 5;
  }

  createBackup(configPath: string): string {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const configName = path.basename(configPath);
    const timestamp = Date.now();
    const backupPath = path.join(this.backupDir, `${configName}.${timestamp}.bak`);

    fs.copyFileSync(configPath, backupPath);
    logger.info(`Backup created: ${backupPath}`);

    this.rotateBackups(configName);
    return backupPath;
  }

  listBackups(configName: string): Array<{ path: string; timestamp: number }> {
    if (!fs.existsSync(this.backupDir)) return [];

    const files = fs.readdirSync(this.backupDir);
    const pattern = new RegExp(`^${configName.replace(/\./g, '\\.')}\\.(\\d+)\\.bak$`);

    return files
      .filter(f => pattern.test(f))
      .map(f => {
        const match = f.match(pattern)!;
        return {
          path: path.join(this.backupDir, f),
          timestamp: parseInt(match[1], 10),
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  rotateBackups(configName: string): number {
    const backups = this.listBackups(configName);
    let deletedCount = 0;

    if (backups.length > this.maxBackups) {
      const toDelete = backups.slice(this.maxBackups);
      for (const backup of toDelete) {
        try {
          fs.unlinkSync(backup.path);
          deletedCount++;
        } catch (error: unknown) {
          logger.error(`Failed to delete backup: ${backup.path}`, { error: String(error) });
        }
      }
    }

    return deletedCount;
  }

  restoreBackup(backupPath: string, targetPath: string): boolean {
    try {
      if (!fs.existsSync(backupPath)) {
        logger.error(`Backup not found: ${backupPath}`);
        return false;
      }
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(backupPath, targetPath);
      logger.info(`Restored backup from ${backupPath} to ${targetPath}`);
      return true;
    } catch (error: unknown) {
      logger.error('Failed to restore backup', { error: String(error) });
      return false;
    }
  }

  getLatestBackup(configName: string): string | null {
    const backups = this.listBackups(configName);
    return backups.length > 0 ? backups[0].path : null;
  }

  getMaxBackups(): number {
    return this.maxBackups;
  }
}

// ============================================================================
// 6. Devcontainer Support
// ============================================================================

export interface DevcontainerConfig {
  name: string;
  image?: string;
  dockerFile?: string;
  features: Record<string, unknown>;
  forwardPorts: number[];
  postCreateCommand?: string;
  remoteUser?: string;
}

export class DevcontainerManager {
  private config: DevcontainerConfig | null = null;

  constructor() {}

  detect(): boolean {
    const paths = [
      '.devcontainer/devcontainer.json',
      '.devcontainer.json',
    ];
    return paths.some(p => fs.existsSync(p));
  }

  loadConfig(configPath?: string): DevcontainerConfig | null {
    const searchPaths = configPath
      ? [configPath]
      : ['.devcontainer/devcontainer.json', '.devcontainer.json'];

    for (const p of searchPaths) {
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw);
          this.config = {
            name: parsed.name ?? 'devcontainer',
            image: parsed.image,
            dockerFile: parsed.dockerFile ?? parsed.build?.dockerfile,
            features: parsed.features ?? {},
            forwardPorts: parsed.forwardPorts ?? [],
            postCreateCommand: parsed.postCreateCommand,
            remoteUser: parsed.remoteUser,
          };
          logger.info(`Devcontainer config loaded from: ${p}`);
          return this.config;
        }
      } catch (error: unknown) {
        logger.error(`Failed to load devcontainer config from: ${p}`, { error: String(error) });
      }
    }
    return null;
  }

  generateConfig(options: Partial<DevcontainerConfig>): DevcontainerConfig {
    const config: DevcontainerConfig = {
      name: options.name ?? 'code-buddy-dev',
      image: options.image,
      dockerFile: options.dockerFile,
      features: options.features ?? {},
      forwardPorts: options.forwardPorts ?? [],
      postCreateCommand: options.postCreateCommand,
      remoteUser: options.remoteUser ?? 'node',
    };
    this.config = config;
    return config;
  }

  isInsideDevcontainer(): boolean {
    return !!process.env.REMOTE_CONTAINERS || !!process.env.CODESPACES || !!process.env.REMOTE_CONTAINERS_IPC;
  }

  getContainerName(): string | null {
    return this.config?.name ?? null;
  }

  getForwardedPorts(): number[] {
    return this.config?.forwardPorts ?? [];
  }

  serializeConfig(config: DevcontainerConfig): string {
    const output: Record<string, unknown> = { name: config.name };
    if (config.image) output.image = config.image;
    if (config.dockerFile) output.dockerFile = config.dockerFile;
    if (Object.keys(config.features).length > 0) output.features = config.features;
    if (config.forwardPorts.length > 0) output.forwardPorts = config.forwardPorts;
    if (config.postCreateCommand) output.postCreateCommand = config.postCreateCommand;
    if (config.remoteUser) output.remoteUser = config.remoteUser;
    return JSON.stringify(output, null, 2);
  }
}

// ============================================================================
// 7. Setting Sources Control
// ============================================================================

export type SettingSource = 'user' | 'project' | 'local' | 'enterprise' | 'env';

const ALL_SOURCES: SettingSource[] = ['user', 'project', 'local', 'enterprise', 'env'];

export class SettingSourceManager {
  private enabledSources: Set<SettingSource>;
  private allSources: SettingSource[];

  constructor(sources?: SettingSource[]) {
    this.allSources = [...ALL_SOURCES];
    this.enabledSources = new Set(sources ?? ALL_SOURCES);
  }

  static fromFlag(flag: string): SettingSourceManager {
    const parts = flag.split(',').map(s => s.trim()).filter(Boolean) as SettingSource[];
    const valid = parts.filter(s => ALL_SOURCES.includes(s));
    return new SettingSourceManager(valid.length > 0 ? valid : undefined);
  }

  isSourceEnabled(source: SettingSource): boolean {
    return this.enabledSources.has(source);
  }

  enableSource(source: SettingSource): void {
    this.enabledSources.add(source);
  }

  disableSource(source: SettingSource): void {
    this.enabledSources.delete(source);
  }

  getEnabledSources(): SettingSource[] {
    return this.allSources.filter(s => this.enabledSources.has(s));
  }

  getAllSources(): SettingSource[] {
    return [...this.allSources];
  }

  toFlag(): string {
    return this.getEnabledSources().join(',');
  }
}
