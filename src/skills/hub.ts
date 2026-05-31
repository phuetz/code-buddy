/**
 * Skills Hub
 *
 * Native Engine ClawHub-inspired Skills Hub for searching, installing,
 * publishing, and syncing skills from a remote registry.
 *
 * Provides lockfile-based integrity management, SHA-256 checksums,
 * semver version comparison, and event-driven lifecycle hooks.
 */

import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { logger } from '../utils/logger.js';
import { generateDiff } from '../utils/diff-generator.js';
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
  /** Lightweight local usage telemetry for skill curation */
  usage?: SkillUsageStats;
  /**
   * Whether the skill is active. Absent = enabled (backward compatible with
   * lockfiles written before this field existed). Disabled skills stay
   * installed but can be filtered out of selection via `listEnabled()`.
   */
  enabled?: boolean;
  /** Local lifecycle metadata for review-gated management actions. */
  lifecycle?: SkillLifecycleState;
  /** Previous on-disk SKILL.md snapshots available for rollback. */
  history?: SkillVersionSnapshot[];
}

export interface InstalledSkillStatus extends InstalledSkill {
  exists: boolean;
  integrityOk: boolean;
  sizeBytes?: number;
}

export interface SkillUsageStats {
  /** Total invocations recorded locally */
  invocationCount: number;
  /** Successful invocations */
  successCount: number;
  /** Failed invocations */
  failureCount: number;
  /** Last usage timestamp (epoch ms) */
  lastUsedAt: number;
  /** Last invocation duration in ms */
  lastDurationMs?: number;
  /** Running average duration in ms */
  averageDurationMs?: number;
  /** Last failure message, cleared on success */
  lastError?: string;
}

export interface SkillLifecycleState {
  status: 'active' | 'disabled' | 'deprecated';
  updatedAt: number;
  updatedBy?: string;
  reason?: string;
}

export interface SkillVersionSnapshot {
  id: string;
  createdAt: number;
  checksum: string;
  version: string;
  snapshotPath: string;
  createdBy?: string;
  reason?: string;
}

export interface SkillPatchOptions {
  actor?: string;
  expectedReplacements?: number;
  filePath?: string;
  reason?: string;
  replaceAll?: boolean;
  updatedAt?: number;
}

export interface SkillPatchResult {
  installed: InstalledSkill;
  filePath: string;
  replacements: number;
  snapshot: SkillVersionSnapshot;
}

export interface SkillEditOptions {
  actor?: string;
  reason?: string;
  updatedAt?: number;
}

export interface SkillEditResult {
  installed: InstalledSkill;
  snapshot: SkillVersionSnapshot;
}

export interface SkillFileMutationOptions {
  actor?: string;
  reason?: string;
  updatedAt?: number;
}

export interface SkillWriteFileResult {
  absolutePath: string;
  bytesWritten: number;
  filePath: string;
  installed: InstalledSkill;
  snapshot: SkillVersionSnapshot;
}

export interface SkillRemoveFileResult {
  absolutePath: string;
  filePath: string;
  installed: InstalledSkill;
  removed: boolean;
  snapshot: SkillVersionSnapshot;
}

export interface SkillRollbackOptions {
  actor?: string;
  reason?: string;
  updatedAt?: number;
}

export interface SkillRollbackResult {
  installed: InstalledSkill;
  restoredSnapshot: SkillVersionSnapshot;
  currentSnapshot: SkillVersionSnapshot;
}

export interface SkillUpdateOptions {
  actor?: string;
  force?: boolean;
  reason?: string;
  updatedAt?: number;
  version?: string;
}

export interface SkillUpdateResult {
  installed: InstalledSkill;
  fromVersion: string;
  toVersion: string;
  snapshot: SkillVersionSnapshot;
}

export interface SkillResetOptions {
  actor?: string;
  reason?: string;
  updatedAt?: number;
  version?: string;
}

export interface SkillResetResult {
  installed: InstalledSkill;
  fromChecksum?: string;
  fromVersion: string;
  recreated: boolean;
  snapshot?: SkillVersionSnapshot;
  toChecksum: string;
  toVersion: string;
}

export interface SkillUpdatePreviewOptions {
  maxDiffChars?: number;
  maxDiffLines?: number;
  version?: string;
}

export interface SkillUpdatePreviewDiff {
  addedLines: number;
  maxChars: number;
  maxLines: number;
  preview: string;
  removedLines: number;
  summary: string;
  truncated: boolean;
}

export interface SkillUpdatePreviewResult {
  currentChecksum: string;
  diff: SkillUpdatePreviewDiff;
  installCommand: string;
  name: string;
  remoteChecksum: string;
  sameContent: boolean;
  updateAvailable: boolean;
  fromVersion: string;
  toVersion: string;
}

export interface SkillHistoryCurrent {
  checksum: string;
  enabled: boolean;
  exists: boolean;
  installedAt: number;
  integrityOk: boolean;
  path: string;
  source: InstalledSkill['source'];
  version: string;
  lifecycle?: SkillLifecycleState;
  sizeBytes?: number;
}

export interface SkillHistorySnapshot extends SkillVersionSnapshot {
  rollbackable: boolean;
  snapshotExists: boolean;
  snapshotIntegrityOk: boolean;
  sizeBytes?: number;
}

export interface SkillHistoryResult {
  installed: InstalledSkill;
  current: SkillHistoryCurrent;
  snapshots: SkillHistorySnapshot[];
  rollbackableCount: number;
  missingSnapshotCount: number;
}

export interface SkillUsageRecord {
  success: boolean;
  durationMs?: number;
  error?: string;
  usedAt?: number;
}

export type SkillTapTrust = 'builtin' | 'official' | 'trusted' | 'community';

export interface SkillTap {
  /** GitHub owner/repo or another stable tap identifier. */
  repo: string;
  /** Directory inside the tap repository that contains skill folders. */
  path: string;
  /** Trust level used by review/install surfaces before accepting third-party SKILL.md content. */
  trust: SkillTapTrust;
  /** First time this tap was added (epoch ms). */
  addedAt: number;
  /** Last local metadata update (epoch ms). */
  updatedAt: number;
  /** Optional reviewer/operator who approved adding the tap. */
  addedBy?: string;
}

export type HubSkillSource = 'registry' | 'github-tap' | 'well-known';

export interface DiscoveredHubSkill extends HubSkill {
  /** Source used to discover this skill before install. */
  source: HubSkillSource;
  /** Stable install identifier such as owner/repo/skill or well-known:<url>. */
  identifier: string;
  /** Trust level to apply before install/review. */
  trust: SkillTapTrust;
  /** Direct SKILL.md URL when available. */
  contentUrl?: string;
  /** Tap repo for GitHub-backed skills. */
  tapRepo?: string;
  /** Path to the skill directory inside a GitHub tap. */
  skillPath?: string;
  /** URL of the index endpoint for well-known skills. */
  indexUrl?: string;
}

export interface SkillTapDiscoveryResult {
  errors: Array<{ repo: string; error: string }>;
  refreshedAt: string;
  skillCount: number;
  skills: DiscoveredHubSkill[];
  taps: SkillTap[];
}

export interface WellKnownSkillDiscoveryResult {
  errors: string[];
  indexUrl: string;
  refreshedAt: string;
  skillCount: number;
  skills: DiscoveredHubSkill[];
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
  /** Path to the tap registry file for GitHub/repository-based skill sources */
  tapsPath: string;
  /** GitHub Contents API base URL. Override in tests or self-hosted gateways. */
  githubApiBaseUrl: string;
  /** GitHub raw content base URL. Override in tests or self-hosted gateways. */
  githubRawBaseUrl: string;
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

interface TapsFile {
  version: number;
  updatedAt: string;
  taps: SkillTap[];
}

interface GitHubContentEntry {
  name: string;
  path?: string;
  type: 'dir' | 'file' | string;
  download_url?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HUB_CONFIG: HubConfig = {
  registryUrl: 'https://hub.codebuddy.dev/api/v1',
  cacheDir: path.join(os.homedir(), '.codebuddy', 'hub', 'cache'),
  skillsDir: path.join(os.homedir(), '.codebuddy', 'skills', 'managed'),
  lockfilePath: path.join(os.homedir(), '.codebuddy', 'hub', 'lock.json'),
  tapsPath: path.join(os.homedir(), '.codebuddy', 'hub', 'taps.json'),
  githubApiBaseUrl: 'https://api.github.com',
  githubRawBaseUrl: 'https://raw.githubusercontent.com',
  autoUpdate: false,
  checkIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
};

const LOCKFILE_VERSION = 1;
const TAPS_FILE_VERSION = 1;
const SUPPORTING_FILE_DIRS = new Set(['references', 'templates', 'scripts', 'assets']);
const MAX_SUPPORTING_FILE_BYTES = 1_048_576;
const DEFAULT_TAP_PATH = 'skills/';
const TRUSTED_TAP_REPOS = new Set([
  'anthropics/skills',
  'huggingface/skills',
  'openai/skills',
]);

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
  // safe: regex matched with three mandatory `(\d+)` capture groups, so match[1..3] are present
  const [, major, minor, patch] = match;
  return [parseInt(major ?? '0', 10), parseInt(minor ?? '0', 10), parseInt(patch ?? '0', 10)];
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

    const tapsDir = path.dirname(this.config.tapsPath);
    if (!fs.existsSync(tapsDir)) {
      fs.mkdirSync(tapsDir, { recursive: true });
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
    return {
      ...this.lockfile,
      skills: Object.fromEntries(
        Object.entries(this.lockfile.skills).map(([name, skill]) => [
          name,
          {
            ...skill,
            usage: skill.usage ? { ...skill.usage } : undefined,
            lifecycle: skill.lifecycle ? { ...skill.lifecycle } : undefined,
            history: skill.history?.map((snapshot) => ({ ...snapshot })),
          },
        ]),
      ),
    };
  }

  // ==========================================================================
  // Taps & Trust
  // ==========================================================================

  /**
   * List configured skill taps. Taps are repository-backed skill catalogs
   * compatible with Hermes' owner/repo + path model.
   */
  listTaps(): SkillTap[] {
    return this.readTapsFile().taps.map((tap) => ({ ...tap }));
  }

  addTap(
    repo: string,
    options: {
      actor?: string;
      path?: string;
      trust?: SkillTapTrust;
      updatedAt?: number;
    } = {},
  ): SkillTap {
    const normalizedRepo = this.normalizeTapRepo(repo);
    const tapsFile = this.readTapsFile();
    const existing = tapsFile.taps.find((tap) => tap.repo === normalizedRepo);
    const now = options.updatedAt ?? Date.now();
    const trust = options.trust ?? this.defaultTapTrust(normalizedRepo);
    const tapPath = this.normalizeTapPath(options.path ?? existing?.path ?? DEFAULT_TAP_PATH);

    if (existing) {
      existing.path = tapPath;
      existing.trust = trust;
      existing.updatedAt = now;
      if (options.actor) existing.addedBy = options.actor;
      this.writeTapsFile(tapsFile);
      this.emit('tap:updated', { ...existing });
      return { ...existing };
    }

    const tap: SkillTap = {
      repo: normalizedRepo,
      path: tapPath,
      trust,
      addedAt: now,
      updatedAt: now,
      ...(options.actor ? { addedBy: options.actor } : {}),
    };
    tapsFile.taps.push(tap);
    tapsFile.taps.sort((left, right) => left.repo.localeCompare(right.repo));
    this.writeTapsFile(tapsFile);
    this.emit('tap:added', { ...tap });
    return { ...tap };
  }

  removeTap(repo: string): boolean {
    const normalizedRepo = this.normalizeTapRepo(repo);
    const tapsFile = this.readTapsFile();
    const next = tapsFile.taps.filter((tap) => tap.repo !== normalizedRepo);
    if (next.length === tapsFile.taps.length) {
      return false;
    }
    tapsFile.taps = next;
    this.writeTapsFile(tapsFile);
    this.emit('tap:removed', normalizedRepo);
    return true;
  }

  setTapTrust(
    repo: string,
    trust: SkillTapTrust,
    options: { actor?: string; updatedAt?: number } = {},
  ): SkillTap | null {
    const normalizedRepo = this.normalizeTapRepo(repo);
    const tapsFile = this.readTapsFile();
    const tap = tapsFile.taps.find((item) => item.repo === normalizedRepo);
    if (!tap) {
      return null;
    }
    tap.trust = this.normalizeTapTrust(trust);
    tap.updatedAt = options.updatedAt ?? Date.now();
    if (options.actor) tap.addedBy = options.actor;
    this.writeTapsFile(tapsFile);
    this.emit('tap:trust_updated', { ...tap });
    return { ...tap };
  }

  getTapTrust(repo: string): SkillTapTrust {
    const normalizedRepo = this.normalizeTapRepo(repo);
    const tap = this.readTapsFile().taps.find((item) => item.repo === normalizedRepo);
    return tap?.trust ?? this.defaultTapTrust(normalizedRepo);
  }

  /**
   * Discover SKILL.md packages from configured GitHub taps. This is read-only:
   * it indexes remote metadata into the local cache but does not install or
   * trust any skill content automatically.
   */
  async refreshTapIndex(repo?: string): Promise<SkillTapDiscoveryResult> {
    const selectedTaps = repo
      ? this.listTaps().filter((tap) => tap.repo === this.normalizeTapRepo(repo))
      : this.listTaps();
    if (repo && selectedTaps.length === 0) {
      throw new Error(`Skill tap not found: ${repo}`);
    }

    const skills: DiscoveredHubSkill[] = [];
    const errors: Array<{ repo: string; error: string }> = [];
    for (const tap of selectedTaps) {
      try {
        skills.push(...await this.discoverGitHubTapSkills(tap));
      } catch (err) {
        errors.push({
          repo: tap.repo,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const refreshedAt = new Date().toISOString();
    this.replaceTapCacheForTaps(skills, selectedTaps.map((tap) => tap.repo), refreshedAt);
    return {
      errors,
      refreshedAt,
      skillCount: skills.length,
      skills,
      taps: selectedTaps,
    };
  }

  /**
   * Discover skills from a site exposing `/.well-known/skills/index.json`.
   * The index parser is intentionally tolerant because the convention is
   * designed for independent publishers.
   */
  async discoverWellKnownSkills(inputUrl: string): Promise<WellKnownSkillDiscoveryResult> {
    const indexUrl = this.resolveWellKnownIndexUrl(inputUrl);
    const response = await fetch(indexUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'codebuddy-hub/1.0',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Well-known skills index returned ${response.status}: ${response.statusText}`);
    }

    const body = await response.json() as unknown;
    const entries = this.extractWellKnownEntries(body);
    const errors: string[] = [];
    const skills: DiscoveredHubSkill[] = [];
    for (const entry of entries) {
      try {
        skills.push(this.discoveredSkillFromWellKnownEntry(entry, indexUrl));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const refreshedAt = new Date().toISOString();
    this.mergeTapCache(skills, refreshedAt);
    return {
      errors,
      indexUrl,
      refreshedAt,
      skillCount: skills.length,
      skills,
    };
  }

  private readTapsFile(): TapsFile {
    try {
      if (fs.existsSync(this.config.tapsPath)) {
        const raw = fs.readFileSync(this.config.tapsPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TapsFile>;
        if (
          parsed.version === TAPS_FILE_VERSION
          && Array.isArray(parsed.taps)
        ) {
          const taps = parsed.taps
            .map((tap) => this.normalizeTapRecord(tap))
            .filter((tap): tap is SkillTap => Boolean(tap));
          return {
            version: TAPS_FILE_VERSION,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
            taps,
          };
        }
      }
    } catch (err) {
      logger.warn('Failed to read hub taps file, starting fresh', {
        path: this.config.tapsPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      version: TAPS_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      taps: [],
    };
  }

  private writeTapsFile(tapsFile: TapsFile): void {
    tapsFile.updatedAt = new Date().toISOString();
    tapsFile.taps.sort((left, right) => left.repo.localeCompare(right.repo));
    fs.writeFileSync(this.config.tapsPath, JSON.stringify(tapsFile, null, 2), 'utf-8');
    logger.debug('Hub taps file written', { path: this.config.tapsPath });
  }

  private normalizeTapRecord(tap: unknown): SkillTap | null {
    if (!tap || typeof tap !== 'object') {
      return null;
    }
    const candidate = tap as Partial<SkillTap>;
    if (typeof candidate.repo !== 'string') {
      return null;
    }

    const addedAt = typeof candidate.addedAt === 'number' ? candidate.addedAt : Date.now();
    const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : addedAt;
    return {
      repo: this.normalizeTapRepo(candidate.repo),
      path: this.normalizeTapPath(candidate.path ?? DEFAULT_TAP_PATH),
      trust: this.normalizeTapTrust(candidate.trust ?? this.defaultTapTrust(candidate.repo)),
      addedAt,
      updatedAt,
      ...(typeof candidate.addedBy === 'string' && candidate.addedBy.trim()
        ? { addedBy: candidate.addedBy.trim() }
        : {}),
    };
  }

  private normalizeTapRepo(repo: string): string {
    const trimmed = repo.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    const normalized = trimmed.replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
      throw new Error(`Invalid skill tap repo '${repo}'. Use owner/repo.`);
    }
    return normalized;
  }

  private normalizeTapPath(tapPath: string): string {
    const normalized = tapPath.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (
      !normalized
      || normalized.includes('..')
      || normalized.split('/').some((part) => part.trim() === '')
    ) {
      throw new Error(`Invalid skill tap path '${tapPath}'. Use a relative directory such as skills/.`);
    }
    return `${normalized}/`;
  }

  private normalizeTapTrust(trust: SkillTapTrust): SkillTapTrust {
    if (['builtin', 'official', 'trusted', 'community'].includes(trust)) {
      return trust;
    }
    throw new Error(`Invalid skill tap trust '${trust}'. Use builtin, official, trusted, or community.`);
  }

  private defaultTapTrust(repo: string): SkillTapTrust {
    return TRUSTED_TAP_REPOS.has(repo.toLowerCase()) ? 'trusted' : 'community';
  }

  private async discoverGitHubTapSkills(tap: SkillTap): Promise<DiscoveredHubSkill[]> {
    const directories = await this.fetchGitHubDirectory(tap.repo, tap.path);
    const skills: DiscoveredHubSkill[] = [];
    for (const entry of directories) {
      if (entry.type !== 'dir' || entry.name.startsWith('.') || entry.name.startsWith('_')) {
        continue;
      }
      const skillPath = `${tap.path}${entry.name}`;
      const skillMdPath = `${skillPath}/SKILL.md`;
      try {
        const content = await this.fetchGitHubFile(tap.repo, skillMdPath);
        const skill = parseSkillFile(content, skillMdPath, 'managed');
        const description = skill.metadata.description || `${skill.metadata.name} from ${tap.repo}`;
        const version = skill.metadata.version || '0.0.0';
        const tags = skill.metadata.tags || [];
        skills.push({
          name: skill.metadata.name,
          version,
          description,
          author: skill.metadata.author || tap.repo,
          tags,
          downloads: 0,
          stars: 0,
          updatedAt: new Date().toISOString(),
          checksum: computeChecksum(content),
          size: Buffer.byteLength(content, 'utf-8'),
          repository: `https://github.com/${tap.repo}`,
          source: 'github-tap',
          identifier: `${tap.repo}/${entry.name}`,
          trust: tap.trust,
          contentUrl: this.rawGitHubUrl(tap.repo, skillMdPath),
          tapRepo: tap.repo,
          skillPath,
        });
      } catch (err) {
        logger.debug('Skipping invalid GitHub tap skill', {
          repo: tap.repo,
          path: skillMdPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return skills;
  }

  private async fetchGitHubDirectory(repo: string, tapPath: string): Promise<GitHubContentEntry[]> {
    const url = `${this.config.githubApiBaseUrl.replace(/\/+$/, '')}/repos/${repo}/contents/${this.encodeGitHubContentPath(tapPath.replace(/\/+$/, ''))}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.githubHeaders('application/vnd.github+json'),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`GitHub contents returned ${response.status}: ${response.statusText}`);
    }
    const json = await response.json() as unknown;
    if (!Array.isArray(json)) {
      throw new Error(`GitHub contents for ${repo}/${tapPath} did not return a directory listing`);
    }
    return json.filter((item): item is GitHubContentEntry => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as GitHubContentEntry).name === 'string'
      && typeof (item as GitHubContentEntry).type === 'string'
    ));
  }

  private async fetchGitHubFile(repo: string, filePath: string): Promise<string> {
    const url = `${this.config.githubApiBaseUrl.replace(/\/+$/, '')}/repos/${repo}/contents/${this.encodeGitHubContentPath(filePath)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.githubHeaders('application/vnd.github.raw'),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`GitHub file returned ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  }

  private encodeGitHubContentPath(filePath: string): string {
    return filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  }

  private githubHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': accept,
      'User-Agent': 'codebuddy-hub/1.0',
    };
    const token = process.env['GITHUB_TOKEN'];
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private rawGitHubUrl(repo: string, filePath: string): string {
    return `${this.config.githubRawBaseUrl.replace(/\/+$/, '')}/${repo}/HEAD/${filePath}`;
  }

  private getTapCacheFile(): string {
    return path.join(this.config.cacheDir, 'tap-cache.json');
  }

  private getTapCacheSkills(): DiscoveredHubSkill[] {
    try {
      const cacheFile = this.getTapCacheFile();
      if (!fs.existsSync(cacheFile)) {
        return [];
      }
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const parsed = JSON.parse(raw) as { skills?: DiscoveredHubSkill[] };
      return Array.isArray(parsed.skills) ? parsed.skills : [];
    } catch {
      return [];
    }
  }

  private writeTapCache(skills: DiscoveredHubSkill[], cachedAt: string): void {
    const cacheFile = this.getTapCacheFile();
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ cachedAt, skills }, null, 2), 'utf-8');
  }

  private mergeTapCache(skills: DiscoveredHubSkill[], cachedAt: string): void {
    const merged = new Map<string, DiscoveredHubSkill>();
    for (const skill of this.getTapCacheSkills()) {
      merged.set(skill.identifier, skill);
    }
    for (const skill of skills) {
      merged.set(skill.identifier, skill);
    }
    this.writeTapCache([...merged.values()], cachedAt);
  }

  private replaceTapCacheForTaps(skills: DiscoveredHubSkill[], tapRepos: string[], cachedAt: string): void {
    const selectedRepos = new Set(tapRepos);
    const retained = this.getTapCacheSkills().filter((skill) => (
      skill.source !== 'github-tap'
      || !skill.tapRepo
      || !selectedRepos.has(skill.tapRepo)
    ));
    this.writeTapCache([...retained, ...skills], cachedAt);
  }

  private resolveWellKnownIndexUrl(inputUrl: string): string {
    const normalized = inputUrl.trim().replace(/^well-known:/, '');
    const url = new URL(normalized);
    if (url.pathname.endsWith('/.well-known/skills/index.json')) {
      return url.toString();
    }
    return new URL('/.well-known/skills/index.json', url.origin).toString();
  }

  private extractWellKnownEntries(body: unknown): unknown[] {
    if (Array.isArray(body)) {
      return body;
    }
    if (!body || typeof body !== 'object') {
      return [];
    }
    const record = body as Record<string, unknown>;
    for (const key of ['skills', 'items', 'entries']) {
      if (Array.isArray(record[key])) {
        return record[key] as unknown[];
      }
    }
    return [];
  }

  private discoveredSkillFromWellKnownEntry(entry: unknown, indexUrl: string): DiscoveredHubSkill {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Well-known skill entry must be an object');
    }
    const record = entry as Record<string, unknown>;
    const name = this.readStringField(record, ['name', 'id', 'slug']);
    const description = this.readStringField(record, ['description', 'summary']) || `${name} from well-known index`;
    const version = this.readStringField(record, ['version']) || '0.0.0';
    const contentUrl = this.resolveWellKnownSkillUrl(record, indexUrl, name);
    return {
      name,
      version,
      description,
      author: this.readStringField(record, ['author', 'publisher']) || new URL(indexUrl).hostname,
      tags: this.readStringArrayField(record, ['tags', 'keywords']),
      downloads: 0,
      stars: 0,
      updatedAt: this.readStringField(record, ['updatedAt', 'updated_at', 'modified']) || new Date().toISOString(),
      checksum: this.readStringField(record, ['checksum', 'sha256']) || computeChecksum(`${name}:${version}:${contentUrl}`),
      size: Number(record['size']) || 0,
      repository: this.readStringField(record, ['repository', 'repo']),
      source: 'well-known',
      identifier: `well-known:${contentUrl.replace(/\/SKILL\.md$/i, '')}`,
      trust: 'community',
      contentUrl,
      indexUrl,
    };
  }

  private readStringField(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return '';
  }

  private readStringArrayField(record: Record<string, unknown>, keys: string[]): string[] {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
      if (typeof value === 'string' && value.trim()) {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      }
    }
    return [];
  }

  private resolveWellKnownSkillUrl(record: Record<string, unknown>, indexUrl: string, name: string): string {
    const explicit = this.readStringField(record, [
      'skillMdUrl',
      'skill_md_url',
      'skillUrl',
      'skill_url',
      'url',
      'href',
    ]);
    if (explicit) {
      return new URL(explicit, indexUrl).toString();
    }
    const base = indexUrl.replace(/\/index\.json(?:[?#].*)?$/, '/');
    return new URL(`${encodeURIComponent(name)}/SKILL.md`, base).toString();
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
    allSkills = this.mergeDiscoveredSkills(allSkills, this.getTapCacheSkills());

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

  private mergeDiscoveredSkills(base: HubSkill[], discovered: HubSkill[]): HubSkill[] {
    const merged = new Map<string, HubSkill>();
    for (const skill of base) {
      merged.set(`${skill.name}@${skill.version}:${skill.repository ?? ''}`, skill);
    }
    for (const skill of discovered) {
      merged.set(`${skill.name}@${skill.version}:${skill.repository ?? ''}`, skill);
    }
    return [...merged.values()];
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

  private getCachedSkillContentPath(skillName: string, version?: string): string | null {
    const candidates = [
      version ? path.join(this.config.cacheDir, `${skillName}@${version}.skill.md`) : null,
      path.join(this.config.cacheDir, `${skillName}.skill.md`),
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
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
    const cachedContentPath = this.getCachedSkillContentPath(skillName, version);
    if (cachedContentPath) {
      logger.debug('Using cached skill content', { name: skillName, version, path: cachedContentPath });
      return fs.readFileSync(cachedContentPath, 'utf-8');
    }

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

  /**
   * Track an existing local SKILL.md file in the lockfile without copying it.
   * This keeps review-gated workspace installs visible to skills_list/skill_view
   * while preserving the workspace path as the source of truth.
   */
  registerLocalSkillFile(
    skillName: string,
    skillPath: string,
    source: InstalledSkill['source'] = 'local',
  ): InstalledSkill {
    if (!/^[a-zA-Z0-9_-]+$/.test(skillName)) {
      throw new Error(`Invalid skill name: ${skillName}. Only alphanumeric, dash, and underscore allowed.`);
    }

    const resolvedPath = path.resolve(skillPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Skill file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    this.validateSkillContent(content, skillName);

    const previous = this.lockfile.skills[skillName];
    const installed: InstalledSkill = {
      name: skillName,
      version: this.extractVersionFromContent(content) || previous?.version || '0.0.0',
      installedAt: previous?.installedAt ?? Date.now(),
      source,
      checksum: computeChecksum(content),
      path: resolvedPath,
      ...(previous?.usage ? { usage: previous.usage } : {}),
      ...(previous?.enabled === false ? { enabled: false } : {}),
      ...(previous?.lifecycle ? { lifecycle: previous.lifecycle } : {}),
      ...(previous?.history ? { history: previous.history } : {}),
    };

    this.lockfile.skills[skillName] = installed;
    this.writeLockfile();
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

  /**
   * Remove a stale lockfile row only when its recorded SKILL.md is already
   * missing. Unlike uninstall(), this never deletes files from skillsDir.
   */
  removeMissingSkillRecord(skillName: string): boolean {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot prune missing skill record because it is not in the lockfile', { name: skillName });
      return false;
    }
    if (fs.existsSync(installed.path)) {
      logger.warn('Refusing to prune skill record because SKILL.md still exists', {
        name: skillName,
        path: installed.path,
      });
      return false;
    }

    delete this.lockfile.skills[skillName];
    this.writeLockfile();
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
      if (!skill) continue;
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
    const cachedInfo = this.getLocalCacheSkills().find((skill) => skill.name === skillName);
    if (cachedInfo) {
      return cachedInfo;
    }

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

  async previewInstalledSkillUpdate(
    skillName: string,
    options: SkillUpdatePreviewOptions = {},
  ): Promise<SkillUpdatePreviewResult | null> {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot preview update for missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const hubInfo = await this.getHubSkillInfo(skillName);
    const targetVersion = options.version || hubInfo?.version;
    if (!targetVersion) {
      throw new Error(`No update metadata found for '${skillName}'`);
    }

    const currentContent = fs.readFileSync(installed.path, 'utf-8');
    const remoteContent = await this.fetchSkillContent(skillName, targetVersion);
    this.validateSkillContent(remoteContent, skillName);
    const resolvedVersion = this.extractVersionFromContent(remoteContent) || targetVersion;
    const currentChecksum = computeChecksum(currentContent);
    const remoteChecksum = computeChecksum(remoteContent);
    const diff = generateDiff(
      currentContent.trimEnd().split('\n'),
      remoteContent.trimEnd().split('\n'),
      `${skillName}/SKILL.md`,
      {
        contextLines: 2,
        summaryPrefix: 'Skill update',
      },
    );
    const maxLines = options.maxDiffLines ?? 120;
    const maxChars = options.maxDiffChars ?? 12000;
    const linePreview = diff.diff.split('\n').slice(0, maxLines).join('\n');
    const preview = linePreview.slice(0, maxChars);

    return {
      currentChecksum,
      diff: {
        addedLines: diff.addedLines,
        maxChars,
        maxLines,
        preview,
        removedLines: diff.removedLines,
        summary: diff.summary,
        truncated: linePreview.length > preview.length || diff.diff.split('\n').length > maxLines,
      },
      fromVersion: installed.version,
      installCommand: `skill_manage action=update name=${skillName} approved_by=<reviewer>${resolvedVersion ? ` version=${resolvedVersion}` : ''}`,
      name: skillName,
      remoteChecksum,
      sameContent: currentChecksum === remoteChecksum,
      toVersion: resolvedVersion,
      updateAvailable: compareSemver(resolvedVersion, installed.version) > 0,
    };
  }

  async updateInstalledSkill(
    skillName: string,
    options: SkillUpdateOptions = {},
  ): Promise<SkillUpdateResult | null> {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot update missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const hubInfo = await this.getHubSkillInfo(skillName);
    const targetVersion = options.version || hubInfo?.version;
    if (!targetVersion) {
      throw new Error(`No update metadata found for '${skillName}'`);
    }
    if (!options.force && compareSemver(targetVersion, installed.version) <= 0) {
      throw new Error(`Skill '${skillName}' is already up to date (${installed.version})`);
    }

    const content = await this.fetchSkillContent(skillName, targetVersion);
    this.validateSkillContent(content, skillName);
    const resolvedVersion = this.extractVersionFromContent(content) || targetVersion;
    if (!options.force && compareSemver(resolvedVersion, installed.version) <= 0) {
      throw new Error(`Skill '${skillName}' update content is not newer (${resolvedVersion} <= ${installed.version})`);
    }

    const snapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason,
      updatedAt: options.updatedAt,
    });
    const fromVersion = installed.version;

    fs.writeFileSync(installed.path, content, 'utf-8');
    installed.version = resolvedVersion;
    installed.checksum = computeChecksum(content);
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, snapshot);
    this.writeLockfile();
    this.emit('skill:updated', installed);

    return {
      installed,
      fromVersion,
      toVersion: resolvedVersion,
      snapshot,
    };
  }

  async resetInstalledSkill(
    skillName: string,
    options: SkillResetOptions = {},
  ): Promise<SkillResetResult | null> {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot reset missing skill', { name: skillName });
      return null;
    }

    const targetVersion = options.version || installed.version;
    if (!targetVersion) {
      throw new Error(`No reset version found for '${skillName}'`);
    }

    const content = await this.fetchSkillContent(skillName, targetVersion);
    this.validateSkillContent(content, skillName);
    const resolvedVersion = this.extractVersionFromContent(content) || targetVersion;
    const toChecksum = computeChecksum(content);
    const existedBeforeReset = fs.existsSync(installed.path);
    const fromChecksum = existedBeforeReset
      ? computeChecksum(fs.readFileSync(installed.path, 'utf-8'))
      : undefined;
    const snapshot = existedBeforeReset
      ? this.snapshotInstalledSkill(installed, {
        actor: options.actor,
        reason: options.reason || `before reset to ${resolvedVersion}`,
        updatedAt: options.updatedAt,
      })
      : undefined;
    const fromVersion = installed.version;

    fs.mkdirSync(path.dirname(installed.path), { recursive: true });
    fs.writeFileSync(installed.path, content, 'utf-8');
    installed.version = resolvedVersion;
    installed.checksum = toChecksum;
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    if (snapshot) {
      this.appendSnapshot(installed, snapshot);
    }
    this.writeLockfile();
    this.emit('skill:reset', installed);

    return {
      installed,
      ...(fromChecksum ? { fromChecksum } : {}),
      fromVersion,
      recreated: !existedBeforeReset,
      ...(snapshot ? { snapshot } : {}),
      toChecksum,
      toVersion: resolvedVersion,
    };
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
      if (!entry) continue;

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
   * List installed skills with cheap on-disk health checks so stale lockfile
   * entries are visible before an agent or operator tries to reuse them.
   */
  listWithIntegrity(): InstalledSkillStatus[] {
    return this.list().map((skill) => {
      const detail = this.info(skill.name);
      const exists = typeof detail?.content === 'string';
      return {
        ...skill,
        exists,
        integrityOk: detail?.integrityOk ?? false,
        ...(exists ? { sizeBytes: Buffer.byteLength(detail.content as string, 'utf-8') } : {}),
      };
    });
  }

  /**
   * List only enabled skills (absent `enabled` flag counts as enabled). This is
   * the set selection/injection should use so a disabled package stays
   * installed but inactive.
   */
  listEnabled(): InstalledSkill[] {
    return this.list().filter((skill) => skill.enabled !== false);
  }

  setEnabled(
    skillName: string,
    enabled: boolean,
    options?: {
      path?: string;
      version?: string;
      actor?: string;
      reason?: string;
      status?: SkillLifecycleState['status'];
      updatedAt?: number;
    }
  ): InstalledSkill | null {
    let installed = this.lockfile.skills[skillName];
    if (!installed) {
      if (!options?.path) {
        logger.warn('Cannot toggle missing skill', { name: skillName });
        return null;
      }
      installed = {
        name: skillName,
        version: options?.version || '0.0.0',
        installedAt: Date.now(),
        source: 'local',
        checksum: '',
        path: options.path,
        enabled: enabled,
      };
      this.lockfile.skills[skillName] = installed;
    } else {
      installed.enabled = enabled;
    }
    installed.lifecycle = {
      status: enabled ? 'active' : options?.status ?? 'disabled',
      updatedAt: options?.updatedAt ?? Date.now(),
      ...(options?.actor ? { updatedBy: options.actor } : {}),
      ...(options?.reason ? { reason: options.reason } : {}),
    };
    this.writeLockfile();
    this.emit('skill:enabled', { name: skillName, enabled });
    return installed;
  }

  /**
   * Rewrite an installed SKILL.md. The current file is snapshotted before
   * writing, so review-gated edits can roll back.
   */
  editInstalledSkill(
    skillName: string,
    content: string,
    options: SkillEditOptions = {},
  ): SkillEditResult | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot edit missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    this.validateSkillContent(content, skillName);
    const snapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason,
      updatedAt: options.updatedAt,
    });

    fs.writeFileSync(installed.path, content, 'utf-8');
    installed.checksum = computeChecksum(content);
    installed.version = this.extractVersionFromContent(content) || installed.version;
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, snapshot);
    this.writeLockfile();
    this.emit('skill:edited', { name: skillName, snapshot });
    return { installed, snapshot };
  }

  /**
   * Patch an installed SKILL.md or one of its supporting files with a literal
   * text replacement. The current SKILL.md is snapshotted before writing, so
   * review-gated guidance edits can roll back.
   */
  patchInstalledSkill(
    skillName: string,
    oldText: string,
    newText: string,
    options: SkillPatchOptions = {},
  ): SkillPatchResult | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot patch missing skill', { name: skillName });
      return null;
    }
    if (!oldText) {
      throw new Error('Patch oldText must not be empty');
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const targetPath = this.resolveSkillMutationPath(installed, options.filePath);
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Skill file not found: ${targetPath}`);
    }

    const content = fs.readFileSync(targetPath, 'utf-8');
    const replacements = content.split(oldText).length - 1;
    if (replacements === 0) {
      throw new Error(`Patch text not found in skill '${skillName}'`);
    }
    const replaceAll = options.replaceAll === true;
    if (!replaceAll && replacements !== 1) {
      throw new Error(
        `Patch text is not unique in '${skillName}' (${replacements} matches). Set replace_all=true to replace all occurrences.`,
      );
    }
    if (
      typeof options.expectedReplacements === 'number'
      && options.expectedReplacements !== replacements
    ) {
      throw new Error(
        `Patch replacement count mismatch for '${skillName}': expected ${options.expectedReplacements}, found ${replacements}`,
      );
    }

    const updatedContent = replaceAll
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText);
    const relativeFilePath = this.relativeSkillMutationPath(installed, targetPath);
    const targetIsSkillMd = path.resolve(targetPath) === path.resolve(installed.path);
    if (targetIsSkillMd) {
      this.validateSkillContent(updatedContent, skillName);
    }
    const snapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason,
      updatedAt: options.updatedAt,
    });

    fs.writeFileSync(targetPath, updatedContent, 'utf-8');
    if (targetIsSkillMd) {
      installed.checksum = computeChecksum(updatedContent);
      installed.version = this.extractVersionFromContent(updatedContent) || installed.version;
    }
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, snapshot);
    this.writeLockfile();
    this.emit('skill:patched', { name: skillName, filePath: relativeFilePath, snapshot, replacements });
    return { installed, filePath: relativeFilePath, replacements, snapshot };
  }

  /**
   * Add or overwrite a supporting file in an installed skill directory.
   */
  writeSkillSupportingFile(
    skillName: string,
    filePath: string,
    fileContent: string,
    options: SkillFileMutationOptions = {},
  ): SkillWriteFileResult | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot write file for missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }
    const byteLength = Buffer.byteLength(fileContent, 'utf-8');
    if (byteLength > MAX_SUPPORTING_FILE_BYTES) {
      throw new Error(`Supporting file exceeds ${MAX_SUPPORTING_FILE_BYTES} bytes`);
    }

    const targetPath = this.resolveSkillMutationPath(installed, filePath, { requireSupportingDir: true });
    const snapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason,
      updatedAt: options.updatedAt,
    });

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, fileContent, 'utf-8');
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, snapshot);
    this.writeLockfile();

    const relativeFilePath = this.relativeSkillMutationPath(installed, targetPath);
    this.emit('skill:file_written', { name: skillName, filePath: relativeFilePath, snapshot });
    return {
      absolutePath: targetPath,
      bytesWritten: byteLength,
      filePath: relativeFilePath,
      installed,
      snapshot,
    };
  }

  /**
   * Remove a supporting file from an installed skill directory.
   */
  removeSkillSupportingFile(
    skillName: string,
    filePath: string,
    options: SkillFileMutationOptions = {},
  ): SkillRemoveFileResult | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot remove file for missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const targetPath = this.resolveSkillMutationPath(installed, filePath, { requireSupportingDir: true });
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Supporting file not found: ${filePath}`);
    }

    const snapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason,
      updatedAt: options.updatedAt,
    });
    fs.rmSync(targetPath, { force: false });
    this.removeEmptySupportingParents(installed, path.dirname(targetPath));
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, snapshot);
    this.writeLockfile();

    const relativeFilePath = this.relativeSkillMutationPath(installed, targetPath);
    this.emit('skill:file_removed', { name: skillName, filePath: relativeFilePath, snapshot });
    return {
      absolutePath: targetPath,
      filePath: relativeFilePath,
      installed,
      removed: true,
      snapshot,
    };
  }

  /**
   * Restore a previous SKILL.md snapshot, snapshotting the current file first
   * so rollback itself remains reversible.
   */
  rollbackInstalledSkill(
    skillName: string,
    snapshotId?: string,
    options: SkillRollbackOptions = {},
  ): SkillRollbackResult | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot rollback missing skill', { name: skillName });
      return null;
    }
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const history = installed.history ?? [];
    const restoredSnapshot = snapshotId
      ? history.find((snapshot) => snapshot.id === snapshotId)
      : history[history.length - 1];
    if (!restoredSnapshot) {
      throw new Error(snapshotId
        ? `Rollback snapshot not found for '${skillName}': ${snapshotId}`
        : `No rollback snapshots available for '${skillName}'`);
    }
    if (!fs.existsSync(restoredSnapshot.snapshotPath)) {
      throw new Error(`Rollback snapshot file not found: ${restoredSnapshot.snapshotPath}`);
    }

    const restoredContent = fs.readFileSync(restoredSnapshot.snapshotPath, 'utf-8');
    this.validateSkillContent(restoredContent, skillName);
    const currentSnapshot = this.snapshotInstalledSkill(installed, {
      actor: options.actor,
      reason: options.reason
        ? `before rollback: ${options.reason}`
        : `before rollback to ${restoredSnapshot.id}`,
      updatedAt: options.updatedAt,
    });

    fs.writeFileSync(installed.path, restoredContent, 'utf-8');
    installed.checksum = computeChecksum(restoredContent);
    installed.version = this.extractVersionFromContent(restoredContent) || restoredSnapshot.version;
    installed.lifecycle = {
      status: installed.enabled === false ? 'disabled' : 'active',
      updatedAt: options.updatedAt ?? Date.now(),
      ...(options.actor ? { updatedBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
    this.appendSnapshot(installed, currentSnapshot);
    this.writeLockfile();
    this.emit('skill:rolled_back', { name: skillName, restoredSnapshot, currentSnapshot });
    return { installed, restoredSnapshot, currentSnapshot };
  }

  /**
   * Return current installed skill state plus rollback snapshots with on-disk
   * integrity checks. This is the read model Cowork/CLI use before offering a
   * version restore decision to a human reviewer.
   */
  getInstalledSkillHistory(skillName: string): SkillHistoryResult | null {
    const detail = this.info(skillName);
    if (!detail) {
      return null;
    }

    const { installed, content, integrityOk } = detail;
    const snapshots = [...(installed.history ?? [])]
      .map((snapshot): SkillHistorySnapshot => {
        const snapshotExists = fs.existsSync(snapshot.snapshotPath);
        let snapshotIntegrityOk = false;
        let sizeBytes: number | undefined;

        if (snapshotExists) {
          const snapshotContent = fs.readFileSync(snapshot.snapshotPath, 'utf-8');
          snapshotIntegrityOk = computeChecksum(snapshotContent) === snapshot.checksum;
          sizeBytes = Buffer.byteLength(snapshotContent, 'utf-8');
        }

        return {
          ...snapshot,
          rollbackable: snapshotExists && snapshotIntegrityOk,
          snapshotExists,
          snapshotIntegrityOk,
          ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt);

    return {
      installed,
      current: {
        checksum: installed.checksum,
        enabled: installed.enabled !== false,
        exists: typeof content === 'string',
        installedAt: installed.installedAt,
        integrityOk,
        path: installed.path,
        source: installed.source,
        version: installed.version,
        ...(installed.lifecycle ? { lifecycle: installed.lifecycle } : {}),
        ...(typeof content === 'string' ? { sizeBytes: Buffer.byteLength(content, 'utf-8') } : {}),
      },
      snapshots,
      rollbackableCount: snapshots.filter((snapshot) => snapshot.rollbackable).length,
      missingSnapshotCount: snapshots.filter((snapshot) => !snapshot.snapshotExists).length,
    };
  }

  /**
   * Record local skill usage so frequently useful skills can be curated.
   * Hermes-style learning starts with this small durable signal.
   */
  recordUsage(skillName: string, record: SkillUsageRecord): InstalledSkill | null {
    const installed = this.lockfile.skills[skillName];
    if (!installed) {
      logger.warn('Cannot record usage for missing skill', { name: skillName });
      return null;
    }

    const previous = installed.usage;
    const invocationCount = (previous?.invocationCount ?? 0) + 1;
    const previousAverage = previous?.averageDurationMs ?? 0;
    const durationMs = record.durationMs;
    const averageDurationMs =
      typeof durationMs === 'number'
        ? ((previousAverage * (invocationCount - 1)) + durationMs) / invocationCount
        : previous?.averageDurationMs;

    installed.usage = {
      invocationCount,
      successCount: (previous?.successCount ?? 0) + (record.success ? 1 : 0),
      failureCount: (previous?.failureCount ?? 0) + (record.success ? 0 : 1),
      lastUsedAt: record.usedAt ?? Date.now(),
      lastDurationMs: durationMs,
      averageDurationMs,
      lastError: record.success ? undefined : record.error,
    };

    this.writeLockfile();
    this.emit('skill:usage', installed);
    return installed;
  }

  /**
   * Return installed skills ordered by local usage frequency.
   */
  usageSummary(): InstalledSkill[] {
    return this.list()
      .filter(skill => Boolean(skill.usage))
      .sort((left, right) => {
        const countDelta =
          (right.usage?.invocationCount ?? 0) - (left.usage?.invocationCount ?? 0);
        if (countDelta !== 0) return countDelta;
        return (right.usage?.lastUsedAt ?? 0) - (left.usage?.lastUsedAt ?? 0);
      });
  }

  private snapshotInstalledSkill(
    installed: InstalledSkill,
    options: { actor?: string; reason?: string; updatedAt?: number } = {},
  ): SkillVersionSnapshot {
    if (!fs.existsSync(installed.path)) {
      throw new Error(`Skill file not found: ${installed.path}`);
    }

    const content = fs.readFileSync(installed.path, 'utf-8');
    const checksum = computeChecksum(content);
    const createdAt = options.updatedAt ?? Date.now();
    const id = `${createdAt.toString(36)}-${randomUUID().slice(0, 8)}-${checksum.slice(0, 12)}`;
    const snapshotDir = path.join(this.config.cacheDir, 'history', installed.name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    const snapshotPath = path.join(snapshotDir, `${id}.SKILL.md`);

    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(snapshotPath, content, 'utf-8');

    return {
      id,
      createdAt,
      checksum,
      version: this.extractVersionFromContent(content) || installed.version,
      snapshotPath,
      ...(options.actor ? { createdBy: options.actor } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    };
  }

  private appendSnapshot(installed: InstalledSkill, snapshot: SkillVersionSnapshot): void {
    installed.history = [...(installed.history ?? []), snapshot].slice(-20);
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

  private resolveSkillMutationPath(
    installed: InstalledSkill,
    filePath?: string,
    options: { requireSupportingDir?: boolean } = {},
  ): string {
    const skillDir = path.dirname(installed.path);
    if (!filePath || filePath.trim() === '') {
      if (options.requireSupportingDir) {
        throw new Error('file_path is required');
      }
      return installed.path;
    }

    const normalized = filePath.trim().replace(/\\/g, '/');
    if (
      normalized.startsWith('/')
      || path.isAbsolute(normalized)
      || /^[A-Za-z]:/.test(normalized)
      || normalized.split('/').some((part) => part === '..' || part === '')
    ) {
      throw new Error(`Unsafe skill file path: ${filePath}`);
    }

    if (normalized === 'SKILL.md') {
      if (options.requireSupportingDir) {
        throw new Error('SKILL.md cannot be used as a supporting file path');
      }
      return installed.path;
    }

    const parts = normalized.split('/');
    const [topLevel] = parts;
    if (!topLevel || !SUPPORTING_FILE_DIRS.has(topLevel)) {
      throw new Error(
        `Unsupported skill file path '${filePath}'. Use references/, templates/, scripts/, or assets/.`,
      );
    }
    if (parts.length < 2 || !parts[parts.length - 1]) {
      throw new Error(
        `Unsupported skill file path '${filePath}'. Use a file under references/, templates/, scripts/, or assets/.`,
      );
    }

    const targetPath = path.resolve(skillDir, ...parts);
    const relative = path.relative(skillDir, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Unsafe skill file path: ${filePath}`);
    }
    return targetPath;
  }

  private relativeSkillMutationPath(installed: InstalledSkill, targetPath: string): string {
    if (path.resolve(targetPath) === path.resolve(installed.path)) {
      return 'SKILL.md';
    }
    return path.relative(path.dirname(installed.path), targetPath).replace(/\\/g, '/');
  }

  private removeEmptySupportingParents(installed: InstalledSkill, startDir: string): void {
    const skillDir = path.dirname(installed.path);
    let current = path.resolve(startDir);
    while (current !== path.resolve(skillDir)) {
      const relative = path.relative(skillDir, current).replace(/\\/g, '/');
      const [topLevel] = relative.split('/');
      if (!topLevel || !SUPPORTING_FILE_DIRS.has(topLevel)) {
        return;
      }
      try {
        if (fs.existsSync(current) && fs.readdirSync(current).length === 0) {
          fs.rmdirSync(current);
          current = path.dirname(current);
          continue;
        }
      } catch {
        return;
      }
      return;
    }
  }

  /**
   * Extract the version field from SKILL.md YAML frontmatter.
   */
  private extractVersionFromContent(content: string): string | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return null;

    // safe: regex matched with a mandatory capture group, so match[1] is present
    const frontmatter = match[1] ?? '';
    try {
      const parsed = yaml.parse(frontmatter) as Record<string, unknown>;
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

    // safe: regex matched with a mandatory capture group, so match[1] is present
    const frontmatter = match[1] ?? '';
    try {
      const parsed = yaml.parse(frontmatter) as Record<string, unknown>;
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
