/**
 * Modular Rules Loader
 *
 * Loads project and user-global rules from `.codebuddy/rules/*.md` files
 * and injects them into the system prompt. This mirrors Claude Code's
 * `.claude/rules/` feature, allowing users to split project instructions
 * into focused, composable Markdown files.
 *
 * Sources (in priority order, later overrides earlier):
 *  1. ~/.codebuddy/rules/*.md   – user-level global rules
 *  2. .codebuddy/rules/*.md     – project-level rules
 *
 * Each file may include YAML frontmatter to control behavior:
 * ```yaml
 * ---
 * title: TypeScript Conventions
 * priority: 10            # lower = injected first; higher = closer to query
 * scope: [code, plan]     # agent modes where this applies (empty = all)
 * alwaysApply: true       # whether to always include (default true)
 * ---
 * ```
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface RuleEntry {
  /** Resolved file path */
  path: string;
  /** Title from frontmatter or filename */
  title: string;
  /** Priority for ordering (lower = injected first) */
  priority: number;
  /** Agent modes this applies to (empty = all) */
  scope: string[];
  /** Whether to always include this rule (default true) */
  alwaysApply: boolean;
  /** Raw markdown content (frontmatter stripped) */
  content: string;
  /** Source tier */
  source: 'global' | 'project';
}

// ============================================================================
// Frontmatter Parser (no YAML lib needed)
// ============================================================================

interface RuleFrontmatter {
  title?: string;
  priority?: number;
  scope?: string[];
  alwaysApply?: boolean;
}

function parseFrontmatter(content: string): { meta: RuleFrontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { meta: {}, body: content };
  }

  const yamlBlock = fmMatch[1];
  const body = fmMatch[2];
  const meta: RuleFrontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    if (key === 'title') {
      meta.title = value.trim();
    } else if (key === 'priority') {
      meta.priority = parseInt(value.trim(), 10) || 0;
    } else if (key === 'scope') {
      // Support "scope: [code, plan]" inline array
      const inline = value.match(/^\[(.*)\]$/);
      if (inline) {
        meta.scope = inline[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
      }
    } else if (key === 'alwaysApply') {
      const trimmed = value.trim().toLowerCase();
      meta.alwaysApply = trimmed === 'true' || trimmed === 'yes';
    }
  }

  return { meta, body };
}

// ============================================================================
// Rules Loader
// ============================================================================

export class RulesLoader {
  private entries: RuleEntry[] = [];
  private loaded = false;

  private get searchDirs(): Array<{ dir: string; source: RuleEntry['source'] }> {
    return [
      { dir: path.join(homedir(), '.codebuddy', 'rules'), source: 'global' },
      { dir: path.join(process.cwd(), '.codebuddy', 'rules'), source: 'project' },
    ];
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  async load(): Promise<void> {
    this.entries = [];

    for (const { dir, source } of this.searchDirs) {
      if (!existsSync(dir)) continue;

      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(dir, file);
        await this.loadFile(filePath, source);
      }
    }

    // Sort by priority ascending (lower priority first, so higher priority
    // content is appended later = closer to the query in the context window)
    this.entries.sort((a, b) => a.priority - b.priority);

    this.loaded = true;
  }

  private async loadFile(filePath: string, source: RuleEntry['source']): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      const filename = path.basename(filePath, '.md');

      this.entries.push({
        path: filePath,
        title: meta.title ?? filename,
        priority: meta.priority ?? 0,
        scope: meta.scope ?? [],
        alwaysApply: meta.alwaysApply ?? true,
        content: body.trim(),
        source,
      });
    } catch {
      // Skip unreadable files silently
    }
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  /** Return all loaded entries, optionally filtered by agent mode */
  getAll(mode?: string): RuleEntry[] {
    if (!this.loaded) return [];
    return this.entries.filter(e => {
      // Filter by alwaysApply — if false and no mode match, skip
      if (!e.alwaysApply && !mode) return false;
      // Filter by scope — if scope is set and mode doesn't match, skip
      if (mode && e.scope.length > 0 && !e.scope.includes(mode)) return false;
      if (!mode && e.scope.length > 0 && !e.alwaysApply) return false;
      return true;
    });
  }

  /**
   * Build a context block string from all loaded rules, filtered by mode.
   * Used by the prompt builder to inject modular rules into the system prompt.
   */
  buildContextBlock(mode?: string): string {
    const entries = this.getAll(mode);
    if (entries.length === 0) return '';

    const sections = entries.map(e =>
      `### ${e.title}\n${e.content}`
    );

    return `## Project Rules\n\n${sections.join('\n\n---\n\n')}`;
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  list(): RuleEntry[] {
    return [...this.entries];
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: RulesLoader | null = null;

export function getRulesLoader(): RulesLoader {
  if (!instance) {
    instance = new RulesLoader();
  }
  return instance;
}

export function resetRulesLoader(): void {
  instance = null;
}
