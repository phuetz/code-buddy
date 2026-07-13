/**
 * Collective Knowledge Graph (CKG) — Phases 0 + 1.
 *
 * A SHARED memory for the agent collective so agent B benefits from what agent A learned.
 * Today every memory store is machine-/process-local and nothing capitalizes knowledge
 * across the collective (see plan ~/.claude/plans/wobbly-brewing-ullman.md).
 *
 * Phase 0 — unified `remember()` / `recall()` on an APPEND-ONLY JSONL ledger:
 *  - The ledger is the single shared write path. POSIX O_APPEND makes small-line appends
 *    atomic, so multiple agents/processes pointing at the same ledger file accumulate
 *    correctly WITHOUT a database — counting happens at read time by replaying the log.
 *    This is what makes "B benefits from A" and concurrent-write correctness hold before
 *    the SQLite backing of Phase 2.
 *
 * Phase 1 — bi-temporal supersede + hybrid retrieval:
 *  - A fact that CHANGES (same logical id, different text) invalidates the old version
 *    (`validTo` set) and records a `supersedes` edge — Mem0 ADD/UPDATE + Zep bi-temporal.
 *  - `recallHybrid()` fuses local embeddings (semantic, $0) + keyword + salience, with NO
 *    LLM at retrieval (Zep). So a PARAPHRASED query still finds the right knowledge.
 *
 * Reuses pure helpers: `contentHash` + `computeSalience` (knowledge-graph), `scanForSecrets`/
 * `redactSecrets` (privacy-lint), `defaultFleetAgentId` (fleet), local embeddings
 * (`getEmbeddingProvider`). Borrows Code Explorer's id convention `Type:scope:name` and edge
 * shape `(from, to, type, confidence, reason)`.
 *
 * Deferred (later phases): PageRank multi-hop (Phase 1 follow-up), SQLite backing +
 * cross-machine git sync (Phases 2-3), wake-sleep consolidation + gated promotion + a
 * production write tool (Phase 4). Never-throws on the write path.
 *
 * @module memory/collective-knowledge-graph
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  type Stats,
} from 'fs';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';
import { contentHash, computeSalience, type EntityType, type RelationType } from './knowledge-graph.js';
import { scanForSecrets, redactSecrets } from '../fleet/privacy-lint.js';
import { defaultFleetAgentId } from '../fleet/colab-store.js';
import { getCodeBuddyHome } from '../utils/codebuddy-home.js';
import { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import { BM25Index } from '../search/bm25.js';
import { cosineSimilarityF32, hybridMmrRank, type HybridCandidate } from './hybrid-mmr.js';
import {
  canonicalObject,
  factMatchKey,
  factRetention,
  parseFactKey,
  reconcileFact,
  FACT_CATEGORIES,
  type FactCategory,
  type FactVerdict,
  type StructuredFact,
} from './ckg-fact-reconciliation.js';
import { writeFileSync } from 'fs';

/** Multilingual embeddings — all-MiniLM (the global default) is English-leaning and misses
 *  French synonyms (measured: it failed paraphrase recall); this model discriminates French
 *  cleanly (sim 0.48 vs 0.005 on the same probe). A dedicated instance avoids clobbering
 *  EnhancedMemory's all-MiniLM singleton. */
const CKG_EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

/** What an agent asks the collective to remember. */
export interface CkgRememberInput {
  /** The statement/knowledge to store (a lesson, fact, decision text). */
  text: string;
  /** Node type. Default 'fact'. */
  type?: EntityType;
  /** Stable key; if omitted, derived from `text` (so identical text dedups). A STABLE name
   *  with NEW text triggers a bi-temporal supersede (the fact changed). */
  name?: string;
  /** Typed edges from this node to other named entities (Code-Explorer edge shape). */
  relations?: Array<{ predicate: RelationType; targetName: string; targetType?: EntityType; reason?: string }>;
  /** Contributing agent (`<host>/<repo>`). Default `defaultFleetAgentId()`. */
  agentId?: string;
  /** Provenance: 'chat' | 'council' | 'worklog' | 'dream' | … */
  source?: string;
  /** 0..1; default 0.8. */
  confidence?: number;
}

export interface CkgRecallResult {
  id: string;
  type: EntityType;
  name: string;
  text: string;
  salience: number;
  mentions: number;
  /** Confidence, boosted by cross-agent corroboration. */
  confidence: number;
  /** Number of DISTINCT agents that independently asserted this fact (collective trust). */
  corroborations: number;
  agentId?: string;
  source?: string;
  /** Semantic similarity to the query (recallHybrid only). */
  similarity?: number;
  /** Set on superseded (no-longer-current) versions returned by getSuperseded(). */
  validTo?: string | null;
  relations: Array<{ predicate: RelationType; target: string; reason?: string }>;
}

/** Decide the relationship between a new discovery and a topical neighbour (NLI-style):
 *  `supports` (corroborates), `contradicts` (conflicting finding), or `related_to`. */
export type RelationClassifier = (
  subjectText: string,
  neighborText: string,
) => Promise<'supports' | 'contradicts' | 'related_to'>;

interface CkgEntity {
  id: string;
  type: EntityType;
  name: string;
  text: string;
  contentHash: string;
  /** Confidence as recorded by the first contributor. */
  baseConfidence: number;
  /** Effective confidence, boosted by cross-agent corroboration. */
  confidence: number;
  mentions: number;
  /** Distinct agents that asserted this fact (collective trust signal). */
  contributors: Set<string>;
  agentId?: string;
  source?: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Cross-agent corroboration: a fact independent agents agree on is more trustworthy
 *  (Bayesian-trust / corroboration-multiplier idea). Each extra independent source lifts
 *  confidence toward 1; same-agent repeats don't (no echo-chamber inflation). */
function corroboratedConfidence(base: number, distinctAgents: number): number {
  return Math.max(0, Math.min(0.99, base + 0.12 * Math.max(0, distinctAgents - 1)));
}

/** Ranking boost from corroboration (caps at 2× for 6+ independent agents). */
function corroborationBoost(distinctAgents: number): number {
  return Math.min(2, 1 + 0.2 * Math.max(0, distinctAgents - 1));
}

interface CkgRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationType;
  reason?: string;
  mentions: number;
}

interface LedgerEvent {
  v: 1;
  // 'retraction' removes a node from the current view (append-only tombstone).
  // Older readers dispatch only on entity/relation and skip unknown kinds, so
  // adding it is backward-compatible by construction.
  kind: 'entity' | 'relation' | 'retraction';
  recordedAt: string;
  agentId: string;
  source?: string;
  contentHash: string;
  // entity + retraction
  id?: string;
  type?: EntityType;
  name?: string;
  text?: string;
  confidence?: number;
  // relation
  sourceId?: string;
  targetId?: string;
  relType?: RelationType;
  reason?: string;
}

const SCOPE = 'collective';

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Code-Explorer id convention: `Type:scope:name`. */
function entityId(type: EntityType, name: string): string {
  return `${type}:${SCOPE}:${normalizeName(name)}`;
}

function tokenize(s: string): Set<string> {
  return new Set((s.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').match(/[a-z0-9]{2,}/g)) ?? []);
}

/** Recall-oriented keyword overlap: fraction of query tokens present in the candidate. */
function keywordOverlap(query: Set<string>, text: string): number {
  if (query.size === 0) return 0;
  const cand = tokenize(text);
  let hit = 0;
  for (const t of query) if (cand.has(t)) hit++;
  return hit / query.size;
}

export interface CollectiveKnowledgeGraphOptions {
  /** Override the shared ledger path (tests / custom layout). Default `<home>/collective/ckg-ledger.jsonl`. */
  ledgerPath?: string;
  /** This agent's id (attribution). Default `defaultFleetAgentId()`. */
  agentId?: string;
  /** Override the (multilingual) embedding model for hybrid recall. */
  embeddingModel?: string;
  /** Inject an embedder (tests / alternative engines). Default: a dedicated EmbeddingProvider. */
  embedder?: CkgEmbedder;
}

/** Minimal embedder surface hybrid recall needs — EmbeddingProvider satisfies it. */
export interface CkgEmbedder {
  embed(text: string): Promise<{ embedding: Float32Array }>;
}

/**
 * The collective shared-memory facade. Construct two instances pointing at the SAME
 * `ledgerPath` to model two agents/processes sharing one collective store.
 */
export class CollectiveKnowledgeGraph {
  private readonly ledgerPath: string;
  private readonly agentId: string;
  /** Currently-true nodes (validTo === null), keyed by logical id. */
  private readonly current = new Map<string, CkgEntity>();
  /** Invalidated (superseded) versions, keyed by `id@contentHash`. */
  private readonly superseded = new Map<string, CkgEntity>();
  private readonly relations = new Map<string, CkgRelation>();
  /** Byte position immediately after the last complete JSONL line applied to the view. */
  private ledgerOffset = 0;
  /** Last observed file metadata, used to make unchanged loads an O(1) stat. */
  private ledgerSize = 0;
  private ledgerMtimeMs = 0;
  private ledgerDevice: number | null = null;
  private ledgerInode: number | null = null;
  /** contentHash → embedding vector. Content-addressed, so it survives ledger reloads. */
  private readonly embCache = new Map<string, Float32Array>();
  private readonly embeddingModel: string;
  private embedder: CkgEmbedder | null = null;
  /** Rust engine client (lazy) — used only when CODEBUDDY_CKG_ENGINE=rust and the binary exists.
   *  Writes go to the SAME ledger, so the TS path stays consistent and falls back transparently. */
  private engine: import('./buddy-memory-client.js').BuddyMemoryClient | null = null;
  private engineTried = false;

  constructor(options: CollectiveKnowledgeGraphOptions = {}) {
    this.ledgerPath = options.ledgerPath ?? join(getCodeBuddyHome(), 'collective', 'ckg-ledger.jsonl');
    this.agentId = options.agentId ?? safeAgentId();
    this.embeddingModel = options.embeddingModel ?? CKG_EMBEDDING_MODEL;
    this.embedder = options.embedder ?? null;
  }

  /** The Rust engine client when opted-in (CODEBUDDY_CKG_ENGINE=rust) and available, else null.
   *  Lazy + cached; any failure → null so callers use the in-process TS implementation. */
  private async engineClient(): Promise<import('./buddy-memory-client.js').BuddyMemoryClient | null> {
    if (process.env.CODEBUDDY_CKG_ENGINE !== 'rust') return null;
    if (this.engineTried) return this.engine;
    this.engineTried = true;
    try {
      const { BuddyMemoryClient } = await import('./buddy-memory-client.js');
      const c = new BuddyMemoryClient({ ledgerPath: this.ledgerPath, agentId: this.agentId });
      this.engine = c.available() ? c : null;
    } catch (err) {
      logger.debug(`[ckg] engine unavailable: ${err instanceof Error ? err.message : String(err)}`);
      this.engine = null;
    }
    return this.engine;
  }

  /** Dedicated multilingual embedder (lazy; isolated from EnhancedMemory's all-MiniLM singleton). */
  private getEmbedder(): CkgEmbedder {
    if (!this.embedder) {
      this.embedder = new EmbeddingProvider({ provider: 'local', modelName: this.embeddingModel });
    }
    return this.embedder;
  }

  /** Path of the shared ledger (for diagnostics/tests). */
  getLedgerPath(): string {
    return this.ledgerPath;
  }

  /**
   * Remember a piece of collective knowledge. Best-effort, never-throws. Secrets are
   * redacted (the lesson is kept, the secret is not). Identical text reinforces (mentions++);
   * a stable name with new text supersedes the old version.
   */
  remember(input: CkgRememberInput): CkgRecallResult | null {
    try {
      const raw = (input.text ?? '').trim();
      if (!raw) return null;
      // Privacy: redact secrets before anything is persisted or shared.
      const text = scanForSecrets(raw).hasSecrets ? redactSecrets(raw) : raw;
      const type: EntityType = input.type ?? 'fact';
      const name = input.name?.trim() || normalizeName(text);
      const id = entityId(type, name);
      const recordedAt = new Date().toISOString();
      const agentId = input.agentId ?? this.agentId;
      const ch = contentHash(type, text);
      const confidence = clamp01(input.confidence ?? 0.8);

      const entityEvent: LedgerEvent = {
        v: 1, kind: 'entity', recordedAt, agentId, contentHash: ch,
        id, type, name, text, confidence,
        ...(input.source ? { source: input.source } : {}),
      };
      this.append(entityEvent);

      for (const rel of input.relations ?? []) {
        const targetType: EntityType = rel.targetType ?? 'concept';
        const targetId = entityId(targetType, rel.targetName);
        const relCh = contentHash('relation', `${id}|${rel.predicate}|${targetId}`);
        const relEvent: LedgerEvent = {
          v: 1, kind: 'relation', recordedAt, agentId, contentHash: relCh,
          sourceId: id, targetId, relType: rel.predicate,
          ...(rel.reason ? { reason: rel.reason } : {}),
          ...(input.source ? { source: input.source } : {}),
        };
        this.append(relEvent);
        if (!this.current.has(targetId)) {
          const tEvent: LedgerEvent = {
            v: 1, kind: 'entity', recordedAt, agentId, contentHash: contentHash(targetType, rel.targetName),
            id: targetId, type: targetType, name: rel.targetName, text: rel.targetName, confidence: 0.5,
          };
          this.append(tEvent);
        }
      }
      return this.toResult(this.current.get(id)!);
    } catch (err) {
      logger.warn(`[ckg] remember failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Ingest a DISCOVERY and auto-link it to its nearest existing discoveries — Patrice's
   * vision: "à chaque découverte, l'enregistrer et relier les découvertes aux plus proches"
   * (Zettelkasten / A-MEM). Uses the multilingual embeddings to find semantic neighbours and
   * adds `related_to` edges. Async (embeds); best-effort linking (a failure still stores the
   * node). This is how a corpus of scientific publications self-organises into a graph.
   */
  async ingest(
    input: CkgRememberInput & {
      autoLinkK?: number;
      autoLinkThreshold?: number;
      /** Optional NLI-style classifier: decide if the new discovery SUPPORTS / CONTRADICTS /
       *  is merely RELATED to a near neighbour. Embeddings find topical neighbours; only a
       *  judge can tell "works" from "doesn't work". Absent → all links are `related_to`. */
      relationClassifier?: RelationClassifier;
    },
  ): Promise<CkgRecallResult | null> {
    const eng = await this.engineClient();
    if (eng) {
      try {
        // Phase 1 engine: stores the discovery (auto-link/embeddings arrive in Phase 2).
        const { relationClassifier: _rc, autoLinkK: _k, autoLinkThreshold: _t, ...rest } = input;
        return ((await eng.call('ingest', { type: 'discovery', ...rest })) as CkgRecallResult) ?? null;
      } catch (err) {
        logger.warn(`[ckg] engine ingest failed, TS fallback: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const stored = this.remember({ type: 'discovery', ...input });
    if (!stored) return null;
    try {
      this.load(); // see other agents' discoveries too
      const self = this.current.get(stored.id);
      if (!self) return stored;
      const provider = this.getEmbedder();
      const selfVec = (await provider.embed(`${self.name}. ${self.text}`)).embedding;
      this.embCache.set(self.contentHash, selfVec);
      const sims: Array<{ e: CkgEntity; sim: number }> = [];
      for (const e of this.current.values()) {
        if (e.id === self.id) continue;
        let v = this.embCache.get(e.contentHash);
        if (!v) {
          v = (await provider.embed(`${e.name}. ${e.text}`)).embedding;
          this.embCache.set(e.contentHash, v);
        }
        sims.push({ e, sim: cosineSimilarityF32(selfVec, v) });
      }
      sims.sort((a, b) => b.sim - a.sim);
      const k = input.autoLinkK ?? 3;
      const threshold = input.autoLinkThreshold ?? 0.5;
      for (const { e, sim } of sims.slice(0, k)) {
        if (sim < threshold) break;
        let relType: RelationType = 'related_to';
        if (input.relationClassifier) {
          try {
            relType = await input.relationClassifier(self.text, e.text);
          } catch {
            relType = 'related_to';
          }
        }
        this.linkRelated(self.id, e.id, sim, stored.agentId, relType);
      }
    } catch (err) {
      logger.debug(`[ckg] auto-link skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.toResult(this.current.get(stored.id)!);
  }

  /** Ingest a scientific publication as an auto-linked discovery (title + abstract).
   *  Pass `relationClassifier` to tag neighbour links as supports/contradicts. */
  async ingestPublication(
    pub: { id?: string; title: string; abstract?: string; source?: string; agentId?: string },
    opts: { relationClassifier?: RelationClassifier; autoLinkK?: number; autoLinkThreshold?: number } = {},
  ): Promise<CkgRecallResult | null> {
    const text = pub.abstract ? `${pub.title}. ${pub.abstract}` : pub.title;
    return this.ingest({
      type: 'discovery',
      name: pub.id ?? pub.title,
      text,
      source: pub.source ?? 'publication',
      ...(pub.agentId ? { agentId: pub.agentId } : {}),
      ...(opts.relationClassifier ? { relationClassifier: opts.relationClassifier } : {}),
      ...(opts.autoLinkK !== undefined ? { autoLinkK: opts.autoLinkK } : {}),
      ...(opts.autoLinkThreshold !== undefined ? { autoLinkThreshold: opts.autoLinkThreshold } : {}),
    });
  }

  /**
   * Recall collective knowledge (Phase 0 — keyword × salience, synchronous, no model load).
   * Reloads the shared ledger first so writes from OTHER agents/processes are visible.
   */
  recall(query: string, opts: { limit?: number; types?: EntityType[] } = {}): CkgRecallResult[] {
    this.load();
    const limit = opts.limit ?? 5;
    const q = tokenize(query);
    const typeFilter = opts.types ? new Set(opts.types) : null;
    const scored: Array<{ e: CkgEntity; score: number }> = [];
    for (const e of this.current.values()) {
      if (typeFilter && !typeFilter.has(e.type)) continue;
      const kw = keywordOverlap(q, `${e.name} ${e.text}`);
      if (q.size > 0 && kw === 0) continue;
      const salience = computeSalience(e.mentions, new Date(e.updatedAt));
      const score = (q.size > 0 ? kw : 1) * salience * corroborationBoost(e.contributors.size);
      scored.push({ e, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ e, score }) => this.toResult(e, score));
  }

  /**
   * Hybrid recall (Phase 1) — fuses local embeddings (semantic, $0) + keyword + salience,
   * with NO LLM at retrieval (Zep). A paraphrased query with no shared keywords still finds
   * the right knowledge. Embeddings are cached by contentHash across reloads.
   */
  async recallHybrid(
    query: string,
    opts: { limit?: number; types?: EntityType[]; semanticWeight?: number; mmrLambda?: number } = {},
  ): Promise<CkgRecallResult[]> {
    const eng = await this.engineClient();
    if (eng) {
      try {
        // Phase 1 engine: keyword recall over the shared ledger (semantic+MMR arrive in Phase 2).
        return ((await eng.call('recallHybrid', {
          query,
          limit: opts.limit ?? 5,
          ...(opts.types ? { types: opts.types } : {}),
        })) as CkgRecallResult[]) ?? [];
      } catch (err) {
        logger.warn(`[ckg] engine recallHybrid failed, TS fallback: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.load();
    const limit = opts.limit ?? 5;
    const typeFilter = opts.types ? new Set(opts.types) : null;
    const candidates = [...this.current.values()].filter((e) => !typeFilter || typeFilter.has(e.type));
    if (candidates.length === 0) return [];

    const provider = this.getEmbedder();
    let qVec: Float32Array | null = null;
    try {
      qVec = (await provider.embed(query)).embedding;
      for (const e of candidates) {
        if (!this.embCache.has(e.contentHash)) {
          this.embCache.set(e.contentHash, (await provider.embed(`${e.name}. ${e.text}`)).embedding);
        }
      }
    } catch (err) {
      // Embeddings unavailable → degrade gracefully to keyword recall (still useful, $0, no crash).
      logger.debug(`[ckg] semantic recall unavailable, keyword only: ${err instanceof Error ? err.message : String(err)}`);
      return this.recall(query, { limit, ...(opts.types ? { types: opts.types } : {}) });
    }

    // Lexical leg: transient BM25 over the live candidates (small corpus,
    // O(N) per query — same cost class as the keyword pass it replaces, with
    // idf + tf length-norm + stemming instead of raw overlap). The stemmer/
    // stopwords are English-leaning; on French text BM25 still beats raw
    // overlap, and the MULTILINGUAL semantic leg carries French synonymy.
    const index = new BM25Index();
    index.addDocuments(candidates.map((e) => ({ id: e.id, content: `${e.name} ${e.text}` })));
    const lexScores = new Map(index.search(query, candidates.length).map((r) => [r.id, r.score]));

    const byId = new Map(candidates.map((e) => [e.id, e]));
    const semById = new Map<string, number>();
    const hybridCandidates: HybridCandidate[] = candidates.map((e) => {
      const vec = this.embCache.get(e.contentHash) ?? null;
      const sem = vec && qVec ? Math.max(0, cosineSimilarityF32(qVec, vec)) : null;
      if (sem !== null) semById.set(e.id, sem);
      const salience = computeSalience(e.mentions, new Date(e.updatedAt));
      return {
        id: e.id,
        lexicalScore: lexScores.get(e.id) ?? 0,
        semanticScore: sem,
        vector: vec,
        // Recency is a gentle tie-breaker; cross-agent corroboration lifts
        // trusted facts. Applied AFTER rank fusion (see hybrid-mmr.ts).
        prior: (0.7 + 0.3 * Math.min(1, salience)) * corroborationBoost(e.contributors.size),
      };
    });

    // Weighted RRF fusion + MMR rerank — see memory/hybrid-mmr.ts for why
    // RANK fusion (scale-free) replaces the previous linear mix of an
    // unbounded keyword score with a bounded cosine.
    const ranked = hybridMmrRank(hybridCandidates, {
      k: limit,
      ...(opts.mmrLambda !== undefined ? { lambda: opts.mmrLambda } : {}),
      ...(opts.semanticWeight !== undefined ? { semanticWeight: opts.semanticWeight } : {}),
    });
    return ranked.map((r) => {
      const e = byId.get(r.id)!;
      return { ...this.toResult(e, r.relevance), similarity: semById.get(r.id) ?? 0 };
    });
  }

  /** A `<collective_knowledge>` system block for prompt injection (token-budgeted).
   *  Uses hybrid (semantic+keyword) retrieval; degrades to keyword if embeddings are unavailable. */
  async formatCollectiveContext(query: string, maxChars = 600): Promise<string> {
    const hits = await this.recallHybrid(query, { limit: 8 });
    if (hits.length === 0) return '';
    const lines: string[] = [];
    let used = 0;
    for (const h of hits) {
      const who = h.agentId ? ` (par ${h.agentId})` : '';
      const line = `- [${h.type}] ${h.text}${who}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length;
    }
    if (lines.length === 0) return '';
    return `<collective_knowledge>\n${lines.join('\n')}\n</collective_knowledge>`;
  }

  /** Invalidated (superseded) versions, for audit / bi-temporal queries. */
  getSuperseded(): CkgRecallResult[] {
    this.load();
    return [...this.superseded.values()].map((e) => ({ ...this.toResult(e), validTo: e.validTo }));
  }

  getStats(): { entities: number; superseded: number; relations: number; ledgerPath: string } {
    this.load();
    return {
      entities: this.current.size,
      superseded: this.superseded.size,
      relations: this.relations.size,
      ledgerPath: this.ledgerPath,
    };
  }

  /**
   * List the indexed entities (newest first) for administration — `buddy research list`. Ingested
   * publications/code insights are type `'discovery'`; pass `type` to filter (e.g. to the documents).
   */
  listEntities(opts: { limit?: number; type?: EntityType } = {}): Array<{
    id: string;
    name: string;
    type: EntityType;
    source?: string;
    confidence: number;
    mentions: number;
    contributors: number;
    createdAt: string;
  }> {
    this.load();
    let items = [...this.current.values()];
    if (opts.type) items = items.filter((e) => e.type === opts.type);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)); // newest first
    if (opts.limit && opts.limit > 0) items = items.slice(0, opts.limit);
    return items.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      ...(e.source ? { source: e.source } : {}),
      confidence: e.confidence,
      mentions: e.mentions,
      contributors: e.contributors.size,
      createdAt: e.createdAt,
    }));
  }

  /**
   * Inspect ONE node by id (or exact/normalized name), including its
   * bi-temporal status and superseded/retracted history — `buddy research show`.
   */
  getEntity(idOrName: string): {
    status: 'current' | 'retracted' | 'not_found';
    entity?: CkgRecallResult & { validTo?: string | null };
    history: Array<CkgRecallResult & { validTo?: string | null }>;
  } {
    this.load();
    const id = this.resolveEntityId(idOrName);
    if (!id) return { status: 'not_found', history: [] };
    const history = [...this.superseded.values()]
      .filter((e) => e.id === id)
      .sort((a, b) => ((a.validTo ?? '') < (b.validTo ?? '') ? -1 : 1))
      .map((e) => ({ ...this.toResult(e), validTo: e.validTo }));
    const cur = this.current.get(id);
    if (cur) return { status: 'current', entity: { ...this.toResult(cur), validTo: null }, history };
    // No current version but history exists: a supersede always installs a new
    // current, so this state can only result from a retraction tombstone.
    const latest = history[history.length - 1];
    return latest ? { status: 'retracted', entity: latest, history } : { status: 'not_found', history: [] };
  }

  /**
   * Retract a node — append-only tombstone; the ledger only grows, and a later
   * `remember()` of the same id revives the node. Idempotent: retracting a
   * missing or already-retracted node is a no-op. — `buddy research retract`.
   */
  retract(idOrName: string, opts: { reason?: string } = {}): {
    retracted: boolean;
    id: string | null;
    status: 'retracted' | 'already_retracted' | 'not_found';
  } {
    try {
      this.load(); // see other agents' writes first (same hygiene as remember)
      const id = this.resolveEntityId(idOrName);
      if (!id) return { retracted: false, id: null, status: 'not_found' };
      if (!this.current.has(id)) return { retracted: false, id, status: 'already_retracted' };
      const recordedAt = new Date().toISOString();
      const event: LedgerEvent = {
        v: 1,
        kind: 'retraction',
        recordedAt,
        agentId: this.agentId,
        contentHash: contentHash('retraction', `${id}|${recordedAt}`),
        id,
        ...(opts.reason ? { reason: opts.reason } : {}),
      };
      this.append(event);
      return { retracted: true, id, status: 'retracted' };
    } catch (err) {
      logger.warn(`[ckg] retract failed: ${err instanceof Error ? err.message : String(err)}`);
      return { retracted: false, id: null, status: 'not_found' };
    }
  }

  /** Resolve an id, exact name, or normalized name to a known entity id. */
  private resolveEntityId(idOrName: string): string | null {
    const raw = idOrName.trim();
    if (!raw) return null;
    const known = (id: string): boolean =>
      this.current.has(id) || [...this.superseded.values()].some((e) => e.id === id);
    if (raw.includes(':') && known(raw)) return raw;
    const norm = normalizeName(raw);
    for (const e of this.current.values()) {
      if (e.name === raw || normalizeName(e.name) === norm) return e.id;
    }
    for (const e of this.superseded.values()) {
      if (e.name === raw || normalizeName(e.name) === norm) return e.id;
    }
    return null;
  }

  // -- structured facts (Memory-Kernel reconciliation) ---------------------

  /**
   * Remember a STRUCTURED fact `(subject, predicate, object, category)` with
   * Memory-Kernel discipline (jarvis-OS concepts, clean-room). The closed
   * vocabulary is enforced here — an out-of-vocab predicate/category is
   * QUARANTINED (never enters the active graph). Otherwise the fact is stored
   * as a `fact` node whose `name` is the deterministic match key
   * `subject|predicate|category` and whose `text` is the canonical object, so
   * the ledger's own bi-temporal machinery gives us for free:
   *   - same key + same object → reinforce (mentions++), no duplicate;
   *   - same key + new object on a STABLE category → bi-temporal supersede;
   *   - same key + new object on a non-stable category → a coexisting node
   *     (multiple preferences may hold at once).
   * Never-throws (mirrors `remember`).
   */
  rememberFact(
    input: StructuredFact & { agentId?: string; source?: string; confidence?: number },
  ): { verdict: FactVerdict; stored: CkgRecallResult | null } {
    try {
      this.load();
      const key = factMatchKey(input);
      const object = canonicalObject(input);
      const existing = this.current.get(entityId('fact', key));
      const verdict = reconcileFact(input, existing ? existing.text : null);

      if (verdict.kind === 'quarantine') {
        logger.debug(`[ckg] fact quarantined: ${verdict.reasons.join('; ')}`);
        return { verdict, stored: null };
      }

      // A differing object on a non-stable category coexists as a distinct
      // node (disambiguated by the object hash) instead of superseding.
      const name = verdict.kind === 'coexist' ? `${key}#${contentHash('fact', object).slice(0, 8)}` : key;
      const stored = this.remember({
        type: 'fact',
        name,
        text: object,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        source: input.source ?? 'fact',
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      });
      return { verdict, stored };
    } catch (err) {
      logger.warn(`[ckg] rememberFact failed: ${err instanceof Error ? err.message : String(err)}`);
      return { verdict: { kind: 'quarantine', reasons: [String(err)] }, stored: null };
    }
  }

  /**
   * Recall structured facts ranked by relevance × category-derived retention
   * (jarvis-OS salience). Facts whose retention has decayed below
   * `minRetention` are dropped (identity/decision are immortal → never drop).
   * Reuses keyword recall over the fact nodes; the category is recovered from
   * the match-key stored in the node name.
   */
  recallFacts(
    query: string,
    opts: { limit?: number; minRetention?: number } = {},
  ): Array<CkgRecallResult & { category: FactCategory | null; retention: number }> {
    const limit = opts.limit ?? 5;
    const minRetention = opts.minRetention ?? 0;
    const now = Date.now();
    // Over-fetch then re-rank with retention (a faded fact can out-keyword a fresh one).
    const hits = this.recall(query, { limit: limit * 4, types: ['fact'] });
    const ranked = hits
      .map((h) => {
        const category = categoryFromFactName(h.name);
        const node = this.current.get(h.id);
        const ageDays = node ? (now - new Date(node.updatedAt).getTime()) / 86_400_000 : 0;
        const retention = category ? factRetention(category, ageDays) : 1;
        return { ...h, category, retention, salience: h.salience * retention };
      })
      .filter((h) => h.retention >= minRetention)
      .sort((a, b) => b.salience - a.salience);
    return ranked.slice(0, limit);
  }

  /**
   * List all current structured facts (parsed from fact nodes), each annotated
   * with its category-derived retention. For the Markdown mirror + inspection.
   */
  listFacts(): Array<{
    subject: string;
    predicate: string;
    object: string;
    category: FactCategory;
    mentions: number;
    confidence: number;
    retention: number;
    corroborations: number;
    updatedAt: string;
  }> {
    this.load();
    const now = Date.now();
    const out: Array<{
      subject: string; predicate: string; object: string; category: FactCategory;
      mentions: number; confidence: number; retention: number; corroborations: number; updatedAt: string;
    }> = [];
    for (const e of this.current.values()) {
      if (e.type !== 'fact') continue;
      const parsed = parseFactKey(e.name);
      if (!parsed) continue;
      const ageDays = (now - new Date(e.updatedAt).getTime()) / 86_400_000;
      out.push({
        subject: parsed.subject,
        predicate: parsed.predicate,
        object: e.text,
        category: parsed.category,
        mentions: e.mentions,
        confidence: e.confidence,
        retention: factRetention(parsed.category, ageDays),
        corroborations: e.contributors.size,
        updatedAt: e.updatedAt,
      });
    }
    return out;
  }

  /**
   * Export a READ-ONLY Markdown mirror of the structured facts, one file per
   * category (Memory-Kernel unidirectional mirror, jarvis-OS concept). Each file
   * carries a "do not edit" banner — the ledger is the source of truth, editing
   * an .md changes nothing. Obsidian-compatible. Returns the files written.
   */
  exportFactMirror(dir: string): { files: string[]; factCount: number } {
    const facts = this.listFacts();
    const byCategory = new Map<FactCategory, typeof facts>();
    for (const cat of FACT_CATEGORIES) byCategory.set(cat, []);
    for (const f of facts) byCategory.get(f.category)!.push(f);

    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    const generatedAt = new Date().toISOString();
    for (const [category, items] of byCategory) {
      if (items.length === 0) continue;
      // Most salient first: retention × confidence, then reinforcement count.
      items.sort(
        (a, b) => b.retention * b.confidence - a.retention * a.confidence || b.mentions - a.mentions,
      );
      const lines = [
        `<!-- AUTO-GÉNÉRÉ depuis le ledger CKG — NE PAS ÉDITER (régénéré à chaque \`buddy research mirror\`) -->`,
        `# ${category}`,
        '',
        `_${items.length} fait(s) · miroir du ${generatedAt}_`,
        '',
      ];
      for (const f of items) {
        const corr = f.corroborations > 1 ? ` · ${f.corroborations} agents` : '';
        lines.push(
          `- **${f.subject} ${f.predicate} ${f.object}** ` +
            `(conf ${f.confidence.toFixed(2)} · rét ${f.retention.toFixed(2)} · vu ${f.mentions}×${corr})`,
        );
      }
      const file = join(dir, `${category}.md`);
      writeFileSync(file, lines.join('\n') + '\n', 'utf8');
      files.push(file);
    }
    return { files, factCount: facts.length };
  }

  // -- internals ------------------------------------------------------------

  private append(event: LedgerEvent): void {
    const dir = dirname(this.ledgerPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // O_APPEND keeps concurrent small-line writes from interleaving (POSIX atomic append).
    appendFileSync(this.ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
    // `load` is the single event-application path. This avoids double-applying a local
    // append while still picking up writes that another process raced in before ours.
    this.load();
  }

  /**
   * Bring the in-memory view up to date from the append-only ledger. Unchanged files cost
   * one stat; growth reads only bytes after the last complete JSONL line. Truncation,
   * replacement, or an in-place rewrite falls back to a full replay.
   */
  private load(): void {
    if (!existsSync(this.ledgerPath)) {
      if (this.ledgerSize > 0 || this.ledgerOffset > 0) this.resetLedgerView();
      return;
    }

    let stats: Stats;
    try {
      stats = statSync(this.ledgerPath);
    } catch {
      return;
    }

    const sameFile =
      this.ledgerDevice === null ||
      (this.ledgerDevice === stats.dev && this.ledgerInode === stats.ino);
    const unchanged =
      sameFile && stats.size === this.ledgerSize && stats.mtimeMs === this.ledgerMtimeMs;
    if (unchanged) return;

    const requiresFullReplay =
      !sameFile ||
      stats.size < this.ledgerSize ||
      stats.size < this.ledgerOffset ||
      (stats.size === this.ledgerSize && stats.mtimeMs !== this.ledgerMtimeMs);
    if (requiresFullReplay) this.resetLedgerView();

    const bytesToRead = stats.size - this.ledgerOffset;
    if (bytesToRead <= 0) {
      this.rememberLedgerMetadata(stats);
      return;
    }

    const chunk = Buffer.allocUnsafe(bytesToRead);
    let fd: number | null = null;
    let bytesRead = 0;
    try {
      fd = openSync(this.ledgerPath, 'r');
      while (bytesRead < bytesToRead) {
        const count = readSync(
          fd,
          chunk,
          bytesRead,
          bytesToRead - bytesRead,
          this.ledgerOffset + bytesRead,
        );
        if (count === 0) break;
        bytesRead += count;
      }
    } catch {
      return;
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // The bytes already read remain usable; a close failure must not break recall.
        }
      }
    }

    // Do not advance past a torn final line. A later append completes it and the next
    // incremental read starts from the same byte offset.
    const completeEnd = chunk.subarray(0, bytesRead).lastIndexOf(0x0a) + 1;
    if (completeEnd === 0) {
      this.rememberLedgerMetadata(stats);
      return;
    }

    const content = chunk.subarray(0, completeEnd).toString('utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: LedgerEvent;
      try {
        event = JSON.parse(trimmed) as LedgerEvent;
      } catch {
        continue; // a torn final line is skipped, not fatal
      }
      if (event.kind === 'entity') this.applyEntity(event);
      else if (event.kind === 'relation') this.applyRelation(event);
      else if (event.kind === 'retraction') this.applyRetraction(event);
    }
    this.ledgerOffset += completeEnd;
    this.rememberLedgerMetadata(stats);
  }

  private resetLedgerView(): void {
    this.current.clear();
    this.superseded.clear();
    this.relations.clear();
    this.ledgerOffset = 0;
    this.ledgerSize = 0;
    this.ledgerMtimeMs = 0;
    this.ledgerDevice = null;
    this.ledgerInode = null;
  }

  private rememberLedgerMetadata(stats: Stats): void {
    this.ledgerSize = stats.size;
    this.ledgerMtimeMs = stats.mtimeMs;
    this.ledgerDevice = stats.dev;
    this.ledgerInode = stats.ino;
  }

  /**
   * Apply a retraction tombstone: the current version moves to the superseded
   * (audit) map with `validTo` stamped, and disappears from `current` — so
   * recall/recallHybrid/listEntities exclude it with no changes of their own.
   * Replay order is file order, so a later entity event for the same id
   * REVIVES the node (append-only undo) by simply installing a fresh current.
   */
  private applyRetraction(e: LedgerEvent): void {
    if (!e.id) return;
    const cur = this.current.get(e.id);
    if (!cur) return; // idempotent: nothing current to retract
    cur.validTo = e.recordedAt;
    this.superseded.set(`${cur.id}@${cur.contentHash}`, cur);
    this.current.delete(e.id);
  }

  private applyEntity(e: LedgerEvent): void {
    if (!e.id || !e.type || e.name === undefined) return;
    const cur = this.current.get(e.id);
    if (!cur) {
      this.current.set(e.id, this.makeEntity(e));
      return;
    }
    // Same id + same text → reinforce. Distinct agents corroborating lifts confidence
    // (collective trust); same-agent repeats only bump the mention count.
    if (cur.contentHash === e.contentHash) {
      cur.mentions += 1;
      cur.updatedAt = e.recordedAt;
      if (e.agentId) cur.contributors.add(e.agentId);
      cur.confidence = corroboratedConfidence(cur.baseConfidence, cur.contributors.size);
      return;
    }
    // Same id, DIFFERENT text → bi-temporal supersede: invalidate old, install new, link them.
    cur.validTo = e.recordedAt;
    this.superseded.set(`${cur.id}@${cur.contentHash}`, cur);
    const fresh = this.makeEntity(e);
    this.current.set(e.id, fresh);
    const relId = contentHash('relation', `${e.id}@${fresh.contentHash}|supersedes|${e.id}@${cur.contentHash}`);
    this.relations.set(relId, {
      id: relId,
      sourceId: e.id,
      targetId: `${e.id}@${cur.contentHash}`,
      type: 'supersedes',
      reason: `fact changed (was ${cur.contentHash.slice(0, 8)})`,
      mentions: 1,
    });
  }

  private makeEntity(e: LedgerEvent): CkgEntity {
    const base = e.confidence ?? 0.8;
    return {
      id: e.id!, type: e.type!, name: e.name!, text: e.text ?? e.name!, contentHash: e.contentHash,
      baseConfidence: base, confidence: base, mentions: 1,
      contributors: new Set(e.agentId ? [e.agentId] : []),
      ...(e.agentId ? { agentId: e.agentId } : {}),
      ...(e.source ? { source: e.source } : {}),
      validTo: null, createdAt: e.recordedAt, updatedAt: e.recordedAt,
    };
  }

  /** Append + apply a typed neighbour edge between two discoveries (default `related_to`;
   *  `supports`/`contradicts` when a classifier judged the pair). */
  private linkRelated(
    sourceId: string,
    targetId: string,
    sim: number,
    agentId?: string,
    relType: RelationType = 'related_to',
  ): void {
    const relCh = contentHash('relation', `${sourceId}|${relType}|${targetId}`);
    if (this.relations.has(relCh)) return; // already linked with this relation
    const event: LedgerEvent = {
      v: 1, kind: 'relation', recordedAt: new Date().toISOString(),
      agentId: agentId ?? this.agentId, contentHash: relCh,
      sourceId, targetId, relType, reason: `semantic neighbour (${sim.toFixed(2)})`,
    };
    this.append(event);
  }

  private applyRelation(e: LedgerEvent): void {
    if (!e.sourceId || !e.targetId || !e.relType) return;
    const relId = e.contentHash;
    const existing = this.relations.get(relId);
    if (existing) {
      existing.mentions += 1;
      return;
    }
    this.relations.set(relId, {
      id: relId, sourceId: e.sourceId, targetId: e.targetId, type: e.relType,
      ...(e.reason ? { reason: e.reason } : {}),
      mentions: 1,
    });
  }

  private toResult(e: CkgEntity, salience?: number): CkgRecallResult {
    const rels = [...this.relations.values()].filter((r) => r.sourceId === e.id);
    return {
      id: e.id, type: e.type, name: e.name, text: e.text,
      salience: salience ?? computeSalience(e.mentions, new Date(e.updatedAt)),
      mentions: e.mentions,
      confidence: e.confidence,
      corroborations: e.contributors.size,
      ...(e.agentId ? { agentId: e.agentId } : {}),
      ...(e.source ? { source: e.source } : {}),
      relations: rels.map((r) => ({
        predicate: r.type,
        target: r.targetId,
        ...(r.reason ? { reason: r.reason } : {}),
      })),
    };
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.8));
}

/** Recover the fact category from a fact node's match-key name. */
function categoryFromFactName(name: string): FactCategory | null {
  return parseFactKey(name)?.category ?? null;
}

function safeAgentId(): string {
  try {
    return defaultFleetAgentId();
  } catch {
    return 'unknown/unknown';
  }
}

let singleton: CollectiveKnowledgeGraph | null = null;
/** Process-wide CKG bound to the default shared ledger. */
export function getCollectiveKnowledgeGraph(): CollectiveKnowledgeGraph {
  if (!singleton) singleton = new CollectiveKnowledgeGraph();
  return singleton;
}

/** Test seam — reset the singleton. */
export function resetCollectiveKnowledgeGraph(): void {
  singleton = null;
}
