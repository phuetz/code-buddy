/**
 * Bootstrap File Injection
 *
 * OpenClaw-inspired workspace context injection at session start.
 * Automatically loads BOOTSTRAP.md, AGENTS.md, SOUL.md, etc.
 * from .codebuddy/ (project) or ~/.codebuddy/ (global).
 *
 * Project files override global files for the same name.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface BootstrapResult {
  /** Concatenated content with headers */
  content: string;
  /** Source file paths that were loaded */
  sources: string[];
  /** Approximate character count */
  tokenCount: number;
  /** Whether content was truncated */
  truncated: boolean;
}

export interface BootstrapLoaderConfig {
  /** Maximum characters to include (default: 20000) */
  maxChars: number;
  /** Bootstrap file names to look for */
  fileNames: string[];
  /** Project config directory name */
  projectDir: string;
  /** Global config directory */
  globalDir: string;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_BOOTSTRAP_FILES = [
  'BOOT.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'IDENTITY.md',
  'USER.md',
  'HEARTBEAT.md',
];

const DEFAULT_CONFIG: BootstrapLoaderConfig = {
  maxChars: 20000,
  fileNames: DEFAULT_BOOTSTRAP_FILES,
  projectDir: '.codebuddy',
  globalDir: path.join(homedir(), '.codebuddy'),
};

// ============================================================================
// Bootstrap Loader
// ============================================================================

export class BootstrapLoader {
  private config: BootstrapLoaderConfig;

  constructor(config: Partial<BootstrapLoaderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load bootstrap files from project and global directories.
   * Project files take priority over global files for the same name.
   */
  async load(cwd: string): Promise<BootstrapResult> {
    const sources: string[] = [];
    const sections: string[] = [];
    let totalChars = 0;
    let truncated = false;

    for (const fileName of this.config.fileNames) {
      if (totalChars >= this.config.maxChars) {
        truncated = true;
        break;
      }

      const content = await this.loadFile(fileName, cwd);
      if (!content) continue;

      // Validate content safety
      if (this.containsDangerousPatterns(content.text)) {
        logger.warn(`Skipping bootstrap file ${content.source}: contains dangerous patterns`);
        continue;
      }

      const remaining = this.config.maxChars - totalChars;
      let text = content.text;
      if (text.length > remaining) {
        text = text.slice(0, remaining) + '\n\n... (truncated)';
        truncated = true;
      }

      sections.push(`## ${fileName}\n\n${text}`);
      sources.push(content.source);
      totalChars += text.length;
    }

    const combinedContent = sections.join('\n\n---\n\n');

    return {
      content: combinedContent,
      sources,
      tokenCount: totalChars,
      truncated,
    };
  }

  /**
   * Load a single bootstrap file, checking project dir first, then global.
   */
  private async loadFile(
    fileName: string,
    cwd: string
  ): Promise<{ text: string; source: string } | null> {
    // Project-level (overrides global)
    const projectPath = path.join(cwd, this.config.projectDir, fileName);
    const projectContent = await this.readFileSafe(projectPath);
    if (projectContent) {
      return { text: projectContent, source: projectPath };
    }

    // Global-level
    const globalPath = path.join(this.config.globalDir, fileName);
    const globalContent = await this.readFileSafe(globalPath);
    if (globalContent) {
      return { text: globalContent, source: globalPath };
    }

    return null;
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Basic security validation for bootstrap content.
   * Rejects files with common dangerous patterns.
   */
  private containsDangerousPatterns(content: string): boolean {
    const patterns = [
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
      /\brequire\s*\(\s*['"]child_process['"]\s*\)/,
      /\bexec(?:Sync)?\s*\(/,
      /\bspawn(?:Sync)?\s*\(/,
      /<script\b/i,
    ];

    return patterns.some(p => p.test(content));
  }
}
