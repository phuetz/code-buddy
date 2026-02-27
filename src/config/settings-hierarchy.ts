/**
 * 3-Level Settings Hierarchy
 *
 * Loads and merges settings from three locations (later overrides earlier):
 * 1. ~/.codebuddy/settings.json      (user global)
 * 2. .codebuddy/settings.json        (project shared, checked into VCS)
 * 3. .codebuddy/settings.local.json  (project local, git-ignored)
 *
 * Additional override layers for enterprise and CLI use:
 * - ManagedPolicy (highest) - /etc/codebuddy/managed-settings.json
 * - CliFlags - command-line arguments
 *
 * Full priority ordering (highest wins):
 * 0. ManagedPolicy
 * 1. CliFlags
 * 2. ProjectLocal  (.codebuddy/settings.local.json)
 * 3. Project       (.codebuddy/settings.json)
 * 4. User          (~/.codebuddy/settings.json)
 * 5. Default       (built-in defaults)
 *
 * Merge strategy: deep-merge objects, replace arrays and scalars.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
import { resolveSecretRefs } from './secret-ref.js';

// ============================================================================
// Types
// ============================================================================

export enum SettingsLevel {
  ManagedPolicy = 0,
  CliFlags = 1,
  ProjectLocal = 2,
  Project = 3,
  User = 4,
  Default = 5,
}

export interface SettingsWithSource {
  value: unknown;
  source: SettingsLevel;
}

interface LevelData {
  level: SettingsLevel;
  settings: Record<string, unknown>;
}

/**
 * Hook configuration — a command to run before or after a tool invocation.
 */
export interface HookConfig {
  /** Shell command to execute */
  command: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

/**
 * MCP (Model Context Protocol) server configuration.
 */
export interface McpServerConfig {
  /** Command to start the server */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

/**
 * Typed settings shape supported by all three hierarchy levels.
 *
 * Every field is optional — a given level only needs to specify the keys it
 * wants to override.  The final effective config is computed by deep-merging
 * Default < User < Project < ProjectLocal < CliFlags < ManagedPolicy.
 */
export interface CodeBuddySettings {
  // -- Tool permissions --------------------------------------------------
  /** Tools that are always allowed without confirmation */
  allowedTools?: string[];
  /** Tools that are never allowed (takes precedence over allowedTools) */
  disallowedTools?: string[];

  // -- Model & provider --------------------------------------------------
  /** Default model identifier (e.g. 'grok-3-fast', 'claude-sonnet') */
  model?: string;

  // -- Security ----------------------------------------------------------
  /** Permission mode: 'suggest' (confirm all), 'auto-edit', 'full-auto' */
  permissions?: string;
  /** Alias kept for backwards compatibility */
  securityMode?: string;

  // -- Hooks -------------------------------------------------------------
  /** Hooks to run before/after tool invocations */
  hooks?: {
    preToolUse?: HookConfig[];
    postToolUse?: HookConfig[];
  };

  // -- MCP servers -------------------------------------------------------
  /** MCP server configurations keyed by server name */
  mcpServers?: Record<string, McpServerConfig>;

  // -- UI ----------------------------------------------------------------
  /** UI theme: 'dark', 'light', 'default', 'minimal', 'colorful' */
  theme?: string;

  // -- Custom commands ---------------------------------------------------
  /** Whether to load custom slash commands from .codebuddy/commands/ */
  customCommands?: boolean;

  // -- Existing settings (preserved for backwards compat) ----------------
  maxToolRounds?: number;
  maxCost?: number;
  autoCompact?: boolean;

  // -- Extensible: allow arbitrary additional keys -----------------------
  [key: string]: unknown;
}

// ============================================================================
// Constants
// ============================================================================

const LEVEL_NAMES: Record<SettingsLevel, string> = {
  [SettingsLevel.ManagedPolicy]: 'ManagedPolicy',
  [SettingsLevel.CliFlags]: 'CliFlags',
  [SettingsLevel.ProjectLocal]: 'ProjectLocal',
  [SettingsLevel.Project]: 'Project',
  [SettingsLevel.User]: 'User',
  [SettingsLevel.Default]: 'Default',
};

const DEFAULT_SETTINGS: CodeBuddySettings = {
  securityMode: 'suggest',
  permissions: 'suggest',
  maxToolRounds: 50,
  maxCost: 10,
  theme: 'dark',
  autoCompact: true,
  customCommands: true,
};

// ============================================================================
// Deep Merge Utility
// ============================================================================

/**
 * Deep-merge `source` into `target`.
 *
 * - Plain objects are recursively merged.
 * - Arrays are **replaced** (not concatenated) — the higher-priority layer wins.
 * - Scalars are replaced.
 *
 * Returns a new object; neither `target` nor `source` is mutated.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (
      isPlainObject(srcVal) &&
      isPlainObject(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

/**
 * Check whether a value is a plain object (not an array, null, Date, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ============================================================================
// SettingsHierarchy
// ============================================================================

export class SettingsHierarchy {
  private levels: LevelData[] = [];
  private projectDir: string;

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
  }

  /**
   * Load settings from all levels
   */
  loadAllLevels(cliFlags?: Record<string, unknown>, projectDir?: string): void {
    if (projectDir) {
      this.projectDir = projectDir;
    }

    this.levels = [];

    // Level 0: Managed Policy (highest priority)
    const managedSettings = this.loadJsonFile(this.getManagedPath());
    this.levels.push({ level: SettingsLevel.ManagedPolicy, settings: managedSettings });

    // Level 1: CLI Flags
    this.levels.push({ level: SettingsLevel.CliFlags, settings: cliFlags || {} });

    // Level 2: Project Local
    const projectLocalSettings = this.loadJsonFile(this.getProjectLocalPath());
    this.levels.push({ level: SettingsLevel.ProjectLocal, settings: projectLocalSettings });

    // Level 3: Project
    const projectSettings = this.loadJsonFile(this.getProjectPath());
    this.levels.push({ level: SettingsLevel.Project, settings: projectSettings });

    // Level 4: User
    const userSettings = this.loadJsonFile(this.getUserPath());
    this.levels.push({ level: SettingsLevel.User, settings: userSettings });

    // Level 5: Default (lowest priority)
    this.levels.push({ level: SettingsLevel.Default, settings: { ...DEFAULT_SETTINGS } });

    logger.debug('Settings hierarchy loaded', { source: 'SettingsHierarchy' });
  }

  /**
   * Get the effective value for a key (highest-priority level wins)
   */
  get(key: string): unknown {
    for (const levelData of this.levels) {
      if (key in levelData.settings) {
        return levelData.settings[key];
      }
    }
    return undefined;
  }

  /**
   * Get the value and its source level
   */
  getWithSource(key: string): SettingsWithSource | undefined {
    for (const levelData of this.levels) {
      if (key in levelData.settings) {
        return {
          value: levelData.settings[key],
          source: levelData.level,
        };
      }
    }
    return undefined;
  }

  /**
   * Check if a key at a given level is overridden by a higher-priority level
   */
  isOverridden(key: string, level: SettingsLevel): boolean {
    for (const levelData of this.levels) {
      if (levelData.level === level) {
        // Reached the target level without finding an override
        return false;
      }
      if (key in levelData.settings) {
        // A higher-priority level has this key
        return true;
      }
    }
    return false;
  }

  /**
   * Get all settings merged (highest priority wins).
   *
   * Objects are deep-merged; arrays and scalars are replaced by higher-priority
   * layers.  Merge order: Default < User < Project < ProjectLocal < CliFlags < ManagedPolicy.
   */
  getAllSettings(): CodeBuddySettings {
    let merged: Record<string, unknown> = {};

    // Merge in reverse order (lowest priority first)
    for (let i = this.levels.length - 1; i >= 0; i--) {
      merged = deepMerge(merged, this.levels[i].settings);
    }

    return merged as CodeBuddySettings;
  }

  /**
   * Get all settings merged with SecretRef resolution.
   *
   * Same as `getAllSettings()` but additionally resolves `${env:...}`,
   * `${file:...}`, and `${exec:...}` references in string values.
   */
  async getAllSettingsResolved(): Promise<CodeBuddySettings> {
    const merged = this.getAllSettings();
    const resolved = await resolveSecretRefs(merged as Record<string, unknown>);
    return resolved as CodeBuddySettings;
  }

  /**
   * Get the level name for display
   */
  getLevelName(level: SettingsLevel): string {
    return LEVEL_NAMES[level] || 'Unknown';
  }

  // ============================================================================
  // Path helpers
  // ============================================================================

  private getManagedPath(): string {
    return '/etc/codebuddy/managed-settings.json';
  }

  private getUserPath(): string {
    return path.join(os.homedir(), '.codebuddy', 'settings.json');
  }

  private getProjectPath(): string {
    return path.join(this.projectDir, '.codebuddy', 'settings.json');
  }

  private getProjectLocalPath(): string {
    return path.join(this.projectDir, '.codebuddy', 'settings.local.json');
  }

  // ============================================================================
  // File loading
  // ============================================================================

  private loadJsonFile(filePath: string): Record<string, unknown> {
    try {
      if (!fs.existsSync(filePath)) {
        return {};
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch (error) {
      logger.debug(`Failed to load settings from ${filePath}: ${error}`, { source: 'SettingsHierarchy' });
      return {};
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: SettingsHierarchy | null = null;

export function getSettingsHierarchy(projectDir?: string): SettingsHierarchy {
  if (!instance || projectDir) {
    instance = new SettingsHierarchy(projectDir);
  }
  return instance;
}

export function resetSettingsHierarchy(): void {
  instance = null;
}
