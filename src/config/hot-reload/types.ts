/**
 * Config Hot-Reload Types
 *
 * Type definitions for the configuration hot-reload system.
 */

import { EventEmitter } from 'events';

/**
 * Subsystem identifiers that can be reloaded
 */
export type SubsystemId =
  | 'model'
  | 'tools'
  | 'policies'
  | 'plugins'
  | 'memory'
  | 'mcp'
  | 'skills'
  | 'security';

/**
 * Configuration change event
 */
export interface ConfigChange {
  subsystem: SubsystemId;
  path: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

/**
 * Configuration snapshot for comparison
 */
export interface ConfigSnapshot {
  timestamp: number;
  hash: string;
  data: Record<string, unknown>;
}

/**
 * Subsystem reloader function type
 */
export type SubsystemReloader = (change: ConfigChange) => Promise<ReloadResult>;

/**
 * Result of a subsystem reload
 */
export interface ReloadResult {
  success: boolean;
  subsystem: SubsystemId;
  duration: number;
  error?: string;
  rollback?: boolean;
}

/**
 * Watcher configuration
 */
export interface WatcherConfig {
  /** Debounce delay in milliseconds */
  debounceMs: number;
  /** Paths to watch */
  paths: string[];
  /** Whether to watch recursively */
  recursive: boolean;
  /** File patterns to ignore */
  ignorePatterns: string[];
  /** Whether to reload on startup */
  reloadOnStart: boolean;
}

/**
 * Default watcher configuration
 */
export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  debounceMs: 500,
  paths: [],
  recursive: true,
  ignorePatterns: ['*.tmp', '*.bak', '.git/**'],
  reloadOnStart: false,
};

/**
 * Hot-reload events
 */
export interface HotReloadEvents {
  'config:changed': (changes: ConfigChange[]) => void;
  'config:reloading': (subsystems: SubsystemId[]) => void;
  'config:reloaded': (results: ReloadResult[]) => void;
  'config:error': (error: Error, subsystem?: SubsystemId) => void;
  'watcher:started': (paths: string[]) => void;
  'watcher:stopped': () => void;
}

/**
 * Typed event emitter for hot-reload events
 */
export class HotReloadEmitter extends EventEmitter {
  emit<K extends keyof HotReloadEvents>(
    event: K,
    ...args: Parameters<HotReloadEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof HotReloadEvents>(
    event: K,
    listener: HotReloadEvents[K]
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof HotReloadEvents>(
    event: K,
    listener: HotReloadEvents[K]
  ): this {
    return super.once(event, listener);
  }

  off<K extends keyof HotReloadEvents>(
    event: K,
    listener: HotReloadEvents[K]
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Subsystem reload priority (lower = reload first)
 */
export const SUBSYSTEM_PRIORITY: Record<SubsystemId, number> = {
  security: 1,
  policies: 2,
  model: 3,
  tools: 4,
  plugins: 5,
  mcp: 6,
  skills: 7,
  memory: 8,
};

/**
 * Subsystem dependencies (reload these after the key subsystem)
 */
export const SUBSYSTEM_DEPENDENCIES: Partial<Record<SubsystemId, SubsystemId[]>> = {
  security: ['policies', 'tools'],
  policies: ['tools'],
  model: [],
  tools: ['skills'],
  plugins: ['tools', 'skills'],
  mcp: ['tools'],
  skills: [],
  memory: [],
};
