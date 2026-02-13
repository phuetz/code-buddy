/**
 * Skills Hub
 *
 * OpenClaw ClawHub-inspired Skills Hub for searching, installing,
 * publishing, and syncing skills from a remote registry.
 *
 * Provides lockfile-based integrity management, SHA-256 checksums,
 * semver version comparison, and event-driven lifecycle hooks.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { logger } from '../utils/logger.js';
import { SkillRegistry } from './skill-registry.js';
import { parseSkillFile, validateSkill } from './parser.js';

// ============================================================================
// Types
// ============================================================================

export interface HubSkill {
  /** Unique skill name */
  name: string;
  /** Semver version */
  version: string;
  /** Human-readable description */
  description: string;
  /** Author name */
  author: string;
  /** Tags for categorization and search */
  tags: string[];
  /** Total downloads */
  downloads: number;
  /** Star count */
  stars: number;
  /** Last updated timestamp (ISO 8601) */
  updatedAt: string;
  /** SHA-256 checksum of skill content */
  checksum: string;
  /** Size in bytes */
  size: number;
  /** Source repository URL */
  repository?: string;
}

export interface HubSearchResult {
  /** Matching skills */
  skills: HubSkill[];
  /** Total number of matches (may exceed returned skills) */
  total: number;
  /** Current page (1-indexed) */
  page: number;
  /** Page size */
  pageSize: number;
}

export interface InstalledSkill {
  /** Skill name */
  name: string;
  /** Installed version */
  version: string;
  /** Installation timestamp (epoch ms) */
  installedAt: number;
  /** Installation source */
  source: 'hub' | 'local' | 'git';
  /** SHA-256 checksum at install time */
  checksum: string;
  /** Path to installed SKILL.md */
  path: string;
}

export interface HubConfig {
  /** Remote registry API base URL */
  registryUrl: string;
  /** Local cache directory for downloaded skills */
  cacheDir: string;
  /** Directory where managed skills are installed */
  skillsDir: string;
  /** Path to the lockfile tracking installed skills */
  lockfilePath: string;
  /** Whether to auto-update on sync */
  autoUpdate: boolean;
  /** Interval in ms between update checks */
  checkIntervalMs: number;
}

export interface HubSearchOptions {
  /** Filter by tags */
  tags?: string[];
  /** Page number (1-indexed) */
  page?: number;
  /** Results per page */
  pageSize?: number;
  /** Max results (alias for pageSize) */
  limit?: number;
  /** Sort by field */
  sortBy?: 'name' | 'downloads' | 'stars' | 'updatedAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

interface Lockfile {
  version: number;
  updatedAt: string;
  skills: Record<string, InstalledSkill>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HUB_CONFIG: HubConfig = {
  registryUrl: 'https://hub.codebuddy.dev/api/v1',
  cacheDir: path.join(os.homedir(), '.codebuddy', 'hub', 'cache'),
  skillsDir: path.join(os.homedir(), '.codebuddy', 'skills', 'managed'),
  lockfilePath: path.join(os.homedir(), '.codebuddy', 'hub', 'lock.json'),
  autoUpdate: false,
  checkIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
};

const LOCKFILE_VERSION = 1;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compute SHA-256 checksum of content.
 */
export function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Parse a semver string into [major, minor, patch] components.
 * Returns [0, 0, 0] for invalid input.
 */
export function parseSemver(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [0, 0, 0];
  }
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

// ============================================================================
// SkillsHub Class
// ============================================================================

export class SkillsHub extends EventEmitter {
  private config: HubConfig;
  private lockfile: Lockfile;
  private cache: Map<string, HubSkill[]> = new Map();
  private cacheTimestamp: number = 0;
  private readonly cacheTtlMs: number = 5 * 60 * 1000; // 5 minutes

  constructor(config: Partial<HubConfig> = {}) {
    super();
    this.config = { ...DEFAULT_HUB_CONFIG, ...config };
    this.lockfile = this.readLockfile();
    this.ensureDirectories();
  }

  // ==========================================================================
  // Directory & Lockfile Management
  // ==========================================================================

  /**
   * Ensure required directories exist.
   */
  private ensureDirectories(): void {
    for (const dir of [this.config.cacheDir, this.config.skillsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const lockDir = path.dirname(this.config.lockfilePath);
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
  }

  /**
   * Read the lockfile from disk. Returns an empty lockfile if not found.
   */
  private readLockfile(): Lockfile {
    try {
      if (fs.existsSync(this.config.lockfilePath)) {
        const raw = fs.readFileSync(this.config.lockfilePath, 'utf-8');
        const parsed = JSON.parse(raw) as Lockfile;
        if (parsed.version === LOCKFILE_VERSION && parsed.skills) {
          return parsed;
        }
      }
    } catch (err) {
      logger.warn('Failed to read hub lockfile, starting fresh', {
        path: this.config.lockfilePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      version: LOCKFILE_VERSION,
      updatedAt: new Date().toISOString(),
      skills: {},
    };
  }

  /**
   * Write the lockfile to disk.
   */
  private writeLockfile(): void {
    this.lockfile.updatedAt = new Date().toISOString();
    const content = JSON.stringify(this.lockfile, null, 2);
    fs.writeFileSync(this.config.lockfilePath, content, 'utf-8');
    logger.debug('Hub lockfile written', { path: this.config.lockfilePath });
  }

  /**
   * Get the lockfile contents (for testing / external inspection).
   */
  getLockfile(): Lockfile {
    return { ...this.lockfile, skills: { ...this.lockfile.skills } };
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  /**
   * Search for skills by query string matching name, tags, and description.
   * Checks local cache first, then fetches from remote registry.
   */
  async search(query: string, options: HubSearchOptions = {}): Promise<HubSearchResult> {
    const {
      tags,
      page = 1,
      pageSize: rawPageSize = 20,
      limit,
      sortBy = 'downloads',
      sortOrder = 'desc',
    } = options;
    const pageSize = limit ?? rawPageSize;

    logger.debug('Hub search', { query, tags, page, pageSize });

    // Try remote fetch, fall back to cache
    let allSkills: HubSkill[];
    try {
      allSkills = await this.fetchRemoteSkills(query);
    } catch {
      logger.debug('Remote fetch failed, using local cache');
      allSkills = this.getLocalCacheSkills();
    }

    // Filter by query
    const queryLower = query.toLowerCase();
    let filtered = allSkills.filter(skill => {
      const nameMatch = skill.name.toLowerCase().includes(queryLower);
      const descMatch = skill.description.toLowerCase().includes(queryLower);
      const tagMatch = skill.tags.some(t => t.toLowerCase().includes(queryLower));
      return nameMatch || descMatch || tagMatch;
    });

    // Filter by tags
    if (tags && tags.length > 0) {
      const tagsLower = tags.map(t => t.toLowerCase());
      filtered = filtered.filter(skill =>
        skill.tags.some(t => tagsLower.includes(t.toLowerCase()))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];

      let cmp: number;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }

      return sortOrder === 'desc' ? -cmp : cmp;
    });

    // Paginate
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const skills = filtered.slice(start, start + pageSize);

    return { skills, total, page, pageSize };
  }

  /**
   * Fetch skills from the remote registry.
   * In a real implementation this would call the API.
   * For now, returns cached data or an empty array.
   */
  private async fetchRemoteSkills(query: string): Promise<HubSkill[]> {
    const url = `${this.config.registryUrl}/skills/search?q=${encodeURIComponent(query)}`;
    logger.debug('Fetching remote skills', { url });

    // Attempt HTTP fetch
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'codebuddy-hub/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json() as { skills?: HubSkill[] };
        if (data.skills && Array.isArray(data.skills)) {
          // Update local cache
          this.cache.set('remote', data.skills);
          this.cacheTimestamp = Date.now();
          this.writeLocalCache(data.skills);
          return data.skills;
        }
      }
    } catch {
      // Network error or timeout - fall through to cache
    }

    // Return cached data if fresh enough
    if (this.cache.has('remote') && Date.now() - this.cacheTimestamp < this.cacheTtlMs) {
      return this.cache.get('remote')!;
    }

    return this.getLocalCacheSkills();
  }

  /**
   * Read locally cached skills from the cache directory.
   */
  private getLocalCacheSkills(): HubSkill[] {
    const cacheFile = path.join(this.config.cacheDir, 'registry-cache.json');
    try {
      if (fs.existsSync(cacheFile)) {
        const raw = fs.readFileSync(cacheFile, 'utf-8');
        const data = JSON.parse(raw) as { skills?: HubSkill[] };
        return data.skills || [];
      }
    } catch {
      // Corrupted cache, ignore
    }
    return [];
  }

  /**
   * Write skills to local cache file.
   */
  private writeLocalCache(skills: HubSkill[]): void {
    const cacheFile = path.join(this.config.cacheDir, 'registry-cache.json');
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ skills, cachedAt: new Date().toISOString() }), 'utf-8');
    } catch {
      logger.debug('Failed to write local cache');
    }
  }

  // ==========================================================================
  // Install
  // ==========================================================================

  /**
   * Install a skill by name and optional version.
   * Downloads the skill content and writes it to the managed skills directory.
   */
  async install(skillName: string, version?: string): Promise<InstalledSkill> {
    // Validate skill name to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName)) {
      throw new Error(`Invalid skill name: ${skillName}. Only alphanumeric, dash, and underscore allowed.`);
    }

    logger.info('Installing skill', { name: skillName, version: version || 'latest' });

    // Check if already installed with same version
    const existing = this.lockfile.skills[skillName];
    if (existing && version && existing.version === version) {
      logger.info('Skill already installed at requested version', { name: skillName, version });
      return existing;
    }

    // Fetch skill content
    const content = await this.fetchSkillContent(skillName, version);
    const checksum = computeChecksum(content);

    // Parse and validate the SKILL.md content
    const resolvedVersion = this.extractVersionFromContent(content) || version || '0.0.0';
    this.validateSkillContent(content, skillName);

    // Write to managed skills directory
    const skillDir = path.join(this.config.skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf-8');

    // Update lockfile
    const installed: InstalledSkill = {
      name: skillName,
      version: resolvedVersion,
      installedAt: Date.now(),
      source: 'hub',
      checksum,
      path: skillPath,
    };

    this.lockfile.skills[skillName] = installed;
    this.writeLockfile();

    logger.info('Skill installed', { name: skillName, version: resolvedVersion, checksum });
    this.emit('skill:installed', installed);

    return installed;
  }

  /**
   * Fetch skill content from the hub or local source.
   * In a real implementation, this would download from the registry.
   */
  private async fetchSkillContent(skillName: string, version?: string): Promise<string> {
    const versionParam = version ? `&version=${encodeURIComponent(version)}` : '';
    const url = `${this.config.registryUrl}/skills/${encodeURIComponent(skillName)}/download?format=skillmd${versionParam}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/markdown',
          'User-Agent': 'codebuddy-hub/1.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        return await response.text();
      }

      throw new Error(`Hub returned status ${response.status}: ${response.statusText}`);
    } catch (err) {
      // Check local cache
      const cached = path.join(this.config.cacheDir, `${skillName}.skill.md`);
      if (fs.existsSync(cached)) {
        logger.debug('Using cached skill content', { name: skillName });
        return fs.readFileSync(cached, 'utf-8');
      }

      throw new Error(
        `Failed to fetch skill '${skillName}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Install a skill from local content string (for local/offline installs).
   */
  async installFromContent(
    skillName: string,
    content: string,
    source: InstalledSkill['source'] = 'local'
  ): Promise<InstalledSkill> {
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName)) {
      throw new Error(`Invalid skill name: ${skillName}. Only alphanumeric, dash, and underscore allowed.`);
    }

    const checksum = computeChecksum(content);
    const version = this.extractVersionFromContent(content) || '0.0.0';

    this.validateSkillContent(content, skillName);

    // Write to managed skills directory
    const skillDir = path.join(this.config.skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    const skillPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillPath, content, 'utf-8');

    const installed: InstalledSkill = {
      name: skillName,
      version,
      installedAt: Date.now(),
      source,
      checksum,
      path: skillPath,
    };

    this.lockfile.skills[skillName] = installed;
    this.writeLockfile();

    logger.info('Skill installed from content', { name: skillName, version, source });
    this.emit('skill:installed', installed);

    return installed;
  }

  // ==========================================================================
  // Uninstall
  // ==========================================================================

  /**
   * Remove an installed skill.
   */
  async uninstall(skillName: string): Promise<boolean> {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Skill not found in lockfile', { name: skillName });
      return false;
    }

    logger.info('Uninstalling skill', { name: skillName });

    // Remove skill directory
    const skillDir = path.join(this.config.skillsDir, skillName);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }

    // Remove from lockfile
    delete this.lockfile.skills[skillName];
    this.writeLockfile();

    logger.info('Skill uninstalled', { name: skillName });
    this.emit('skill:removed', skillName);

    return true;
  }

  // ==========================================================================
  // Update
  // ==========================================================================

  /**
   * Update one or all installed skills.
   * If skillName is provided, updates that skill only.
   * Otherwise updates all installed skills.
   */
  async update(skillName?: string): Promise<InstalledSkill[]> {
    const updated: InstalledSkill[] = [];

    const toUpdate = skillName
      ? [this.lockfile.skills[skillName]].filter(Boolean)
      : Object.values(this.lockfile.skills);

    if (toUpdate.length === 0) {
      logger.info('No skills to update');
      return updated;
    }

    for (const skill of toUpdate) {
      try {
        // Check for newer version
        const hubInfo = await this.getHubSkillInfo(skill.name);
        if (!hubInfo) {
          logger.debug('Skill not found on hub, skipping update', { name: skill.name });
          continue;
        }

        if (compareSemver(hubInfo.version, skill.version) <= 0) {
          logger.debug('Skill already at latest version', {
            name: skill.name,
            current: skill.version,
            available: hubInfo.version,
          });
          continue;
        }

        logger.info('Updating skill', {
          name: skill.name,
          from: skill.version,
          to: hubInfo.version,
        });

        const installed = await this.install(skill.name, hubInfo.version);
        updated.push(installed);
        this.emit('skill:updated', installed);
      } catch (err) {
        logger.error('Failed to update skill', {
          name: skill.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return updated;
  }

  /**
   * Get skill info from the hub API.
   */
  private async getHubSkillInfo(skillName: string): Promise<HubSkill | null> {
    const url = `${this.config.registryUrl}/skills/${encodeURIComponent(skillName)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'codebuddy-hub/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        return await response.json() as HubSkill;
      }
    } catch {
      // Network error
    }

    return null;
  }

  // ==========================================================================
  // Publish
  // ==========================================================================

  /**
   * Validate and prepare a skill for publishing.
   * Reads the SKILL.md, validates YAML frontmatter, computes checksum,
   * and returns the prepared HubSkill metadata.
   */
  async publish(skillPath: string): Promise<HubSkill> {
    const resolvedPath = path.resolve(skillPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Skill file not found: ${resolvedPath}`);
    }

    // Determine the SKILL.md path
    let skillFilePath: string;
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      skillFilePath = path.join(resolvedPath, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) {
        throw new Error(`No SKILL.md found in directory: ${resolvedPath}`);
      }
    } else {
      skillFilePath = resolvedPath;
    }

    const content = fs.readFileSync(skillFilePath, 'utf-8');

    // Parse and validate
    const skill = parseSkillFile(content, skillFilePath, 'workspace');
    const validation = validateSkill(skill);

    if (!validation.valid) {
      throw new Error(`Skill validation failed: ${validation.errors.join(', ')}`);
    }

    // Ensure required publish fields
    if (!skill.metadata.version) {
      throw new Error('Skill version is required for publishing (add version to frontmatter)');
    }

    if (!skill.metadata.description) {
      throw new Error('Skill description is required for publishing');
    }

    const checksum = computeChecksum(content);
    const size = Buffer.byteLength(content, 'utf-8');

    const hubSkill: HubSkill = {
      name: skill.metadata.name,
      version: skill.metadata.version,
      description: skill.metadata.description,
      author: skill.metadata.author || 'unknown',
      tags: skill.metadata.tags || [],
      downloads: 0,
      stars: 0,
      updatedAt: new Date().toISOString(),
      checksum,
      size,
    };

    logger.info('Skill prepared for publishing', {
      name: hubSkill.name,
      version: hubSkill.version,
      checksum,
      size,
    });

    this.emit('skill:published', hubSkill);

    return hubSkill;
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  /**
   * Sync the lockfile with actually installed skills.
   * - Removes lockfile entries for skills that no longer exist on disk.
   * - Detects checksum mismatches (manual edits).
   * - Optionally triggers updates if autoUpdate is enabled.
   */
  async sync(): Promise<{ removed: string[]; mismatched: string[]; updated: string[] }> {
    const removed: string[] = [];
    const mismatched: string[] = [];
    const updated: string[] = [];

    logger.info('Syncing hub lockfile');

    // Check each locked skill
    const skillNames = Object.keys(this.lockfile.skills);
    for (const name of skillNames) {
      const entry = this.lockfile.skills[name];

      // Check if skill still exists on disk
      if (!fs.existsSync(entry.path)) {
        logger.info('Skill file missing, removing from lockfile', { name, path: entry.path });
        delete this.lockfile.skills[name];
        removed.push(name);
        continue;
      }

      // Verify checksum
      const content = fs.readFileSync(entry.path, 'utf-8');
      const currentChecksum = computeChecksum(content);

      if (currentChecksum !== entry.checksum) {
        logger.warn('Skill checksum mismatch (file was modified externally)', {
          name,
          expected: entry.checksum,
          actual: currentChecksum,
        });
        mismatched.push(name);

        // Update the lockfile entry to reflect current state
        entry.checksum = currentChecksum;
        const newVersion = this.extractVersionFromContent(content);
        if (newVersion) {
          entry.version = newVersion;
        }
      }
    }

    // Auto-update if configured
    if (this.config.autoUpdate) {
      const updateResults = await this.update();
      for (const result of updateResults) {
        updated.push(result.name);
      }
    }

    this.writeLockfile();

    logger.info('Hub sync complete', {
      removed: removed.length,
      mismatched: mismatched.length,
      updated: updated.length,
    });

    return { removed, mismatched, updated };
  }

  // ==========================================================================
  // List & Info
  // ==========================================================================

  /**
   * List all installed skills from the lockfile.
   */
  list(): InstalledSkill[] {
    return Object.values(this.lockfile.skills);
  }

  /**
   * Get detailed information about an installed skill.
   * Returns the lockfile entry plus the current on-disk content metadata.
   */
  info(skillName: string): { installed: InstalledSkill; content?: string; integrityOk: boolean } | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      return null;
    }

    let content: string | undefined;
    let integrityOk = false;

    if (fs.existsSync(installed.path)) {
      content = fs.readFileSync(installed.path, 'utf-8');
      const currentChecksum = computeChecksum(content);
      integrityOk = currentChecksum === installed.checksum;
    }

    return { installed, content, integrityOk };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Extract the version field from SKILL.md YAML frontmatter.
   */
  private extractVersionFromContent(content: string): string | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    try {
      const parsed = yaml.parse(match[1]) as Record<string, unknown>;
      if (typeof parsed.version === 'string') {
        return parsed.version;
      }
    } catch {
      // Invalid YAML
    }

    return null;
  }

  /**
   * Validate skill content by parsing it and checking required fields.
   */
  private validateSkillContent(content: string, skillName: string): void {
    // Check that it has valid frontmatter
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) {
      throw new Error(`Invalid SKILL.md format for '${skillName}': missing YAML frontmatter`);
    }

    try {
      const parsed = yaml.parse(match[1]) as Record<string, unknown>;
      if (!parsed.name || typeof parsed.name !== 'string') {
        throw new Error(`SKILL.md for '${skillName}' is missing required 'name' field`);
      }
      if (!parsed.description || typeof parsed.description !== 'string') {
        throw new Error(`SKILL.md for '${skillName}' is missing required 'description' field`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('SKILL.md')) {
        throw err;
      }
      throw new Error(
        `Failed to parse YAML frontmatter for '${skillName}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Get hub configuration.
   */
  getConfig(): Readonly<HubConfig> {
    return { ...this.config };
  }

  /**
   * Shutdown and cleanup.
   */
  shutdown(): void {
    this.cache.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let hubInstance: SkillsHub | null = null;

/**
 * Get the singleton SkillsHub instance.
 */
export function getSkillsHub(config?: Partial<HubConfig>): SkillsHub {
  if (!hubInstance) {
    hubInstance = new SkillsHub(config);
  }
  return hubInstance;
}

/**
 * Reset the singleton SkillsHub instance (for testing).
 */
export function resetSkillsHub(): void {
  if (hubInstance) {
    hubInstance.shutdown();
  }
  hubInstance = null;
}

export default SkillsHub;
