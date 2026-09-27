/**
 * Research-driven weakness source — the loop's most valuable input: ambitious improvement goals
 * grounded in ingested scientific articles, matched to the CONCERNED Code Buddy functionality.
 *
 * Closes the loop the CKG + research daemon prepared: article → CKG (typed `discovery`) → match to a
 * feature area (semantic recall) → synthesize a targeted, actionable goal → evolution. Unlike the
 * internal sources (hotspots/eval), this brings ideas from OUTSIDE the system, so self-improvement is
 * open rather than turning on itself.
 *
 * Anti-Leviathan: reuses `recallHybrid` (matching), the feature map, and the in-process LLM pattern.
 * Everything is injectable (featureMap / recall / chat) so it's unit-tested without a CKG or provider,
 * and never-throws → [] falls back to the other sources (zero regression when nothing is ingested).
 *
 * @module agent/self-improvement/evolution/research-weakness-source
 */
import { logger } from '../../../utils/logger.js';
import type { CollectiveKnowledgeGraph } from '../../../memory/collective-knowledge-graph.js';
import type { Weakness } from './evolution-engine.js';
import { getFeatureMap, type FeatureArea, type FeatureEnrichment } from './feature-map.js';
import { buildResearchQuery, createResearchBm25Recall, fuseResearchRanks, isResearchArticle } from './research-retrieval.js';

/** A recall hit reduced to what prioritization + synthesis need (subset of CkgRecallResult). */
export interface ResearchHit {
  id?: string;
  name?: string;
  text: string;
  similarity?: number;
  confidence: number;
  corroborations?: number;
  source?: string;
  /** RRF score, when both retrieval legs were available. */
  retrievalScore?: number;
  relations?: Array<{ predicate: string; target?: string; reason?: string }>;
}

export type ResearchRecall = (query: string, opts: { types?: string[]; limit?: number }) => Promise<ResearchHit[]>;
export type SynthChat = (prompt: string) => Promise<string | null>;

export interface FetchResearchGoalsArgs {
  /** Feature areas (default: getFeatureMap). Inject a small list for tests. */
  features?: FeatureArea[];
  enrich?: FeatureEnrichment;
  recall?: ResearchRecall;
  chat?: SynthChat;
  /** Max goals to emit. */
  limit?: number;
  /** Discoveries recalled per feature. */
  perFeature?: number;
  /** Minimum semantic similarity for a match to count. */
  minSimilarity?: number;
  /** Restore the historical 0.32 similarity floor; default leaves it off. */
  filterMode?: 'none' | 'legacy';
  /** Explicit retrieval choice, so a measured regression can be reverted. */
  retrievalMode?: 'legacy' | 'hybrid';
  /** Repeat the component description in the query; retained for measured comparisons. */
  queryMode?: 'plain' | 'component';
  model?: string;
}

const DEFAULT_MIN_SIMILARITY = 0.32;

// ── prioritization (pure) ───────────────────────────────────────────────

export function isContradicted(hit: ResearchHit): boolean {
  return (hit.relations ?? []).some((r) => r.predicate === 'contradicts');
}

/** Match strength: similarity × confidence, lifted when the discovery is corroborated / supported. */
export function matchScore(hit: ResearchHit): number {
  const sim = typeof hit.similarity === 'number' ? hit.similarity : 0;
  const conf = typeof hit.confidence === 'number' ? hit.confidence : 0.5;
  const supported = (hit.relations ?? []).some((r) => r.predicate === 'supports' || r.predicate === 'builds_on');
  const corroBoost = 1 + 0.1 * Math.max(0, (hit.corroborations ?? 1) - 1);
  return sim * conf * (supported ? 1.15 : 1) * corroBoost;
}

export interface FeatureMatch {
  feature: FeatureArea;
  hit: ResearchHit;
  score: number;
}

/** Best (feature × discovery) matches: contradiction gate, optional historical similarity floor. */
export function selectMatches(
  candidates: FeatureMatch[],
  opts: { minSimilarity?: number; limit?: number; filterMode?: 'none' | 'legacy' } = {},
): FeatureMatch[] {
  const floor = opts.minSimilarity ?? (opts.filterMode === 'legacy' ? DEFAULT_MIN_SIMILARITY : null);
  const kept = candidates.filter(
    (c) => (floor === null || (c.hit.similarity ?? 0) >= floor) && !isContradicted(c.hit),
  );
  // One goal per feature (avoid N goals all hitting the same area), best-first.
  kept.sort((a, b) => b.score - a.score);
  const seenFeature = new Set<string>();
  const out: FeatureMatch[] = [];
  for (const m of kept) {
    if (seenFeature.has(m.feature.id)) continue;
    seenFeature.add(m.feature.id);
    out.push(m);
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

/** Prompt asking the model to turn a (feature, article) match into ONE ambitious, actionable goal. */
export function buildGoalPrompt(feature: FeatureArea, hit: ResearchHit): string {
  return [
    'À partir d\'un article de recherche et d\'une fonctionnalité de Code Buddy, formule UN objectif',
    'd\'amélioration ambitieux MAIS concret et faisable — appliquer la technique de l\'article à cette',
    'fonctionnalité. Si l\'article n\'est pas réellement applicable à ce code, réponds exactement "NONE".',
    'Réponds par UNE phrase impérative (le goal), rien d\'autre.',
    '',
    `Fonctionnalité : ${feature.name} — ${feature.description}`,
    `Fichiers : ${feature.paths.join(', ') || '(non précisé)'}`,
    '',
    `Article : ${hit.text.slice(0, 800)}`,
  ].join('\n');
}

/** Parse the synthesized goal; "" / "NONE" / too-short → null (not actionable). */
export function parseGoal(text: string | null): string | null {
  const t = (text ?? '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!t || /^none$/i.test(t) || t.length < 12) return null;
  return t.split('\n')[0]!.trim();
}

// ── default recall + chat (in-process, reused patterns) ──────────────────

function makeDefaultRecall(mode: 'legacy' | 'hybrid', graph?: CollectiveKnowledgeGraph): ResearchRecall {
  let bm25: ReturnType<typeof createResearchBm25Recall> | null = null;
  return async (query, opts) => {
    try {
      const { getCollectiveKnowledgeGraph } = await import('../../../memory/collective-knowledge-graph.js');
      const ckg = graph ?? getCollectiveKnowledgeGraph();
      const hits = await ckg.recallHybrid(query, {
        types: ['discovery'],
        limit: mode === 'hybrid' ? 100 : (opts.limit ?? 3),
        ...(mode === 'hybrid' ? { semanticWeight: 1, mmrLambda: 1, inProcess: true } : {}),
      });
      let lexical: typeof hits = [];
      if (mode === 'hybrid') {
        try {
          lexical = (bm25 ??= createResearchBm25Recall(ckg))(query, 100);
        } catch (err) {
          logger.debug(`[evolve] research BM25 unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const ranked = mode === 'hybrid'
        ? fuseResearchRanks(hits.filter(isResearchArticle), lexical, opts.limit ?? 20)
        : hits.map((hit) => ({ hit, score: matchScore(hit) }));
      return ranked.map(({ hit: h, score }) => ({
        id: h.id,
        name: h.name,
        text: h.text,
        similarity: h.similarity,
        confidence: h.confidence,
        corroborations: h.corroborations,
        source: h.source,
        relations: h.relations,
        ...(mode === 'hybrid' ? { retrievalScore: score } : {}),
      }));
    } catch {
      return [];
    }
  };
}

export interface ResearchSelectionArgs extends Pick<FetchResearchGoalsArgs,
  'recall' | 'perFeature' | 'limit' | 'minSimilarity' | 'filterMode' | 'retrievalMode' | 'queryMode'> {
  features: FeatureArea[];
  /** Explicit graph for an offline benchmark; production uses its normal singleton. */
  ckg?: CollectiveKnowledgeGraph;
}

export function researchQueryForFeature(feature: FeatureArea, mode: 'legacy' | 'hybrid', queryMode: 'plain' | 'component'): string {
  return mode === 'hybrid' && queryMode === 'component'
    ? buildResearchQuery(feature.name, feature) : feature.description;
}

/** The production selection path, shared verbatim with the offline benchmark. */
export async function retrieveResearchMatches(args: ResearchSelectionArgs): Promise<FeatureMatch[]> {
  const mode = args.retrievalMode ?? (process.env.CODEBUDDY_DGM_RESEARCH_RETRIEVAL === 'legacy' ? 'legacy' : 'hybrid');
  const recall = args.recall ?? makeDefaultRecall(mode, args.ckg);
  const perFeature = args.perFeature ?? (mode === 'hybrid' ? 20 : 3);
  const queryMode = args.queryMode ?? (process.env.CODEBUDDY_DGM_RESEARCH_QUERY === 'component' ? 'component' : 'plain');
  const candidates: FeatureMatch[] = [];
  for (const feature of args.features) {
    let hits: ResearchHit[] = [];
    try {
      const query = researchQueryForFeature(feature, mode, queryMode);
      hits = await recall(query, { types: ['discovery'], limit: perFeature });
    } catch {
      hits = [];
    }
    for (const hit of hits) {
      if (!hit?.text) continue;
      candidates.push({ feature, hit, score: hit.retrievalScore ?? matchScore(hit) });
    }
  }
  return selectMatches(candidates, {
    ...(args.minSimilarity !== undefined ? { minSimilarity: args.minSimilarity } : {}),
    filterMode: args.filterMode ?? (process.env.CODEBUDDY_DGM_RESEARCH_FILTER === 'legacy' ? 'legacy' : 'none'),
    limit: args.limit ?? 3,
  });
}

function makeDefaultChat(model?: string): SynthChat {
  return async (prompt) => {
    try {
      const { detectProviderFromEnv } = await import('../../../utils/provider-detector.js');
      const { CodeBuddyClient } = await import('../../../codebuddy/client.js');
      const detected = detectProviderFromEnv();
      if (!detected) return null;
      const client = new CodeBuddyClient(detected.apiKey, model ?? detected.defaultModel, detected.baseURL);
      const resp = await client.chat([{ role: 'user', content: prompt }] as never, []);
      return (resp as { choices?: Array<{ message?: { content?: string | null } }> })?.choices?.[0]?.message?.content ?? null;
    } catch {
      return null;
    }
  };
}

// ── the source ───────────────────────────────────────────────────────────

/**
 * Produce ambitious, article-grounded weaknesses: match each feature area to ingested discoveries,
 * keep the strongest non-contradicted matches, and synthesize one goal each. Never-throws → [].
 */
export async function fetchResearchGoals(args: FetchResearchGoalsArgs = {}): Promise<Weakness[]> {
  try {
    const features = args.features ?? (await getFeatureMap(args.enrich ? { enrich: args.enrich } : {}));
    const chat = args.chat ?? makeDefaultChat(args.model);
    const matches = await retrieveResearchMatches({ ...args, features });

    const goals: Weakness[] = [];
    let i = 0;
    for (const m of matches) {
      const goal = parseGoal(await chat(buildGoalPrompt(m.feature, m.hit)));
      if (!goal) continue; // model judged it not actionable
      goals.push({ id: `research-${m.feature.id}-${++i}`, kind: 'research', goal });
    }
    if (goals.length > 0) logger.info(`[evolve] research source → ${goals.length} article-grounded goal(s)`);
    return goals;
  } catch (err) {
    logger.debug(`[evolve] research goal source failed → []: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
