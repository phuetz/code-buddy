/**
 * Identity Manager
 *
 * Handles loading, validating, and hot-reloading identity files
 * (SOUL.md, USER.md, AGENTS.md, TOOLS.md, IDENTITY.md).
 *
 * Project-level files (.codebuddy/) override global files (~/.codebuddy/)
 * for the same name. File changes are watched and hot-reloaded.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { watch, type FSWatcher } from 'fs';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface IdentityFile {
  /** File name (e.g. 'SOUL.md') */
  name: string;
  /** File content */
  content: string;
  /** Whether the file comes from project or global directory */
  source: 'project' | 'global';
  /** Absolute path to the file */
  path: string;
  /** Last modification timestamp */
  lastModified: Date;
}

export interface IdentityManagerConfig {
  /** Project config directory name (default: '.codebuddy') */
  projectDir: string;
  /** Global config directory path (default: '~/.codebuddy') */
  globalDir: string;
  /** Whether to watch for file changes (default: true) */
  watchForChanges: boolean;
  /** Identity file names to load */
  fileNames: string[];
}

export interface IdentityManagerEvents {
  'identity:loaded': (files: IdentityFile[]) => void;
  'identity:changed': (file: IdentityFile) => void;
  'identity:error': (error: Error) => void;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_IDENTITY_FILES = [
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'IDENTITY.md',
];

const DEFAULT_CONFIG: IdentityManagerConfig = {
  projectDir: '.codebuddy',
  globalDir: path.join(homedir(), '.codebuddy'),
  watchForChanges: true,
  fileNames: DEFAULT_IDENTITY_FILES,
};

// ============================================================================
// Identity Manager
// ============================================================================

export class IdentityManager extends EventEmitter {
  private config: IdentityManagerConfig;
  private files: Map<string, IdentityFile> = new Map();
  private watchers: FSWatcher[] = [];
  private cwd: string | null = null;

  constructor(config: Partial<IdentityManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load all identity files from project and global directories.
   * Project files override global files for the same name.
   */
  async load(cwd: string): Promise<IdentityFile[]> {
    this.cwd = cwd;
    this.files.clear();

    for (const fileName of this.config.fileNames) {
      const file = await this.loadFile(fileName, cwd);
      if (file) {
        this.files.set(fileName, file);
      }
    }

    const loaded = Array.from(this.files.values());
    this.emit('identity:loaded', loaded);
    logger.debug(`Loaded ${loaded.length} identity file(s)`, {
      files: loaded.map(f => f.name),
    });

    return loaded;
  }

  /**
   * Get a specific identity file by name.
   */
  get(name: string): IdentityFile | undefined {
    return this.files.get(name);
  }

  /**
   * Get all loaded identity files.
   */
  getAll(): IdentityFile[] {
    return Array.from(this.files.values());
  }

  /**
   * Write or update an identity file in the project directory.
   */
  async set(name: string, content: string): Promise<void> {
    if (!this.cwd) {
      throw new Error('IdentityManager: call load() before set()');
    }

    const dirPath = path.join(this.cwd, this.config.projectDir);
    const filePath = path.join(dirPath, name);

    try {
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');

      const stat = await fs.stat(filePath);
      const file: IdentityFile = {
        name,
        content: content.trim(),
        source: 'project',
        path: filePath,
        lastModified: stat.mtime,
      };

      this.files.set(name, file);
      this.emit('identity:changed', file);
      logger.debug(`Updated identity file: ${name}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('identity:error', error);
      logger.error(`Failed to write identity file ${name}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Returns formatted string of all identity content for prompt injection.
   * Each file is wrapped in a section header and separated by horizontal rules.
   */
  getPromptInjection(): string {
    const files = this.getAll();
    if (files.length === 0) {
      return '';
    }

    const sections = files.map(
      file => `## ${file.name}\n\n${file.content}`
    );

    return sections.join('\n\n---\n\n');
  }

  /**
   * Watch for file changes in project and global directories.
   * Automatically reloads changed identity files.
   */
  watch(cwd: string): void {
    this.unwatch();
    this.cwd = cwd;

    const projectDir = path.join(cwd, this.config.projectDir);
    const globalDir = this.config.globalDir;

    this.watchDirectory(projectDir, 'project');
    this.watchDirectory(globalDir, 'global');

    logger.debug('Identity file watcher started');
  }

  /**
   * Stop watching for file changes.
   */
  unwatch(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Load a single identity file, checking project dir first, then global.
   */
  private async loadFile(
    fileName: string,
    cwd: string,
  ): Promise<IdentityFile | null> {
    // Project-level (overrides global)
    const projectPath = path.join(cwd, this.config.projectDir, fileName);
    const projectFile = await this.readIdentityFile(projectPath, fileName, 'project');
    if (projectFile) {
      return projectFile;
    }

    // Global-level fallback
    const globalPath = path.join(this.config.globalDir, fileName);
    const globalFile = await this.readIdentityFile(globalPath, fileName, 'global');
    if (globalFile) {
      return globalFile;
    }

    return null;
  }

  /**
   * Read a single identity file from disk with metadata.
   */
  private async readIdentityFile(
    filePath: string,
    name: string,
    source: 'project' | 'global',
  ): Promise<IdentityFile | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const trimmed = content.trim();
      if (!trimmed) {
        return null;
      }

      const stat = await fs.stat(filePath);

      return {
        name,
        content: trimmed,
        source,
        path: filePath,
        lastModified: stat.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Watch a directory for changes to identity files.
   */
  private watchDirectory(dirPath: string, source: 'project' | 'global'): void {
    try {
      const watcher = watch(dirPath, async (eventType, filename) => {
        if (!filename || !this.config.fileNames.includes(filename)) {
          return;
        }

        try {
          const filePath = path.join(dirPath, filename);
          const file = await this.readIdentityFile(filePath, filename, source);

          if (file) {
            // Only update if this source should take priority
            const existing = this.files.get(filename);
            if (!existing || existing.source === source || source === 'project') {
              this.files.set(filename, file);
              this.emit('identity:changed', file);
              logger.debug(`Identity file changed: ${filename} (${source})`);
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.emit('identity:error', error);
        }
      });

      this.watchers.push(watcher);
    } catch {
      // Directory may not exist yet - that's fine
      logger.debug(`Cannot watch directory (may not exist): ${dirPath}`);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let identityManagerInstance: IdentityManager | null = null;

/**
 * Get or create the IdentityManager singleton.
 */
export function getIdentityManager(): IdentityManager {
  if (!identityManagerInstance) {
    identityManagerInstance = new IdentityManager();
  }
  return identityManagerInstance;
}

/**
 * Reset the IdentityManager singleton (for testing).
 */
export function resetIdentityManager(): void {
  if (identityManagerInstance) {
    identityManagerInstance.unwatch();
  }
  identityManagerInstance = null;
}
