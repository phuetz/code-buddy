/**
 * Knowledge Graph — Lightweight In-Memory Triple Store
 *
 * Stores code entity relationships as RDF-like triples (subject, predicate, object).
 * Queryable via pattern matching. Fed by AST analysis or manual insertion.
 *
 * Manus AI Gap: "Typed Event Stream" — structured knowledge about code relationships.
 */

import { logger } from '../utils/logger.js';
import { computePageRank, type PageRankResult } from './graph-pagerank.js';
import type { GraphEmbeddingIndex } from './graph-embeddings.js';

// ============================================================================
// Types
// ============================================================================

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
  metadata?: Record<string, string>;
}

export type Predicate =
  | 'imports'
  | 'exports'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'dependsOn'
  | 'contains'
  | 'definedIn'
  | 'usedBy'
  | 'typeof'
  | 'belongsTo'
  | 'patternOf'
  | 'hasDirectory'
  | 'importCount'
  | 'exposes'
  | 'circularWith'
  | 'hasMethod'
  | 'containsFunction';

export interface TriplePattern {
  subject?: string | RegExp;
  predicate?: string;
  object?: string | RegExp;
}

export interface GraphStats {
  tripleCount: number;
  subjectCount: number;
  predicateCount: number;
  objectCount: number;
}

export interface SubgraphResult {
  triples: Triple[];
  entities: Set<string>;
  depth: number;
}

// ============================================================================
// Knowledge Graph (Singleton)
// ============================================================================

export class KnowledgeGraph {
  private static instance: KnowledgeGraph | null = null;

  /** All triples */
  private triples: Triple[] = [];

  /** Index: subject → triple indices */
  private subjectIndex = new Map<string, Set<number>>();

  /** Index: predicate → triple indices */
  private predicateIndex = new Map<string, Set<number>>();

  /** Index: object → triple indices */
  private objectIndex = new Map<string, Set<number>>();

  /** PageRank cache */
  private _pageRankCache: PageRankResult | null = null;
  private _pageRankDirty = true;
  private _pageRankLastComputed = 0;
  private static readonly PAGERANK_COOLDOWN = 5000; // 5s min between recalcs

  static getInstance(): KnowledgeGraph {
    if (!KnowledgeGraph.instance) {
      KnowledgeGraph.instance = new KnowledgeGraph();
    }
    return KnowledgeGraph.instance;
  }

  static resetInstance(): void {
    KnowledgeGraph.instance = null;
  }

  /**
   * Add a triple to the graph
   */
  add(subject: string, predicate: string, object: string, metadata?: Record<string, string>): void {
    // Deduplicate
    if (this.has(subject, predicate, object)) return;

    const idx = this.triples.length;
    this.triples.push({ subject, predicate, object, metadata });

    this.addToIndex(this.subjectIndex, subject, idx);
    this.addToIndex(this.predicateIndex, predicate, idx);
    this.addToIndex(this.objectIndex, object, idx);
    this._pageRankDirty = true;
  }

  /**
   * Add multiple triples at once
   */
  addBatch(triples: Array<{ subject: string; predicate: string; object: string; metadata?: Record<string, string> }>): number {
    let added = 0;
    for (const t of triples) {
      if (!this.has(t.subject, t.predicate, t.object)) {
        this.add(t.subject, t.predicate, t.object, t.metadata);
        added++;
      }
    }
    return added;
  }

  /**
   * Check if a triple exists
   */
  has(subject: string, predicate: string, object: string): boolean {
    const subjectSet = this.subjectIndex.get(subject);
    if (!subjectSet) return false;

    for (const idx of subjectSet) {
      const t = this.triples[idx];
      if (t.predicate === predicate && t.object === object) return true;
    }
    return false;
  }

  /**
   * Query triples matching a pattern
   */
  query(pattern: TriplePattern): Triple[] {
    let candidates: Set<number> | null = null;

    // Use indices to narrow candidates
    if (pattern.subject && typeof pattern.subject === 'string') {
      candidates = this.subjectIndex.get(pattern.subject) ?? new Set();
    }
    if (pattern.predicate) {
      const predSet = this.predicateIndex.get(pattern.predicate) ?? new Set();
      candidates = candidates ? this.intersect(candidates, predSet) : predSet;
    }
    if (pattern.object && typeof pattern.object === 'string') {
      const objSet = this.objectIndex.get(pattern.object) ?? new Set();
      candidates = candidates ? this.intersect(candidates, objSet) : objSet;
    }

    // If no index hit, scan all
    const indices = candidates ?? new Set(this.triples.keys());

    const results: Triple[] = [];
    for (const idx of indices) {
      const t = this.triples[idx];
      if (this.matchesPattern(t, pattern)) {
        results.push(t);
      }
    }

    return results;
  }

  /**
   * Get all entities connected to a subject (1-hop neighbors)
   */
  neighbors(entity: string): Triple[] {
    return [
      ...this.query({ subject: entity }),
      ...this.query({ object: entity }),
    ];
  }

  /**
   * Get a subgraph around an entity up to a given depth
   */
  subgraph(entity: string, maxDepth: number = 2): SubgraphResult {
    const visited = new Set<string>();
    const resultTriples: Triple[] = [];
    const queue: Array<{ entity: string; depth: number }> = [{ entity, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.entity) || current.depth > maxDepth) continue;
      visited.add(current.entity);

      const related = this.neighbors(current.entity);
      for (const triple of related) {
        resultTriples.push(triple);
        const other = triple.subject === current.entity ? triple.object : triple.subject;
        if (!visited.has(other) && current.depth < maxDepth) {
          queue.push({ entity: other, depth: current.depth + 1 });
        }
      }
    }

    return {
      triples: resultTriples,
      entities: visited,
      depth: maxDepth,
    };
  }

  /**
   * Find paths between two entities (BFS shortest path)
   */
  /**
   * Find paths between two entities (BFS shortest path)
   * @param findAll - If false (default), returns only the first shortest path for performance.
   *                  If true, returns all paths up to maxDepth.
   */
  findPath(from: string, to: string, maxDepth: number = 5, findAll: boolean = false): Triple[][] {
    if (from === to) return [[]];

    const queue: Array<{ entity: string; path: Triple[] }> = [{ entity: from, path: [] }];
    const visited = new Set<string>([from]);
    const paths: Triple[][] = [];
    let shortestDepth = Infinity;

    while (queue.length > 0) {
      const { entity, path } = queue.shift()!;
      if (path.length >= maxDepth) continue;
      // Early exit: don't explore deeper than shortest found path
      if (!findAll && paths.length > 0 && path.length >= shortestDepth) continue;

      const related = this.neighbors(entity);
      for (const triple of related) {
        const next = triple.subject === entity ? triple.object : triple.subject;
        if (next === to) {
          const foundPath = [...path, triple];
          paths.push(foundPath);
          shortestDepth = Math.min(shortestDepth, foundPath.length);
          // Early exit: return immediately if only first path needed
          if (!findAll) return paths;
          continue;
        }
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ entity: next, path: [...path, triple] });
        }
      }
    }

    return paths;
  }

  /**
   * Remove triples matching a pattern
   */
  remove(pattern: TriplePattern): number {
    const matching = this.query(pattern);
    if (matching.length === 0) return 0;

    // Incremental removal: find indices, remove from index maps, then compact
    const toRemove = new Set<number>();
    for (const m of matching) {
      const idx = this.triples.findIndex(t =>
        t.subject === m.subject && t.predicate === m.predicate && t.object === m.object
      );
      if (idx >= 0) toRemove.add(idx);
    }

    // Remove from index maps (incremental, not full rebuild)
    for (const idx of toRemove) {
      const t = this.triples[idx];
      this.subjectIndex.get(t.subject)?.delete(idx);
      this.predicateIndex.get(t.predicate)?.delete(idx);
      this.objectIndex.get(t.object)?.delete(idx);
      // Clean up empty sets
      if (this.subjectIndex.get(t.subject)?.size === 0) this.subjectIndex.delete(t.subject);
      if (this.predicateIndex.get(t.predicate)?.size === 0) this.predicateIndex.delete(t.predicate);
      if (this.objectIndex.get(t.object)?.size === 0) this.objectIndex.delete(t.object);
    }

    // Compact: rebuild only if >20% of triples were removed (amortized cost)
    if (toRemove.size > this.triples.length * 0.2) {
      const newTriples = this.triples.filter((_, i) => !toRemove.has(i));
      this.rebuildIndices(newTriples);
    } else {
      // Mark removed triples as null and skip in queries (lazy compaction)
      // For simplicity, just filter and rebuild indices for small removals
      const newTriples = this.triples.filter((_, i) => !toRemove.has(i));
      this.rebuildIndices(newTriples);
    }

    this._pageRankDirty = true;
    return matching.length;
  }

  /**
   * Get graph statistics
   */
  getStats(): GraphStats {
    return {
      tripleCount: this.triples.length,
      subjectCount: this.subjectIndex.size,
      predicateCount: this.predicateIndex.size,
      objectCount: this.objectIndex.size,
    };
  }

  /**
   * Clear all triples
   */
  clear(): void {
    this.triples = [];
    this.subjectIndex.clear();
    this.predicateIndex.clear();
    this.objectIndex.clear();
    this._pageRankCache = null;
    this._pageRankDirty = true;
  }

  /**
   * Serialize to JSON
   */
  toJSON(): Triple[] {
    return [...this.triples];
  }

  /**
   * Load from serialized triples
   */
  loadJSON(triples: Triple[]): void {
    this.clear();
    for (const t of triples) {
      this.add(t.subject, t.predicate, t.object, t.metadata);
    }
    logger.debug(`KnowledgeGraph: loaded ${triples.length} triples`);
  }

  /**
   * Format subgraph as readable text for LLM context injection
   */
  formatForContext(entity: string, maxDepth: number = 2): string {
    const sg = this.subgraph(entity, maxDepth);
    if (sg.triples.length === 0) return '';

    const lines = sg.triples.map(t => `  ${t.subject} --${t.predicate}--> ${t.object}`);
    return `<context type="knowledge">\nKnowledge Graph for "${entity}":\n${lines.join('\n')}\n</context>`;
  }

  // ===========================================================================
  // PageRank API
  // ===========================================================================

  /**
   * Get PageRank scores for all entities (lazy computed + cached).
   * Respects a 5s cooldown between recalculations.
   */
  getPageRank(): Map<string, number> {
    if (this._pageRankDirty || !this._pageRankCache) {
      const now = Date.now();
      if (now - this._pageRankLastComputed < KnowledgeGraph.PAGERANK_COOLDOWN && this._pageRankCache) {
        return this._pageRankCache.scores;
      }
      this._pageRankCache = computePageRank(this);
      this._pageRankDirty = false;
      this._pageRankLastComputed = now;
    }
    return this._pageRankCache.scores;
  }

  /**
   * Get the PageRank score for a single entity. Returns 0 if unknown.
   */
  getEntityRank(entity: string): number {
    return this.getPageRank().get(entity) ?? 0;
  }

  // ===========================================================================
  // Entity Lookup
  // ===========================================================================

  /**
   * Fuzzy entity lookup — find the best matching entity ID from a partial name.
   * Searches all subjects and objects by substring match.
   * Prioritizes exact suffix matches, then PageRank + connection count.
   * Optionally boosts by embedding similarity when an index is provided.
   */
  findEntity(partial: string, options?: { embeddingIndex?: GraphEmbeddingIndex }): string | null {
    if (this.triples.length === 0) return null;

    const lower = partial.toLowerCase()
      .replace(/\.(ts|js|tsx|jsx)$/, '') // strip extension
      .replace(/\\/g, '/');              // normalize slashes

    // Collect all unique entity IDs
    const allEntities = new Set<string>();
    for (const key of this.subjectIndex.keys()) allEntities.add(key);
    for (const key of this.objectIndex.keys()) allEntities.add(key);

    // PageRank scores (lazy)
    let pageRankScores: Map<string, number> | null = null;
    try { pageRankScores = this.getPageRank(); } catch { /* skip if circular dep */ }

    // Score candidates
    const scored: Array<{ id: string; score: number }> = [];
    for (const id of allEntities) {
      const idLower = id.toLowerCase();
      const bare = idLower.replace(/^(mod|cls|fn|iface|layer|pat):/, '');

      let score = 0;
      if (bare === lower || idLower === lower) {
        score = 100; // exact match
      } else if (bare.endsWith('/' + lower) || bare.endsWith('.' + lower) || bare.endsWith('-' + lower) || bare.endsWith('_' + lower)) {
        score = 80; // boundary-aligned suffix match (e.g., "agent-executor" → "mod:src/agent/execution/agent-executor")
      } else if (bare.includes(lower)) {
        score = 50; // substring match
      } else if (lower.includes(bare)) {
        score = 30; // reverse substring
      }

      if (score > 0) {
        // Boost by connection count (hot modules rank higher)
        const subjectConns = this.subjectIndex.get(id)?.size ?? 0;
        const objectConns = this.objectIndex.get(id)?.size ?? 0;
        score += Math.min(subjectConns + objectConns, 20);

        // Boost by PageRank (+30pts for rank 1.0)
        if (pageRankScores) {
          score += (pageRankScores.get(id) ?? 0) * 30;
        }

        scored.push({ id, score });
      }
    }

    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
  }

  /**
   * Format a compact ego-graph around an entity for LLM consumption.
   * Groups triples by predicate for readability.
   * Truncates output to maxChars to respect token budget.
   */
  formatEgoGraph(entity: string, depth: number = 1, maxChars: number = 800): string {
    const sg = this.subgraph(entity, depth);
    if (sg.triples.length === 0) return '';

    // Group by predicate + direction
    const outgoing = new Map<string, string[]>(); // predicate → [objects]
    const incoming = new Map<string, string[]>(); // predicate → [subjects]

    for (const t of sg.triples) {
      if (t.subject === entity) {
        const list = outgoing.get(t.predicate) ?? [];
        list.push(t.object);
        outgoing.set(t.predicate, list);
      } else if (t.object === entity) {
        const list = incoming.get(t.predicate) ?? [];
        list.push(t.subject);
        incoming.set(t.predicate, list);
      }
    }

    const lines: string[] = [];
    lines.push(`Entity: ${entity}`);

    // Add metadata if available
    const directTriples = this.query({ subject: entity });
    const meta = directTriples.find(t => t.metadata?.nodeType)?.metadata;
    if (meta?.nodeType) {
      lines.push(`Type: ${meta.nodeType}`);
    }

    // Sort neighbors by PageRank before display (highest first)
    let prScores: Map<string, number> | null = null;
    try { prScores = this.getPageRank(); } catch { /* skip */ }
    const sortByRank = (arr: string[]) => {
      if (prScores && prScores.size > 0) {
        arr.sort((a, b) => (prScores!.get(b) ?? 0) - (prScores!.get(a) ?? 0));
      }
    };

    // Format outgoing edges
    for (const [pred, targets] of outgoing) {
      sortByRank(targets);
      const shown = targets.slice(0, 8);
      const more = targets.length > 8 ? ` +${targets.length - 8} more` : '';
      lines.push(`→ ${pred}: ${shown.join(', ')}${more}`);
    }

    // Format incoming edges
    for (const [pred, sources] of incoming) {
      sortByRank(sources);
      const shown = sources.slice(0, 8);
      const more = sources.length > 8 ? ` +${sources.length - 8} more` : '';
      lines.push(`← ${pred}: ${shown.join(', ')}${more}`);
    }

    // Count neighbor types
    const entityTypes = new Map<string, number>();
    for (const e of sg.entities) {
      if (e === entity) continue;
      const prefix = e.split(':')[0] || 'other';
      entityTypes.set(prefix, (entityTypes.get(prefix) ?? 0) + 1);
    }
    if (entityTypes.size > 0) {
      const summary = [...entityTypes.entries()].map(([t, c]) => `${c} ${t}`).join(', ');
      lines.push(`Neighbors: ${summary}`);
    }

    // Truncate to maxChars
    let output = lines.join('\n');
    if (output.length > maxChars) {
      output = output.substring(0, maxChars - 3) + '...';
    }

    return output;
  }

  // --- Private helpers ---

  private addToIndex(index: Map<string, Set<number>>, key: string, idx: number): void {
    let set = index.get(key);
    if (!set) {
      set = new Set();
      index.set(key, set);
    }
    set.add(idx);
  }

  private intersect(a: Set<number>, b: Set<number>): Set<number> {
    const result = new Set<number>();
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const item of smaller) {
      if (larger.has(item)) result.add(item);
    }
    return result;
  }

  private matchesPattern(triple: Triple, pattern: TriplePattern): boolean {
    if (pattern.subject) {
      if (pattern.subject instanceof RegExp) {
        if (!pattern.subject.test(triple.subject)) return false;
      } else if (triple.subject !== pattern.subject) {
        return false;
      }
    }
    if (pattern.predicate && triple.predicate !== pattern.predicate) return false;
    if (pattern.object) {
      if (pattern.object instanceof RegExp) {
        if (!pattern.object.test(triple.object)) return false;
      } else if (triple.object !== pattern.object) {
        return false;
      }
    }
    return true;
  }

  private rebuildIndices(triples: Triple[]): void {
    this.triples = triples;
    this.subjectIndex.clear();
    this.predicateIndex.clear();
    this.objectIndex.clear();

    for (let i = 0; i < triples.length; i++) {
      const t = triples[i];
      this.addToIndex(this.subjectIndex, t.subject, i);
      this.addToIndex(this.predicateIndex, t.predicate, i);
      this.addToIndex(this.objectIndex, t.object, i);
    }
  }
}

/**
 * Convenience accessor
 */
export function getKnowledgeGraph(): KnowledgeGraph {
  return KnowledgeGraph.getInstance();
}
