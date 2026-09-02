/**
 * Memory Routes
 *
 * Handles context and memory management API endpoints.
 *
 * Backed by the REAL persistent memory store (`PersistentMemoryManager` —
 * `.codebuddy/CODEBUDDY_MEMORY.md` + `~/.codebuddy/memory.md`), the same
 * store the agent, `/memory` slash command and auto-writeback use. This
 * route previously operated on an ephemeral in-process Map that was
 * disconnected from every real store.
 *
 * Id semantics: the REST id IS the memory key (URL-encoded in paths). An
 * optional `?scope=project|user` narrows lookups; without it, project is
 * checked first, then user (recall() precedence). TTLs are not supported —
 * retention is governed by the Ebbinghaus forgetting curve
 * (CODEBUDDY_MEMORY_FORGET).
 */

import { Router, Request, Response } from 'express';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type {
  Memory,
  MemoryCategory,
  MemoryScope,
  PersistentMemoryManager,
} from '../../memory/persistent-memory.js';
import type { MemoryStats } from '../types.js';

// Context manager interface for server routes
interface ContextManagerAPI {
  getStats?(): {
    currentTokens?: number;
    maxTokens?: number;
    utilization?: number;
    compressionEnabled?: boolean;
    lastCompression?: string;
  };
  getContextWindow?(): unknown[];
  compress?(): Promise<void>;
}

// Lazy load the context manager
let contextManagerInstance: ContextManagerAPI | null = null;
async function getContextManager(): Promise<ContextManagerAPI> {
  if (!contextManagerInstance) {
    const { ContextManagerV3 } = await import('../../context/context-manager-v3.js');
    contextManagerInstance = new ContextManagerV3() as unknown as ContextManagerAPI;
  }
  return contextManagerInstance!;
}

// The real persistent store, initialized once per manager instance. A WeakSet
// (not a boolean) so resetMemoryManagerForTests() → new instance is
// re-initialized instead of silently served uninitialized.
const initializedManagers = new WeakSet<PersistentMemoryManager>();
async function getStore(): Promise<PersistentMemoryManager> {
  const { getMemoryManager } = await import('../../memory/persistent-memory.js');
  const manager = getMemoryManager();
  if (!initializedManagers.has(manager)) {
    await manager.initialize();
    initializedManagers.add(manager);
  }
  return manager;
}

const VALID_CATEGORIES: MemoryCategory[] = ['project', 'preferences', 'decisions', 'patterns', 'context', 'custom'];

function coerceCategory(raw: unknown): MemoryCategory {
  return typeof raw === 'string' && (VALID_CATEGORIES as string[]).includes(raw) ? (raw as MemoryCategory) : 'custom';
}

function parseScope(raw: unknown): MemoryScope | undefined {
  return raw === 'project' || raw === 'user' ? raw : undefined;
}

/** REST shape: `id` is the memory key; `content` mirrors the stored value. */
function toRestEntry(memory: Memory & { scope: MemoryScope }): Record<string, unknown> {
  return {
    id: memory.key,
    key: memory.key,
    content: memory.value,
    category: memory.category,
    scope: memory.scope,
    tags: memory.tags,
    timestamp: memory.updatedAt.toISOString(),
    createdAt: memory.createdAt.toISOString(),
    accessCount: memory.accessCount,
  };
}

/** All entries, newest first (non-reinforcing). */
function allEntries(store: PersistentMemoryManager, scope?: MemoryScope): Array<Memory & { scope: MemoryScope }> {
  return store.getRecentMemories(Number.MAX_SAFE_INTEGER, scope);
}

/** Translate a store write rejection (char budget / security scan) to a 400. */
async function rejectOn400<T>(work: () => Promise<T>): Promise<T> {
  const { MemoryPersistenceError, MemoryWriteRejectedError } = await import('../../memory/persistent-memory.js');
  try {
    return await work();
  } catch (err) {
    if (err instanceof MemoryWriteRejectedError) {
      throw ApiServerError.badRequest(err.message);
    }
    if (err instanceof MemoryPersistenceError) {
      throw ApiServerError.serviceUnavailable(err.message);
    }
    throw err;
  }
}

const router = Router();

/**
 * GET /api/memory
 * List memory entries (newest first) from the persistent store.
 */
router.get(
  '/',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const scope = parseScope(req.query.scope);
    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const offsetParam = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;

    const store = await getStore();
    let entries = allEntries(store, scope);
    if (category) entries = entries.filter((e) => e.category === category);

    const total = entries.length;
    const paginated = entries.slice(offsetParam, offsetParam + limitParam);

    res.json({
      entries: paginated.map(toRestEntry),
      total,
      limit: limitParam,
      offset: offsetParam,
    });
  })
);

/**
 * POST /api/memory
 * Create a memory entry in the persistent store. The optional `key` becomes
 * the entry id; without one, a `mem_<ts>_<rand>` key is generated. A write
 * whose key+content already exist returns 409; char-budget/security-scan
 * rejections return 400. `ttl` is not supported (Ebbinghaus decay governs
 * retention) and is reported back as ignored.
 */
router.post(
  '/',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    validateRequired(req.body, ['content']);
    const { content, key, category, scope, tags, ttl } = req.body as Record<string, unknown>;

    const entryKey =
      typeof key === 'string' && key.trim()
        ? key.trim()
        : `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const entryScope = parseScope(scope) ?? 'project';

    const store = await getStore();
    const result = await rejectOn400(() =>
      store.remember(entryKey, String(content), {
        scope: entryScope,
        category: coerceCategory(category),
        ...(Array.isArray(tags) ? { tags: tags.map(String) } : {}),
      })
    );
    if (result.status === 'duplicate') {
      throw new ApiServerError(`Memory entry '${result.key}' already exists with identical content`, 'CONFLICT', 409);
    }

    // Re-read by the result key — the store may reconcile writes (facts service).
    const stored = store.get(result.key, entryScope);
    res.status(201).json({
      ...(stored
        ? toRestEntry(stored)
        : { id: result.key, key: result.key, content: String(content), category: result.category, scope: entryScope }),
      ...(ttl !== undefined
        ? { warning: 'ttl is not supported; retention is governed by the forgetting curve (CODEBUDDY_MEMORY_FORGET)' }
        : {}),
    });
  })
);

// ── Static routes (must come before /:id to avoid shadowing) ──────────

/**
 * GET /api/memory/search
 * Keyword search over keys and values (non-reinforcing).
 */
router.get(
  '/search',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const scope = parseScope(req.query.scope);
    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

    if (!query) {
      throw ApiServerError.badRequest('Query parameter is required');
    }

    const queryLower = query.toLowerCase();
    const store = await getStore();
    let entries = allEntries(store, scope);
    if (category) entries = entries.filter((e) => e.category === category);
    entries = entries.filter(
      (e) => e.value.toLowerCase().includes(queryLower) || e.key.toLowerCase().includes(queryLower)
    );
    // Content starting with the query ranks higher (kept from the old route).
    entries.sort((a, b) => {
      const aStarts = a.value.toLowerCase().startsWith(queryLower) ? 1 : 0;
      const bStarts = b.value.toLowerCase().startsWith(queryLower) ? 1 : 0;
      return bStarts - aStarts;
    });
    entries = entries.slice(0, limitParam);

    res.json({
      results: entries.map(toRestEntry),
      total: entries.length,
      query,
    });
  })
);

/**
 * GET /api/memory/stats
 * Statistics from the persistent store.
 */
router.get(
  '/stats',
  requireScope('memory'),
  asyncHandler(async (_req: Request, res: Response) => {
    const store = await getStore();
    const entries = allEntries(store);

    const byCategory = new Map<string, number>();
    for (const entry of entries) {
      byCategory.set(entry.category, (byCategory.get(entry.category) || 0) + 1);
    }

    const stats: MemoryStats = {
      totalEntries: entries.length,
      byCategory: Object.fromEntries(byCategory),
      totalSize: entries.reduce((sum, e) => sum + e.value.length, 0),
      // TTLs don't exist on the persistent store; decay is Ebbinghaus-based.
      expiredEntries: 0,
    };

    res.json(stats);
  })
);

/**
 * POST /api/memory/clear
 * Clear entries — all, by category, by scope, or older than N days
 * (`olderThanDays`, mapped to the store's forgetOlderThan).
 */
router.post(
  '/clear',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, scope: rawScope, olderThanDays, expiredOnly } = (req.body ?? {}) as Record<string, unknown>;
    if (expiredOnly) {
      throw ApiServerError.badRequest(
        'expiredOnly is not supported: the persistent store has no TTLs (retention is Ebbinghaus-based). Use olderThanDays.'
      );
    }
    const scope = parseScope(rawScope);
    const store = await getStore();

    let cleared = 0;
    if (typeof olderThanDays === 'number' && olderThanDays > 0) {
      for (const s of scope ? [scope] : (['project', 'user'] as MemoryScope[])) {
        cleared += await store.forgetOlderThan(olderThanDays, s);
      }
    } else {
      const targets = allEntries(store, scope).filter((e) => !category || e.category === category);
      for (const entry of targets) {
        if (await store.forget(entry.key, entry.scope)) cleared++;
      }
    }

    res.json({
      cleared,
      remaining: allEntries(store).length,
    });
  })
);

/**
 * GET /api/memory/context
 * Get current context window info
 */
router.get(
  '/context',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const contextManager = await getContextManager();

    const stats = contextManager.getStats?.() || {};
    const contextWindow = contextManager.getContextWindow?.() || [];

    res.json({
      currentTokens: stats.currentTokens || 0,
      maxTokens: stats.maxTokens || 0,
      utilization: stats.utilization || 0,
      messageCount: contextWindow.length,
      compressionEnabled: stats.compressionEnabled || false,
      lastCompression: stats.lastCompression,
    });
  })
);

/**
 * POST /api/memory/context/compress
 * Trigger context compression
 */
router.post(
  '/context/compress',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const contextManager = await getContextManager();

    if (!contextManager.compress) {
      throw ApiServerError.badRequest('Context compression not available');
    }

    const beforeSize = contextManager.getStats?.().currentTokens || 0;
    await contextManager.compress();
    const afterSize = contextManager.getStats?.().currentTokens || 0;

    res.json({
      beforeTokens: beforeSize,
      afterTokens: afterSize,
      tokensReclaimed: beforeSize - afterSize,
      compressionRatio: beforeSize > 0 ? ((beforeSize - afterSize) / beforeSize * 100).toFixed(2) + '%' : '0%',
    });
  })
);

/**
 * POST /api/memory/import
 * Import memory entries into the persistent store.
 */
router.post(
  '/import',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { entries } = req.body as { entries?: unknown };

    if (!Array.isArray(entries)) {
      throw ApiServerError.badRequest('Entries must be an array');
    }
    if (entries.length > 1000) {
      throw ApiServerError.badRequest('Maximum 1000 entries per import');
    }

    const store = await getStore();
    let imported = 0;
    let skipped = 0;

    for (const raw of entries) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const content = entry.content;
      if (typeof content !== 'string' || !content.trim() || content.length > 100_000) {
        skipped++;
        continue;
      }
      const entryKey =
        (typeof entry.id === 'string' && entry.id.trim()) ||
        (typeof entry.key === 'string' && entry.key.trim()) ||
        `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      try {
        const result = await store.remember(entryKey, content, {
          scope: parseScope(entry.scope) ?? 'project',
          category: coerceCategory(entry.category),
        });
        if (result.status === 'duplicate') skipped++;
        else imported++;
      } catch {
        skipped++; // char budget / security scan rejection — never aborts the batch
      }
    }

    res.json({
      imported,
      skipped,
      total: allEntries(store).length,
    });
  })
);

/**
 * GET /api/memory/export
 * Export all persistent memory entries.
 */
router.get(
  '/export',
  requireScope('memory'),
  asyncHandler(async (_req: Request, res: Response) => {
    const store = await getStore();
    res.setHeader('Content-Disposition', 'attachment; filename="memory-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      entries: allEntries(store).map(toRestEntry),
    });
  })
);

// ── Dynamic routes (must come after static routes) ────────────────────

/**
 * GET /api/memory/:id
 * Get one entry by key (URL-encoded). Non-reinforcing read.
 */
router.get(
  '/:id',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.id as string;
    const store = await getStore();
    const entry = store.get(key, parseScope(req.query.scope));
    if (!entry) {
      throw ApiServerError.notFound(`Memory entry '${key}'`);
    }
    res.json(toRestEntry(entry));
  })
);

/**
 * PUT /api/memory/:id
 * Update an entry by key (content and/or category/tags).
 */
router.put(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.id as string;
    const { content, category, tags } = (req.body ?? {}) as Record<string, unknown>;

    const store = await getStore();
    const existing = store.get(key, parseScope(req.query.scope));
    if (!existing) {
      throw ApiServerError.notFound(`Memory entry '${key}'`);
    }

    await rejectOn400(() =>
      store.replace(key, typeof content === 'string' ? content : existing.value, {
        scope: existing.scope,
        ...(category !== undefined ? { category: coerceCategory(category) } : {}),
        ...(Array.isArray(tags) ? { tags: tags.map(String) } : {}),
      })
    );

    const updated = store.get(key, existing.scope);
    res.json(updated ? toRestEntry(updated) : { id: key, key });
  })
);

/**
 * DELETE /api/memory/:id
 * Delete an entry by key.
 */
router.delete(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const key = req.params.id as string;
    const store = await getStore();
    const existing = store.get(key, parseScope(req.query.scope));
    if (!existing) {
      throw ApiServerError.notFound(`Memory entry '${key}'`);
    }
    await store.forget(key, existing.scope);
    res.status(204).send();
  })
);

export default router;
