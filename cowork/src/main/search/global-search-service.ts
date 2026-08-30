/**
 * GlobalSearchService — Claude Cowork parity Phase 2
 *
 * Cross-project/session search for the Cmd+K command palette. Queries
 * sessions, messages, memories, knowledge entries, and workspace files
 * using the existing SQLite store + project services. Simple substring
 * matching with BM25-ish score weighting; no external deps.
 *
 * @module main/search/global-search-service
 */

import * as fs from 'fs';
import * as path from 'path';
import { logWarn } from '../utils/logger';
import type { DatabaseInstance } from '../db/database';
import type { KnowledgeService } from '../knowledge/knowledge-service';
import type { ProjectMemoryService } from '../project/project-memory';
import type { ProjectManager } from '../project/project-manager';

export type GlobalSearchSource =
  | 'session'
  | 'message'
  | 'memory'
  | 'knowledge'
  | 'file';

export interface GlobalSearchHit {
  source: GlobalSearchSource;
  id: string;
  title: string;
  snippet: string;
  score: number;
  /** Context for navigation: session id for message/session, file path for file, etc. */
  context: {
    sessionId?: string;
    projectId?: string;
    messageIndex?: number;
    /** Persistent id of the matched message — used by the renderer to scroll-and-highlight. */
    messageId?: string;
    path?: string;
  };
}

export interface GlobalSearchResults {
  hits: GlobalSearchHit[];
  totalByCategory: Record<GlobalSearchSource, number>;
}

/** Compute a lightweight relevance score. */
function scoreMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (!h || !n) return 0;

  const idx = h.indexOf(n);
  if (idx === -1) return 0;

  let score = 10;
  // Prefer earlier matches
  score += Math.max(0, 10 - idx / 10);
  // Prefer exact-word matches
  if (h.includes(` ${n} `) || h.startsWith(`${n} `) || h.endsWith(` ${n}`)) {
    score += 20;
  }
  // Boost for prefix match
  if (h.startsWith(n)) score += 30;
  return score;
}

function buildMessageFtsQuery(query: string): string | null {
  const tokens = query
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.toLowerCase())
    .filter(Boolean)
    .slice(0, 16);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' AND ');
}

function extractSnippet(text: string, query: string, maxLen = 140): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  let snippetText = '';
  let prefix = '';
  let suffix = '';
  if (idx === -1) {
    snippetText = text.slice(0, maxLen);
    suffix = text.length > maxLen ? '…' : '';
  } else {
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + 80);
    snippetText = text.slice(start, end);
    prefix = start > 0 ? '…' : '';
    suffix = end < text.length ? '…' : '';
  }

  // Safely escape and highlight query terms
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return prefix + snippetText + suffix;

  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  const escapedTerms = sortedTerms.map(t => t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
  const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
  const highlighted = snippetText.replace(regex, '<mark>$1</mark>');

  return prefix + highlighted + suffix;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function extractMessageContentText(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return content;
    return parsed
      .map((block: unknown) => {
        if (!block || typeof block !== 'object') return '';
        const entry = block as {
          type?: string;
          text?: string;
          thinking?: string;
          content?: string;
          name?: string;
          input?: unknown;
          filename?: string;
        };
        if (entry.type === 'text') return entry.text ?? '';
        if (entry.type === 'thinking') return entry.thinking ?? '';
        if (entry.type === 'tool_result') return entry.content ?? '';
        if (entry.type === 'tool_use') return `${entry.name ?? ''} ${JSON.stringify(entry.input ?? {})}`;
        if (entry.type === 'file_attachment') return entry.filename ?? '';
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  } catch {
    return content;
  }
}

export interface GlobalSearchDeps {
  db: DatabaseInstance;
  projectManager?: ProjectManager | null;
  knowledgeService?: KnowledgeService | null;
  projectMemoryService?: ProjectMemoryService | null;
}

export class GlobalSearchService {
  constructor(private deps: GlobalSearchDeps) {}

  /**
   * Run a query across all sources. Returns up to `limit` hits total,
   * balanced across categories.
   */
  async search(query: string, limit = 40): Promise<GlobalSearchResults> {
    const trimmed = query.trim();
    if (!trimmed) {
      return {
        hits: [],
        totalByCategory: {
          session: 0,
          message: 0,
          memory: 0,
          knowledge: 0,
          file: 0,
        },
      };
    }

    const perCategory = Math.max(5, Math.ceil(limit / 4));
    const hits: GlobalSearchHit[] = [];
    const counts: Record<GlobalSearchSource, number> = {
      session: 0,
      message: 0,
      memory: 0,
      knowledge: 0,
      file: 0,
    };

    // Sessions
    try {
      const sessionHits = this.searchSessions(trimmed, perCategory);
      counts.session = sessionHits.length;
      hits.push(...sessionHits);
    } catch (err) {
      logWarn('[GlobalSearchService] session search failed:', err);
    }

    // Messages
    try {
      const messageHits = this.searchMessages(trimmed, perCategory);
      counts.message = messageHits.length;
      hits.push(...messageHits);
    } catch (err) {
      logWarn('[GlobalSearchService] message search failed:', err);
    }

    // Memory (project-scoped)
    try {
      const memoryHits = this.searchMemory(trimmed, perCategory);
      counts.memory = memoryHits.length;
      hits.push(...memoryHits);
    } catch (err) {
      logWarn('[GlobalSearchService] memory search failed:', err);
    }

    // Knowledge (project-scoped)
    try {
      const knowledgeHits = this.searchKnowledge(trimmed, perCategory);
      counts.knowledge = knowledgeHits.length;
      hits.push(...knowledgeHits);
    } catch (err) {
      logWarn('[GlobalSearchService] knowledge search failed:', err);
    }

    // Files (limited to active project workspace)
    try {
      const fileHits = await this.searchFiles(trimmed, perCategory);
      counts.file = fileHits.length;
      hits.push(...fileHits);
    } catch (err) {
      logWarn('[GlobalSearchService] file search failed:', err);
    }

    // Sort by score desc and cap
    hits.sort((a, b) => b.score - a.score);
    return {
      hits: hits.slice(0, limit),
      totalByCategory: counts,
    };
  }

  private searchSessions(query: string, limit: number): GlobalSearchHit[] {
    const database = this.deps.db.raw;
    const rows = database
      .prepare(
        `SELECT id, title, cwd, created_at
         FROM sessions
         WHERE LOWER(title) LIKE ? ESCAPE '\\'
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(`%${escapeLikePattern(query.toLowerCase())}%`, limit) as Array<{
      id: string;
      title: string;
      cwd: string | null;
      created_at: number;
    }>;

    return rows.map((row) => ({
      source: 'session' as const,
      id: row.id,
      title: row.title,
      snippet: row.cwd ?? '',
      score: scoreMatch(row.title, query),
      context: { sessionId: row.id },
    }));
  }

  private searchMessages(query: string, limit: number): GlobalSearchHit[] {
    const database = this.deps.db.raw;
    try {
      const ftsQuery = buildMessageFtsQuery(query);
      if (ftsQuery) {
        const rows = database
          .prepare(
            `SELECT f.message_id AS id, f.session_id, f.content, m.timestamp,
                    snippet(messages_fts, 0, '<mark>', '</mark>', '...', 25) AS snippet
             FROM messages_fts f
             JOIN messages m ON m.id = f.message_id
             WHERE messages_fts MATCH ?
             ORDER BY bm25(messages_fts), m.timestamp DESC
             LIMIT ?`
          )
          .all(ftsQuery, limit) as Array<{
          id: string;
          session_id: string;
          content: string;
          timestamp: number;
          snippet: string;
        }>;

        return rows.map((row) => {
          const text = extractMessageContentText(row.content);
          return {
            source: 'message' as const,
            id: row.id,
            title: text.slice(0, 60) + (text.length > 60 ? '…' : ''),
            snippet: row.snippet,
            score: scoreMatch(text, query),
            context: { sessionId: row.session_id, messageId: row.id },
          };
        });
      }
    } catch (err) {
      logWarn('[GlobalSearchService] message FTS search failed, falling back to LIKE:', err);
    }

    // Fallback using LIKE statement
    const rows = database
      .prepare(
        `SELECT id, session_id, content, timestamp
         FROM messages
         WHERE LOWER(content) LIKE ? ESCAPE '\\'
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(`%${escapeLikePattern(query.toLowerCase())}%`, limit) as Array<{
      id: string;
      session_id: string;
      content: string;
      timestamp: number;
    }>;

    return rows.map((row) => {
      const text = extractMessageContentText(row.content);
      return {
        source: 'message' as const,
        id: row.id,
        title: text.slice(0, 60) + (text.length > 60 ? '…' : ''),
        snippet: extractSnippet(text, query),
        score: scoreMatch(text, query),
        context: { sessionId: row.session_id, messageId: row.id },
      };
    });
  }

  private searchMemory(query: string, limit: number): GlobalSearchHit[] {
    if (!this.deps.projectMemoryService || !this.deps.projectManager) {
      return [];
    }
    const active = this.deps.projectManager.getActive();
    if (!active) return [];

    try {
      const memories = this.deps.projectMemoryService.listMemoryEntries(active.id);
      const lower = query.toLowerCase();
      return memories
        .filter((m) => m.content.toLowerCase().includes(lower))
        .slice(0, limit)
        .map((m) => ({
          source: 'memory' as const,
          id: `${m.sourceSessionId ?? 'mem'}-${m.timestamp ?? Date.now()}`,
          title: m.category ?? 'memory',
          snippet: extractSnippet(m.content, query),
          score: scoreMatch(m.content, query) * 0.9,
          context: {
            projectId: active.id,
            sessionId: m.sourceSessionId,
          },
        }));
    } catch (err) {
      logWarn('[GlobalSearchService] memory list failed:', err);
      return [];
    }
  }

  private searchKnowledge(query: string, limit: number): GlobalSearchHit[] {
    if (!this.deps.knowledgeService || !this.deps.projectManager) {
      return [];
    }
    const active = this.deps.projectManager.getActive();
    if (!active?.workspacePath) return [];

    try {
      const entries = this.deps.knowledgeService.list(active.workspacePath);
      const lower = query.toLowerCase();
      return entries
        .filter((e) => {
          return (
            e.title.toLowerCase().includes(lower) ||
            e.content.toLowerCase().includes(lower) ||
            (e.tags ?? []).some((t) => t.toLowerCase().includes(lower))
          );
        })
        .slice(0, limit)
        .map((e) => ({
          source: 'knowledge' as const,
          id: e.id,
          title: e.title,
          snippet: extractSnippet(e.content, query),
          score:
            scoreMatch(e.title, query) * 1.5 + scoreMatch(e.content, query) * 0.8,
          context: {
            projectId: active.id,
            path: e.path,
          },
        }));
    } catch (err) {
      logWarn('[GlobalSearchService] knowledge list failed:', err);
      return [];
    }
  }

  private async searchFiles(query: string, limit: number): Promise<GlobalSearchHit[]> {
    if (!this.deps.projectManager) return [];
    const active = this.deps.projectManager.getActive();
    if (!active?.workspacePath) return [];

    const workspace = active.workspacePath;
    try {
      await fs.promises.access(workspace);
    } catch {
      return [];
    }

    const results: GlobalSearchHit[] = [];
    const ignoreDirs = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      '.cache',
      '.codebuddy',
      'target',
      '.vscode',
      '.idea',
    ]);

    const visit = async (dir: string, depth: number): Promise<void> => {
      if (results.length >= limit) return;
      if (depth > 6) return;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= limit) return;
        if (entry.name.startsWith('.') && !query.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (ignoreDirs.has(entry.name)) continue;
          await visit(full, depth + 1);
          continue;
        }
        if (entry.isFile()) {
          const match = scoreMatch(entry.name, query);
          if (match > 0) {
            const relativePath = path.relative(workspace, full);
            results.push({
              source: 'file',
              id: full,
              title: entry.name,
              snippet: relativePath,
              score: match,
              context: {
                projectId: active.id,
                path: full,
              },
            });
          }
        }
      }
    };

    try {
      await visit(workspace, 0);
    } catch (err) {
      logWarn('[GlobalSearchService] file walk failed:', err);
    }

    return results;
  }
}
