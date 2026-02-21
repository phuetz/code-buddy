/**
 * Todo Tracker — Manus AI-inspired attention bias
 *
 * Maintains a persistent `todo.md` in the working directory.
 * On every agent turn the current task list is appended at the END of
 * the LLM context, exploiting recency bias to keep objectives in focus
 * across long sessions ("lost-in-the-middle" mitigation).
 *
 * The agent calls `todo_update` to mutate the list; a thin hook in
 * AgentExecutor re-injects the latest block before each LLM call.
 *
 * Ref: "Context Engineering for AI Agents: Lessons from Building Manus"
 * https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  priority: TodoPriority;
  subtasks: TodoItem[];
  createdAt: number;
  updatedAt: number;
}

export interface TodoUpdateInput {
  /** Action to perform */
  action: 'add' | 'complete' | 'update' | 'remove' | 'clear_done';
  /** For add/update: item text */
  text?: string;
  /** For complete/update/remove: item id */
  id?: string;
  /** For update: new status */
  status?: TodoStatus;
  /** For add/update: priority (default 'medium') */
  priority?: TodoPriority;
}

// ============================================================================
// Singleton registry (one tracker per working directory)
// ============================================================================

const registry = new Map<string, TodoTracker>();

export function getTodoTracker(workDir: string = process.cwd()): TodoTracker {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new TodoTracker(key));
  }
  return registry.get(key)!;
}

// ============================================================================
// TodoTracker
// ============================================================================

export class TodoTracker {
  private todoPath: string;
  private items: TodoItem[] = [];
  private loaded = false;

  constructor(private workDir: string) {
    this.todoPath = path.join(workDir, 'todo.md');
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.todoPath)) return;
    try {
      const content = fs.readFileSync(this.todoPath, 'utf-8');
      this.items = this.parseMd(content);
    } catch {
      this.items = [];
    }
  }

  save(): void {
    try {
      if (!fs.existsSync(this.workDir)) return;
      fs.writeFileSync(this.todoPath, this.serialise(), 'utf-8');
    } catch {
      // non-fatal
    }
  }

  add(text: string, priority: TodoPriority = 'medium'): TodoItem {
    this.load();
    const item: TodoItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text,
      status: 'pending',
      priority,
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  complete(id: string): boolean {
    this.load();
    const item = this.findById(id);
    if (!item) return false;
    item.status = 'done';
    item.updatedAt = Date.now();
    this.save();
    return true;
  }

  update(id: string, updates: { text?: string; status?: TodoStatus; priority?: TodoPriority }): boolean {
    this.load();
    const item = this.findById(id);
    if (!item) return false;
    if (updates.text !== undefined) item.text = updates.text;
    if (updates.status !== undefined) item.status = updates.status;
    if (updates.priority !== undefined) item.priority = updates.priority;
    item.updatedAt = Date.now();
    this.save();
    return true;
  }

  remove(id: string): boolean {
    this.load();
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    this.save();
    return true;
  }

  clearDone(): number {
    this.load();
    const before = this.items.length;
    this.items = this.items.filter(i => i.status !== 'done');
    this.save();
    return before - this.items.length;
  }

  getAll(): TodoItem[] {
    this.load();
    return this.items;
  }

  getPending(): TodoItem[] {
    this.load();
    return this.items.filter(i => i.status !== 'done');
  }

  hasPending(): boolean {
    return this.getPending().length > 0;
  }

  /**
   * Build the context suffix injected at the END of the LLM context each turn.
   * Returns null when there are no pending items (avoids noisy injections).
   */
  buildContextSuffix(): string | null {
    this.load();
    const pending = this.getPending();
    if (pending.length === 0) return null;

    const statusIcon: Record<TodoStatus, string> = {
      pending: '⬜',
      in_progress: '🔄',
      done: '✅',
      blocked: '🚫',
    };
    const prioTag: Record<TodoPriority, string> = {
      high: ' [HIGH]',
      medium: '',
      low: ' [low]',
    };

    const lines = [
      '<todo_context>',
      '## Current Task List (todo.md)',
      '',
    ];

    for (const item of pending) {
      const icon = statusIcon[item.status];
      const prio = prioTag[item.priority];
      lines.push(`${icon} [${item.id}]${prio} ${item.text}`);
      for (const sub of item.subtasks) {
        lines.push(`  ${statusIcon[sub.status]} ${sub.text}`);
      }
    }

    lines.push('</todo_context>');
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // Markdown serialisation / parsing
  // --------------------------------------------------------------------------

  private serialise(): string {
    const lines = [
      '# Todo',
      `<!-- auto-generated by Code Buddy — last updated ${new Date().toISOString()} -->`,
      '',
    ];

    for (const item of this.items) {
      const check = item.status === 'done' ? 'x' : ' ';
      const prio = item.priority !== 'medium' ? ` [${item.priority}]` : '';
      lines.push(`- [${check}] <!--${item.id}:${item.status}:${item.priority}--> ${item.text}`);
      for (const sub of item.subtasks) {
        const sc = sub.status === 'done' ? 'x' : ' ';
        lines.push(`  - [${sc}] ${sub.text}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  private parseMd(content: string): TodoItem[] {
    const items: TodoItem[] = [];
    const lines = content.split('\n');
    let current: TodoItem | null = null;

    for (const rawLine of lines) {
      const topMatch = rawLine.match(/^- \[(.)\] <!--([^:]+):([^:]+):([^-]+)--> (.+)/);
      if (topMatch) {
        current = {
          id: topMatch[2],
          status: topMatch[3] as TodoStatus,
          priority: topMatch[4] as TodoPriority,
          text: topMatch[5].trim(),
          subtasks: [],
          createdAt: 0,
          updatedAt: 0,
        };
        items.push(current);
        continue;
      }

      // Plain markdown list item (no metadata comment)
      const plainTop = rawLine.match(/^- \[(.)\] (.+)/);
      if (plainTop) {
        current = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          status: plainTop[1] === 'x' ? 'done' : 'pending',
          priority: 'medium',
          text: plainTop[2].trim(),
          subtasks: [],
          createdAt: 0,
          updatedAt: 0,
        };
        items.push(current);
        continue;
      }

      // Sub-task (indented)
      const subMatch = rawLine.match(/^ {2,}- \[(.)\] (.+)/);
      if (subMatch && current) {
        current.subtasks.push({
          id: Math.random().toString(36).slice(2, 7),
          text: subMatch[2].trim(),
          status: subMatch[1] === 'x' ? 'done' : 'pending',
          priority: 'medium',
          subtasks: [],
          createdAt: 0,
          updatedAt: 0,
        });
      }
    }

    return items;
  }

  private findById(id: string): TodoItem | undefined {
    return this.items.find(i => i.id === id);
  }
}
