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
import { existsSync } from 'fs';
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
// Hierarchical Instruction Files (Codex CLI pattern)
// ============================================================================

/** File names to search for when walking the hierarchy */
const HIERARCHICAL_FILES = ['AGENTS.md', 'CODEBUDDY.md', 'CONTEXT.md', 'INSTRUCTIONS.md'];

/** Max directory levels to walk */
const MAX_HIERARCHY_DEPTH = 10;

/** Root markers for project detection */
const ROOT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', '.hg'];

// ============================================================================
// Bootstrap Loader
// ============================================================================

export class BootstrapLoader {
  private config: BootstrapLoaderConfig;

  constructor(config: Partial<BootstrapLoaderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Load bootstrap files from project and global directories,
   * plus hierarchical instruction files from root to CWD.
   */
  async load(cwd: string): Promise<BootstrapResult> {
    const sources: string[] = [];
    const sections: string[] = [];
    let totalChars = 0;
    let truncated = false;

    // 1. Standard bootstrap files (project dir + global dir)
    for (const fileName of this.config.fileNames) {
      if (totalChars >= this.config.maxChars) {
        truncated = true;
        break;
      }

      const content = await this.loadFile(fileName, cwd);
      if (!content) continue;

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

    // 2. Hierarchical instruction files (Codex CLI pattern)
    if (totalChars < this.config.maxChars) {
      const hierarchicalResult = await this.loadHierarchical(cwd);
      for (const entry of hierarchicalResult) {
        if (totalChars >= this.config.maxChars) {
          truncated = true;
          break;
        }
        if (sources.includes(entry.source)) continue;

        const remaining = this.config.maxChars - totalChars;
        let text = entry.text;
        if (text.length > remaining) {
          text = text.slice(0, remaining) + '\n\n... (truncated)';
          truncated = true;
        }

        const relSource = path.relative(cwd, entry.source) || entry.source;
        sections.push(`## ${entry.fileName} (${relSource})\n\n${text}`);
        sources.push(entry.source);
        totalChars += text.length;
      }
    }

    // 3. Auto-generated project knowledge (from /docs generate --with-llm)
    if (totalChars < this.config.maxChars) {
      const knowledgePath = path.join(cwd, '.codebuddy', 'PROJECT_KNOWLEDGE.md');
      try {
        if (existsSync(knowledgePath)) {
          const knowledgeText = await fs.readFile(knowledgePath, 'utf-8');
          if (knowledgeText.trim() && !this.containsDangerousPatterns(knowledgeText)) {
            const remaining = this.config.maxChars - totalChars;
            let text = knowledgeText;
            if (text.length > remaining) {
              text = text.slice(0, remaining) + '\n\n... (truncated)';
              truncated = true;
            }
            sections.push(`## Project Knowledge (auto-generated)\n\n${text}`);
            sources.push(knowledgePath);
            totalChars += text.length;
            logger.debug('Bootstrap: loaded PROJECT_KNOWLEDGE.md');
          }
        }
      } catch { /* optional */ }
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
   * Walk from the detected project root to CWD, collecting instruction files
   * at each directory level (Codex CLI pattern).
   */
  async loadHierarchical(
    cwd: string,
    rootMarkers: string[] = ROOT_MARKERS
  ): Promise<Array<{ text: string; source: string; fileName: string }>> {
    const root = this.findProjectRoot(cwd, rootMarkers);
    if (!root || root === cwd) return [];

    const dirs = this.getDirectoryChain(root, cwd);
    const results: Array<{ text: string; source: string; fileName: string }> = [];

    for (const dir of dirs) {
      for (const fileName of HIERARCHICAL_FILES) {
        const filePath = path.join(dir, fileName);
        const content = await this.readFileSafe(filePath);
        if (content && !this.containsDangerousPatterns(content)) {
          results.push({ text: content, source: filePath, fileName });
        }
      }
    }

    return results;
  }

  /**
   * Find project root by walking up from CWD.
   */
  private findProjectRoot(cwd: string, markers: string[]): string | null {
    let dir = path.resolve(cwd);
    let depth = 0;

    while (depth < MAX_HIERARCHY_DEPTH) {
      for (const marker of markers) {
        try {
          if (existsSync(path.join(dir, marker))) return dir;
        } catch { /* ignore */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      depth++;
    }
    return null;
  }

  /**
   * Get directory chain from root to target (inclusive).
   */
  private getDirectoryChain(root: string, target: string): string[] {
    const resolved = path.resolve(target);
    const resolvedRoot = path.resolve(root);
    const chain: string[] = [resolvedRoot];

    const relativePath = path.relative(resolvedRoot, resolved);
    if (!relativePath || relativePath.startsWith('..')) return chain;

    let current = resolvedRoot;
    for (const seg of relativePath.split(path.sep).filter(Boolean)) {
      current = path.join(current, seg);
      chain.push(current);
    }
    return chain;
  }

  /**
   * Load a single bootstrap file, checking project dir first, then global.
   */
  private async loadFile(
    fileName: string,
    cwd: string
  ): Promise<{ text: string; source: string } | null> {
    const projectPath = path.join(cwd, this.config.projectDir, fileName);
    const projectContent = await this.readFileSafe(projectPath);
    if (projectContent) {
      return { text: projectContent, source: projectPath };
    }

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
