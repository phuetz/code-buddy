import fs from "fs-extra";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { getHooksManager } from "../hooks/lifecycle-hooks.js";
import { Fact, FactCategory } from "./facts-memory.js";
import { logger } from "../utils/logger.js";
import { shouldWriteProjectRuntimeFiles } from "../utils/runtime-flags.js";
import { decideForgets, type ForgetCandidate, type ForgettingConfig } from "./memory-forgetting.js";

function mapMemoryCategoryToFactCategory(cat: MemoryCategory): FactCategory {
  switch (cat) {
    case 'project': return 'Projet';
    case 'preferences': return 'Preferences';
    case 'decisions': return 'Decisions';
    case 'patterns': return 'Conventions';
    case 'context': return 'Besoins';
    case 'custom': return 'Profil';
    default: return 'Profil';
  }
}

function mapFactCategoryToMemoryCategory(cat: FactCategory): MemoryCategory {
  switch (cat) {
    case 'Projet': return 'project';
    case 'Preferences': return 'preferences';
    case 'Decisions': return 'decisions';
    case 'Conventions': return 'patterns';
    case 'Besoins': return 'context';
    case 'Profil': return 'custom';
    default: return 'custom';
  }
}

export interface Memory {
  key: string;
  value: string;
  category: MemoryCategory;
  createdAt: Date;
  updatedAt: Date;
  /** Last recall (reinforcement anchor for the forgetting curve). */
  lastAccessedAt?: Date;
  accessCount: number;
  tags?: string[];
}

export type MemoryCategory =
  | "project"      // Project-specific context
  | "preferences"  // User preferences
  | "decisions"    // Architectural decisions
  | "patterns"     // Code patterns used
  | "context"      // Ongoing context
  | "custom";      // User-defined

export interface MemoryConfig {
  projectMemoryPath: string;   // .codebuddy/CODEBUDDY_MEMORY.md
  userMemoryPath: string;      // ~/.codebuddy/memory.md
  autoCapture: boolean;        // Auto-capture important context
  maxMemories: number;         // Max memories per scope
  relevanceThreshold: number;  // For semantic matching (0-1)
  enforceCharLimits: boolean;  // Hermes-style bounded memory: reject writes over the char budget
  projectCharLimit: number;    // Project MEMORY.md-equivalent budget
  userCharLimit: number;       // USER.md-equivalent budget
  securityScan: boolean;       // Reject prompt-injection/exfiltration patterns before durable writes
  rejectExactDuplicates: boolean;
}

const DEFAULT_CONFIG: MemoryConfig = {
  projectMemoryPath: ".codebuddy/CODEBUDDY_MEMORY.md",
  userMemoryPath: path.join(os.homedir(), ".codebuddy", "memory.md"),
  autoCapture: true,
  maxMemories: 100,
  relevanceThreshold: 0.5,
  enforceCharLimits: process.env.CODEBUDDY_MEMORY_ENFORCE_LIMITS !== 'false',
  projectCharLimit: parsePositiveInt(process.env.CODEBUDDY_MEMORY_PROJECT_CHAR_LIMIT, 2200),
  userCharLimit: parsePositiveInt(process.env.CODEBUDDY_MEMORY_USER_CHAR_LIMIT, 1375),
  securityScan: process.env.CODEBUDDY_MEMORY_SECURITY_SCAN !== 'false',
  rejectExactDuplicates: process.env.CODEBUDDY_MEMORY_REJECT_DUPLICATES !== 'false',
};

export type MemoryScope = "project" | "user";

/** One entry of the recoverable forgetting archive (`*.archive.md`). */
export interface ArchivedMemory {
  key: string;
  value: string;
  category: MemoryCategory;
  tags?: string[];
  /** ISO timestamp of the `## Forgotten <ISO>` section it was archived under. */
  forgottenAt: string;
  scope: MemoryScope;
}

export interface MemoryUsage {
  scope: MemoryScope;
  used: number;
  limit: number;
  percent: number;
}

export type MemoryWriteStatus = 'stored' | 'updated' | 'duplicate' | 'replaced' | 'missing';

export interface MemoryWriteResult {
  status: MemoryWriteStatus;
  key: string;
  scope: MemoryScope;
  category?: MemoryCategory;
  usage: MemoryUsage;
  message: string;
}

export class MemoryWriteRejectedError extends Error {
  constructor(
    message: string,
    readonly code: 'memory_limit_exceeded' | 'memory_security_rejected',
    readonly usage?: MemoryUsage,
  ) {
    super(message);
    this.name = 'MemoryWriteRejectedError';
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Metadata round-tripped through the markdown file so recall reinforcement
 * and the forgetting curve survive restarts (older files simply lack it). */
interface MemoryMeta {
  createdAt?: Date;
  updatedAt?: Date;
  lastAccessedAt?: Date;
  accessCount?: number;
}

function parseMemoryMeta(body: string): MemoryMeta {
  const field = (name: string): string | undefined =>
    new RegExp(`\\b${name}=(\\S+)`).exec(body)?.[1];
  const date = (raw: string | undefined): Date | undefined => {
    if (!raw) return undefined;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };
  const accessed = Number.parseInt(field("accessed") ?? "", 10);
  return {
    createdAt: date(field("created")),
    updatedAt: date(field("updated")),
    lastAccessedAt: date(field("last")),
    accessCount: Number.isFinite(accessed) && accessed >= 0 ? accessed : undefined,
  };
}

function renderMemoryMeta(memory: Memory): string {
  const last = memory.lastAccessedAt ? ` last=${memory.lastAccessedAt.toISOString()}` : "";
  return `  <!-- meta: accessed=${memory.accessCount} created=${memory.createdAt.toISOString()} updated=${memory.updatedAt.toISOString()}${last} -->`;
}

function cloneMemoryMap(memories: Map<string, Memory>): Map<string, Memory> {
  return new Map(Array.from(memories.entries()).map(([key, memory]) => [
    key,
    {
      ...memory,
      createdAt: new Date(memory.createdAt),
      updatedAt: new Date(memory.updatedAt),
      lastAccessedAt: memory.lastAccessedAt ? new Date(memory.lastAccessedAt) : undefined,
      tags: memory.tags ? [...memory.tags] : undefined,
    },
  ]));
}

const MEMORY_TEMPLATE = `# Code Buddy Memory

This file stores persistent memory for the Code Buddy agent.
It is automatically managed but can be manually edited.

## Project Context
<!-- Key information about this project -->

## User Preferences
<!-- Coding style, conventions, preferences -->

## Decisions
<!-- Important architectural or design decisions -->

## Patterns
<!-- Code patterns and conventions used -->

## Custom
<!-- User-defined memories -->

---
*Last updated: ${new Date().toISOString()}*
`;

/**
 * Persistent Memory Manager - Inspired by Claude's CLAUDE.md memory system
 * Stores memories in markdown files that persist across sessions
 */
export class PersistentMemoryManager extends EventEmitter {
  private config: MemoryConfig;
  private projectMemories: Map<string, Memory> = new Map();
  private userMemories: Map<string, Memory> = new Map();
  private initialized: boolean = false;
  /**
   * Promise gate for concurrent initialize() callers (F31).
   *
   * Previously `initialize()` guarded only on the `initialized` boolean,
   * which left a window where two concurrent callers both saw
   * `initialized === false`, both did the full `ensureMemoryFiles` +
   * `loadMemories x 2` sequence, and both emitted `memory:initialized` —
   * doubling I/O and firing warm-up listeners twice. Storing the init
   * promise and returning it to every caller ensures a single run.
   */
  private initPromise: Promise<void> | null = null;
  /** Scopes with unpersisted recall reinforcement (see reinforce/flushAccessMetadata). */
  private accessDirtyScopes = new Set<MemoryScope>();
  private accessFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize memory system, loading existing memories.
   * Concurrent calls share the same in-flight promise (see F31 above).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.ensureMemoryFiles();
      await this.loadMemories("project");
      await this.loadMemories("user");
      this.initialized = true;
      this.emit("memory:initialized");
    })();

    try {
      await this.initPromise;
    } catch (err) {
      // Reset so a later caller can retry after a transient failure
      // (e.g. disk full during ensureMemoryFiles).
      this.initPromise = null;
      throw err;
    }
  }

  private async ensureMemoryFiles(): Promise<void> {
    // Ensure project memory file only for persistent sessions. Headless one-shot
    // runs may read an existing project memory file, but should not create one.
    if (shouldWriteProjectRuntimeFiles() || await fs.pathExists(this.config.projectMemoryPath)) {
      const projectDir = path.dirname(this.config.projectMemoryPath);
      await fs.ensureDir(projectDir);

      if (!(await fs.pathExists(this.config.projectMemoryPath))) {
        await fs.writeFile(this.config.projectMemoryPath, MEMORY_TEMPLATE);
      }
    }

    // Ensure user memory file
    const userDir = path.dirname(this.config.userMemoryPath);
    await fs.ensureDir(userDir);

    if (!(await fs.pathExists(this.config.userMemoryPath))) {
      await fs.writeFile(this.config.userMemoryPath, MEMORY_TEMPLATE);
    }
  }

  private async loadMemories(scope: "project" | "user"): Promise<void> {
    const filePath = scope === "project"
      ? this.config.projectMemoryPath
      : this.config.userMemoryPath;

    const memories = scope === "project" ? this.projectMemories : this.userMemories;

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = this.parseMemoryFile(content);

      for (const memory of parsed) {
        memories.set(memory.key, memory);
      }
    } catch (_error) {
      // File doesn't exist or can't be read, start fresh
    }
  }

  private parseMemoryFile(content: string): Memory[] {
    const memories: Memory[] = [];
    const categoryMap: Record<string, MemoryCategory> = {
      "Project Context": "project",
      "User Preferences": "preferences",
      "Decisions": "decisions",
      "Patterns": "patterns",
      "Context": "context",
      "Custom": "custom",
    };

    let currentCategory: MemoryCategory = "custom";
    const lines = content.split("\n");
    let currentKey = "";
    let currentValue = "";
    let currentMeta: MemoryMeta | undefined;
    let inMemoryBlock = false;

    const pushCurrent = () => {
      if (currentKey && currentValue) {
        memories.push(this.createMemory(currentKey, currentValue.trim(), currentCategory, currentMeta));
      }
      currentKey = "";
      currentValue = "";
      currentMeta = undefined;
    };

    for (const line of lines) {
      // Check for category headers
      if (line.startsWith("## ")) {
        const categoryName = line.slice(3).trim();
        if (categoryMap[categoryName]) {
          currentCategory = categoryMap[categoryName];
        }
        continue;
      }

      // Check for memory entries (format: - **key**: value)
      const memoryMatch = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
      if (memoryMatch) {
        pushCurrent();
        // Group 1 (`[^*]+`) always matches at least one char; group 2 (`.*`) defaults to "" when empty.
        const [, matchedKey = "", matchedValue = ""] = memoryMatch;
        currentKey = matchedKey;
        currentValue = matchedValue;
        inMemoryBlock = true;
        continue;
      }

      // Metadata comment (written by saveMemories; absent in older files).
      // Must be checked BEFORE the multi-line continuation branch or it would
      // be folded into the value.
      const metaMatch = line.match(/^\s*<!--\s*meta:\s*(.*?)\s*-->\s*$/);
      if (metaMatch && inMemoryBlock) {
        currentMeta = parseMemoryMeta(metaMatch[1] ?? "");
        continue;
      }

      // Continue multi-line value
      if (inMemoryBlock && line.startsWith("  ")) {
        currentValue += "\n" + line.trim();
      } else if (inMemoryBlock && line.trim() === "") {
        // End of memory block
        pushCurrent();
        inMemoryBlock = false;
      }
    }

    // Don't forget last memory
    pushCurrent();

    return memories;
  }

  private createMemory(key: string, value: string, category: MemoryCategory, meta?: MemoryMeta): Memory {
    return {
      key,
      value,
      category,
      createdAt: meta?.createdAt ?? new Date(),
      updatedAt: meta?.updatedAt ?? new Date(),
      ...(meta?.lastAccessedAt ? { lastAccessedAt: meta.lastAccessedAt } : {}),
      accessCount: meta?.accessCount ?? 0,
    };
  }

  /**
   * Remember something (store in memory)
   */
  async remember(
    key: string,
    value: string,
    options: {
      scope?: MemoryScope;
      category?: MemoryCategory;
      tags?: string[];
    } = {}
  ): Promise<MemoryWriteResult> {
    const { scope = "project", category = "context", tags } = options;
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();

    this.assertMemoryWriteSafe(normalizedKey, normalizedValue);

    const existing = memories.get(normalizedKey);
    if (this.config.rejectExactDuplicates && existing?.value === normalizedValue) {
      return {
        status: 'duplicate',
        key: normalizedKey,
        scope,
        category: existing.category,
        usage: this.getMemoryUsage(scope),
        message: `No duplicate added for "${normalizedKey}".`,
      };
    }

    const previousMemories = cloneMemoryMap(memories);
    const status: MemoryWriteStatus = existing ? 'updated' : 'stored';

    try {
      const { FactsMemoryService } = await import('./facts-memory.js');
      const service = new FactsMemoryService();

      if (await service.isAvailable()) {
        const newFact: Fact = {
          category: mapMemoryCategoryToFactCategory(category),
          text: `${normalizedKey}: ${normalizedValue}`,
          source: tags?.join(', ') || 'manual',
          updatedAt: new Date()
        };

        const currentFacts: Fact[] = Array.from(memories.entries()).map(([k, m]) => ({
          category: mapMemoryCategoryToFactCategory(m.category),
          text: `${k}: ${m.value}`,
          source: m.tags?.join(', ') || 'persistent-memory',
          updatedAt: m.updatedAt
        }));

        const reconciledFacts = await service.reconcileFacts(currentFacts, [newFact]);

        memories.clear();
        for (const fact of reconciledFacts) {
          let fKey = `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          let fValue = fact.text;
          const colonIdx = fact.text.indexOf(': ');
          if (colonIdx > 0 && colonIdx < 50) {
            fKey = fact.text.substring(0, colonIdx).trim();
            fValue = fact.text.substring(colonIdx + 2).trim();
          }

          // The map was cleared above — prior metadata lives in previousMemories.
          const prior = previousMemories.get(fKey);
          memories.set(fKey, {
            key: fKey,
            value: fValue,
            category: mapFactCategoryToMemoryCategory(fact.category),
            createdAt: prior?.createdAt || fact.updatedAt || new Date(),
            updatedAt: fact.updatedAt || new Date(),
            ...(prior?.lastAccessedAt ? { lastAccessedAt: prior.lastAccessedAt } : {}),
            accessCount: prior?.accessCount || 0,
            tags: fact.source ? [fact.source] : tags
          });
        }
      } else {
        // Fallback to default direct write
        this.setMemoryDirect(memories, normalizedKey, normalizedValue, category, tags);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[FactsMemory] Failed to reconcile remember, falling back to default behavior: ${message}`);
      memories.clear();
      for (const [memoryKey, memory] of previousMemories) {
        memories.set(memoryKey, memory);
      }
      this.setMemoryDirect(memories, normalizedKey, normalizedValue, category, tags);
    }

    try {
      this.assertScopeWithinLimit(scope);
    } catch (err) {
      memories.clear();
      for (const [memoryKey, memory] of previousMemories) {
        memories.set(memoryKey, memory);
      }
      throw err;
    }

    await this.saveMemories(scope);

    this.emit("memory:remembered", { key: normalizedKey, scope, category });
    return {
      status,
      key: normalizedKey,
      scope,
      category,
      usage: this.getMemoryUsage(scope),
      message: status === 'updated'
        ? `Updated "${normalizedKey}" in ${scope} memory.`
        : `Stored "${normalizedKey}" in ${scope} memory.`,
    };
  }

  async replace(
    key: string,
    value: string,
    options: {
      scope?: MemoryScope;
      category?: MemoryCategory;
      tags?: string[];
    } = {},
  ): Promise<MemoryWriteResult> {
    const { scope = 'project', category, tags } = options;
    const memories = scope === 'project' ? this.projectMemories : this.userMemories;
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    const existing = memories.get(normalizedKey);

    if (!existing) {
      return {
        status: 'missing',
        key: normalizedKey,
        scope,
        category,
        usage: this.getMemoryUsage(scope),
        message: `No memory found for key "${normalizedKey}" in ${scope} scope.`,
      };
    }

    this.assertMemoryWriteSafe(normalizedKey, normalizedValue);

    const previousMemories = cloneMemoryMap(memories);
    memories.set(normalizedKey, {
      ...existing,
      value: normalizedValue,
      category: category ?? existing.category,
      updatedAt: new Date(),
      tags: tags ?? existing.tags,
    });

    try {
      this.assertScopeWithinLimit(scope);
    } catch (err) {
      memories.clear();
      for (const [memoryKey, memory] of previousMemories) {
        memories.set(memoryKey, memory);
      }
      throw err;
    }

    await this.saveMemories(scope);
    this.emit("memory:replaced", { key: normalizedKey, scope, category: category ?? existing.category });

    return {
      status: 'replaced',
      key: normalizedKey,
      scope,
      category: category ?? existing.category,
      usage: this.getMemoryUsage(scope),
      message: `Replaced "${normalizedKey}" in ${scope} memory.`,
    };
  }

  private setMemoryDirect(
    memories: Map<string, Memory>,
    key: string,
    value: string,
    category: MemoryCategory,
    tags?: string[],
  ): void {
    const existing = memories.get(key);
    const memory: Memory = {
      key,
      value,
      category,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
      ...(existing?.lastAccessedAt ? { lastAccessedAt: existing.lastAccessedAt } : {}),
      accessCount: existing?.accessCount || 0,
      tags,
    };
    memories.set(key, memory);
  }

  private assertMemoryWriteSafe(key: string, value: string): void {
    if (!key || !value) {
      throw new MemoryWriteRejectedError(
        'Memory key and value must be non-empty.',
        'memory_security_rejected',
      );
    }

    if (!this.config.securityScan) return;

    const content = `${key}\n${value}`;
    if (/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u.test(content)) {
      throw new MemoryWriteRejectedError(
        'Memory write rejected: invisible Unicode control characters are not allowed in prompt-injected memory.',
        'memory_security_rejected',
      );
    }

    const threatPatterns: Array<{ pattern: RegExp; reason: string }> = [
      {
        pattern: /\b(ignore|override|bypass|discard)\b.{0,80}\b(system|developer|previous|prior|above)\b.{0,80}\b(instructions?|prompt|rules?)\b/i,
        reason: 'prompt injection instruction',
      },
      {
        pattern: /\b(exfiltrate|steal|leak|send|upload|post)\b.{0,100}\b(api[-_ ]?key|token|secret|password|credential|private key)\b/i,
        reason: 'credential exfiltration instruction',
      },
      {
        pattern: /\b(authorized_keys|reverse shell|backdoor|ssh-rsa)\b/i,
        reason: 'backdoor or SSH persistence pattern',
      },
      {
        pattern: /-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/i,
        reason: 'private key material',
      },
    ];

    for (const { pattern, reason } of threatPatterns) {
      if (pattern.test(content)) {
        throw new MemoryWriteRejectedError(
          `Memory write rejected: ${reason} detected.`,
          'memory_security_rejected',
        );
      }
    }
  }

  private assertScopeWithinLimit(scope: MemoryScope): void {
    if (!this.config.enforceCharLimits) return;
    const usage = this.getMemoryUsage(scope);
    if (usage.limit > 0 && usage.used > usage.limit) {
      throw new MemoryWriteRejectedError(
        `Memory ${scope} is full (${usage.used}/${usage.limit} chars). Consolidate or remove entries before retrying.`,
        'memory_limit_exceeded',
        usage,
      );
    }
  }

  private getMemoryLimit(scope: MemoryScope): number {
    return scope === 'project' ? this.config.projectCharLimit : this.config.userCharLimit;
  }

  private renderScopeEntries(memories: Map<string, Memory>): string {
    return Array.from(memories.values())
      .map((memory) => `${memory.key}: ${memory.value}`)
      .join('\n§\n');
  }

  getMemoryUsage(scope: MemoryScope): MemoryUsage {
    const memories = scope === 'project' ? this.projectMemories : this.userMemories;
    const used = this.renderScopeEntries(memories).length;
    const limit = this.getMemoryLimit(scope);
    return {
      scope,
      used,
      limit,
      percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    };
  }

  getMemoryUsages(): { project: MemoryUsage; user: MemoryUsage } {
    return {
      project: this.getMemoryUsage('project'),
      user: this.getMemoryUsage('user'),
    };
  }

  /**
   * Recall something from memory
   */
  recall(key: string, scope?: "project" | "user"): string | null {
    if (scope) {
      const memories = scope === "project" ? this.projectMemories : this.userMemories;
      const memory = memories.get(key);
      if (memory) {
        this.reinforce(memory, scope);
        return memory.value;
      }
      return null;
    }

    // Search both scopes, project first
    const projectHit = this.projectMemories.get(key);
    const memory = projectHit ?? this.userMemories.get(key);

    if (memory) {
      this.reinforce(memory, projectHit ? "project" : "user");
      return memory.value;
    }
    return null;
  }

  /**
   * Recall reinforcement: bump the spaced-repetition signals the forgetting
   * curve reads (accessCount → stability, lastAccessedAt → decay anchor) and
   * schedule a debounced persist so they survive restarts.
   */
  private reinforce(memory: Memory, scope: MemoryScope): void {
    memory.accessCount++;
    memory.lastAccessedAt = new Date();
    this.scheduleAccessFlush(scope);
  }

  private scheduleAccessFlush(scope: MemoryScope): void {
    this.accessDirtyScopes.add(scope);
    if (this.accessFlushTimer) return;
    this.accessFlushTimer = setTimeout(() => {
      void this.flushAccessMetadata();
    }, 10_000);
    this.accessFlushTimer.unref?.();
  }

  /** Persist pending recall reinforcement now (also runs on a 10s debounce). Never throws. */
  async flushAccessMetadata(): Promise<void> {
    if (this.accessFlushTimer) {
      clearTimeout(this.accessFlushTimer);
      this.accessFlushTimer = null;
    }
    const scopes = Array.from(this.accessDirtyScopes);
    this.accessDirtyScopes.clear();
    for (const scope of scopes) {
      try {
        // Headless one-shot runs must not create project runtime files just
        // because something was recalled (same invariant as ensureMemoryFiles).
        if (
          scope === "project" &&
          !shouldWriteProjectRuntimeFiles() &&
          !(await fs.pathExists(this.config.projectMemoryPath))
        ) {
          continue;
        }
        await this.saveMemories(scope);
      } catch (err) {
        logger.warn(
          `[persistent-memory] could not persist recall reinforcement (${scope}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Non-reinforcing single-entry read. Unlike `recall()`, this does NOT bump
   * `accessCount`/`lastAccessedAt`, so surface reads (REST GET, listings)
   * don't distort the Ebbinghaus forgetting curve. With no scope, project is
   * checked first, then user — the same precedence as `recall()`.
   */
  get(key: string, scope?: MemoryScope): (Memory & { scope: MemoryScope }) | undefined {
    const normalizedKey = key.trim();
    if (!scope || scope === "project") {
      const memory = this.projectMemories.get(normalizedKey);
      if (memory) return { ...memory, scope: "project" };
    }
    if (!scope || scope === "user") {
      const memory = this.userMemories.get(normalizedKey);
      if (memory) return { ...memory, scope: "user" };
    }
    return undefined;
  }

  /**
   * Forget something (remove from memory)
   */
  async forget(key: string, scope: "project" | "user" = "project"): Promise<boolean> {
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    const deleted = memories.delete(key);

    if (deleted) {
      await this.saveMemories(scope);
      this.emit("memory:forgotten", { key, scope });
    }

    return deleted;
  }

  /**
   * Get memories relevant to a query (simple keyword matching)
   */
  getRelevantMemories(query: string, limit: number = 5): Memory[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    const allMemories: Array<{ memory: Memory; scope: MemoryScope }> = [
      ...Array.from(this.projectMemories.values(), (memory) => ({ memory, scope: "project" as const })),
      ...Array.from(this.userMemories.values(), (memory) => ({ memory, scope: "user" as const })),
    ];

    // Score memories by relevance
    const scored = allMemories.map(({ memory, scope }) => {
      const textLower = `${memory.key} ${memory.value}`.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (textLower.includes(word)) {
          score += 1;
        }
      }

      // Boost by access count
      score += memory.accessCount * 0.1;

      return { memory, scope, score };
    });

    // Sort by score and return top results
    const top = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Retrieval-for-prompt counts as recall: reinforce the returned hits
    // (unlike getContextForPrompt, which renders everything indiscriminately).
    for (const { memory, scope } of top) {
      this.reinforce(memory, scope);
    }

    return top.map((s) => s.memory);
  }

  /**
   * Read-only enumeration of live memories (copies) for inspection tooling —
   * the Curator's dry-run forgetting scan reads through this instead of
   * poking the private maps. Does NOT reinforce (unlike getRelevantMemories).
   */
  listMemories(scope: MemoryScope): Memory[] {
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    return Array.from(memories.values()).map((m) => ({
      ...m,
      ...(m.tags ? { tags: [...m.tags] } : {}),
    }));
  }

  /**
   * Ebbinghaus forgetting pass (recoverable): memories whose retention decayed
   * below the threshold are appended to a sibling `*.archive.md`, then removed.
   * An archive write failure aborts the pass — we never drop what we could not
   * preserve. `preferences`/`decisions` and `pinned`-tagged entries never decay
   * (see memory-forgetting.ts).
   */
  async applyForgetting(
    scope: MemoryScope,
    options: { now?: Date; config?: Partial<ForgettingConfig> } = {},
  ): Promise<{ forgotten: ForgetCandidate[] }> {
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    const now = options.now ?? new Date();
    const candidates = decideForgets(memories.values(), now, options.config);
    if (candidates.length === 0) return { forgotten: [] };

    const archivePath = this.getArchivePath(scope);
    const lines = candidates.map((candidate) => {
      const memory = memories.get(candidate.key)!;
      const tags = memory.tags?.length ? ` [${memory.tags.join(", ")}]` : "";
      return (
        `- **${memory.key}** (${memory.category}${tags}, accessed ${memory.accessCount}×, ` +
        `age ${Math.round(candidate.ageDays)}d, retention ${candidate.retention.toFixed(3)}): ${memory.value}`
      );
    });

    try {
      await fs.ensureDir(path.dirname(archivePath));
      await fs.appendFile(archivePath, `\n## Forgotten ${now.toISOString()}\n${lines.join("\n")}\n`);
    } catch (err) {
      logger.warn(
        `[persistent-memory] forgetting aborted — archive write failed, keeping all ${scope} memories: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { forgotten: [] };
    }

    for (const candidate of candidates) {
      memories.delete(candidate.key);
    }
    await this.saveMemories(scope);
    for (const candidate of candidates) {
      this.emit("memory:forgotten", { key: candidate.key, scope, reason: "decay", retention: candidate.retention });
    }
    logger.info(
      `[persistent-memory] ${scope}: ${candidates.length} memories faded (archived to ${archivePath})`,
    );
    return { forgotten: candidates };
  }

  private getArchivePath(scope: MemoryScope): string {
    const filePath = scope === "project" ? this.config.projectMemoryPath : this.config.userMemoryPath;
    return filePath.replace(/\.md$/i, "") + ".archive.md";
  }

  /**
   * List the entries the forgetting pass archived (newest first). Parses the
   * `*.archive.md` sections written by applyForgetting():
   *   `## Forgotten <ISO>` then `- **key** (category[ [tags]], accessed N×,
   *   age Dd, retention R): value`.
   */
  async listArchived(scope?: MemoryScope): Promise<ArchivedMemory[]> {
    const scopes: MemoryScope[] = scope ? [scope] : ["project", "user"];
    const out: ArchivedMemory[] = [];
    for (const s of scopes) {
      const parsed = await this.parseArchive(s);
      out.push(...parsed.map(({ lineIndex: _lineIndex, ...entry }) => entry));
    }
    return out.sort((a, b) => (a.forgottenAt < b.forgottenAt ? 1 : a.forgottenAt > b.forgottenAt ? -1 : 0));
  }

  /**
   * Restore a forgotten entry from the archive back into live memory — the
   * "recoverable" half of the Ebbinghaus pass. The LATEST archived version of
   * the key wins (project checked before user when no scope is given). The
   * critical action is the re-remember (restoring = re-learning: the curve
   * restarts fresh); on success the restored line is removed from the archive
   * (atomic rewrite, best-effort — a cleanup failure never undoes the restore).
   * Returns null when the key is not in the archive.
   */
  async restoreFromArchive(
    key: string,
    scope?: MemoryScope,
  ): Promise<{ result: MemoryWriteResult; restored: ArchivedMemory } | null> {
    const normalizedKey = key.trim();
    const scopes: MemoryScope[] = scope ? [scope] : ["project", "user"];
    for (const s of scopes) {
      const parsed = await this.parseArchive(s);
      const matches = parsed.filter((e) => e.key === normalizedKey);
      if (matches.length === 0) continue;
      // Latest version wins: sections are appended chronologically, so the
      // last file occurrence is the most recent forgetting of this key.
      const entry = matches[matches.length - 1]!;
      const result = await this.remember(entry.key, entry.value, {
        scope: s,
        category: entry.category,
        ...(entry.tags?.length ? { tags: entry.tags } : {}),
      });
      if (result.status === "stored" || result.status === "updated") {
        await this.removeArchiveLine(s, entry.lineIndex);
        this.emit("memory:restored", { key: entry.key, scope: s });
      }
      const { lineIndex: _lineIndex, ...restored } = entry;
      return { result, restored };
    }
    return null;
  }

  /** Parse one scope's archive file into entries carrying their raw line index. */
  private async parseArchive(scope: MemoryScope): Promise<Array<ArchivedMemory & { lineIndex: number }>> {
    const archivePath = this.getArchivePath(scope);
    let content: string;
    try {
      content = await fs.readFile(archivePath, "utf-8");
    } catch {
      return [];
    }
    const entries: Array<ArchivedMemory & { lineIndex: number }> = [];
    let forgottenAt = "";
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const section = line.match(/^## Forgotten (.+)$/);
      if (section) {
        forgottenAt = section[1]!.trim();
        continue;
      }
      const entry = line.match(
        /^- \*\*(.+?)\*\* \((\w+)(?: \[([^\]]*)\])?, accessed \d+×, age \d+d, retention [\d.]+\): (.*)$/,
      );
      if (!entry) continue;
      const [, entryKey, rawCategory, rawTags, value] = entry;
      if (entryKey === undefined || value === undefined) continue;
      const category: MemoryCategory = (
        ["project", "preferences", "decisions", "patterns", "context", "custom"] as const
      ).includes(rawCategory as MemoryCategory)
        ? (rawCategory as MemoryCategory)
        : "custom";
      const tags = rawTags
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      entries.push({
        key: entryKey,
        value,
        category,
        ...(tags?.length ? { tags } : {}),
        forgottenAt,
        scope,
        lineIndex: i,
      });
    }
    return entries;
  }

  /** Drop one restored line from the archive (and any now-empty section), atomically. */
  private async removeArchiveLine(scope: MemoryScope, lineIndex: number): Promise<void> {
    const archivePath = this.getArchivePath(scope);
    try {
      const lines = (await fs.readFile(archivePath, "utf-8")).split("\n");
      lines.splice(lineIndex, 1);
      // Remove sections left with no entry lines before the next section.
      const cleaned: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (/^## Forgotten /.test(line)) {
          let j = i + 1;
          let hasEntry = false;
          while (j < lines.length && !/^## Forgotten /.test(lines[j]!)) {
            if (lines[j]!.startsWith("- ")) hasEntry = true;
            j++;
          }
          if (!hasEntry) {
            i = j - 1; // skip the empty section (header + blank filler)
            continue;
          }
        }
        cleaned.push(line);
      }
      const tmpPath = `${archivePath}.tmp`;
      await fs.writeFile(tmpPath, cleaned.join("\n"), "utf-8");
      await fs.rename(tmpPath, archivePath);
    } catch (err) {
      logger.warn(
        `[persistent-memory] archive cleanup after restore failed (restore itself succeeded): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Get all memories for a category
   */
  getByCategory(category: MemoryCategory, scope?: "project" | "user"): Memory[] {
    const memories: Memory[] = [];

    if (!scope || scope === "project") {
      for (const memory of this.projectMemories.values()) {
        if (memory.category === category) {
          memories.push(memory);
        }
      }
    }

    if (!scope || scope === "user") {
      for (const memory of this.userMemories.values()) {
        if (memory.category === category) {
          memories.push(memory);
        }
      }
    }

    return memories;
  }

  /**
   * Clear old memories
   */
  async forgetOlderThan(days: number, scope: "project" | "user" = "project"): Promise<number> {
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let count = 0;

    for (const [key, memory] of memories) {
      if (memory.updatedAt < cutoff) {
        memories.delete(key);
        count++;
      }
    }

    if (count > 0) {
      await this.saveMemories(scope);
    }

    return count;
  }

  /**
   * Save memories to file
   */
  private async saveMemories(scope: "project" | "user"): Promise<void> {
    const memories = scope === "project" ? this.projectMemories : this.userMemories;
    const filePath = scope === "project"
      ? this.config.projectMemoryPath
      : this.config.userMemoryPath;

    // Group by category
    const byCategory = new Map<MemoryCategory, Memory[]>();
    for (const memory of memories.values()) {
      const list = byCategory.get(memory.category) || [];
      list.push(memory);
      byCategory.set(memory.category, list);
    }

    // Generate markdown
    let content = `# Code Buddy Memory\n\n`;
    content += `This file stores persistent memory for the Code Buddy agent.\n`;
    content += `It is automatically managed but can be manually edited.\n\n`;

    const categoryNames: Record<MemoryCategory, string> = {
      project: "Project Context",
      preferences: "User Preferences",
      decisions: "Decisions",
      patterns: "Patterns",
      context: "Context",
      custom: "Custom",
    };

    for (const [category, name] of Object.entries(categoryNames)) {
      content += `## ${name}\n`;
      const categoryMemories = byCategory.get(category as MemoryCategory) || [];

      if (categoryMemories.length === 0) {
        content += `<!-- No memories in this category -->\n`;
      } else {
        for (const memory of categoryMemories) {
          content += `- **${memory.key}**: ${memory.value}\n`;
          if (memory.tags && memory.tags.length > 0) {
            content += `  Tags: ${memory.tags.join(", ")}\n`;
          }
          content += `${renderMemoryMeta(memory)}\n`;
        }
      }
      content += `\n`;
    }

    content += `---\n`;
    content += `*Last updated: ${new Date().toISOString()}*\n`;

    try {
      const hooksManager = getHooksManager();
      const results = await hooksManager.executeHooks("before-memory-write", {
        file: filePath,
        content: content,
      });

      let abort = false;
      let modifiedContent = content;

      for (const res of results) {
        if (res.abort) {
          abort = true;
        }
        if (res.modified?.content !== undefined) {
          modifiedContent = res.modified.content;
        }
      }

      if (abort) {
        return;
      }
      content = modifiedContent;
    } catch (_err) {
      // Ignored
    }

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content);
  }

  /**
   * Get context string for system prompt
   */
  getContextForPrompt(): string {
    const snapshot = this.getHermesSnapshotForPrompt();
    if (!snapshot) return "";
    return `--- PERSISTENT MEMORY ---\n${snapshot}\n--- END MEMORY ---\n`;
  }

  getHermesSnapshotForPrompt(): string {
    const sections: string[] = [];
    const projectEntries = this.renderScopeEntries(this.projectMemories);
    const userEntries = this.renderScopeEntries(this.userMemories);

    if (projectEntries) {
      const usage = this.getMemoryUsage('project');
      sections.push(this.renderHermesMemorySection(
        'MEMORY (project notes)',
        usage,
        projectEntries,
      ));
    }

    if (userEntries) {
      const usage = this.getMemoryUsage('user');
      sections.push(this.renderHermesMemorySection(
        'USER (profile and preferences)',
        usage,
        userEntries,
      ));
    }

    return sections.join('\n\n');
  }

  private renderHermesMemorySection(title: string, usage: MemoryUsage, entries: string): string {
    const width = 46;
    const bar = '═'.repeat(width);
    return [
      bar,
      `${title} [${usage.percent}% - ${usage.used}/${usage.limit} chars]`,
      bar,
      entries,
    ].join('\n');
  }

  /**
   * Auto-capture important information from conversation
   */
  async autoCapture(message: string, response: string): Promise<void> {
    if (!this.config.autoCapture) return;

    try {
      const { FactsMemoryService } = await import('./facts-memory.js');
      const service = new FactsMemoryService();

      if (!(await service.isAvailable())) {
        throw new Error("FactsMemoryService is not available (running in tests or offline)");
      }

      // 1. Get current facts from project memories
      const currentProjectFacts: Fact[] = Array.from(this.projectMemories.entries()).map(([key, memory]) => ({
        category: mapMemoryCategoryToFactCategory(memory.category),
        text: `${key}: ${memory.value}`,
        source: memory.tags?.join(', ') || 'persistent-memory',
        updatedAt: memory.updatedAt
      }));

      // 2. Extract facts from the conversation turn
      const extractedFacts = await service.extractFacts(`User: ${message}\nAssistant: ${response}`);
      if (extractedFacts.length === 0) return;

      // 3. Reconcile facts
      const reconciledFacts = await service.reconcileFacts(currentProjectFacts, extractedFacts);

      // 4. Update project memories with reconciled facts (preserving each
      // surviving key's recall-reinforcement metadata).
      const priorProjectMemories = new Map(this.projectMemories);
      this.projectMemories.clear();
      for (const fact of reconciledFacts) {
        let key = `fact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        let value = fact.text;

        const colonIdx = fact.text.indexOf(': ');
        if (colonIdx > 0 && colonIdx < 50) {
          key = fact.text.substring(0, colonIdx).trim();
          value = fact.text.substring(colonIdx + 2).trim();
        }

        const prior = priorProjectMemories.get(key);
        this.projectMemories.set(key, {
          key,
          value,
          category: mapFactCategoryToMemoryCategory(fact.category),
          createdAt: prior?.createdAt || fact.updatedAt || new Date(),
          updatedAt: fact.updatedAt || new Date(),
          ...(prior?.lastAccessedAt ? { lastAccessedAt: prior.lastAccessedAt } : {}),
          accessCount: prior?.accessCount || 0,
          tags: fact.source ? [fact.source] : ['auto-captured']
        });
      }

      await this.saveMemories("project");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[FactsMemory] Failed to autoCapture facts, falling back to pattern matching: ${message}`);
      // Fallback: Detect project context
      const projectPatterns = [
        /this (?:is|project) (?:a|an) ([^.]+)/i,
        /using ([^,.]+ (?:framework|library|stack))/i,
        /the (?:main|entry) (?:file|point) is ([^\s]+)/i,
      ];

      for (const pattern of projectPatterns) {
        const match = message.match(pattern) || response.match(pattern);
        if (match) {
          await this.remember(`auto-${Date.now()}`, match[0], {
            category: "project",
            tags: ["auto-captured"],
          });
        }
      }

      // Detect preferences
      const prefPatterns = [
        /(?:i |we )prefer ([^.]+)/i,
        /(?:always |never )([^.]+)/i,
        /use ([^.]+) (?:style|convention|format)/i,
      ];

      for (const pattern of prefPatterns) {
        const match = message.match(pattern);
        if (match) {
          await this.remember(`pref-${Date.now()}`, match[0], {
            category: "preferences",
            tags: ["auto-captured"],
          });
        }
      }

      // Detect decisions
      const decisionPatterns = [
        /(?:decided|choosing|going with) ([^.]+)/i,
        /(?:will|should) use ([^.]+) (?:for|because)/i,
      ];

      for (const pattern of decisionPatterns) {
        const match = message.match(pattern) || response.match(pattern);
        if (match) {
          await this.remember(`decision-${Date.now()}`, match[0], {
            category: "decisions",
            tags: ["auto-captured"],
          });
        }
      }
    }
  }

  /**
   * Return memories sorted by `updatedAt` descending. Decorates each entry
   * with its scope so callers can render where it lives without re-querying.
   *
   * Powers `/memory recent [N] [scope?]` — the UX surface for the LLM's
   * auto-memory writeback (system-prompt directive shipped 2026-05-03).
   * The Map preserves insertion order, but we must sort by mtime explicitly
   * because manual `/memory remember` and auto-saves from the LLM can
   * arrive out of order.
   */
  getRecentMemories(
    limit = 10,
    scope?: "project" | "user"
  ): Array<Memory & { scope: "project" | "user" }> {
    const all: Array<Memory & { scope: "project" | "user" }> = [];
    if (!scope || scope === "project") {
      for (const m of this.projectMemories.values()) {
        all.push({ ...m, scope: "project" });
      }
    }
    if (!scope || scope === "user") {
      for (const m of this.userMemories.values()) {
        all.push({ ...m, scope: "user" });
      }
    }
    return all
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, Math.max(0, limit));
  }

  /**
   * Format memories for display
   */
  formatMemories(scope?: "project" | "user"): string {
    let output = `\n🧠 Persistent Memory\n${"═".repeat(50)}\n\n`;

    const formatScope = (name: string, memories: Map<string, Memory>, memoryScope: MemoryScope) => {
      const usage = this.getMemoryUsage(memoryScope);
      output += `📁 ${name}\n`;
      output += `   Capacity: ${usage.used}/${usage.limit} chars (${usage.percent}%)\n`;
      if (memories.size === 0) {
        output += `   (empty)\n`;
      } else {
        for (const [key, memory] of memories) {
          output += `   • ${key}: ${memory.value.slice(0, 50)}${memory.value.length > 50 ? "..." : ""}\n`;
          output += `     Category: ${memory.category} | Accessed: ${memory.accessCount}x\n`;
        }
      }
      output += `\n`;
    };

    if (!scope || scope === "project") {
      formatScope("Project Memory", this.projectMemories, 'project');
    }
    if (!scope || scope === "user") {
      formatScope("User Memory", this.userMemories, 'user');
    }

    output += `${"═".repeat(50)}\n`;
    output += `💡 Commands: /remember <key> <value>, /memory replace <key> <value>, /recall <key>, /forget <key>\n`;

    return output;
  }

  getStats(): { project: number; user: number; total: number } {
    return {
      project: this.projectMemories.size,
      user: this.userMemories.size,
      total: this.projectMemories.size + this.userMemories.size,
    };
  }
}

// Default singleton instance (no bot scope) + per-bot instances.
let memoryManagerInstance: PersistentMemoryManager | null = null;
const memoryManagerByBot = new Map<string, PersistentMemoryManager>();

/**
 * Get the memory manager. With no `botId`, returns the global singleton (default
 * — CLI / desktop / server behavior unchanged). With a `botId` (multi-bot
 * channels), returns a per-bot instance whose memory files live under
 * `~/.codebuddy/bots/<botId>/`, so bots never share each other's `remember` facts.
 */
export function getMemoryManager(
  config?: Partial<MemoryConfig>,
  botId?: string,
): PersistentMemoryManager {
  if (!botId) {
    if (!memoryManagerInstance) {
      memoryManagerInstance = new PersistentMemoryManager(config);
    }
    return memoryManagerInstance;
  }
  let inst = memoryManagerByBot.get(botId);
  if (!inst) {
    const botDir = path.join(os.homedir(), '.codebuddy', 'bots', botId);
    inst = new PersistentMemoryManager({
      ...(config ?? {}),
      userMemoryPath: path.join(botDir, 'memory.md'),
      projectMemoryPath: path.join(botDir, 'CODEBUDDY_MEMORY.md'),
    });
    memoryManagerByBot.set(botId, inst);
  }
  return inst;
}

export function resetMemoryManagerForTests(): void {
  memoryManagerInstance = null;
  memoryManagerByBot.clear();
}

export async function initializeMemory(config?: Partial<MemoryConfig>): Promise<PersistentMemoryManager> {
  const manager = getMemoryManager(config);
  await manager.initialize();
  return manager;
}
