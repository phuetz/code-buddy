/**
 * Centralized Feature Flags System
 *
 * Provides runtime configuration for enabling/disabling features across the application.
 * Supports environment variable overrides and persistent configuration.
 *
 * Usage:
 *   import { getFeatureFlags, isFeatureEnabled } from '@/config/feature-flags';
 *
 *   if (isFeatureEnabled('VOICE_CONTROL')) {
 *     // Voice control logic
 *   }
 */

import * as fs from 'fs';
import os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Feature flag definition
 */
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  category: FeatureCategory;
  requiresConfig?: boolean;
  envOverride?: string; // Environment variable name for override
  experimental?: boolean;
  deprecated?: boolean;
}

export type FeatureCategory =
  | 'core'
  | 'ai'
  | 'ui'
  | 'security'
  | 'optimization'
  | 'integration'
  | 'experimental';

/**
 * Feature flags configuration
 */
export interface FeatureFlagsConfig {
  version: string;
  flags: Record<string, FeatureFlag>;
}

// ============================================================================
// Feature Flag Definitions
// ============================================================================

const DEFAULT_FEATURE_FLAGS: Record<string, FeatureFlag> = {
  // Core Features
  PERFORMANCE_CACHE: {
    name: 'PERFORMANCE_CACHE',
    enabled: true,
    description: 'Enable performance caching for tool results and API responses',
    category: 'optimization',
    envOverride: 'GROK_PERFORMANCE_CACHE',
  },

  YOLO_MODE: {
    name: 'YOLO_MODE',
    enabled: false,
    description: 'Full autonomy mode - allows operations without confirmations',
    category: 'core',
    envOverride: 'YOLO_MODE',
  },

  // AI Features
  SELF_HEALING: {
    name: 'SELF_HEALING',
    enabled: true,
    description: 'Automatic error repair and retry',
    category: 'ai',
    envOverride: 'GROK_SELF_HEALING',
  },

  VOICE_CONTROL: {
    name: 'VOICE_CONTROL',
    enabled: false,
    description: 'Voice command input and control',
    category: 'ui',
    requiresConfig: true,
    experimental: true,
  },

  // Hook System
  HOOKS_PRE_COMMIT: {
    name: 'HOOKS_PRE_COMMIT',
    enabled: false,
    description: 'Run pre-commit hooks (lint and test)',
    category: 'integration',
  },

  HOOKS_POST_EDIT: {
    name: 'HOOKS_POST_EDIT',
    enabled: false,
    description: 'Run type checking after file edits',
    category: 'integration',
  },

  HOOKS_ON_FILE_CHANGE: {
    name: 'HOOKS_ON_FILE_CHANGE',
    enabled: false,
    description: 'Auto-format files with Prettier on change',
    category: 'integration',
  },

  HOOKS_ON_SESSION_START: {
    name: 'HOOKS_ON_SESSION_START',
    enabled: false,
    description: 'Run commands when session starts',
    category: 'integration',
  },

  // MCP Servers
  MCP_FILESYSTEM: {
    name: 'MCP_FILESYSTEM',
    enabled: false,
    description: 'Enable MCP filesystem server integration',
    category: 'integration',
    requiresConfig: true,
  },

  MCP_GITHUB: {
    name: 'MCP_GITHUB',
    enabled: false,
    description: 'Enable MCP GitHub integration',
    category: 'integration',
    requiresConfig: true,
    envOverride: 'GITHUB_TOKEN',
  },

  // Security
  SANDBOX_MODE: {
    name: 'SANDBOX_MODE',
    enabled: false,
    description: 'Run in sandboxed environment with restricted permissions',
    category: 'security',
  },

  DRY_RUN_MODE: {
    name: 'DRY_RUN_MODE',
    enabled: false,
    description: 'Show what would be done without executing',
    category: 'security',
    envOverride: 'GROK_DRY_RUN',
  },

  // UI Features
  MULTI_STEP_PROGRESS: {
    name: 'MULTI_STEP_PROGRESS',
    enabled: true,
    description: 'Show detailed progress for multi-step operations',
    category: 'ui',
  },

  THINKING_INDICATOR: {
    name: 'THINKING_INDICATOR',
    enabled: true,
    description: 'Show AI thinking indicator',
    category: 'ui',
  },

  // Experimental Features
  TREE_OF_THOUGHTS: {
    name: 'TREE_OF_THOUGHTS',
    enabled: false,
    description: 'Use Tree of Thoughts reasoning for complex problems',
    category: 'ai',
    experimental: true,
  },

  MULTI_AGENT_SYSTEM: {
    name: 'MULTI_AGENT_SYSTEM',
    enabled: false,
    description: 'Enable multi-agent collaboration',
    category: 'ai',
    experimental: true,
  },

  PROJECT_SCAFFOLDING: {
    name: 'PROJECT_SCAFFOLDING',
    enabled: true,
    description: 'Project template and scaffolding system',
    category: 'core',
  },

  // Optimization
  PARALLEL_TOOL_EXECUTION: {
    name: 'PARALLEL_TOOL_EXECUTION',
    enabled: true,
    description: 'Execute independent tools in parallel',
    category: 'optimization',
  },

  LAZY_LOADING: {
    name: 'LAZY_LOADING',
    enabled: true,
    description: 'Lazy load modules for faster startup',
    category: 'optimization',
  },

  // Analytics
  ANALYTICS: {
    name: 'ANALYTICS',
    enabled: false,
    description: 'Collect usage analytics',
    category: 'core',
    envOverride: 'GROK_ANALYTICS',
  },
};

// ============================================================================
// Feature Flags Manager
// ============================================================================

export class FeatureFlagsManager extends EventEmitter {
  private flags: Map<string, FeatureFlag>;
  private configPath: string;
  private userConfigPath: string;

  constructor(configDir?: string) {
    super();
    this.configPath = path.join(configDir || process.cwd(), '.codebuddy', 'feature-flags.json');
    this.userConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || os.homedir(),
      '.codebuddy',
      'feature-flags.json'
    );
    this.flags = new Map();
    this.loadFlags();
  }

  /**
   * Load feature flags from config files and environment variables
   */
  private loadFlags(): void {
    // Start with defaults
    const flags = { ...DEFAULT_FEATURE_FLAGS };

    // Load user-level config
    const userConfig = this.loadConfigFile(this.userConfigPath);
    if (userConfig) {
      Object.entries(userConfig.flags).forEach(([name, flag]) => {
        flags[name] = { ...flags[name], ...flag };
      });
    }

    // Load project-level config (overrides user config)
    const projectConfig = this.loadConfigFile(this.configPath);
    if (projectConfig) {
      Object.entries(projectConfig.flags).forEach(([name, flag]) => {
        flags[name] = { ...flags[name], ...flag };
      });
    }

    // Apply environment variable overrides
    Object.entries(flags).forEach(([name, flag]) => {
      if (flag.envOverride) {
        const envValue = process.env[flag.envOverride];
        if (envValue !== undefined) {
          flags[name] = {
            ...flag,
            enabled: envValue === 'true' || envValue === '1',
          };
        }
      }
    });

    // Store in map
    this.flags.clear();
    Object.entries(flags).forEach(([name, flag]) => {
      this.flags.set(name, flag);
    });

    this.emit('flags:loaded', this.flags.size);
  }

  /**
   * Load configuration from file
   */
  private loadConfigFile(filePath: string): FeatureFlagsConfig | null {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`Failed to load feature flags from ${filePath}`, { error: String(error) });
    }
    return null;
  }

  /**
   * Save configuration to file
   */
  saveConfig(userLevel: boolean = false): void {
    const configPath = userLevel ? this.userConfigPath : this.configPath;
    const dir = path.dirname(configPath);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const config: FeatureFlagsConfig = {
        version: '1.0.0',
        flags: Object.fromEntries(this.flags),
      };

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      this.emit('config:saved', configPath);
    } catch (error) {
      this.emit('config:error', error);
      throw error;
    }
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(flagName: string): boolean {
    const flag = this.flags.get(flagName);
    return flag?.enabled ?? false;
  }

  /**
   * Get feature flag details
   */
  getFlag(flagName: string): FeatureFlag | undefined {
    return this.flags.get(flagName);
  }

  /**
   * Get all feature flags
   */
  getAllFlags(): Map<string, FeatureFlag> {
    return new Map(this.flags);
  }

  /**
   * Get flags by category
   */
  getFlagsByCategory(category: FeatureCategory): FeatureFlag[] {
    return Array.from(this.flags.values()).filter((flag) => flag.category === category);
  }

  /**
   * Get experimental flags
   */
  getExperimentalFlags(): FeatureFlag[] {
    return Array.from(this.flags.values()).filter((flag) => flag.experimental === true);
  }

  /**
   * Get deprecated flags
   */
  getDeprecatedFlags(): FeatureFlag[] {
    return Array.from(this.flags.values()).filter((flag) => flag.deprecated === true);
  }

  /**
   * Enable a feature flag
   */
  enableFlag(flagName: string): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      this.flags.set(flagName, { ...flag, enabled: true });
      this.emit('flag:enabled', flagName);
    }
  }

  /**
   * Disable a feature flag
   */
  disableFlag(flagName: string): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      this.flags.set(flagName, { ...flag, enabled: false });
      this.emit('flag:disabled', flagName);
    }
  }

  /**
   * Toggle a feature flag
   */
  toggleFlag(flagName: string): boolean {
    const flag = this.flags.get(flagName);
    if (flag) {
      const newEnabled = !flag.enabled;
      this.flags.set(flagName, { ...flag, enabled: newEnabled });
      this.emit('flag:toggled', flagName, newEnabled);
      return newEnabled;
    }
    return false;
  }

  /**
   * Register a new feature flag
   */
  registerFlag(flag: FeatureFlag): void {
    this.flags.set(flag.name, flag);
    this.emit('flag:registered', flag.name);
  }

  /**
   * Reload configuration from disk
   */
  reload(): void {
    this.loadFlags();
    this.emit('flags:reloaded');
  }

  /**
   * Get feature flags summary
   */
  getSummary(): {
    total: number;
    enabled: number;
    disabled: number;
    experimental: number;
    deprecated: number;
    byCategory: Record<FeatureCategory, number>;
  } {
    const flags = Array.from(this.flags.values());

    const summary = {
      total: flags.length,
      enabled: flags.filter((f) => f.enabled).length,
      disabled: flags.filter((f) => !f.enabled).length,
      experimental: flags.filter((f) => f.experimental).length,
      deprecated: flags.filter((f) => f.deprecated).length,
      byCategory: {} as Record<FeatureCategory, number>,
    };

    // Count by category
    const categories: FeatureCategory[] = [
      'core',
      'ai',
      'ui',
      'security',
      'optimization',
      'integration',
      'experimental',
    ];
    categories.forEach((cat) => {
      summary.byCategory[cat] = flags.filter((f) => f.category === cat).length;
    });

    return summary;
  }

  /**
   * Format flags for display
   */
  formatFlags(options: {
    category?: FeatureCategory;
    onlyEnabled?: boolean;
    onlyDisabled?: boolean;
    experimental?: boolean;
  } = {}): string {
    let flags = Array.from(this.flags.values());

    // Apply filters
    if (options.category) {
      flags = flags.filter((f) => f.category === options.category);
    }
    if (options.onlyEnabled) {
      flags = flags.filter((f) => f.enabled);
    }
    if (options.onlyDisabled) {
      flags = flags.filter((f) => !f.enabled);
    }
    if (options.experimental !== undefined) {
      flags = flags.filter((f) => f.experimental === options.experimental);
    }

    // Sort by category, then name
    flags.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });

    let output = '🚩 Feature Flags\n' + '═'.repeat(60) + '\n\n';

    let currentCategory: FeatureCategory | null = null;
    for (const flag of flags) {
      if (flag.category !== currentCategory) {
        currentCategory = flag.category;
        output += `\n📂 ${currentCategory.toUpperCase()}\n`;
      }

      const status = flag.enabled ? '✅' : '❌';
      const badges: string[] = [];
      if (flag.experimental) badges.push('🧪');
      if (flag.deprecated) badges.push('⚠️ DEPRECATED');
      if (flag.requiresConfig) badges.push('⚙️');

      output += `  ${status} ${flag.name}${badges.length > 0 ? ' ' + badges.join(' ') : ''}\n`;
      output += `     ${flag.description}\n`;

      if (flag.envOverride) {
        output += `     Env: ${flag.envOverride}\n`;
      }
    }

    return output;
  }

  /**
   * Dispose manager
   */
  dispose(): void {
    this.flags.clear();
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let featureFlagsInstance: FeatureFlagsManager | null = null;

export function getFeatureFlags(configDir?: string): FeatureFlagsManager {
  if (!featureFlagsInstance) {
    featureFlagsInstance = new FeatureFlagsManager(configDir);
  }
  return featureFlagsInstance;
}

export function resetFeatureFlags(): void {
  if (featureFlagsInstance) {
    featureFlagsInstance.dispose();
  }
  featureFlagsInstance = null;
}

/**
 * Quick check if a feature is enabled
 */
export function isFeatureEnabled(flagName: string): boolean {
  return getFeatureFlags().isEnabled(flagName);
}

/**
 * Quick enable a feature
 */
export function enableFeature(flagName: string): void {
  getFeatureFlags().enableFlag(flagName);
}

/**
 * Quick disable a feature
 */
export function disableFeature(flagName: string): void {
  getFeatureFlags().disableFlag(flagName);
}
