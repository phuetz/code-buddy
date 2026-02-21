/**
 * Lessons Tracker — Self-improvement loop for recurring patterns
 *
 * Maintains a persistent `lessons.md` in `.codebuddy/lessons.md` (project)
 * and `~/.codebuddy/lessons.md` (global). On every agent turn the active
 * lessons are injected BEFORE the todo suffix (stable rules before recency
 * bias), so the model internalises learned patterns across sessions.
 *
 * The agent calls `lessons_add` to capture a new lesson after a correction;
 * `lessons_search` to find relevant lessons before similar tasks.
 *
 * Categories follow a structured taxonomy:
 *  PATTERN — "What went wrong → correct approach"
 *  RULE    — Invariant to always follow (e.g. "run tests before marking done")
 *  CONTEXT — Project/domain-specific facts (e.g. "this repo uses ESM imports")
 *  INSIGHT — Non-obvious observation useful for future tasks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';

export interface LessonItem {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;   // e.g. "TypeScript", "React", "bash"
  createdAt: number;
  source: 'user_correction' | 'self_observed' | 'manual';
}

export interface LessonsStats {
  total: number;
  byCategory: Record<LessonCategory, number>;
  bySource: Record<LessonItem['source'], number>;
  oldestAt: number | null;
  newestAt: number | null;
}

// ============================================================================
// Singleton registry (one tracker per working directory)
// ============================================================================

const registry = new Map<string, LessonsTracker>();

export function getLessonsTracker(workDir: string = process.cwd()): LessonsTracker {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new LessonsTracker(key));
  }
  return registry.get(key)!;
}

// ============================================================================
// LessonsTracker
// ============================================================================

export class LessonsTracker {
  private projectPath: string;
  private globalPath: string;
  private items: LessonItem[] = [];
  private loaded = false;

  constructor(private workDir: string) {
    const projectDir = path.join(workDir, '.codebuddy');
    this.projectPath = path.join(projectDir, 'lessons.md');
    this.globalPath = path.join(os.homedir(), '.codebuddy', 'lessons.md');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const globalItems = this.loadFile(this.globalPath);
    const projectItems = this.loadFile(this.projectPath);
    // Merge: project overrides global for duplicate ids
    const byId = new Map<string, LessonItem>();
    for (const item of [...globalItems, ...projectItems]) {
      byId.set(item.id, item);
    }
    this.items = Array.from(byId.values());
  }

  save(): void {
    this.load();
    // Save to project path only (global is managed manually or by `lessons_add --global`)
    try {
      const dir = path.dirname(this.projectPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.projectPath, this.serialise(), 'utf-8');
    } catch {
      // non-fatal
    }
  }

  add(
    category: LessonCategory,
    content: string,
    source: LessonItem['source'] = 'manual',
    context?: string
  ): LessonItem {
    this.load();
    const item: LessonItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      category,
      content,
      context,
      createdAt: Date.now(),
      source,
    };
    this.items.push(item);
    this.save();
    return item;
  }

  remove(id: string): boolean {
    this.load();
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.save();
    return true;
  }

  clearByCategory(category?: LessonCategory): number {
    this.load();
    const before = this.items.length;
    this.items = category
      ? this.items.filter(i => i.category !== category)
      : [];
    this.save();
    return before - this.items.length;
  }

  list(category?: LessonCategory): LessonItem[] {
    this.load();
    return category ? this.items.filter(i => i.category === category) : this.items;
  }

  search(query: string, category?: LessonCategory): LessonItem[] {
    this.load();
    const q = query.toLowerCase();
    return this.items.filter(item => {
      if (category && item.category !== category) return false;
      return (
        item.content.toLowerCase().includes(q) ||
        (item.context?.toLowerCase().includes(q) ?? false)
      );
    });
  }

  /**
   * Build the per-turn context block injected BEFORE the todo suffix.
   * Returns null when there are no lessons (avoids noisy injections).
   */
  buildContextBlock(): string | null {
    this.load();
    if (this.items.length === 0) return null;

    const lines = [
      '<lessons_context>',
      '## Active Lessons (apply to this turn)',
      '',
    ];

    const grouped = new Map<LessonCategory, LessonItem[]>();
    for (const item of this.items) {
      const arr = grouped.get(item.category) ?? [];
      arr.push(item);
      grouped.set(item.category, arr);
    }

    const order: LessonCategory[] = ['RULE', 'PATTERN', 'CONTEXT', 'INSIGHT'];
    for (const cat of order) {
      const catItems = grouped.get(cat);
      if (!catItems || catItems.length === 0) continue;
      for (const item of catItems) {
        const ctx = item.context ? ` _(${item.context})_` : '';
        lines.push(`**[${item.category}]**${ctx} ${item.content}`);
      }
    }

    lines.push('</lessons_context>');
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // Analytics
  // --------------------------------------------------------------------------

  getStats(): LessonsStats {
    this.load();
    const byCategory: Record<LessonCategory, number> = { PATTERN: 0, RULE: 0, CONTEXT: 0, INSIGHT: 0 };
    const bySource: Record<LessonItem['source'], number> = { user_correction: 0, self_observed: 0, manual: 0 };
    let oldestAt: number | null = null;
    let newestAt: number | null = null;

    for (const item of this.items) {
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
      if (item.createdAt > 0) {
        if (oldestAt === null || item.createdAt < oldestAt) oldestAt = item.createdAt;
        if (newestAt === null || item.createdAt > newestAt) newestAt = item.createdAt;
      }
    }

    return { total: this.items.length, byCategory, bySource, oldestAt, newestAt };
  }

  export(format: 'json' | 'md' | 'csv' = 'md'): string {
    this.load();
    if (format === 'json') {
      return JSON.stringify(this.items, null, 2);
    }
    if (format === 'csv') {
      const header = 'id,category,source,createdAt,context,content';
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = this.items.map(item =>
        [
          escape(item.id),
          escape(item.category),
          escape(item.source),
          escape(new Date(item.createdAt).toISOString()),
          escape(item.context ?? ''),
          escape(item.content),
        ].join(',')
      );
      return [header, ...rows].join('\n');
    }
    // 'md' — default
    return this.serialise();
  }

  autoDecay(maxAgeDays: number = 90): number {
    this.load();
    const threshold = Date.now() - maxAgeDays * 86_400_000;
    const before = this.items.length;
    this.items = this.items.filter(
      item => !(item.category === 'INSIGHT' && item.createdAt > 0 && item.createdAt < threshold)
    );
    const removed = before - this.items.length;
    if (removed > 0) {
      this.save();
    }
    return removed;
  }

  // --------------------------------------------------------------------------
  // Markdown serialisation / parsing
  // --------------------------------------------------------------------------

  private serialise(): string {
    const lines = [
      '# Lessons Learned',
      `<!-- auto-generated by Code Buddy — last updated ${new Date().toISOString()} -->`,
      '',
    ];

    const grouped = new Map<LessonCategory, LessonItem[]>();
    for (const item of this.items) {
      const arr = grouped.get(item.category) ?? [];
      arr.push(item);
      grouped.set(item.category, arr);
    }

    const order: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    for (const cat of order) {
      const catItems = grouped.get(cat);
      if (!catItems || catItems.length === 0) continue;
      lines.push(`## ${cat}`);
      for (const item of catItems) {
        const date = new Date(item.createdAt).toISOString().slice(0, 10);
        const ctx = item.context ? `:${item.context}` : '';
        lines.push(`- [${item.id}] ${item.content} <!-- ${date} ${item.source}${ctx} -->`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private loadFile(filePath: string): LessonItem[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseMd(content);
    } catch {
      return [];
    }
  }

  private parseMd(content: string): LessonItem[] {
    const items: LessonItem[] = [];
    let currentCategory: LessonCategory = 'INSIGHT';

    for (const rawLine of content.split('\n')) {
      // Category header: ## PATTERN
      const catMatch = rawLine.match(/^## (PATTERN|RULE|CONTEXT|INSIGHT)\s*$/);
      if (catMatch) {
        currentCategory = catMatch[1] as LessonCategory;
        continue;
      }

      // Item: - [id] content <!-- date source:context -->
      const itemMatch = rawLine.match(/^- \[([^\]]+)\] (.+?) <!-- ([^\s]+) ([^\s:]+)(?::([^-]+))? -->/);
      if (itemMatch) {
        items.push({
          id: itemMatch[1],
          content: itemMatch[2].trim(),
          category: currentCategory,
          createdAt: new Date(itemMatch[3]).getTime() || 0,
          source: (itemMatch[4] as LessonItem['source']) ?? 'manual',
          context: itemMatch[5]?.trim() || undefined,
        });
        continue;
      }

      // Plain item fallback: - content
      const plainMatch = rawLine.match(/^- (.+)/);
      if (plainMatch) {
        items.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          content: plainMatch[1].trim(),
          category: currentCategory,
          createdAt: 0,
          source: 'manual',
        });
      }
    }

    return items;
  }
}
