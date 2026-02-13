/**
 * Allowlist Store
 *
 * Persists approval patterns to ~/.codebuddy/exec-approvals.json
 * Provides CRUD operations for patterns and configuration.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  ApprovalPattern,
  AllowlistConfig,
  PatternType,
  ApprovalDecision,
  PatternSource,
} from './types.js';
import { DEFAULT_ALLOWLIST_CONFIG, DEFAULT_SAFE_PATTERNS, DEFAULT_DENY_PATTERNS } from './types.js';
import { matchApprovalPattern, findBestMatch, validatePattern } from './pattern-matcher.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Allowlist Store
// ============================================================================

/**
 * Store for bash command approval patterns
 */
export class AllowlistStore extends EventEmitter {
  private config: AllowlistConfig;
  private configPath: string;
  private initialized: boolean = false;

  constructor(configDir?: string) {
    super();
    this.configPath = this.getConfigPath(configDir);
    this.config = { ...DEFAULT_ALLOWLIST_CONFIG };
  }

  /**
   * Initialize the store (load config, add defaults)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.loadConfig();
    this.addDefaultPatterns();
    this.initialized = true;

    this.emit('config:loaded', this.config);
  }

  /**
   * Check if store is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  // ============================================================================
  // Pattern Operations
  // ============================================================================

  /**
   * Add a new pattern
   */
  addPattern(
    pattern: string,
    type: PatternType,
    decision: ApprovalDecision,
    options?: {
      description?: string;
      tags?: string[];
      source?: PatternSource;
      expiresAt?: Date | null;
    }
  ): ApprovalPattern {
    // Validate pattern
    const validation = validatePattern(pattern, type);
    if (!validation.valid) {
      throw new Error(`Invalid pattern: ${validation.error}`);
    }

    // Check for duplicate
    const existing = this.findPatternByValue(pattern, type);
    if (existing) {
      // Update existing pattern
      existing.decision = decision;
      existing.description = options?.description || existing.description;
      existing.tags = options?.tags || existing.tags;
      existing.enabled = true;
      this.saveConfig();
      return existing;
    }

    const newPattern: ApprovalPattern = {
      id: randomUUID(),
      pattern,
      type,
      decision,
      description: options?.description,
      useCount: 0,
      createdAt: new Date(),
      expiresAt: options?.expiresAt,
      enabled: true,
      tags: options?.tags,
      source: options?.source || 'user',
    };

    this.config.patterns.push(newPattern);
    this.saveConfig();

    this.emit('pattern:added', newPattern);
    return newPattern;
  }

  /**
   * Remove a pattern by ID
   */
  removePattern(id: string): boolean {
    const index = this.config.patterns.findIndex(p => p.id === id);
    if (index === -1) {
      return false;
    }

    // Don't remove system patterns
    const pattern = this.config.patterns[index];
    if (pattern.source === 'system') {
      // Just disable it instead
      pattern.enabled = false;
      this.saveConfig();
      return true;
    }

    this.config.patterns.splice(index, 1);
    this.saveConfig();

    this.emit('pattern:removed', { id });
    return true;
  }

  /**
   * Update a pattern
   */
  updatePattern(
    id: string,
    updates: Partial<Omit<ApprovalPattern, 'id' | 'createdAt'>>
  ): ApprovalPattern | undefined {
    const pattern = this.getPattern(id);
    if (!pattern) {
      return undefined;
    }

    // Validate if pattern string is being updated
    if (updates.pattern && updates.type) {
      const validation = validatePattern(updates.pattern, updates.type);
      if (!validation.valid) {
        throw new Error(`Invalid pattern: ${validation.error}`);
      }
    }

    Object.assign(pattern, updates);
    this.saveConfig();

    return pattern;
  }

  /**
   * Get a pattern by ID
   */
  getPattern(id: string): ApprovalPattern | undefined {
    return this.config.patterns.find(p => p.id === id);
  }

  /**
   * Find pattern by value and type
   */
  findPatternByValue(pattern: string, type: PatternType): ApprovalPattern | undefined {
    return this.config.patterns.find(
      p => p.pattern === pattern && p.type === type
    );
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): ApprovalPattern[] {
    return [...this.config.patterns];
  }

  /**
   * Get patterns by tag
   */
  getPatternsByTag(tag: string): ApprovalPattern[] {
    return this.config.patterns.filter(
      p => p.tags?.includes(tag)
    );
  }

  /**
   * Get patterns by decision
   */
  getPatternsByDecision(decision: ApprovalDecision): ApprovalPattern[] {
    return this.config.patterns.filter(
      p => p.decision === decision && p.enabled
    );
  }

  /**
   * Enable/disable a pattern
   */
  setPatternEnabled(id: string, enabled: boolean): boolean {
    const pattern = this.getPattern(id);
    if (!pattern) {
      return false;
    }

    pattern.enabled = enabled;
    this.saveConfig();
    return true;
  }

  // ============================================================================
  // Command Checking
  // ============================================================================

  /**
   * Check a command against stored patterns
   */
  checkCommand(command: string): {
    matched: boolean;
    pattern?: ApprovalPattern;
    decision: ApprovalDecision | 'prompt';
  } {
    // Update stats
    this.config.stats.totalChecks++;

    // Clean expired patterns first
    this.cleanExpiredPatterns();

    // Find best matching pattern
    const match = findBestMatch(command, this.config.patterns);

    if (match) {
      // Update pattern usage
      match.useCount++;
      match.lastUsedAt = new Date();
      this.saveConfig();

      // Update stats
      if (match.decision === 'allow') {
        this.config.stats.allowed++;
      } else {
        this.config.stats.denied++;
      }

      this.emit('pattern:matched', { command, pattern: match });

      return {
        matched: true,
        pattern: match,
        decision: match.decision,
      };
    }

    // No match - use fallback
    this.config.stats.prompted++;
    return {
      matched: false,
      decision: this.config.defaults.fallback,
    };
  }

  /**
   * Record a command approval (for creating patterns from prompts)
   */
  recordApproval(
    command: string,
    decision: ApprovalDecision,
    options?: {
      pattern?: string;
      patternType?: PatternType;
      description?: string;
    }
  ): ApprovalPattern | undefined {
    if (!options?.pattern) {
      return undefined;
    }

    return this.addPattern(
      options.pattern,
      options.patternType || 'glob',
      decision,
      {
        description: options.description || `Auto-approved: ${command}`,
        source: 'user',
        tags: ['auto-created'],
      }
    );
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get configuration
   */
  getConfig(): AllowlistConfig {
    return { ...this.config };
  }

  /**
   * Update defaults
   */
  updateDefaults(updates: Partial<AllowlistConfig['defaults']>): void {
    Object.assign(this.config.defaults, updates);
    this.saveConfig();
  }

  /**
   * Get statistics
   */
  getStats(): AllowlistConfig['stats'] {
    return { ...this.config.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.config.stats = {
      totalChecks: 0,
      allowed: 0,
      denied: 0,
      prompted: 0,
    };
    this.saveConfig();
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  /**
   * Get config file path
   */
  private getConfigPath(configDir?: string): string {
    const dir = configDir || path.join(os.homedir(), '.codebuddy');
    return path.join(dir, 'exec-approvals.json');
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<void> {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(content) as AllowlistConfig;

        // Migrate if needed
        if (loaded.version !== DEFAULT_ALLOWLIST_CONFIG.version) {
          this.migrateConfig(loaded);
        } else {
          // Convert date strings back to Date objects
          this.config = {
            ...DEFAULT_ALLOWLIST_CONFIG,
            ...loaded,
            patterns: loaded.patterns.map(p => ({
              ...p,
              createdAt: new Date(p.createdAt),
              lastUsedAt: p.lastUsedAt ? new Date(p.lastUsedAt) : undefined,
              expiresAt: p.expiresAt ? new Date(p.expiresAt) : undefined,
            })),
          };
        }
      }
    } catch (error) {
      // Use defaults on error
      logger.error('Failed to load allowlist config', error as Error);
    }
  }

  /**
   * Save configuration to file
   */
  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2)
      );

      this.emit('config:saved', this.config);
    } catch (error) {
      logger.error('Failed to save allowlist config', error as Error);
    }
  }

  /**
   * Migrate old config format
   */
  private migrateConfig(old: AllowlistConfig): void {
    // Currently only version 1, so just use defaults
    this.config = {
      ...DEFAULT_ALLOWLIST_CONFIG,
      patterns: old.patterns || [],
      stats: old.stats || DEFAULT_ALLOWLIST_CONFIG.stats,
    };
    this.saveConfig();
  }

  /**
   * Add default patterns if not present
   */
  private addDefaultPatterns(): void {
    // Add safe patterns
    for (const partial of DEFAULT_SAFE_PATTERNS) {
      const existing = this.findPatternByValue(
        partial.pattern!,
        partial.type!
      );
      if (!existing) {
        this.config.patterns.push({
          id: randomUUID(),
          pattern: partial.pattern!,
          type: partial.type!,
          decision: partial.decision!,
          description: partial.description,
          useCount: 0,
          createdAt: new Date(),
          enabled: true,
          tags: partial.tags,
          source: 'system',
        });
      }
    }

    // Add deny patterns
    for (const partial of DEFAULT_DENY_PATTERNS) {
      const existing = this.findPatternByValue(
        partial.pattern!,
        partial.type!
      );
      if (!existing) {
        this.config.patterns.push({
          id: randomUUID(),
          pattern: partial.pattern!,
          type: partial.type!,
          decision: partial.decision!,
          description: partial.description,
          useCount: 0,
          createdAt: new Date(),
          enabled: true,
          tags: partial.tags,
          source: 'system',
        });
      }
    }

    this.saveConfig();
  }

  /**
   * Clean expired patterns
   */
  private cleanExpiredPatterns(): void {
    const now = new Date();
    let cleaned = false;

    for (const pattern of this.config.patterns) {
      if (pattern.expiresAt && new Date(pattern.expiresAt) < now) {
        pattern.enabled = false;
        cleaned = true;
        this.emit('pattern:expired', { id: pattern.id });
      }
    }

    if (cleaned) {
      this.saveConfig();
    }
  }

  // ============================================================================
  // Import/Export
  // ============================================================================

  /**
   * Export patterns to JSON
   */
  exportPatterns(options?: {
    includeStats?: boolean;
    tagsFilter?: string[];
  }): string {
    let patterns = this.config.patterns;

    // Filter by tags if specified
    if (options?.tagsFilter?.length) {
      patterns = patterns.filter(p =>
        p.tags?.some(t => options.tagsFilter!.includes(t))
      );
    }

    const exportData = {
      version: this.config.version,
      exportedAt: new Date().toISOString(),
      patterns,
      ...(options?.includeStats ? { stats: this.config.stats } : {}),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import patterns from JSON
   */
  importPatterns(
    json: string,
    options?: {
      merge?: boolean;  // Merge with existing (default: true)
      overwrite?: boolean;  // Overwrite existing patterns with same value
    }
  ): { imported: number; skipped: number } {
    const data = JSON.parse(json) as {
      version: number;
      patterns: ApprovalPattern[];
    };

    let imported = 0;
    let skipped = 0;

    for (const pattern of data.patterns) {
      const existing = this.findPatternByValue(pattern.pattern, pattern.type);

      if (existing) {
        if (options?.overwrite) {
          Object.assign(existing, {
            ...pattern,
            id: existing.id,  // Keep original ID
            source: 'import' as PatternSource,
          });
          imported++;
        } else {
          skipped++;
        }
      } else if (options?.merge !== false) {
        this.config.patterns.push({
          ...pattern,
          id: randomUUID(),  // New ID
          source: 'import' as PatternSource,
          createdAt: new Date(),
          useCount: 0,
        });
        imported++;
      }
    }

    this.saveConfig();
    return { imported, skipped };
  }

  /**
   * Clear all user patterns (keep system patterns)
   */
  clearUserPatterns(): number {
    const before = this.config.patterns.length;
    this.config.patterns = this.config.patterns.filter(
      p => p.source === 'system'
    );
    const removed = before - this.config.patterns.length;
    this.saveConfig();
    return removed;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let storeInstance: AllowlistStore | null = null;

/**
 * Get or create the AllowlistStore singleton
 */
export function getAllowlistStore(configDir?: string): AllowlistStore {
  if (!storeInstance) {
    storeInstance = new AllowlistStore(configDir);
  }
  return storeInstance;
}

/**
 * Reset the AllowlistStore singleton
 */
export function resetAllowlistStore(): void {
  if (storeInstance) {
    storeInstance.removeAllListeners();
  }
  storeInstance = null;
}
