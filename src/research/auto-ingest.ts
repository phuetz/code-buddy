/**
 * Autonomous research ingestion — the daemon, when idle, studies a database of scientific
 * publications on its own and feeds the Collective Knowledge Graph. Combined with the
 * self-improvement bridge (the lesson drafter recalls the CKG), this closes Patrice's loop:
 * "avec une base de connaissances sur l'IA, Code Buddy s'auto-améliore plus facilement".
 *
 * Opt-in via `CODEBUDDY_RESEARCH_TOPICS` (csv). One topic per idle cycle (round-robin),
 * bounded and NEVER-THROWS. Core is injectable so it is unit-testable without the network.
 *
 * @module research/auto-ingest
 */

import { logger } from '../utils/logger.js';
import type { Publication, PublicationSource } from './publication-sources.js';
import type { RelationClassifier } from '../memory/collective-knowledge-graph.js';

export interface AutoIngestDeps {
  /** Topics to rotate through (from CODEBUDDY_RESEARCH_TOPICS). */
  topics: string[];
  fetchPublications: (topic: string, opts: { source?: PublicationSource; limit?: number }) => Promise<Publication[]>;
  ingestPublication: (pub: Publication, opts?: { relationClassifier?: RelationClassifier }) => Promise<unknown>;
  /** Round-robin index source (module counter by default; injected in tests). */
  pickIndex: () => number;
  source?: PublicationSource;
  limit?: number;
  /** When set, neighbour links are tagged supports/contradicts (costs an LLM call per neighbour). */
  relationClassifier?: RelationClassifier;
}

/** Ingest one topic's worth of publications. Never-throws; returns what happened. */
export async function runAutoResearchIngest(deps: AutoIngestDeps): Promise<{ applied: boolean; detail: string }> {
  const topics = deps.topics.map((t) => t.trim()).filter(Boolean);
  if (topics.length === 0) return { applied: false, detail: 'CODEBUDDY_RESEARCH_TOPICS not set' };
  const topic = topics[Math.abs(deps.pickIndex()) % topics.length]!;
  try {
    const pubs = await deps.fetchPublications(topic, { ...(deps.source ? { source: deps.source } : {}), limit: deps.limit ?? 4 });
    let n = 0;
    const opts = deps.relationClassifier ? { relationClassifier: deps.relationClassifier } : undefined;
    for (const p of pubs) {
      if (await deps.ingestPublication(p, opts)) n++;
    }
    return n > 0
      ? { applied: true, detail: `ingested ${n} publication(s) on "${topic}"` }
      : { applied: false, detail: `no new publications for "${topic}"` };
  } catch (err) {
    return { applied: false, detail: `research ingest failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Seed from the clock so a daemon restart doesn't always re-pick topic[0] (the rotation keeps
// advancing across restarts instead of re-ingesting — and dedup-dropping — the same first topic).
let cursor = Math.floor(Date.now() / 60_000);

/** Parse CODEBUDDY_RESEARCH_TOPICS into a topic list. */
export function readResearchTopics(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CODEBUDDY_RESEARCH_TOPICS ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Default wiring used by the autonomous daemon idle hook: reads env, ingests one topic into
 * the real CKG, rotating across cycles. No-op (applied:false) when no topics are configured.
 */
export async function defaultAutoResearchIngest(): Promise<{ applied: boolean; detail: string }> {
  const { resolveResearchTopics } = await import('./research-topics.js');
  const topics = resolveResearchTopics(); // env ∪ persisted store (buddy research topics …)
  if (topics.length === 0) return { applied: false, detail: 'no research topics (env CODEBUDDY_RESEARCH_TOPICS or `buddy research topics add`)' };
  try {
    const { fetchPublications } = await import('./publication-sources.js');
    const { getCollectiveKnowledgeGraph } = await import('../memory/collective-knowledge-graph.js');
    const ckg = getCollectiveKnowledgeGraph();
    const sourceEnv = (process.env.CODEBUDDY_RESEARCH_SOURCE ?? '').toLowerCase();
    const source = (['arxiv', 'europepmc', 'both'].includes(sourceEnv) ? sourceEnv : undefined) as
      | PublicationSource
      | undefined;
    const limit = Number(process.env.CODEBUDDY_RESEARCH_LIMIT) || 4;
    // Opt-in supports/contradicts tagging on the autonomous path (costs one LLM call per
    // neighbour, hence gated separately from ingestion itself).
    let relationClassifier;
    if (process.env.CODEBUDDY_RESEARCH_CLASSIFY === 'true') {
      const { makeLlmRelationClassifier } = await import('./relation-classifier.js');
      relationClassifier = makeLlmRelationClassifier();
    }
    const result = await runAutoResearchIngest({
      topics,
      fetchPublications,
      ingestPublication: (pub, opts) => ckg.ingestPublication(pub, opts ?? {}),
      pickIndex: () => cursor++,
      ...(source ? { source } : {}),
      limit,
      ...(relationClassifier ? { relationClassifier } : {}),
    });
    if (result.applied) logger.info(`[auto-research] ${result.detail}`);
    return result;
  } catch (err) {
    return { applied: false, detail: `auto-research unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
