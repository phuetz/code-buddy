/**
 * Memory Routes
 *
 * Handles context and memory management API endpoints.
 */

import { Router, Request, Response } from 'express';
import { requireScope, asyncHandler, ApiServerError, validateRequired } from '../middleware/index.js';
import type { MemoryEntry, MemoryStats } from '../types.js';

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

// In-memory storage for API memory entries
// In production, this would be persisted to a database
const memoryStore = new Map<string, MemoryEntry>();

const router = Router();

/**
 * GET /api/memory
 * List all memory entries
 */
router.get(
  '/',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const offsetParam = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;

    let entries = Array.from(memoryStore.values());

    // Filter by category if provided
    if (category) {
      entries = entries.filter((e) => e.category === category);
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // Apply pagination
    const total = entries.length;
    const paginatedEntries = entries.slice(offsetParam, offsetParam + limitParam);

    res.json({
      entries: paginatedEntries,
      total,
      limit: limitParam,
      offset: offsetParam,
    });
  })
);

/**
 * GET /api/memory/:id
 * Get a specific memory entry
 */
router.get(
  '/:id',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const entry = memoryStore.get(id);

    if (!entry) {
      throw ApiServerError.notFound(`Memory entry '${id}'`);
    }

    res.json(entry);
  })
);

/**
 * POST /api/memory
 * Create a new memory entry
 */
router.post(
  '/',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    validateRequired(req.body, ['content']);

    const { content, category, metadata, ttl } = req.body;

    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const entry: MemoryEntry = {
      id,
      content,
      category: category || 'general',
      timestamp: new Date().toISOString(),
      metadata,
      expiresAt: ttl ? new Date(Date.now() + ttl * 1000).toISOString() : undefined,
    };

    memoryStore.set(id, entry);

    res.status(201).json(entry);
  })
);

/**
 * PUT /api/memory/:id
 * Update a memory entry
 */
router.put(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const entry = memoryStore.get(id);

    if (!entry) {
      throw ApiServerError.notFound(`Memory entry '${id}'`);
    }

    const { content, category, metadata } = req.body;

    const updated: MemoryEntry = {
      ...entry,
      content: content ?? entry.content,
      category: category ?? entry.category,
      metadata: metadata ?? entry.metadata,
      timestamp: new Date().toISOString(),
    };

    memoryStore.set(id, updated);

    res.json(updated);
  })
);

/**
 * DELETE /api/memory/:id
 * Delete a memory entry
 */
router.delete(
  '/:id',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    if (!memoryStore.has(id)) {
      throw ApiServerError.notFound(`Memory entry '${id}'`);
    }

    memoryStore.delete(id);

    res.status(204).send();
  })
);

/**
 * GET /api/memory/search
 * Search memory entries
 */
router.get(
  '/search',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;

    if (!query) {
      throw ApiServerError.badRequest('Query parameter is required');
    }

    const queryLower = query.toLowerCase();
    let entries = Array.from(memoryStore.values());

    // Filter by category if provided
    if (category) {
      entries = entries.filter((e) => e.category === category);
    }

    // Search in content
    entries = entries.filter((e) =>
      e.content.toLowerCase().includes(queryLower)
    );

    // Sort by relevance (simple: content starts with query ranks higher)
    entries.sort((a, b) => {
      const aStarts = a.content.toLowerCase().startsWith(queryLower) ? 1 : 0;
      const bStarts = b.content.toLowerCase().startsWith(queryLower) ? 1 : 0;
      return bStarts - aStarts;
    });

    // Apply limit
    entries = entries.slice(0, limitParam);

    res.json({
      results: entries,
      total: entries.length,
      query,
    });
  })
);

/**
 * GET /api/memory/stats
 * Get memory statistics
 */
router.get(
  '/stats',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const entries = Array.from(memoryStore.values());

    // Count by category
    const byCategory = new Map<string, number>();
    for (const entry of entries) {
      const cat = entry.category || 'general';
      byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
    }

    // Calculate total size
    const totalSize = entries.reduce((sum, e) => sum + e.content.length, 0);

    // Count expired entries
    const now = new Date();
    const expired = entries.filter(
      (e) => e.expiresAt && new Date(e.expiresAt) < now
    ).length;

    const stats: MemoryStats = {
      totalEntries: entries.length,
      byCategory: Object.fromEntries(byCategory),
      totalSize,
      expiredEntries: expired,
    };

    res.json(stats);
  })
);

/**
 * POST /api/memory/clear
 * Clear all memory entries (or by category)
 */
router.post(
  '/clear',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { category, expiredOnly } = req.body;

    let clearedCount = 0;

    if (expiredOnly) {
      // Only clear expired entries
      const now = new Date();
      for (const [id, entry] of memoryStore.entries()) {
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
          memoryStore.delete(id);
          clearedCount++;
        }
      }
    } else if (category) {
      // Clear by category
      for (const [id, entry] of memoryStore.entries()) {
        if (entry.category === category) {
          memoryStore.delete(id);
          clearedCount++;
        }
      }
    } else {
      // Clear all
      clearedCount = memoryStore.size;
      memoryStore.clear();
    }

    res.json({
      cleared: clearedCount,
      remaining: memoryStore.size,
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
 * Import memory entries from JSON
 */
router.post(
  '/import',
  requireScope('memory:write'),
  asyncHandler(async (req: Request, res: Response) => {
    const { entries } = req.body;

    if (!Array.isArray(entries)) {
      throw ApiServerError.badRequest('Entries must be an array');
    }

    let imported = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!entry.content) {
        skipped++;
        continue;
      }

      const id = entry.id || `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const memEntry: MemoryEntry = {
        id,
        content: entry.content,
        category: entry.category || 'general',
        timestamp: entry.timestamp || new Date().toISOString(),
        metadata: entry.metadata,
        expiresAt: entry.expiresAt,
      };

      memoryStore.set(id, memEntry);
      imported++;
    }

    res.json({
      imported,
      skipped,
      total: memoryStore.size,
    });
  })
);

/**
 * GET /api/memory/export
 * Export all memory entries
 */
router.get(
  '/export',
  requireScope('memory'),
  asyncHandler(async (req: Request, res: Response) => {
    const entries = Array.from(memoryStore.values());

    res.setHeader('Content-Disposition', 'attachment; filename="memory-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      entries,
    });
  })
);

// Cleanup expired entries periodically
setInterval(() => {
  const now = new Date();
  for (const [id, entry] of memoryStore.entries()) {
    if (entry.expiresAt && new Date(entry.expiresAt) < now) {
      memoryStore.delete(id);
    }
  }
}, 60000); // Every minute

export default router;
