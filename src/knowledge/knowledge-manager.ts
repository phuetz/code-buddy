/**
 * Knowledge Module (Manus AI-inspired)
 *
 * Loads external knowledge bases from Markdown files and injects them
 * as agent context at task start. This lets users give the agent
 * stable domain knowledge that survives context compression.
 *
 * Sources (in priority order, later overrides earlier):
 *  1. ~/.codebuddy/knowledge/*.md       – user-level global knowledge
 *  2. .codebuddy/knowledge/*.md         – project-level knowledge
 *  3. Knowledge.md in current directory – quick single-file override
 *
 * Each file may include YAML frontmatter to control scope:
 * ```yaml
 * ---
 * title: TypeScript Conventions
 * tags: [typescript, conventions]
 * scope: [code, review]   # agent modes where this applies
 * priority: 10            # higher priority files injected last (closer to query)
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

export interface KnowledgeEntry {
  /** Resolved file path */
  path: string;
  /** Title from frontmatter or filename */
  title: string;
  /** Tags for filtering */
  tags: string[];
  /** Agent modes this applies to (empty = all) */
  scope: string[];
  /** Priority for ordering (higher = injected last = higher weight) */
  priority: number;
  /** Raw markdown content (frontmatter stripped) */
  content: string;
  /** Source tier */
  source: 'global' | 'project' | 'local';
}

export interface KnowledgeSearchResult {
  entry: KnowledgeEntry;
  /** Relevance score (0-1, simple keyword match) */
  score: number;
  /** Excerpt around the first match */
  excerpt: string;
}

// ============================================================================
// Frontmatter Parser (no YAML lib needed)
// ============================================================================

interface Frontmatter {
  title?: string;
  tags?: string[];
  scope?: string[];
  priority?: number;
}

function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { meta: {}, body: content };
  }

  const yamlBlock = fmMatch[1];
  const body = fmMatch[2];
  const meta: Frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    if (key === 'title') {
      meta.title = value.trim();
    } else if (key === 'priority') {
      meta.priority = parseInt(value.trim(), 10) || 0;
    } else if (key === 'tags' || key === 'scope') {
      // Support "tags: [a, b]" or multiline list
      const inline = value.match(/^\[(.*)\]$/);
      if (inline) {
        meta[key] = inline[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
      }
    }
  }

  return { meta, body };
}

// ============================================================================
// Knowledge Manager
// ============================================================================

export class KnowledgeManager {
  private entries: KnowledgeEntry[] = [];
  private loaded = false;

  private get searchDirs(): Array<{ dir: string; source: KnowledgeEntry['source'] }> {
    return [
      { dir: path.join(homedir(), '.codebuddy', 'knowledge'), source: 'global' },
      { dir: path.join(process.cwd(), '.codebuddy', 'knowledge'), source: 'project' },
    ];
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  async load(): Promise<void> {
    this.entries = [];

    // Scan all search dirs
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

    // Single-file local override
    const localKnowledge = path.join(process.cwd(), 'Knowledge.md');
    if (existsSync(localKnowledge)) {
      await this.loadFile(localKnowledge, 'local');
    }

    // Sort by priority ascending (lower priority first, so higher priority
    // content is appended later = closer to the query in the context window)
    this.entries.sort((a, b) => a.priority - b.priority);

    this.loaded = true;
  }

  private async loadFile(filePath: string, source: KnowledgeEntry['source']): Promise<void> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      const filename = path.basename(filePath, '.md');

      this.entries.push({
        path: filePath,
        title: meta.title ?? filename,
        tags: meta.tags ?? [],
        scope: meta.scope ?? [],
        priority: meta.priority ?? 0,
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

  /** Return all loaded entries, optionally filtered by tag or scope */
  getAll(filter?: { tags?: string[]; scope?: string }): KnowledgeEntry[] {
    if (!this.loaded) return [];
    return this.entries.filter(e => {
      if (filter?.tags && filter.tags.length > 0) {
        if (!filter.tags.some(t => e.tags.includes(t))) return false;
      }
      if (filter?.scope) {
        if (e.scope.length > 0 && !e.scope.includes(filter.scope)) return false;
      }
      return true;
    });
  }

  /**
   * Simple keyword search across all knowledge entries.
   * Returns ranked results with excerpts.
   */
  search(query: string, limit = 5): KnowledgeSearchResult[] {
    if (!this.loaded) return [];

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2);

    const results: KnowledgeSearchResult[] = [];

    for (const entry of this.entries) {
      const haystack = `${entry.title} ${entry.tags.join(' ')} ${entry.content}`.toLowerCase();

      let matches = 0;
      let firstIndex = -1;

      for (const term of terms) {
        const idx = haystack.indexOf(term);
        if (idx !== -1) {
          matches++;
          if (firstIndex === -1) firstIndex = idx;
        }
      }

      if (matches === 0) continue;

      const score = matches / Math.max(terms.length, 1);

      // Extract excerpt around first match
      const excerptStart = Math.max(0, firstIndex - 100);
      const excerptEnd = Math.min(entry.content.length, firstIndex + 300);
      const excerpt = entry.content.slice(excerptStart, excerptEnd).trim();

      results.push({ entry, score, excerpt });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Build a system prompt injection string from all loaded knowledge.
   * Used by the agent to prepend domain knowledge before the user query.
   */
  buildContextBlock(filter?: { scope?: string }): string {
    const entries = this.getAll(filter);
    if (entries.length === 0) return '';

    const sections = entries.map(e =>
      `### ${e.title}\n${e.content}`
    );

    return `## Knowledge Base\n\n${sections.join('\n\n---\n\n')}`;
  }

  // --------------------------------------------------------------------------
  // Management
  // --------------------------------------------------------------------------

  /** Add a new knowledge file to the user's global knowledge directory */
  async add(title: string, content: string, tags: string[] = [], scope: string[] = []): Promise<string> {
    const dir = path.join(homedir(), '.codebuddy', 'knowledge');
    await fs.mkdir(dir, { recursive: true });

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const filePath = path.join(dir, `${slug}.md`);

    const frontmatter = [
      '---',
      `title: ${title}`,
      tags.length > 0 ? `tags: [${tags.join(', ')}]` : null,
      scope.length > 0 ? `scope: [${scope.join(', ')}]` : null,
      '---',
    ].filter(Boolean).join('\n');

    await fs.writeFile(filePath, `${frontmatter}\n\n${content}`);

    // Reload
    await this.load();

    return filePath;
  }

  /** Remove a knowledge entry by title or file path */
  async remove(titleOrPath: string): Promise<boolean> {
    const entry = this.entries.find(
      e => e.title === titleOrPath || e.path === titleOrPath
    );
    if (!entry) return false;

    // Only allow removing non-bundled (user-created) entries
    if (entry.source === 'global' || entry.source === 'project' || entry.source === 'local') {
      await fs.unlink(entry.path);
      await this.load();
      return true;
    }

    return false;
  }

  list(): KnowledgeEntry[] {
    return [...this.entries];
  }

  get isLoaded(): boolean {
    return this.loaded;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: KnowledgeManager | null = null;

export function getKnowledgeManager(): KnowledgeManager {
  if (!instance) {
    instance = new KnowledgeManager();
  }
  return instance;
}

export function resetKnowledgeManager(): void {
  instance = null;
}
