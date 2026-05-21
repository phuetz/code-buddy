/**
 * Code Graph Context Provider
 *
 * Builds per-turn context from the code graph, using multiple sources:
 * 1. Entity names in the user message
 * 2. Recently read/written files
 * 3. Function names from error messages
 * 4. Code review context (dependencies of touched entities)
 *
 * Capped at 800 chars (or 800 for review mode) to avoid token budget bloat.
 * Returns null if no entity is recognized (no noise added).
 */

import { KnowledgeGraph } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';

const MAX_CONTEXT_CHARS = 800;
const MAX_ENTITIES = 2;

/** Entity resolution cache: candidate → resolved entity (or null). TTL: 30s. */
const entityCache = new Map<string, { entity: string | null; ts: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Entity extraction patterns — matches common code references in natural language.
 */
const ENTITY_PATTERNS = [
  // Explicit file paths: src/foo/bar.ts, foo-bar.ts, also .py .go .rs .java
  /(?:^|\s)((?:src\/)?[\w/.-]+\.(?:ts|js|tsx|jsx|py|rs|go|java))\b/gi,
  // PascalCase class/type names (at least 2 segments, e.g. CodeBuddyAgent)
  /\b([A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)+)\b/g,
  // kebab-case module names (agent-executor, knowledge-graph)
  /\b([a-z][a-z0-9]*(?:-[a-z0-9]+){1,5})\b/g,
  // snake_case Python-style (user_service, fetch_from_db)
  /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,5})\b/g,
];

/** Patterns for extracting function names from error/stack traces */
const ERROR_PATTERNS = [
  // at ClassName.methodName (file.ts:123)
  /at\s+(?:(\w+)\.)?(\w+)\s+\(/g,
  // Error in function 'name'
  /(?:error|failed|exception)\s+(?:in|at)\s+['"]?(\w+\.\w+|\w+)['"]?/gi,
  // function_name() threw
  /(\w+(?:\.\w+)?)\(\)\s+(?:threw|failed|errored)/gi,
];

// Ring buffer of recently accessed files
const recentFiles: string[] = [];
const MAX_RECENT_FILES = 5;

/**
 * Clear tracked recent files (for testing).
 */
export function clearRecentFiles(): void {
  recentFiles.length = 0;
  entityCache.clear();
}

/**
 * Notify the context provider that a file was read or written.
 * Called from the agent executor after tool execution.
 */
export function trackRecentFile(filePath: string): void {
  // Normalize path
  const normalized = filePath.replace(/\\/g, '/').replace(/\.[^.]+$/, '');
  // Remove duplicates
  const idx = recentFiles.indexOf(normalized);
  if (idx >= 0) recentFiles.splice(idx, 1);
  // Push to front
  recentFiles.unshift(normalized);
  // Trim
  while (recentFiles.length > MAX_RECENT_FILES) recentFiles.pop();
}

/**
 * Build code graph context for a user message.
 * Uses message entities + recent files + error traces.
 * Returns null if no relevant entity is found.
 */
export function buildCodeGraphContext(
  graph: KnowledgeGraph,
  message: string,
): string | null {
  if (graph.getStats().tripleCount === 0) return null;

  const candidates = extractEntities(message);

  // Add recent file entities (high priority — user was just looking at these)
  for (const file of recentFiles) {
    const entity = graph.findEntity(file);
    if (entity && !candidates.includes(file)) {
      candidates.unshift(file); // Prepend (higher priority)
    }
  }

  // Extract from error messages/stack traces
  const errorEntities = extractErrorEntities(message);
  for (const e of errorEntities) {
    if (!candidates.includes(e)) candidates.push(e);
  }

  if (candidates.length === 0) return null;

  // Resolve all candidates to entities with scores (cached)
  const now = Date.now();
  const resolved: Array<{ candidate: string; entity: string; rank: number }> = [];
  for (const candidate of candidates) {
    let entity: string | null;
    const cached = entityCache.get(candidate);
    if (cached && (now - cached.ts) < CACHE_TTL_MS) {
      entity = cached.entity;
    } else {
      entity = graph.findEntity(candidate);
      entityCache.set(candidate, { entity, ts: now });
    }
    if (entity) {
      const rank = graph.getEntityRank(entity);
      resolved.push({ candidate, entity, rank });
    }
  }

  // Sort by PageRank (most important first), deduplicate by entity
  resolved.sort((a, b) => b.rank - a.rank);
  const seen = new Set<string>();
  const unique = resolved.filter(r => {
    if (seen.has(r.entity)) return false;
    seen.add(r.entity);
    return true;
  });

  // Build structured context for top N entities
  const blocks: string[] = [];
  for (const { candidate, entity } of unique.slice(0, MAX_ENTITIES)) {
    const block = buildStructuredEntityBlock(graph, entity);
    if (block) {
      logger.debug(`CodeGraphContext: matched "${candidate}" → ${entity}`);
      blocks.push(block);
    }
  }

  // Add recent files summary
  if (recentFiles.length > 0) {
    const recentSummary = recentFiles
      .slice(0, 3)
      .map((f, i) => `${f} (${i === 0 ? 'last turn' : `${i + 1} turns ago`})`)
      .join(', ');
    blocks.push(`Recently touched: ${recentSummary}`);
  }

  if (blocks.length > 0) {
    let output = blocks.join('\n\n');
    if (output.length > MAX_CONTEXT_CHARS) {
      output = output.substring(0, MAX_CONTEXT_CHARS - 3) + '...';
    }
    return output;
  }

  // Semantic fallback: if no exact match, try embedding-based search.
  // The index is built lazily in the background; only used if already ready.
  if (unique.length === 0 && candidates.length > 0) {
    const semanticResult = semanticFallbackSync(graph, candidates[0]);
    if (semanticResult) return semanticResult;
  }

  return null;
}

/**
 * Build a structured context block for a single entity.
 * Includes PageRank, community, grouped relations.
 */
function buildStructuredEntityBlock(graph: KnowledgeGraph, entity: string): string | null {
  const rank = graph.getEntityRank(entity);
  const lines: string[] = [];

  // Entity header with rank
  const rankStr = rank > 0 ? ` (PageRank: ${rank.toFixed(2)})` : '';
  lines.push(`Entity: ${entity}${rankStr}`);

  // Grouped outgoing relations (top 5 per predicate)
  const outgoing = graph.query({ subject: entity });
  const outByPred = new Map<string, string[]>();
  for (const t of outgoing) {
    const list = outByPred.get(t.predicate) ?? [];
    list.push(t.object);
    outByPred.set(t.predicate, list);
  }

  // Grouped incoming relations (callers, importers)
  const incoming = graph.query({ object: entity });
  const inByPred = new Map<string, string[]>();
  for (const t of incoming) {
    const list = inByPred.get(t.predicate) ?? [];
    list.push(t.subject);
    inByPred.set(t.predicate, list);
  }

  // Format outgoing: definedIn, hasMethod, imports, calls, etc.
  for (const [pred, targets] of outByPred) {
    const shown = targets.slice(0, 5);
    const more = targets.length > 5 ? ` (+${targets.length - 5})` : '';
    lines.push(`  ${pred}: ${shown.join(', ')}${more}`);
  }

  // Format incoming: called-by, imported-by
  for (const [pred, sources] of inByPred) {
    const shown = sources.slice(0, 5);
    const total = sources.length;
    const more = total > 5 ? ` (+${total - 5})` : '';
    lines.push(`  ${pred}-by: ${shown.join(', ')}${more} (${total} total)`);
  }

  if (lines.length <= 1) return null;
  return lines.join('\n');
}

/**
 * Extract entity name candidates from a message.
 * Returns deduplicated candidates sorted by specificity (longer first).
 * Exported for reuse by workflow-guard, reasoning-middleware, etc.
 */
export function extractEntities(message: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const STOP = new Set([
    'the', 'and', 'for', 'this', 'that', 'with', 'from', 'which',
    'have', 'does', 'what', 'show', 'list', 'find', 'give',
    'code', 'file', 'files', 'class', 'function', 'module',
    'import', 'imports', 'export', 'exports', 'type', 'interface',
    'self', 'none', 'true', 'false', 'null', 'undefined',
    'async', 'await', 'return', 'const', 'string', 'number',
  ]);

  for (const pattern of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      const candidate = match[1];
      if (candidate.length < 3) continue;
      if (STOP.has(candidate.toLowerCase())) continue;

      const key = candidate.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(candidate);
      }
    }
  }

  // Sort by length descending (more specific first)
  results.sort((a, b) => b.length - a.length);

  return results.slice(0, 8);
}

/**
 * Extract function/method names from error messages and stack traces.
 */
function extractErrorEntities(message: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const pattern of ERROR_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      // Take the most specific group
      const name = match[2] || match[1];
      if (name && name.length > 2 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        results.push(name);
      }
    }
  }

  return results.slice(0, 3);
}

// ============================================================================
// Context-Aware Code Review
// ============================================================================

const REVIEW_PATTERNS = [
  /\breview\b/i, /\bcheck\b.*\b(code|change|pr|diff)\b/i,
  /\brefactor\b/i, /\blook\s+at\b/i, /\bwhat.*\bthink\b/i,
  /\bany.*\b(issue|problem|bug)\b/i,
];

/**
 * Build enhanced context for code review scenarios.
 * When the user asks to review code involving recently touched files,
 * automatically inject the dependency subgraph of those files so the LLM
 * understands what depends on the code being reviewed.
 *
 * Returns null if not in a review context or no relevant graph data.
 */
export function buildReviewContext(
  graph: KnowledgeGraph,
  message: string,
): string | null {
  if (graph.getStats().tripleCount === 0) return null;

  // Only activate for review-like messages
  const isReview = REVIEW_PATTERNS.some(p => p.test(message));
  if (!isReview && recentFiles.length === 0) return null;

  // Collect relevant modules from recent files
  const relevantModules: string[] = [];
  for (const file of recentFiles) {
    const entity = graph.findEntity(file);
    if (entity && entity.startsWith('mod:')) {
      relevantModules.push(entity);
    }
  }

  if (relevantModules.length === 0) return null;

  const MAX_REVIEW_CHARS = 800;
  const lines: string[] = ['Code Review Context:'];

  for (const mod of relevantModules.slice(0, 3)) {
    const shortName = mod.replace(/^mod:/, '');

    // Who imports this module?
    const importers = graph.query({ predicate: 'imports', object: mod });
    if (importers.length > 0) {
      const names = importers.slice(0, 5).map(t => t.subject.replace(/^mod:/, ''));
      const more = importers.length > 5 ? ` +${importers.length - 5} more` : '';
      lines.push(`  ${shortName} imported by: ${names.join(', ')}${more}`);
    }

    // Key functions and their callers
    const functions = graph.query({ subject: mod, predicate: 'containsFunction' });
    const highRankFns = functions
      .map(f => ({ fn: f.object, rank: graph.getEntityRank(f.object) }))
      .filter(f => f.rank > 0.05)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 3);

    for (const { fn } of highRankFns) {
      const callers = graph.query({ predicate: 'calls', object: fn });
      if (callers.length > 0) {
        const callerNames = callers.slice(0, 4).map(t => t.subject);
        const more = callers.length > 4 ? ` +${callers.length - 4}` : '';
        lines.push(`  ${fn} called by: ${callerNames.join(', ')}${more}`);
      }
    }
  }

  if (lines.length <= 1) return null;

  let output = lines.join('\n');
  if (output.length > MAX_REVIEW_CHARS) {
    output = output.substring(0, MAX_REVIEW_CHARS - 3) + '...';
  }

  logger.debug(`CodeGraphContext: review context for ${relevantModules.length} modules`);
  return output;
}

// ============================================================================
// Semantic Embedding Fallback
// ============================================================================

import type { GraphEmbeddingIndex } from './graph-embeddings.js';

/** Cached embedding index — built lazily in background */
let _embeddingIndex: GraphEmbeddingIndex | null = null;
let _embeddingIndexBuilding = false;

/**
 * Warm up the embedding index in background.
 * Called once when the context provider is first wired in.
 * Non-blocking: if it fails, exact-match-only mode continues.
 */
export function warmEmbeddingIndex(graph: KnowledgeGraph): void {
  if (
    process.env.CODEBUDDY_HEADLESS === 'true' ||
    process.env.CODEBUDDY_DISABLE_BACKGROUND_EMBEDDINGS === 'true'
  ) {
    return;
  }
  if (_embeddingIndex || _embeddingIndexBuilding) return;
  if (graph.getStats().tripleCount < 10) return; // too small to be useful

  _embeddingIndexBuilding = true;
  import('./graph-embeddings.js')
    .then(({ createGraphEmbeddingIndex }) => {
      const index = createGraphEmbeddingIndex(graph, {
        maxEntities: 500,
        entityPrefix: 'mod:',
      });
      return index.rebuild().then(() => {
        if (index.isReady()) {
          _embeddingIndex = index;
          logger.debug('CodeGraphContext: embedding index warmed up');
        }
        _embeddingIndexBuilding = false;
      });
    })
    .catch(() => {
      _embeddingIndexBuilding = false;
    });
}

/**
 * Synchronous semantic fallback — uses the pre-built embedding index.
 * Returns null if index not ready (non-blocking).
 */
function semanticFallbackSync(graph: KnowledgeGraph, query: string): string | null {
  if (!_embeddingIndex || !_embeddingIndex.isReady()) {
    // Trigger background build on first miss
    warmEmbeddingIndex(graph);
    return null;
  }

  // The index is ready — do a sync-compatible search.
  // Since EmbeddingProvider.embed() is async, we can't truly search synchronously.
  // Instead, we use a heuristic: search for the query string in the entity text map
  // that was used to build embeddings. This gives us substring-level semantic matching
  // without an async call.
  //
  // For true embedding search, the caller should use the code_graph tool's
  // semantic_search operation (which is async).
  const queryLower = query.toLowerCase().replace(/[-_]/g, ' ');

  // Search through graph entities with a text-matching heuristic
  const allTriples = graph.toJSON();
  const entitySet = new Set<string>();
  for (const t of allTriples) {
    if (t.subject.startsWith('mod:')) entitySet.add(t.subject);
  }

  let bestEntity: string | null = null;
  let bestScore = 0;

  for (const entity of entitySet) {
    const entityText = entity.replace(/^mod:/, '').toLowerCase().replace(/[/\-_]/g, ' ');
    // Score: substring match on path segments
    const queryWords = queryLower.split(/\s+/);
    let score = 0;
    for (const word of queryWords) {
      if (word.length < 3) continue;
      if (entityText.includes(word)) score += word.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestEntity = entity;
    }
  }

  if (bestEntity && bestScore >= 3) {
    const egoGraph = graph.formatEgoGraph(bestEntity, 1, MAX_CONTEXT_CHARS);
    if (egoGraph) {
      logger.debug(`CodeGraphContext: semantic fallback matched "${query}" → ${bestEntity}`);
      return egoGraph;
    }
  }

  return null;
}
