/**
 * Skills Registry Module
 *
 * A ClawHub-like registry for discovering, installing, and managing skills.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface SkillManifest {
  /** Skill unique name (e.g., '@author/skill-name') */
  name: string;
  /** Version (semver) */
  version: string;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Author info */
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  /** Homepage URL */
  homepage?: string;
  /** Repository URL */
  repository?: string;
  /** License */
  license: string;
  /** Keywords for search */
  keywords: string[];
  /** Dependencies (other skills) */
  dependencies?: Record<string, string>;
  /** Platform requirements */
  platforms?: string[];
  /** Required tools/binaries */
  requirements?: {
    bins?: string[];
    env?: string[];
    nodeVersion?: string;
  };
  /** Entry point */
  main: string;
  /** Skill category */
  category: SkillCategory;
  /** Is verified/official */
  verified?: boolean;
  /** Icon URL */
  icon?: string;
}

export type SkillCategory =
  | 'development'
  | 'productivity'
  | 'communication'
  | 'data'
  | 'security'
  | 'automation'
  | 'integration'
  | 'utility'
  | 'other';

export interface SkillVersion {
  /** Version string */
  version: string;
  /** Release date */
  releasedAt: Date;
  /** Changelog */
  changelog?: string;
  /** Download URL */
  downloadUrl: string;
  /** Checksum */
  checksum: string;
  /** Size in bytes */
  size: number;
  /** Deprecated */
  deprecated?: boolean;
  /** Deprecation message */
  deprecationMessage?: string;
}

export interface InstalledSkill {
  /** Skill manifest */
  manifest: SkillManifest;
  /** Installation path */
  installPath: string;
  /** Installed at */
  installedAt: Date;
  /** Updated at */
  updatedAt?: Date;
  /** Is enabled */
  enabled: boolean;
  /** Configuration */
  config?: Record<string, unknown>;
}

export interface SkillSearchResult {
  /** Skill name */
  name: string;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Latest version */
  latestVersion: string;
  /** Author name */
  author: string;
  /** Download count */
  downloads: number;
  /** Star count */
  stars: number;
  /** Is verified */
  verified: boolean;
  /** Category */
  category: SkillCategory;
  /** Keywords */
  keywords: string[];
  /** Updated at */
  updatedAt: Date;
}

export interface RegistryConfig {
  /** Registry URL */
  registryUrl: string;
  /** Installation directory */
  installDir: string;
  /** Enable auto-updates */
  autoUpdate: boolean;
  /** Update check interval (ms) */
  updateCheckIntervalMs: number;
  /** Cache TTL (ms) */
  cacheTTLMs: number;
  /** Allow unverified skills */
  allowUnverified: boolean;
}

export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  registryUrl: 'https://registry.codebuddy.dev',
  installDir: '~/.codebuddy/skills',
  autoUpdate: true,
  updateCheckIntervalMs: 24 * 60 * 60 * 1000, // Daily
  cacheTTLMs: 60 * 60 * 1000, // 1 hour
  allowUnverified: true,
};

export interface RegistryEvents {
  'skill-install': (skill: InstalledSkill) => void;
  'skill-uninstall': (name: string) => void;
  'skill-update': (skill: InstalledSkill, oldVersion: string) => void;
  'skill-enable': (name: string) => void;
  'skill-disable': (name: string) => void;
  'search-complete': (results: SkillSearchResult[]) => void;
  'update-available': (name: string, currentVersion: string, newVersion: string) => void;
  'error': (error: Error) => void;
}

// ============================================================================
// Skills Registry
// ============================================================================

export class SkillsRegistry extends EventEmitter {
  private config: RegistryConfig;
  private installedSkills: Map<string, InstalledSkill> = new Map();
  private searchCache: Map<string, { results: SkillSearchResult[]; timestamp: number }> = new Map();
  private updateCheckTimer: NodeJS.Timeout | null = null;

  // Mock registry data
  private mockRegistry: SkillSearchResult[] = [];

  constructor(config: Partial<RegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.initializeMockRegistry();
  }

  private initializeMockRegistry(): void {
    this.mockRegistry = [
      {
        name: '@codebuddy/git-workflow',
        displayName: 'Git Workflow',
        description: 'Enhanced Git operations with smart commit messages and PR creation',
        latestVersion: '2.1.0',
        author: 'Code Buddy Team',
        downloads: 15420,
        stars: 342,
        verified: true,
        category: 'development',
        keywords: ['git', 'workflow', 'commit', 'pr'],
        updatedAt: new Date('2025-01-15'),
      },
      {
        name: '@codebuddy/code-review',
        displayName: 'Code Review Assistant',
        description: 'AI-powered code review with suggestions and best practices',
        latestVersion: '1.5.2',
        author: 'Code Buddy Team',
        downloads: 12850,
        stars: 289,
        verified: true,
        category: 'development',
        keywords: ['review', 'quality', 'suggestions'],
        updatedAt: new Date('2025-01-10'),
      },
      {
        name: '@codebuddy/test-generator',
        displayName: 'Test Generator',
        description: 'Automatically generate unit tests for your code',
        latestVersion: '1.2.0',
        author: 'Code Buddy Team',
        downloads: 9840,
        stars: 215,
        verified: true,
        category: 'development',
        keywords: ['test', 'unit', 'coverage', 'jest'],
        updatedAt: new Date('2025-01-08'),
      },
      {
        name: '@community/slack-notifier',
        displayName: 'Slack Notifier',
        description: 'Send notifications to Slack channels',
        latestVersion: '0.8.3',
        author: 'Community',
        downloads: 5620,
        stars: 98,
        verified: false,
        category: 'communication',
        keywords: ['slack', 'notification', 'messaging'],
        updatedAt: new Date('2024-12-20'),
      },
      {
        name: '@community/data-transformer',
        displayName: 'Data Transformer',
        description: 'Transform data between formats (JSON, CSV, YAML, etc.)',
        latestVersion: '1.0.1',
        author: 'DataWizard',
        downloads: 4280,
        stars: 76,
        verified: false,
        category: 'data',
        keywords: ['json', 'csv', 'yaml', 'transform', 'convert'],
        updatedAt: new Date('2024-12-15'),
      },
      {
        name: '@security/vault-manager',
        displayName: 'Vault Manager',
        description: 'Securely manage secrets and credentials',
        latestVersion: '2.0.0',
        author: 'Security Team',
        downloads: 7890,
        stars: 156,
        verified: true,
        category: 'security',
        keywords: ['vault', 'secrets', 'credentials', 'security'],
        updatedAt: new Date('2025-01-05'),
      },
    ];
  }

  // ============================================================================
  // Search & Discovery
  // ============================================================================

  /**
   * Search for skills
   */
  async search(query: string, options?: {
    category?: SkillCategory;
    verified?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<SkillSearchResult[]> {
    // Check cache
    const cacheKey = JSON.stringify({ query, options });
    const cached = this.searchCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
      return cached.results;
    }

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 100));

    let results = [...this.mockRegistry];

    // Filter by query
    if (query) {
      const lowerQuery = query.toLowerCase();
      results = results.filter(skill =>
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.displayName.toLowerCase().includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery) ||
        skill.keywords.some(k => k.toLowerCase().includes(lowerQuery))
      );
    }

    // Filter by category
    if (options?.category) {
      results = results.filter(skill => skill.category === options.category);
    }

    // Filter by verified
    if (options?.verified !== undefined) {
      results = results.filter(skill => skill.verified === options.verified);
    }

    // Pagination
    const offset = options?.offset || 0;
    const limit = options?.limit || 20;
    results = results.slice(offset, offset + limit);

    // Cache results
    this.searchCache.set(cacheKey, { results, timestamp: Date.now() });

    this.emit('search-complete', results);
    return results;
  }

  /**
   * Get skill details
   */
  async getSkillDetails(name: string): Promise<SkillSearchResult | null> {
    await new Promise(resolve => setTimeout(resolve, 50));
    return this.mockRegistry.find(s => s.name === name) || null;
  }

  /**
   * Get skill versions
   */
  async getVersions(name: string): Promise<SkillVersion[]> {
    await new Promise(resolve => setTimeout(resolve, 50));

    const skill = this.mockRegistry.find(s => s.name === name);
    if (!skill) return [];

    // Mock versions
    return [
      {
        version: skill.latestVersion,
        releasedAt: skill.updatedAt,
        downloadUrl: `${this.config.registryUrl}/packages/${name}/${skill.latestVersion}`,
        checksum: crypto.randomBytes(32).toString('hex'),
        size: 102400,
      },
      {
        version: '1.0.0',
        releasedAt: new Date('2024-01-01'),
        downloadUrl: `${this.config.registryUrl}/packages/${name}/1.0.0`,
        checksum: crypto.randomBytes(32).toString('hex'),
        size: 98304,
      },
    ];
  }

  /**
   * Get featured/popular skills
   */
  async getFeatured(): Promise<SkillSearchResult[]> {
    return this.mockRegistry
      .filter(s => s.verified)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 5);
  }

  /**
   * Get skills by category
   */
  async getByCategory(category: SkillCategory): Promise<SkillSearchResult[]> {
    return this.search('', { category });
  }

  // ============================================================================
  // Installation
  // ============================================================================

  /**
   * Install a skill
   */
  async install(name: string, version?: string): Promise<InstalledSkill> {
    // Check if already installed
    if (this.installedSkills.has(name)) {
      throw new Error(`Skill ${name} is already installed`);
    }

    // Get skill details
    const details = await this.getSkillDetails(name);
    if (!details) {
      throw new Error(`Skill ${name} not found in registry`);
    }

    // Check if unverified is allowed
    if (!details.verified && !this.config.allowUnverified) {
      throw new Error(`Skill ${name} is not verified. Enable allowUnverified to install.`);
    }

    // Simulate download
    await new Promise(resolve => setTimeout(resolve, 200));

    const installed: InstalledSkill = {
      manifest: {
        name: details.name,
        version: version || details.latestVersion,
        displayName: details.displayName,
        description: details.description,
        author: { name: details.author },
        license: 'MIT',
        keywords: details.keywords,
        main: 'index.js',
        category: details.category,
        verified: details.verified,
      },
      installPath: `${this.config.installDir}/${name}`,
      installedAt: new Date(),
      enabled: true,
    };

    this.installedSkills.set(name, installed);
    this.emit('skill-install', installed);

    return installed;
  }

  /**
   * Uninstall a skill
   */
  async uninstall(name: string): Promise<boolean> {
    if (!this.installedSkills.has(name)) {
      return false;
    }

    // Simulate cleanup
    await new Promise(resolve => setTimeout(resolve, 50));

    this.installedSkills.delete(name);
    this.emit('skill-uninstall', name);

    return true;
  }

  /**
   * Update a skill
   */
  async update(name: string, version?: string): Promise<InstalledSkill | null> {
    const installed = this.installedSkills.get(name);
    if (!installed) {
      return null;
    }

    const details = await this.getSkillDetails(name);
    if (!details) {
      return null;
    }

    const targetVersion = version || details.latestVersion;
    if (installed.manifest.version === targetVersion) {
      return installed; // Already up to date
    }

    const oldVersion = installed.manifest.version;

    // Simulate update
    await new Promise(resolve => setTimeout(resolve, 150));

    installed.manifest.version = targetVersion;
    installed.updatedAt = new Date();

    this.emit('skill-update', installed, oldVersion);

    return installed;
  }

  /**
   * Update all skills
   */
  async updateAll(): Promise<InstalledSkill[]> {
    const updated: InstalledSkill[] = [];

    for (const [name, _installed] of this.installedSkills) {
      const result = await this.update(name);
      if (result) {
        updated.push(result);
      }
    }

    return updated;
  }

  // ============================================================================
  // Installed Skills Management
  // ============================================================================

  /**
   * Get installed skills
   */
  getInstalled(): InstalledSkill[] {
    return Array.from(this.installedSkills.values());
  }

  /**
   * Get installed skill by name
   */
  getInstalledSkill(name: string): InstalledSkill | undefined {
    return this.installedSkills.get(name);
  }

  /**
   * Check if skill is installed
   */
  isInstalled(name: string): boolean {
    return this.installedSkills.has(name);
  }

  /**
   * Enable a skill
   */
  enable(name: string): boolean {
    const skill = this.installedSkills.get(name);
    if (!skill) return false;

    skill.enabled = true;
    this.emit('skill-enable', name);
    return true;
  }

  /**
   * Disable a skill
   */
  disable(name: string): boolean {
    const skill = this.installedSkills.get(name);
    if (!skill) return false;

    skill.enabled = false;
    this.emit('skill-disable', name);
    return true;
  }

  /**
   * Get enabled skills
   */
  getEnabled(): InstalledSkill[] {
    return Array.from(this.installedSkills.values()).filter(s => s.enabled);
  }

  /**
   * Configure a skill
   */
  configure(name: string, config: Record<string, unknown>): boolean {
    const skill = this.installedSkills.get(name);
    if (!skill) return false;

    skill.config = { ...skill.config, ...config };
    return true;
  }

  // ============================================================================
  // Update Checking
  // ============================================================================

  /**
   * Check for updates
   */
  async checkForUpdates(): Promise<Array<{ name: string; current: string; latest: string }>> {
    const updates: Array<{ name: string; current: string; latest: string }> = [];

    for (const [name, installed] of this.installedSkills) {
      const details = await this.getSkillDetails(name);
      if (details && details.latestVersion !== installed.manifest.version) {
        updates.push({
          name,
          current: installed.manifest.version,
          latest: details.latestVersion,
        });
        this.emit('update-available', name, installed.manifest.version, details.latestVersion);
      }
    }

    return updates;
  }

  /**
   * Start auto-update checking
   */
  startAutoUpdateCheck(): void {
    if (this.updateCheckTimer) return;

    this.updateCheckTimer = setInterval(() => {
      this.checkForUpdates().catch(error => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    }, this.config.updateCheckIntervalMs);
  }

  /**
   * Stop auto-update checking
   */
  stopAutoUpdateCheck(): void {
    if (this.updateCheckTimer) {
      clearInterval(this.updateCheckTimer);
      this.updateCheckTimer = null;
    }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get configuration
   */
  getConfig(): RegistryConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RegistryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.searchCache.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    installedCount: number;
    enabledCount: number;
    cacheEntries: number;
    isAutoUpdating: boolean;
  } {
    return {
      installedCount: this.installedSkills.size,
      enabledCount: this.getEnabled().length,
      cacheEntries: this.searchCache.size,
      isAutoUpdating: this.updateCheckTimer !== null,
    };
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    this.stopAutoUpdateCheck();
    this.clearCache();
    this.installedSkills.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let skillsRegistryInstance: SkillsRegistry | null = null;

export function getSkillsRegistry(config?: Partial<RegistryConfig>): SkillsRegistry {
  if (!skillsRegistryInstance) {
    skillsRegistryInstance = new SkillsRegistry(config);
  }
  return skillsRegistryInstance;
}

export function resetSkillsRegistry(): void {
  if (skillsRegistryInstance) {
    skillsRegistryInstance.shutdown();
    skillsRegistryInstance = null;
  }
}
