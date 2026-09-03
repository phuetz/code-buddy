/**
 * Auto-Memory System
 *
 * Automatically extracts and stores memories from agent interactions.
 * Supports three scopes: user, project, and local.
 * Memories are stored in MEMORY.md files at scope-appropriate paths.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// Types
// ============================================================================

export type MemoryScope = 'user' | 'project' | 'local';

export interface MemoryEntry {
  key: string;
  value: string;
  scope: MemoryScope;
  timestamp: number;
  source: 'agent' | 'user';
}

// ============================================================================
// Keyword Patterns for Analysis
// ============================================================================

const ANALYSIS_PATTERNS: { category: string; patterns: RegExp[] }[] = [
  {
    category: 'project-structure',
    patterns: [
      /(?:project|repo|codebase) (?:uses?|is built with|structure[ds]?) ([^.]+)/i,
      /(?:main|entry|root) (?:file|directory|folder) (?:is|at) ([^\s.]+)/i,
      /monorepo (?:with|using|containing) ([^.]+)/i,
    ],
  },
  {
    category: 'user-preference',
    patterns: [
      /(?:i |we |please )prefer ([^.]+)/i,
      /(?:always|never) (?:use|do|include) ([^.]+)/i,
      /(?:my|our) (?:preferred|favorite) ([^.]+)/i,
    ],
  },
  {
    category: 'error-solution',
    patterns: [
      /(?:fix|solution|resolved|workaround)[:\s]+([^.]+)/i,
      /(?:the error|the issue|the bug) (?:was|is) (?:caused by|due to|fixed by) ([^.]+)/i,
    ],
  },
  {
    category: 'architecture',
    patterns: [
      /(?:architecture|pattern|design) (?:is|uses?|follows?) ([^.]+)/i,
      /(?:we use|using) (?:the )?([^.]*(?:pattern|architecture|approach))/i,
    ],
  },
  {
    category: 'important-file',
    patterns: [
      /(?:important|key|critical|config) files?[:\s]+([^\n.]+)/i,
      /(?:don't|do not|never) (?:edit|modify|touch|delete) ([^\s.]+)/i,
    ],
  },
];

// ============================================================================
// AutoMemoryManager
// ============================================================================

export class AutoMemoryManager {
  private projectDir: string;
  private memories: Map<string, MemoryEntry> = new Map();

  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
    this.loadAllMemories();
  }

  /**
   * Analyze context and response for potential memories to extract
   */
  analyzeForMemories(context: string, response: string): MemoryEntry[] {
    const extracted: MemoryEntry[] = [];
    const combined = `${context}\n${response}`;

    for (const { category, patterns } of ANALYSIS_PATTERNS) {
      for (const pattern of patterns) {
        const match = combined.match(pattern);
        if (match && match[1]) {
          const key = `${category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const entry: MemoryEntry = {
            key,
            value: match[0].trim(),
            scope: 'project',
            timestamp: Date.now(),
            source: 'agent',
          };
          extracted.push(entry);
        }
      }
    }

    return extracted;
  }

  /**
   * Write a memory entry to the appropriate MEMORY.md file
   */
  writeMemory(key: string, value: string, scope: MemoryScope = 'project'): void {
    const entry: MemoryEntry = {
      key,
      value,
      scope,
      timestamp: Date.now(),
      source: 'user',
    };

    this.memories.set(`${scope}:${key}`, entry);

    const memoryPath = this.getMemoryPath(scope);
    const dir = path.dirname(memoryPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.saveMemoryFile(scope);
    logger.debug(`Memory written: ${key} (${scope})`, { source: 'AutoMemoryManager' });
  }

  /**
   * Search all scoped memory files for relevant entries
   */
  recallMemories(context: string): MemoryEntry[] {
    const contextLower = context.toLowerCase();
    const words = contextLower.split(/\s+/).filter((w) => w.length > 3);

    const results: MemoryEntry[] = [];

    for (const entry of this.memories.values()) {
      const entryText = `${entry.key} ${entry.value}`.toLowerCase();
      let score = 0;

      for (const word of words) {
        if (entryText.includes(word)) {
          score++;
        }
      }

      if (score > 0) {
        results.push(entry);
      }
    }

    // Sort by relevance (more matching words first), then by recency
    results.sort((a, b) => {
      return b.timestamp - a.timestamp;
    });

    return results;
  }

  /**
   * Get the file path for a given memory scope
   */
  getMemoryPath(scope: MemoryScope): string {
    switch (scope) {
      case 'user':
        return path.join(os.homedir(), '.codebuddy', 'memory', 'MEMORY.md');
      case 'project':
        return path.join(this.projectDir, '.codebuddy', 'memory', 'MEMORY.md');
      case 'local':
        return path.join(this.projectDir, '.codebuddy', 'memory', 'local', 'MEMORY.md');
    }
  }

  /**
   * List all memories, optionally filtered by scope
   */
  listMemories(scope?: MemoryScope): MemoryEntry[] {
    const entries = Array.from(this.memories.values());
    if (scope) {
      return entries.filter((e) => e.scope === scope);
    }
    return entries;
  }

  /**
   * Delete a memory entry by key and optional scope
   */
  deleteMemory(key: string, scope?: MemoryScope): boolean {
    if (scope) {
      const compositeKey = `${scope}:${key}`;
      const deleted = this.memories.delete(compositeKey);
      if (deleted) {
        this.saveMemoryFile(scope);
      }
      return deleted;
    }

    // Try all scopes
    let deleted = false;
    for (const s of ['user', 'project', 'local'] as MemoryScope[]) {
      const compositeKey = `${s}:${key}`;
      if (this.memories.delete(compositeKey)) {
        this.saveMemoryFile(s);
        deleted = true;
      }
    }
    return deleted;
  }

  /**
   * Get a summary of recalled memories count
   */
  getRecallSummary(): string {
    const count = this.memories.size;
    return `Recalled ${count} memories`;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private loadAllMemories(): void {
    for (const scope of ['user', 'project', 'local'] as MemoryScope[]) {
      this.loadMemoryFile(scope);
    }
  }

  private loadMemoryFile(scope: MemoryScope): void {
    const memoryPath = this.getMemoryPath(scope);

    try {
      if (!fs.existsSync(memoryPath)) {
        return;
      }

      const content = readTextAtomicSync(memoryPath, '');
      if (!content) return;
      const lines = content.split('\n');

      for (const line of lines) {
        // Parse entries in format: - **key**: value [timestamp] [source]
        const match = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+?)(?:\s*\[(\d+)\])?\s*(?:\[(\w+)\])?\s*$/);
        if (match) {
          const key = match[1];
          const value = match[2];
          if (key === undefined || value === undefined) {
            continue;
          }
          const entry: MemoryEntry = {
            key,
            value: value.trim(),
            scope,
            timestamp: match[3] ? parseInt(match[3], 10) : Date.now(),
            source: (match[4] as 'agent' | 'user') || 'user',
          };
          this.memories.set(`${scope}:${entry.key}`, entry);
        }
      }
    } catch (error) {
      logger.debug(`Failed to load memory file ${memoryPath}: ${error}`, { source: 'AutoMemoryManager' });
    }
  }

  private saveMemoryFile(scope: MemoryScope): void {
    const memoryPath = this.getMemoryPath(scope);
    const entries = this.listMemories(scope);

    let content = `# Code Buddy Auto-Memory (${scope})\n\n`;
    content += `## Memories\n\n`;

    for (const entry of entries) {
      content += `- **${entry.key}**: ${entry.value} [${entry.timestamp}] [${entry.source}]\n`;
    }

    content += `\n---\n*Last updated: ${new Date().toISOString()}*\n`;

    const dir = path.dirname(memoryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    writeFileAtomicSync(memoryPath, content, { mode: 0o600 });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: AutoMemoryManager | null = null;

export function getAutoMemoryManager(projectDir?: string): AutoMemoryManager {
  if (!instance || projectDir) {
    instance = new AutoMemoryManager(projectDir);
  }
  return instance;
}

export function resetAutoMemory(): void {
  instance = null;
}
