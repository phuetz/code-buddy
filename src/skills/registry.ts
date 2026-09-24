/**
 * Skill Registry
 *
 * Three-tier skill loading system (workspace > managed > bundled).
 * Supports lazy loading, caching, and file watching.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type {
  Skill,
  SkillTier,
  SkillRegistryConfig,
  SkillMatch,
  SkillSearchOptions,
  UnifiedSkill,
} from './types.js';
import { DEFAULT_SKILL_REGISTRY_CONFIG } from './types.js';
import { parseSkillFile, validateSkill } from './parser.js';
import {
  skillMdToUnified,
  type LegacySkill,
} from './adapters/index.js';
import { scanDeniesInstall, scanFile as scanSkillFile } from '../security/skill-scanner.js';
import { getSkillsHub } from './hub.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Skill Registry Class
// ============================================================================

/** Watchers whose close was started but whose handle may still be held. */
const pendingWatcherCloses = new Set<Promise<void>>();

/** A watcher that already errored never emits 'close': never wait forever. */
const WATCHER_CLOSE_TIMEOUT_MS = 2000;

/** Kernel/user watch quotas. Node maps a full inotify table to these codes. */
const WATCH_RESOURCE_ERROR_CODES = new Set(['ENOSPC', 'EMFILE', 'ENFILE']);

/** Bound on-demand rescans so a hot get() loop cannot hammer the disk. */
const ON_DEMAND_RESCAN_MIN_MS = 200;

export interface SkillWatchHealth {
  watcherCount: number;
  degraded: boolean;
  reason: string | null;
}

function readInotifyLimit(name: 'max_user_watches' | 'max_user_instances'): string | null {
  try {
    return fs.readFileSync(`/proc/sys/fs/inotify/${name}`, 'utf8').trim();
  } catch {
    return null;
  }
}

function watchResourceHint(): string {
  if (process.platform !== 'linux') {
    return 'the operating system refused a filesystem watcher';
  }
  const maxWatches = readInotifyLimit('max_user_watches') ?? '?';
  const maxInstances = readInotifyLimit('max_user_instances') ?? '?';
  return (
    `inotify limit exhausted (fs.inotify.max_user_watches=${maxWatches}, ` +
    `fs.inotify.max_user_instances=${maxInstances})`
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function trackWatcherClose(watcher: fs.FSWatcher): void {
  const closed = new Promise<void>(resolve => {
    watcher.once('close', () => resolve());
    const timer = setTimeout(resolve, WATCHER_CLOSE_TIMEOUT_MS);
    timer.unref?.();
  });
  pendingWatcherCloses.add(closed);
  void closed.then(() => pendingWatcherCloses.delete(closed));
}

export class SkillRegistry extends EventEmitter {
  private config: SkillRegistryConfig;
  private skills: Map<string, Skill> = new Map();
  private skillsByTier: Map<SkillTier, Map<string, Skill>> = new Map();
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private loaded: boolean = false;
  private watchingPauses = 0;
  private resumeWatchingAfterPause = false;
  private watchUnavailableReason: string | null = null;
  private watchDegradedLogged = false;
  private watchPassFailed = false;
  private lastOnDemandRescanAt = 0;

  private readonly watchFn: typeof fs.watch;

  constructor(
    config: Partial<SkillRegistryConfig> & { watchFn?: typeof fs.watch } = {}
  ) {
    super();
    const { watchFn, ...rest } = config;
    this.config = { ...DEFAULT_SKILL_REGISTRY_CONFIG, ...rest };
    this.watchFn = watchFn ?? fs.watch;

    // Initialize tier maps
    this.skillsByTier.set('workspace', new Map());
    this.skillsByTier.set('managed', new Map());
    this.skillsByTier.set('bundled', new Map());
  }

  // ==========================================================================
  // Loading
  // ==========================================================================

  /**
   * Load all skills from all tiers
   */
  async load(): Promise<void> {
    if (this.loaded && this.config.cacheEnabled) {
      return;
    }

    this.skills.clear();
    for (const tierMap of this.skillsByTier.values()) {
      tierMap.clear();
    }

    // Load in priority order (lower priority first, higher priority overwrites)
    await this.loadTier('bundled', this.config.bundledPath);
    await this.loadTier('managed', this.config.managedPath);
    await this.loadTier('workspace', this.config.workspacePath);

    this.loaded = true;
    this.emit('registry:reloaded', this.skills.size);

    // Start watching if enabled
    if (this.config.watchEnabled) {
      this.startWatching();
    }
  }

  /**
   * Load skills from a specific tier
   */
  private async loadTier(tier: SkillTier, dirPath: string): Promise<void> {
    if (!dirPath) {
      return;
    }

    const resolvedPath = this.resolvePath(dirPath);

    if (!fs.existsSync(resolvedPath)) {
      return;
    }

    let files: string[];
    try {
      files = await this.findSkillFiles(resolvedPath);
    } catch (error) {
      if (this.isEnoent(error)) return;
      throw error;
    }

    for (const file of files) {
      try {
        const skill = await this.loadSkillFile(file, tier);
        this.registerSkill(skill);
      } catch (error) {
        if (!this.isEnoent(error)) {
          this.emit('skill:error', file, error instanceof Error ? error : new Error(String(error)));
        }
      }
    }
  }

  /**
   * Find all SKILL.md files in a directory
   */
  private async findSkillFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return this.collectSkillFiles(dirPath, entries);
  }

  private findSkillFilesSync(dirPath: string): string[] {
    return this.collectSkillFiles(dirPath, fs.readdirSync(dirPath, { withFileTypes: true }));
  }

  private collectSkillFiles(dirPath: string, entries: fs.Dirent[]): string[] {
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const skillFile = path.join(fullPath, 'skill.md');
        if (fs.existsSync(skillFile)) {
          files.push(skillFile);
        }
        const skillFileUpper = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(skillFileUpper)) {
          files.push(skillFileUpper);
        }
      } else if (
        entry.name.toLowerCase().endsWith('.skill.md') ||
        entry.name.toLowerCase() === 'skill.md'
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Load a single skill file
   */
  private async loadSkillFile(filePath: string, tier: SkillTier): Promise<Skill> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const skill = parseSkillFile(content, filePath, tier);

    const validation = validateSkill(skill);
    if (!validation.valid) {
      throw new Error(`Invalid skill: ${validation.errors.join(', ')}`);
    }

    return skill;
  }

  /**
   * Register a skill
   */
  private registerSkill(skill: Skill): void {
    // Block critical findings, and any scan that did not read a regular file.
    if (skill.sourcePath && !skill.sourcePath.startsWith('legacy://') && fs.existsSync(skill.sourcePath)) {
      try {
        const scanResult = scanSkillFile(skill.sourcePath);
        if (scanDeniesInstall(scanResult)) {
          const criticalFindings = scanResult.findings.filter(f => f.severity === 'critical');
          const unread = scanResult.textRead !== true
            || scanResult.findings.some(f => f.pattern === 'special-file-not-read');
          const detail = unread
            ? 'the scanner did not read a regular file'
            : `${criticalFindings.length} critical finding(s) — ${criticalFindings.map(f => f.description).join('; ')}`;
          this.emit('skill:error', skill.sourcePath, new Error(
            `Skill blocked by security scanner: ${detail}`
          ));
          return;
        }
      } catch {
        this.emit('skill:error', skill.sourcePath, new Error(
          'Skill blocked by security scanner: the scanner did not read a regular file'
        ));
        return;
      }
    }

    // Add to main map (overwrites lower priority)
    this.skills.set(skill.metadata.name, skill);

    // Add to tier-specific map
    const tierMap = this.skillsByTier.get(skill.tier);
    if (tierMap) {
      tierMap.set(skill.metadata.name, skill);
    }

    this.emit('skill:loaded', skill);
  }

  /**
   * Load and register one generated skill immediately, even when its active
   * workspace differs from the process cwd used by the default registry.
   */
  async registerSkillFile(filePath: string, tier: SkillTier = 'workspace'): Promise<Skill> {
    const skill = await this.loadSkillFile(filePath, tier);
    this.registerSkill(skill);
    return skill;
  }

  /**
   * Synchronous twin of registerSkillFile for callers that immediately go on
   * to move/remove the skill directory (the self-improvement mutator): no
   * read handle is left pending on the event loop, which on Windows would make
   * the subsequent directory rename fail with EPERM.
   */
  registerSkillFileSync(filePath: string, tier: SkillTier = 'workspace'): Skill {
    const content = fs.readFileSync(filePath, 'utf-8');
    const skill = parseSkillFile(content, filePath, tier);
    const validation = validateSkill(skill);
    if (!validation.valid) {
      throw new Error(`Invalid skill: ${validation.errors.join(', ')}`);
    }
    this.registerSkill(skill);
    return skill;
  }

  // ==========================================================================
  // Retrieval
  // ==========================================================================

  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    this.maybeOnDemandRescan();
    return this.skills.get(name);
  }

  /**
   * List all skills
   */
  list(options?: { tier?: SkillTier; tags?: string[]; enabled?: boolean }): Skill[] {
    this.maybeOnDemandRescan();
    let skills = Array.from(this.skills.values());

    let disabledSkills = new Set<string>();
    try {
      disabledSkills = new Set(
        getSkillsHub()
          .list()
          .filter((s) => s.enabled === false)
          .map((s) => s.name)
      );
    } catch {
      // Ignored
    }

    if (options?.tier) {
      skills = skills.filter(s => s.tier === options.tier);
    }

    if (options?.tags && options.tags.length > 0) {
      skills = skills.filter(s =>
        s.metadata.tags?.some(t => options.tags!.includes(t))
      );
    }

    if (options?.enabled !== undefined) {
      skills = skills.filter(s => {
        const isHubEnabled = !disabledSkills.has(s.metadata.name);
        const isSkillEnabled = s.enabled !== false;
        const finalEnabled = isHubEnabled && isSkillEnabled;
        return finalEnabled === options.enabled;
      });
    }

    return skills;
  }

  /**
   * Get skill count
   */
  get count(): number {
    this.maybeOnDemandRescan();
    return this.skills.size;
  }

  /**
   * Get all tags
   */
  getTags(): string[] {
    const tags = new Set<string>();
    for (const skill of this.skills.values()) {
      if (skill.metadata.tags) {
        for (const tag of skill.metadata.tags) {
          tags.add(tag);
        }
      }
    }
    return Array.from(tags).sort();
  }

  // ==========================================================================
  // Matching
  // ==========================================================================

  /**
   * Find skills matching a query
   */
  search(options: SkillSearchOptions): SkillMatch[] {
    this.maybeOnDemandRescan();
    const matches: SkillMatch[] = [];
    const query = options.query.toLowerCase();
    const queryWords = query.split(/\s+/);

    let disabledSkills = new Set<string>();
    try {
      disabledSkills = new Set(
        getSkillsHub()
          .list()
          .filter((s) => s.enabled === false)
          .map((s) => s.name)
      );
    } catch {
      // Ignored
    }

    for (const skill of this.skills.values()) {
      if (disabledSkills.has(skill.metadata.name) && !options.includeDisabled) {
        continue;
      }

      if (!skill.enabled && !options.includeDisabled) {
        continue;
      }

      if (options.tier && skill.tier !== options.tier) {
        continue;
      }

      if (options.tags && options.tags.length > 0) {
        if (!skill.metadata.tags?.some(t => options.tags!.includes(t))) {
          continue;
        }
      }

      const match = this.scoreSkill(skill, query, queryWords);

      if (match.confidence >= (options.minConfidence || 0.1)) {
        matches.push(match);
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    // Apply limit
    if (options.limit) {
      return matches.slice(0, options.limit);
    }

    return matches;
  }

  /**
   * Score a skill against a query
   */
  private scoreSkill(skill: Skill, query: string, queryWords: string[]): SkillMatch {
    let score = 0;
    const matchedTriggers: string[] = [];
    const matchedTags: string[] = [];
    const reasons: string[] = [];

    // Filter out stop words and short words for partial matching
    const significantWords = queryWords.filter(w => w.length >= 3);

    // Check name — exact substring match in name
    const nameLower = skill.metadata.name.toLowerCase();
    if (nameLower.includes(query)) {
      score += 0.6;
      reasons.push('name match');
    } else {
      // Check if significant query words appear in the skill name
      const nameWordMatches = significantWords.filter(w => nameLower.includes(w)).length;
      if (nameWordMatches > 0) {
        score += 0.3 * (nameWordMatches / Math.max(significantWords.length, 1));
        reasons.push('name word match');
      }
    }

    // Check description
    const descLower = skill.metadata.description.toLowerCase();
    if (descLower.includes(query)) {
      score += 0.3;
      reasons.push('description match');
    } else if (significantWords.length > 0) {
      // Partial word matches (only significant words)
      const wordMatches = significantWords.filter(w => descLower.includes(w)).length;
      if (wordMatches > 0) {
        score += 0.15 * (wordMatches / significantWords.length);
        reasons.push('partial description match');
      }
    }

    // Check tags — require exact tag match or significant word match
    if (skill.metadata.tags) {
      let tagScore = 0;
      for (const tag of skill.metadata.tags) {
        const tagLower = tag.toLowerCase().trim();
        // Exact tag match with a significant query word
        if (significantWords.some(w => tagLower === w || tagLower.includes(w) && w.length >= 4)) {
          tagScore += 0.1;
          matchedTags.push(tag);
        }
      }
      // Cap tag score to avoid skills with many tags winning
      score += Math.min(tagScore, 0.2);
      if (matchedTags.length > 0) {
        reasons.push('tag match');
      }
    }

    // Check triggers (Standard metadata) — query must contain trigger, not reverse
    if (skill.metadata.nativeEngine?.triggers) {
      for (const trigger of skill.metadata.nativeEngine.triggers) {
        const triggerLower = trigger.toLowerCase();
        if (query.includes(triggerLower)) {
          score += 0.4;
          matchedTriggers.push(trigger);
        } else {
          // Check word overlap for multi-word triggers
          const triggerWords = triggerLower.split(/\s+/).filter(w => w.length >= 3);
          const overlap = triggerWords.filter(tw => significantWords.includes(tw)).length;
          if (triggerWords.length > 0 && overlap >= Math.ceil(triggerWords.length * 0.6)) {
            score += 0.25 * (overlap / triggerWords.length);
            matchedTriggers.push(trigger);
          }
        }
      }
      if (matchedTriggers.length > 0) {
        reasons.push('trigger match');
      }
    }

    // Check examples — query must contain example or high word overlap
    if (skill.content.examples) {
      for (const example of skill.content.examples) {
        const exampleLower = example.request.toLowerCase();
        if (query.includes(exampleLower) || exampleLower.includes(query)) {
          score += 0.35;
          reasons.push('example match');
          break;
        }
        // Word overlap with examples
        const exampleWords = exampleLower.split(/\s+/).filter(w => w.length >= 3);
        const overlap = exampleWords.filter(ew => significantWords.includes(ew)).length;
        if (exampleWords.length > 0 && overlap >= Math.ceil(exampleWords.length * 0.5)) {
          score += 0.2 * (overlap / exampleWords.length);
          reasons.push('example word match');
          break;
        }
      }
    }

    // Apply priority boost
    if (skill.metadata.nativeEngine?.priority) {
      score *= 1 + (skill.metadata.nativeEngine.priority / 100);
    }

    // Normalize to 0-1
    const confidence = Math.min(1, score);

    return {
      skill,
      confidence,
      reason: reasons.join(', ') || 'no match',
      matchedTriggers,
      matchedTags,
    };
  }

  /**
   * Find the best matching skill for a request
   */
  findBestMatch(request: string): SkillMatch | null {
    const matches = this.search({
      query: request,
      limit: 1,
      minConfidence: 0.15,
    });

    return matches[0] ?? null;
  }

  // ==========================================================================
  // Unified Skill Access
  // ==========================================================================

  /**
   * Register a legacy JSON-based skill by converting it to SKILL.md format.
   * The skill is stored internally as a SKILL.md Skill after conversion
   * from the legacy adapter.
   *
   * @param legacySkill - A legacy skill object (from SkillManager or SkillLoader)
   * @param tier - The tier to register under (defaults to 'workspace')
   */
  registerLegacySkill(legacySkill: LegacySkill, tier: SkillTier = 'workspace'): void {
    // Convert to SKILL.md Skill format for internal storage
    const skill: Skill = {
      metadata: {
        name: legacySkill.name,
        description: legacySkill.description || '',
        tags: legacySkill.triggers ? legacySkill.triggers.slice(0, 10) : undefined,
        requires: legacySkill.tools ? { tools: legacySkill.tools } : undefined,
        nativeEngine: {
          priority: legacySkill.priority,
          triggers: legacySkill.triggers ? [...legacySkill.triggers] : undefined,
        },
      },
      content: {
        description: legacySkill.systemPrompt || '',
        rawMarkdown: legacySkill.systemPrompt || '',
      },
      sourcePath: 'legacy://' + legacySkill.name,
      tier,
      loadedAt: new Date(),
      enabled: true,
    };

    this.registerSkill(skill);
  }

  /**
   * Get all skills as UnifiedSkill format.
   * Converts all registered SKILL.md skills to the unified format.
   *
   * @returns An array of UnifiedSkill objects
   */
  getAllUnified(): UnifiedSkill[] {
    this.maybeOnDemandRescan();
    const unified: UnifiedSkill[] = [];

    let disabledSkills = new Set<string>();
    try {
      disabledSkills = new Set(
        getSkillsHub()
          .list()
          .filter((s) => s.enabled === false)
          .map((s) => s.name)
      );
    } catch {
      // Ignored
    }

    for (const skill of this.skills.values()) {
      const uSkill = skillMdToUnified(skill);
      const isHubEnabled = !disabledSkills.has(skill.metadata.name);
      const isSkillEnabled = skill.enabled !== false;
      uSkill.enabled = isHubEnabled && isSkillEnabled;
      unified.push(uSkill);
    }

    return unified;
  }

  // ==========================================================================
  // Management
  // ==========================================================================

  /**
   * Enable a skill
   */
  enable(name: string): boolean {
    const skill = this.skills.get(name);
    if (skill) {
      skill.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * Disable a skill
   */
  disable(name: string): boolean {
    const skill = this.skills.get(name);
    if (skill) {
      skill.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * Reload a specific skill
   */
  async reload(name: string): Promise<boolean> {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    try {
      const reloaded = await this.loadSkillFile(skill.sourcePath, skill.tier);
      this.registerSkill(reloaded);
      return true;
    } catch (error) {
      if (!this.isEnoent(error)) {
        this.emit('skill:error', name, error instanceof Error ? error : new Error(String(error)));
      }
      return false;
    }
  }

  /**
   * Reload all skills
   */
  async reloadAll(): Promise<void> {
    this.loaded = false;
    await this.load();
  }

  /**
   * Unload a skill
   */
  unload(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    this.skills.delete(name);
    const tierMap = this.skillsByTier.get(skill.tier);
    if (tierMap) {
      tierMap.delete(name);
    }

    this.emit('skill:unloaded', name);
    return true;
  }

  // ==========================================================================
  // File Watching
  // ==========================================================================

  /**
   * Start watching skill directories
   */
  private startWatching(): void {
    this.stopWatching();
    if (this.watchingPauses > 0) {
      this.resumeWatchingAfterPause = true;
      return;
    }

    this.watchPassFailed = false;
    const paths = [
      { tier: 'workspace' as SkillTier, path: this.config.workspacePath },
      { tier: 'managed' as SkillTier, path: this.config.managedPath },
    ];

    let attempted = 0;
    for (const { tier, path: dirPath } of paths) {
      if (!dirPath) continue;

      const resolved = this.resolvePath(dirPath);
      if (!fs.existsSync(resolved)) continue;

      attempted += 1;
      if (this.watchDirectory(tier, resolved, resolved, true)) {
        this.refreshChildWatchers(tier, resolved);
      }
    }

    if (attempted > 0 && this.watchers.size > 0 && !this.watchPassFailed) {
      this.watchUnavailableReason = null;
      this.watchDegradedLogged = false;
    }
  }

  private watcherKey(tier: SkillTier, directory: string): string {
    return `${tier}:${directory}`;
  }

  /**
   * Watch exactly one directory. Recursive fs.watch is intentionally avoided:
   * Node's Linux recursive watcher can throw outside our callback when a newly
   * discovered child disappears before its internal scandir runs.
   */
  private watchDirectory(
    tier: SkillTier,
    rootPath: string,
    directory: string,
    isRoot: boolean
  ): boolean {
    const key = this.watcherKey(tier, directory);
    if (this.watchers.has(key)) {
      return true;
    }

    try {
      const watcher = this.watchFn(directory, { recursive: false }, (event, filename) => {
        if (isRoot) {
          this.handleRootWatchEvent(tier, rootPath, event, filename);
        } else {
          this.handleChildWatchEvent(tier, rootPath, directory, event, filename);
        }
      });

      watcher.on('error', error => {
        this.closeWatcher(key);
        if (isRoot) {
          this.removeChildWatchers(tier, rootPath);
          if (this.isEnoent(error)) {
            this.unloadSkillsUnder(rootPath, tier);
          }
        } else if (this.isEnoent(error)) {
          this.unloadSkillsUnder(directory, tier);
        }
        this.reportWatchError(directory, error);
      });

      this.watchers.set(key, watcher);
      return true;
    } catch (error) {
      this.reportWatchError(directory, error);
      return false;
    }
  }

  private handleRootWatchEvent(
    tier: SkillTier,
    rootPath: string,
    event: string,
    filename: string | Buffer | null
  ): void {
    if (!this.loaded || this.watchingPauses > 0) return;

    const name = filename?.toString();
    if (name && path.basename(name) === name) {
      const changedPath = path.join(rootPath, name);
      if (this.isSkillFilename(name)) {
        this.queueFileChange(tier, changedPath, event);
      } else if (event === 'rename') {
        const childKey = this.watcherKey(tier, changedPath);
        if (this.watchers.has(childKey)) {
          this.closeWatcher(childKey);
          this.unloadSkillsUnder(changedPath, tier);
        }
      }
    }

    this.refreshChildWatchers(tier, rootPath);
  }

  private handleChildWatchEvent(
    tier: SkillTier,
    rootPath: string,
    directory: string,
    event: string,
    filename: string | Buffer | null
  ): void {
    if (!this.loaded || this.watchingPauses > 0) return;

    if (!this.isDirectory(directory)) {
      this.closeWatcher(this.watcherKey(tier, directory));
      this.unloadSkillsUnder(directory, tier);
      this.refreshChildWatchers(tier, rootPath);
      return;
    }

    const name = filename?.toString();
    if (name && path.basename(name) === name && this.isSkillFilename(name)) {
      this.queueFileChange(tier, path.join(directory, name), event);
    } else if (!name) {
      this.refreshSkillFilesInChild(tier, directory);
    }
  }

  /**
   * Keep one non-recursive watcher for every first-level skill directory.
   * Every filesystem lookup is guarded because a directory may disappear at
   * any point between readdir, watch, and the first callback.
   */
  private refreshChildWatchers(tier: SkillTier, rootPath: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rootPath, { withFileTypes: true });
    } catch (error) {
      if (this.isEnoent(error)) {
        this.closeWatcher(this.watcherKey(tier, rootPath));
        this.removeChildWatchers(tier, rootPath);
        this.unloadSkillsUnder(rootPath, tier);
      } else {
        this.reportWatchError(rootPath, error);
      }
      return;
    }

    const rootKey = this.watcherKey(tier, rootPath);
    const childKeyPrefix = `${rootKey}${path.sep}`;
    const childDirectories = new Set(
      entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(rootPath, entry.name))
    );

    for (const key of Array.from(this.watchers.keys())) {
      if (!key.startsWith(childKeyPrefix)) continue;

      const directory = key.slice(`${tier}:`.length);
      if (!childDirectories.has(directory)) {
        this.closeWatcher(key);
        this.unloadSkillsUnder(directory, tier);
      }
    }

    for (const directory of childDirectories) {
      const key = this.watcherKey(tier, directory);
      if (this.watchers.has(key)) continue;
      const watching = this.watchDirectory(tier, rootPath, directory, false);
      // A refused observer must still pick up SKILL.md that already exists.
      if (watching || this.isDirectory(directory)) {
        this.refreshSkillFilesInChild(tier, directory);
      }
    }
  }

  private refreshSkillFilesInChild(tier: SkillTier, directory: string): void {
    for (const name of ['skill.md', 'SKILL.md']) {
      this.queueFileChange(tier, path.join(directory, name), 'rename');
    }
  }

  private queueFileChange(tier: SkillTier, filePath: string, event: string): void {
    void this.handleFileChange(tier, filePath, event).catch(error => {
      this.reportWatchError(filePath, error);
    });
  }

  private isSkillFilename(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower === 'skill.md' || lower.endsWith('.skill.md');
  }

  private isDirectory(directory: string): boolean {
    try {
      return fs.statSync(directory).isDirectory();
    } catch (error) {
      this.reportWatchError(directory, error);
      return false;
    }
  }

  private unloadSkillsUnder(directory: string, tier: SkillTier): void {
    const prefix = `${directory}${path.sep}`;
    const names = Array.from(this.skillsByTier.get(tier)?.values() ?? [])
      .filter(skill => skill.sourcePath === directory || skill.sourcePath.startsWith(prefix))
      .map(skill => skill.metadata.name);

    for (const name of names) {
      this.unload(name);
    }
  }

  private removeChildWatchers(tier: SkillTier, rootPath: string): void {
    const prefix = `${this.watcherKey(tier, rootPath)}${path.sep}`;
    for (const key of Array.from(this.watchers.keys())) {
      if (key.startsWith(prefix)) {
        this.closeWatcher(key);
      }
    }
  }

  private closeWatcher(key: string): void {
    const watcher = this.watchers.get(key);
    if (!watcher) return;

    this.watchers.delete(key);
    trackWatcherClose(watcher);
    try {
      watcher.close();
    } catch {
      // The watcher may already be closed after an error event.
    }
  }

  private isEnoent(error: unknown): boolean {
    return errorCode(error) === 'ENOENT';
  }

  private isWatchResourceError(error: unknown): boolean {
    const code = errorCode(error);
    return code !== undefined && WATCH_RESOURCE_ERROR_CODES.has(code);
  }

  getWatchHealth(): SkillWatchHealth {
    return {
      watcherCount: this.watchers.size,
      degraded: this.watchUnavailableReason !== null,
      reason: this.watchUnavailableReason,
    };
  }

  private maybeOnDemandRescan(): void {
    if (!this.loaded || !this.config.watchEnabled || this.watchUnavailableReason === null) {
      return;
    }

    const now = Date.now();
    if (now - this.lastOnDemandRescanAt < ON_DEMAND_RESCAN_MIN_MS) {
      return;
    }
    this.lastOnDemandRescanAt = now;

    if (this.watchingPauses === 0) {
      this.startWatching();
      if (this.watchUnavailableReason === null && this.watchers.size > 0) {
        return;
      }
    }

    this.rescanWatchedTiersSync();
  }

  private rescanWatchedTiersSync(): void {
    const seen = new Set<string>();
    const paths = [
      { tier: 'workspace' as SkillTier, path: this.config.workspacePath },
      { tier: 'managed' as SkillTier, path: this.config.managedPath },
    ];

    for (const { tier, path: dirPath } of paths) {
      if (!dirPath) continue;
      const resolved = this.resolvePath(dirPath);
      if (!fs.existsSync(resolved)) continue;

      let files: string[];
      try {
        files = this.findSkillFilesSync(resolved);
      } catch (error) {
        if (this.isEnoent(error)) continue;
        this.reportWatchError(resolved, error);
        continue;
      }

      for (const file of files) {
        try {
          const skill = this.registerSkillFileSync(file, tier);
          seen.add(skill.metadata.name);
        } catch (error) {
          if (!this.isEnoent(error)) {
            this.emit(
              'skill:error',
              file,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }
      }
    }

    for (const skill of [...this.skills.values()]) {
      if (skill.tier === 'bundled') continue;
      if (!seen.has(skill.metadata.name)) this.unload(skill.metadata.name);
    }
  }

  private reportWatchError(targetPath: string, error: unknown): void {
    if (this.isEnoent(error)) return;

    this.watchPassFailed = true;
    if (this.isWatchResourceError(error)) {
      const code = errorCode(error) ?? 'ENOSPC';
      this.watchUnavailableReason = `${code}: ${watchResourceHint()}`;
      if (!this.watchDegradedLogged) {
        this.watchDegradedLogged = true;
        logger.warn(
          'Skill directory watching unavailable; falling back to on-demand rescan',
          { directory: targetPath, code, reason: this.watchUnavailableReason }
        );
      }
    } else if (this.watchUnavailableReason === null) {
      const message = error instanceof Error ? error.message : String(error);
      this.watchUnavailableReason = message;
      if (!this.watchDegradedLogged) {
        this.watchDegradedLogged = true;
        logger.warn(
          'Skill directory watching unavailable; falling back to on-demand rescan',
          { directory: targetPath, reason: message }
        );
      }
    }

    this.emit(
      'skill:error',
      targetPath,
      error instanceof Error ? error : new Error(String(error))
    );
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(
    tier: SkillTier,
    filePath: string,
    event: string
  ): Promise<void> {
    if (event === 'rename') {
      // File deleted or renamed
      const skill = Array.from(this.skills.values()).find(s => s.sourcePath === filePath);
      if (skill) {
        this.unload(skill.metadata.name);
      }

      // Check if file exists (renamed to)
      if (fs.existsSync(filePath)) {
        try {
          const newSkill = await this.loadSkillFile(filePath, tier);
          this.registerSkill(newSkill);
        } catch {
          // Invalid skill file
        }
      }
    } else if (event === 'change') {
      // File modified
      const skill = Array.from(this.skills.values()).find(s => s.sourcePath === filePath);
      if (skill) {
        await this.reload(skill.metadata.name);
      } else {
        // New file
        try {
          const newSkill = await this.loadSkillFile(filePath, tier);
          this.registerSkill(newSkill);
        } catch {
          // Invalid skill file
        }
      }
    }
  }

  /** Suspend handles during removal; restore only a previously active watcher set. */
  pauseWatching(): () => void {
    if (this.watchingPauses === 0) this.resumeWatchingAfterPause = this.watchers.size > 0;
    this.watchingPauses++;
    this.stopWatching();
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      this.watchingPauses--;
      if (this.watchingPauses === 0 && this.resumeWatchingAfterPause && this.loaded) {
        // Removal events were deliberately missed while handles were closed.
        for (const skill of [...this.skills.values()]) {
          if (!fs.existsSync(skill.sourcePath)) this.unload(skill.metadata.name);
        }
        this.startWatching();
      }
    };
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    for (const key of Array.from(this.watchers.keys())) {
      this.closeWatcher(key);
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Resolve path with home directory expansion
   */
  private resolvePath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
  }

  /**
   * Format skills as a list for display
   */
  formatList(): string {
    const lines: string[] = ['Skills Registry:', ''];

    const byTier: Record<SkillTier, Skill[]> = {
      workspace: [],
      managed: [],
      bundled: [],
    };

    for (const skill of this.skills.values()) {
      byTier[skill.tier].push(skill);
    }

    for (const tier of ['workspace', 'managed', 'bundled'] as SkillTier[]) {
      const skills = byTier[tier];
      if (skills.length === 0) continue;

      lines.push(`[${tier.toUpperCase()}] (${skills.length})`);
      for (const skill of skills) {
        const status = skill.enabled ? '✓' : '✗';
        const tags = skill.metadata.tags?.join(', ') || '';
        lines.push(`  ${status} ${skill.metadata.name} - ${skill.metadata.description}`);
        if (tags) {
          lines.push(`      Tags: ${tags}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Shutdown registry
   */
  shutdown(): void {
    this.stopWatching();
    this.skills.clear();
    this.skillsByTier.clear();
    this.loaded = false;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let registryInstance: SkillRegistry | null = null;

export function getSkillRegistry(config?: Partial<SkillRegistryConfig>): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry(config);
  }
  return registryInstance;
}

/** Do not create a registry just to remove an installed package. */
export function pauseSkillRegistryWatching(): () => void {
  return registryInstance?.pauseWatching() ?? (() => {});
}

/**
 * Wait until every closed watcher released its operating-system handle.
 *
 * Windows refuses to remove a directory that still carries a change
 * notification handle, and `watcher.close()` only starts that release: the
 * 'close' event is emitted on the next tick while libuv frees the handle in a
 * later loop phase. Callers that remove a watched directory must await this
 * before the removal, otherwise the first `rm` attempt races the release.
 */
export async function awaitSkillRegistryWatchersClosed(): Promise<void> {
  const pending = [...pendingWatcherCloses];
  pendingWatcherCloses.clear();
  await Promise.all(pending);
  // libuv runs handle close callbacks after the check phase: two turns of the
  // loop are enough for the descriptor to be gone, on every platform.
  await new Promise<void>(resolve => { setImmediate(resolve); });
  await new Promise<void>(resolve => { setImmediate(resolve); });
}

export function resetSkillRegistry(): void {
  if (registryInstance) {
    registryInstance.shutdown();
  }
  registryInstance = null;
}

export default SkillRegistry;
