/**
 * Graph Embeddings — Hybrid Structural + Semantic Search
 *
 * Builds an embedding index over code graph entities by combining
 * structural information (path, function names, imports) with
 * semantic embeddings (MiniLM-L6-v2 via EmbeddingProvider).
 *
 * Lazy-init: rebuild() called on first search(), not at startup.
 * Capped at 500 entities to limit latency.
 */

import type { KnowledgeGraph } from './knowledge-graph.js';
import { logger } from '../utils/logger.js';
import { createVectorIndex } from '../search/vector-index-factory.js';
import type { VectorEngine, VectorIndexLike } from '../search/vector-index-factory.js';

// ============================================================================
// Types
// ============================================================================

export interface GraphEmbeddingIndex {
  /** Semantic search over graph entities */
  search(query: string, k?: number): Promise<Array<{ entityId: string; score: number }>>;
  /** Whether the index has been built */
  isReady(): boolean;
  /** Build/rebuild the index from the current graph state */
  rebuild(): Promise<void>;
}

export interface GraphEmbeddingConfig {
  /** Maximum entities to index. Default 500 */
  maxEntities: number;
  /** Entity prefix to index. Default 'mod:' */
  entityPrefix: string;
}

const DEFAULT_CONFIG: GraphEmbeddingConfig = {
  maxEntities: 500,
  entityPrefix: 'mod:',
};

/**
 * Le moteur retenu vient désormais de `createVectorIndex` : plus de variante
 * « legacy-usearch » ici. Elle n'existait que pour une signature `add(id, vec)`
 * qu'aucun index du dépôt n'expose — seulement un mock de test.
 */
type VectorIndexKind = VectorEngine | 'brute-force';

function getEmbeddings(batchResult: unknown): number[][] {
  if (Array.isArray(batchResult)) {
    return batchResult as number[][];
  }
  const maybeBatch = batchResult as { embeddings?: number[][] | Float32Array[] } | null | undefined;
  return (maybeBatch?.embeddings ?? []).map(embedding => Array.from(embedding));
}

function getEmbedding(result: unknown): number[] | undefined {
  if (Array.isArray(result)) {
    return result as number[];
  }
  const maybeResult = result as { embedding?: number[] | Float32Array } | null | undefined;
  return maybeResult?.embedding ? Array.from(maybeResult.embedding) : undefined;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a GraphEmbeddingIndex backed by the existing EmbeddingProvider + USearch infra.
 *
 * Text per entity = path + function names + class names + top imports.
 * Falls back gracefully if embedding provider is unavailable.
 */
export function createGraphEmbeddingIndex(
  graph: KnowledgeGraph,
  config?: Partial<GraphEmbeddingConfig>,
): GraphEmbeddingIndex {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let ready = false;
  let entityTexts: Map<string, string> = new Map();
  let embeddingProvider: any = null;
  /** Soit un index de la fabrique, soit la boucle locale de dernier recours. */
  let vectorIndex: VectorIndexLike | BruteForceIndex | null = null;
  let vectorIndexKind: VectorIndexKind = 'brute-force';
  let entityIds: string[] = [];

  return {
    isReady(): boolean {
      return ready;
    },

    async rebuild(): Promise<void> {
      try {
        // Lazy-load embedding infra
        if (!embeddingProvider) {
          const { EmbeddingProvider } = await import('../embeddings/embedding-provider.js');
          embeddingProvider = new EmbeddingProvider();
          await embeddingProvider.initialize();
        }

        // Collect entities
        entityTexts = buildEntityTexts(graph, cfg);
        entityIds = [...entityTexts.keys()];

        if (entityIds.length === 0) {
          ready = false;
          return;
        }

        // Generate embeddings
        const texts = entityIds.map(id => entityTexts.get(id)!);
        const batchResult = await embeddingProvider.embedBatch(texts);
        const embeddings = getEmbeddings(batchResult);

        if (!embeddings || embeddings.length === 0) {
          ready = false;
          return;
        }

        // Build vector index
        const firstEmbedding = embeddings[0];
        if (!firstEmbedding) {
          ready = false;
          return;
        }
        const dim = firstEmbedding.length;
        // La fabrique charge réellement le paquet natif avant de le choisir. Le
        // `try/catch` d'avant portait sur un import de fichier TypeScript du
        // dépôt : il réussissait toujours, si bien que le repli n'était jamais
        // atteint ici et s'activait plus tard, en silence, dans l'index lui-même.
        try {
          const { index, engine } = await createVectorIndex({
            name: 'graph-embeddings',
            dimensions: dim,
            capacity: Math.max(entityIds.length, 1),
          });
          vectorIndex = index;
          vectorIndexKind = engine;
          await vectorIndex.initialize();
        } catch (err) {
          logger.debug(`GraphEmbeddingIndex: fabrique indisponible (${String(err)}) — boucle locale`);
          vectorIndex = new BruteForceIndex(dim);
          vectorIndexKind = 'brute-force';
        }

        for (let i = 0; i < entityIds.length; i++) {
          const embedding = embeddings[i];
          if (!embedding) continue;
          if (vectorIndex instanceof BruteForceIndex) {
            vectorIndex.add(i, embedding);
          } else {
            await vectorIndex.add({
              id: String(i),
              embedding,
              metadata: { entityId: entityIds[i] },
            });
          }
        }

        ready = true;
        logger.debug(
          `GraphEmbeddingIndex: built with ${entityIds.length} entities, dim=${dim}, engine=${vectorIndexKind}`,
        );
      } catch (err) {
        logger.debug(`GraphEmbeddingIndex: failed to build - ${err}`);
        ready = false;
      }
    },

    async search(query: string, k: number = 10): Promise<Array<{ entityId: string; score: number }>> {
      // Auto-build on first search
      if (!ready) {
        await this.rebuild();
      }
      if (!ready || !embeddingProvider || !vectorIndex) {
        return [];
      }

      try {
        const queryResult = await embeddingProvider.embed(query);
        const queryEmbedding = getEmbedding(queryResult);
        if (!queryEmbedding) return [];

        const results = await vectorIndex.search(queryEmbedding, Math.min(k, entityIds.length));

        // `filter(Boolean)` ne rétrécit pas le type : sans prédicat, un identifiant
        // absent traversait en `undefined` sous le couvert d'un `any`.
        return results
          .map((r: { id: number | string; score: number }) => ({
            entityId: entityIds[Number(r.id)],
            score: r.score,
          }))
          .filter((r): r is { entityId: string; score: number } => typeof r.entityId === 'string');
      } catch {
        return [];
      }
    },
  };
}

// ============================================================================
// Entity Text Builder
// ============================================================================

/**
 * Build text representation for each entity suitable for embedding.
 * Text = path + contained function names + class names + import targets
 */
function buildEntityTexts(
  graph: KnowledgeGraph,
  cfg: GraphEmbeddingConfig,
): Map<string, string> {
  const texts = new Map<string, string>();
  const allTriples = graph.toJSON();

  // Collect entities with prefix
  const entities = new Set<string>();
  for (const t of allTriples) {
    if (t.subject.startsWith(cfg.entityPrefix)) entities.add(t.subject);
    if (t.object.startsWith(cfg.entityPrefix)) entities.add(t.object);
  }

  // Sort and cap
  const sorted = [...entities].sort();
  const capped = sorted.slice(0, cfg.maxEntities);

  for (const entityId of capped) {
    const parts: string[] = [];

    // Path (strip prefix)
    parts.push(entityId.replace(/^mod:/, '').replace(/\//g, ' '));

    // Contained functions
    const fns = graph.query({ subject: entityId, predicate: 'containsFunction' });
    for (const fn of fns.slice(0, 20)) {
      parts.push(fn.object.replace(/^fn:/, ''));
    }

    // Classes defined in this module
    const cls = graph.query({ predicate: 'definedIn', object: entityId });
    for (const c of cls.slice(0, 10)) {
      if (c.subject.startsWith('cls:')) {
        parts.push(c.subject.replace(/^cls:/, ''));
      }
    }

    // Top imports
    const imports = graph.query({ subject: entityId, predicate: 'imports' });
    for (const imp of imports.slice(0, 5)) {
      parts.push(imp.object.replace(/^mod:/, '').split('/').pop() ?? '');
    }

    texts.set(entityId, parts.join(' '));
  }

  return texts;
}

// ============================================================================
// Brute-Force Fallback (when USearch is unavailable)
// ============================================================================

class BruteForceIndex {
  private vectors: Map<number, number[]> = new Map();

  constructor(private dim: number) {}

  add(id: number, vector: number[]): void {
    this.vectors.set(id, vector);
  }

  search(query: number[], k: number): Array<{ id: number; score: number }> {
    const scores: Array<{ id: number; score: number }> = [];

    for (const [id, vec] of this.vectors) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.dim; i++) {
        const q = query[i] ?? 0;
        const v = vec[i] ?? 0;
        dot += q * v;
        normA += q * q;
        normB += v * v;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      const similarity = denom > 0 ? dot / denom : 0;
      scores.push({ id, score: similarity });
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k);
  }
}
