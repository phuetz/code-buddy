/**
 * Deep Research — Phase A (GPT-Researcher-style deterministic, cited pipeline).
 *
 * This is the OPT-IN counterpart to Wide Research (`wide-research.ts`). Wide
 * Research fans out coarse *thematic* subtopics and lets each worker agent
 * decide (non-deterministically) whether to search/scrape; citations are lost
 * at aggregation. Deep Research replaces that with a deterministic, bounded,
 * end-to-end-cited pipeline:
 *
 *   1. plan     — question → N sub-questions → 2-3 concrete search queries each
 *                 (one bounded LLM call, deterministic fallback on any failure)
 *   2. collect  — DETERMINISTIC fan-out: each query → web_search(top-K) →
 *                 unique URLs → scrape in parallel batches (Firecrawl or cheap
 *                 fetch), globally bounded. A failed scrape drops that source.
 *   3. dedup    — pragmatic near-duplicate detection between scraped sources
 *                 (normalize → word-shingle hashes → Jaccard), like the dHash
 *                 dedup in tools/video/frame-dedup.ts. No new heavy dep.
 *   4. cite     — a source registry {id,url,title} is threaded from collection
 *                 to synthesis; the report carries inline [n] markers and a
 *                 numbered "## Références" section rendered deterministically.
 *   5. synthesize — one LLM call aggregates the deduped, cited sources into a
 *                 structured report (TL;DR, body per sub-question, references),
 *                 with a deterministic fallback body on failure.
 *
 * Everything here is PURE and its side-effecting edges (LLM, search, scrape,
 * fingerprint, batching) are INJECTABLE `DeepResearchBoundaries` so the whole
 * pipeline is unit-testable with zero network. Every stage is never-throws:
 * a boundary failure degrades gracefully, it never crashes the research.
 *
 * @module agent/deep-research
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Options (all BOUNDED — token/time cost is capped regardless of the question)
// ============================================================================

export interface DeepResearchOptions {
  /** Max sub-questions the planner may emit (default 4). */
  maxSubQuestions?: number;
  /** Concrete search queries per sub-question (default 3, GPT-Researcher-style). */
  queriesPerSubQuestion?: number;
  /** Top-K search results taken per query (default 5). */
  resultsPerQuery?: number;
  /** Global cap on scraped sources across all queries (default 12). */
  maxSources?: number;
  /** Jaccard similarity ≥ threshold ⇒ near-duplicate source, dropped (default 0.8). */
  dedupThreshold?: number;
  /** Parallel scrape batch size (default 5). */
  concurrency?: number;
  /** Per-source content chars fed to synthesis (default 3000). */
  perSourceChars?: number;
}

type ResolvedOptions = Required<DeepResearchOptions>;

const DEFAULTS: ResolvedOptions = {
  maxSubQuestions: 4,
  queriesPerSubQuestion: 3,
  resultsPerQuery: 5,
  maxSources: 12,
  dedupThreshold: 0.8,
  concurrency: 5,
  perSourceChars: 3000,
};

export function resolveDeepResearchOptions(o: DeepResearchOptions = {}): ResolvedOptions {
  return {
    maxSubQuestions: clampInt(o.maxSubQuestions, DEFAULTS.maxSubQuestions, 1, 12),
    queriesPerSubQuestion: clampInt(o.queriesPerSubQuestion, DEFAULTS.queriesPerSubQuestion, 1, 6),
    resultsPerQuery: clampInt(o.resultsPerQuery, DEFAULTS.resultsPerQuery, 1, 10),
    maxSources: clampInt(o.maxSources, DEFAULTS.maxSources, 1, 40),
    dedupThreshold: clampFloat(o.dedupThreshold, DEFAULTS.dedupThreshold, 0.5, 1),
    concurrency: clampInt(o.concurrency, DEFAULTS.concurrency, 1, 10),
    perSourceChars: clampInt(o.perSourceChars, DEFAULTS.perSourceChars, 500, 20000),
  };
}

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}
function clampFloat(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.max(min, Math.min(max, n));
}

// ============================================================================
// Data types
// ============================================================================

export interface DeepLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** A sub-question plus the concrete search queries that answer it. */
export interface SubQuestionPlan {
  subQuestion: string;
  queries: string[];
}

export interface DeepQueryPlan {
  question: string;
  subQuestions: SubQuestionPlan[];
}

/** A scraped source with its stable citation id (assigned AFTER dedup). */
export interface CollectedSource {
  id: number;
  url: string;
  title: string;
  content: string;
  /** The query that surfaced this source (provenance). */
  query: string;
}

/** The citation registry entry threaded end-to-end. */
export interface SourceRef {
  id: number;
  url: string;
  title: string;
}

export interface DeepResearchResult {
  question: string;
  plan: DeepQueryPlan;
  /** Final numbered source registry (post-dedup). */
  sources: SourceRef[];
  /** The cited report (inline [n] markers + "## Références" section). */
  report: string;
  durationMs: number;
  /** True when the LLM planner succeeded (false ⇒ deterministic fallback). */
  plannerLlmUsed: boolean;
  /** True when the LLM synthesizer succeeded (false ⇒ deterministic fallback). */
  synthesisLlmUsed: boolean;
  /** How many scraped sources were dropped as near-duplicates. */
  duplicatesDropped: number;
  /** Per-stage in/out counts. Always present on pipeline results. */
  trace?: DeepResearchTrace;
}

/** Journal of how many results entered/left each collection stage. */
export interface DeepResearchTrace {
  queries: number;
  searchHits: number;
  hitsWithUrl: number;
  uniqueUrls: number;
  scrapeAttempted: number;
  scrapeNonEmpty: number;
  snippetFallbacks: number;
  emptyDropped: number;
  dedupKept: number;
  dedupDropped: number;
  searchErrors: string[];
  scrapeErrors: string[];
  providerNotes: string[];
}

export function emptyDeepResearchTrace(): DeepResearchTrace {
  return {
    queries: 0,
    searchHits: 0,
    hitsWithUrl: 0,
    uniqueUrls: 0,
    scrapeAttempted: 0,
    scrapeNonEmpty: 0,
    snippetFallbacks: 0,
    emptyDropped: 0,
    dedupKept: 0,
    dedupDropped: 0,
    searchErrors: [],
    scrapeErrors: [],
    providerNotes: [],
  };
}

/**
 * Explicit failure copy when Deep Research would otherwise announce a
 * "successful" report with an empty citation registry.
 */
export function formatZeroSourceFailure(result: DeepResearchResult): string {
  const t = result.trace;
  const lines = [
    'Deep Research produced 0 cited sources — refusing to report success.',
  ];
  if (t) {
    lines.push(
      `Stages: queries=${t.queries} searchHits=${t.searchHits} hitsWithUrl=${t.hitsWithUrl} uniqueUrls=${t.uniqueUrls} scrapeAttempted=${t.scrapeAttempted} scrapeNonEmpty=${t.scrapeNonEmpty} snippetFallbacks=${t.snippetFallbacks} emptyDropped=${t.emptyDropped} dedupKept=${t.dedupKept} dedupDropped=${t.dedupDropped}`,
    );
    if (t.providerNotes.length > 0) lines.push(`Providers: ${t.providerNotes.join('; ')}`);
    if (t.searchErrors.length > 0) lines.push(`Search errors: ${t.searchErrors.join('; ')}`);
    if (t.scrapeErrors.length > 0) {
      lines.push(`Scrape errors: ${t.scrapeErrors.slice(0, 8).join('; ')}`);
    }
  } else {
    lines.push('Stages: (no per-stage trace — pipeline returned an empty registry)');
  }
  return lines.join('\n');
}

// ============================================================================
// Boundaries (INJECTABLE edges — real impls wired by the orchestrator)
// ============================================================================

export interface DeepResearchBoundaries {
  /** Bounded LLM chat. Returns assistant text; MAY throw (caller falls back). */
  llm(messages: DeepLlmMessage[]): Promise<string>;
  /** Web search returning up to `k` structured hits. Never expected to throw, but caller guards anyway. */
  search(query: string, k: number): Promise<SearchHit[]>;
  /** Scrape a URL → plain/markdown content ('' when empty/unavailable). Caller guards throws. */
  scrape(url: string): Promise<string>;
  /** Content fingerprint for dedup (default: word-shingle hashes). */
  fingerprint?(text: string): number[];
  /** Parallel batched map (default: internal chunk + Promise.all). Injected by the orchestrator to reuse its batching. */
  mapBatched?<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]>;
  /**
   * Phase B (gap loop) ONLY: examine the current draft + collected sources and
   * return the identified gaps as new targeted queries. Optional — when absent,
   * a default implementation drives it through `llm`. MAY throw (the loop stops
   * cleanly with the current draft on failure).
   */
  analyzeGaps?(input: GapAnalysisInput): Promise<GapAnalysis>;
}

export type DeepResearchStage =
  | { stage: 'planning' }
  | { stage: 'planned'; subQuestions: number; queries: number; llmUsed: boolean }
  | { stage: 'collecting'; urls: number }
  | { stage: 'searched'; queries: number; hits: number; urls: number }
  | { stage: 'collected'; scraped: number }
  | { stage: 'deduped'; kept: number; dropped: number }
  | { stage: 'synthesizing' }
  | { stage: 'done'; sources: number }
  // Phase B (gap loop) — only emitted when rounds > 1.
  | { stage: 'gap-analysis'; round: number }
  | { stage: 'gaps'; round: number; gaps: number; queries: number; sufficient: boolean }
  | { stage: 'merged'; round: number; added: number; dropped: number; total: number }
  | {
      stage: 'converged';
      round: number;
      reason: 'sufficient' | 'no-new-sources' | 'source-cap' | 'gap-analysis-failed';
    };

// ============================================================================
// 1. Query planner
// ============================================================================

const PLANNER_SYSTEM = [
  'You are a research query planner. Given a question, break it into a small set of',
  'independent sub-questions, and for each sub-question write concrete, effective WEB SEARCH',
  'QUERIES (not topics — real queries you would type into a search engine).',
  'Return ONLY a JSON object of the exact shape:',
  '{"subQuestions":[{"subQuestion":"...","queries":["query 1","query 2"]}]}',
  'No prose, no markdown fences.',
].join('\n');

/**
 * Plan concrete search queries. One bounded LLM call; on ANY failure (throw,
 * empty, unparseable) falls back to a deterministic plan. Never throws.
 */
export async function planQueries(
  question: string,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): Promise<{ plan: DeepQueryPlan; llmUsed: boolean }> {
  const userPrompt = [
    `Question: ${question}`,
    '',
    `Produce at most ${opts.maxSubQuestions} sub-questions.`,
    `Each sub-question must have ${opts.queriesPerSubQuestion} concrete search queries.`,
    'Return the JSON object only.',
  ].join('\n');

  try {
    const raw = await boundaries.llm([
      { role: 'system', content: PLANNER_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
    const parsed = parsePlan(raw, question, opts);
    if (parsed && parsed.subQuestions.length > 0) {
      return { plan: parsed, llmUsed: true };
    }
  } catch (err) {
    logger.debug(`[deep-research] planner LLM failed: ${errMsg(err)}`);
  }
  return { plan: fallbackPlan(question, opts), llmUsed: false };
}

function parsePlan(raw: string, question: string, opts: ResolvedOptions): DeepQueryPlan | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  const rawList = Array.isArray(obj)
    ? (obj as unknown[])
    : Array.isArray((obj as { subQuestions?: unknown })?.subQuestions)
      ? ((obj as { subQuestions: unknown[] }).subQuestions)
      : [];
  const subQuestions: SubQuestionPlan[] = [];
  for (const entry of rawList) {
    if (subQuestions.length >= opts.maxSubQuestions) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { subQuestion?: unknown; queries?: unknown };
    const sq = typeof e.subQuestion === 'string' ? e.subQuestion.trim() : '';
    const queries = Array.isArray(e.queries)
      ? e.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
      : [];
    if (!sq || queries.length === 0) continue;
    subQuestions.push({ subQuestion: sq, queries: dedupStrings(queries).slice(0, opts.queriesPerSubQuestion) });
  }
  if (subQuestions.length === 0) return null;
  return { question, subQuestions };
}

/**
 * Deterministic fallback plan: the question itself as the single sub-question,
 * with a bounded set of query variants. Fully offline.
 */
export function fallbackPlan(question: string, opts: ResolvedOptions): DeepQueryPlan {
  const base = question.trim();
  const variants = [
    base,
    `${base} overview`,
    `${base} latest developments`,
    `${base} key facts`,
    `${base} pros and cons`,
    `${base} explained`,
  ];
  const queries = dedupStrings(variants).slice(0, opts.queriesPerSubQuestion);
  return { question, subQuestions: [{ subQuestion: base, queries }] };
}

// ============================================================================
// 2. Deterministic source collection (fan-out → top-K → scrape)
// ============================================================================

/**
 * Deterministic fan-out. For every planned query: web_search(top-K) → collect
 * unique URLs in a stable order → globally cap at maxSources → scrape in
 * parallel batches. A search that fails yields no hits for that query; a scrape
 * that fails/returns empty drops that source. Never throws.
 *
 * Returns sources WITHOUT final ids (ids are assigned after dedup).
 */
export async function collectSources(
  plan: DeepQueryPlan,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
  trace: DeepResearchTrace = emptyDeepResearchTrace(),
): Promise<Array<Omit<CollectedSource, 'id'>>> {
  const flatQueries: string[] = [];
  for (const sq of plan.subQuestions) {
    for (const q of sq.queries) flatQueries.push(q);
  }
  const queries = dedupStrings(flatQueries);
  const mapBatched = boundaries.mapBatched ?? defaultMapBatched;

  // Bounded fan-out: 12 parallel DuckDuckGo queries trip CAPTCHA and wipe the
  // whole round. Reassemble hits in deterministic query order via mapBatched.
  const perQueryHits = await mapBatched(queries, opts.concurrency, async (query) => {
    try {
      const hits = await boundaries.search(query, opts.resultsPerQuery);
      const list = Array.isArray(hits) ? hits.slice(0, opts.resultsPerQuery) : [];
      const withUrl = list.filter((h) => typeof h?.url === 'string' && h.url.trim().length > 0);
      trace.queries += 1;
      trace.searchHits += list.length;
      trace.hitsWithUrl += withUrl.length;
      trace.providerNotes.push(
        `query "${query}": ${list.length} hit(s) in, ${withUrl.length} with URL`,
      );
      logger.info('[deep-research] search stage', {
        query,
        hitsIn: list.length,
        hitsWithUrl: withUrl.length,
      });
      return { query, hits: list };
    } catch (err) {
      const message = errMsg(err);
      logger.debug(`[deep-research] search failed for "${query}": ${message}`);
      trace.queries += 1;
      trace.searchErrors.push(`${query}: ${message}`);
      trace.providerNotes.push(`query "${query}": search failed (${message})`);
      return { query, hits: [] as SearchHit[] };
    }
  });

  // Collect unique URLs in stable order, globally bounded BEFORE scraping.
  const seen = new Set<string>();
  const targets: Array<{ url: string; title: string; query: string; snippet: string }> = [];
  for (const { query, hits } of perQueryHits) {
    for (const hit of hits) {
      const url = typeof hit?.url === 'string' ? hit.url.trim() : '';
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const snippet = typeof hit.snippet === 'string' ? hit.snippet.trim() : '';
      targets.push({ url, title: (hit.title || url).trim(), query, snippet });
      if (targets.length >= opts.maxSources) break;
    }
    if (targets.length >= opts.maxSources) break;
  }
  trace.uniqueUrls = targets.length;
  logger.info('[deep-research] unique URLs before scrape', { uniqueUrls: targets.length });

  const scraped = await mapBatched(targets, opts.concurrency, async (t) => {
    trace.scrapeAttempted += 1;
    let content = '';
    try {
      content = await boundaries.scrape(t.url);
    } catch (err) {
      const message = errMsg(err);
      logger.debug(`[deep-research] scrape failed for ${t.url}: ${message}`);
      trace.scrapeErrors.push(`${t.url}: ${message}`);
      content = '';
    }
    content = typeof content === 'string' ? content : '';
    if (content.trim().length > 0) {
      trace.scrapeNonEmpty += 1;
    } else if (t.snippet) {
      // Search snippets are citable when the page fetch is empty/blocked.
      content = t.snippet;
      trace.snippetFallbacks += 1;
      logger.info('[deep-research] snippet fallback', { url: t.url });
    } else {
      trace.emptyDropped += 1;
      trace.scrapeErrors.push(`${t.url}: empty scrape and empty snippet`);
    }
    return { url: t.url, title: t.title, query: t.query, content };
  });

  const kept = scraped.filter((s) => s.content.trim().length > 0);
  logger.info('[deep-research] scrape stage', {
    attempted: trace.scrapeAttempted,
    nonEmpty: trace.scrapeNonEmpty,
    snippetFallbacks: trace.snippetFallbacks,
    emptyDropped: trace.emptyDropped,
    kept: kept.length,
  });
  return kept;
}

// ============================================================================
// 3. Pragmatic content dedup (normalize → shingle hashes → Jaccard)
// ============================================================================

/** Unicode-friendly text normalization for fingerprinting. */
function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit string hash. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SHINGLE_WORDS = 4;
const FINGERPRINT_MAX_CHARS = 8000;

/**
 * Content fingerprint: the set of word-shingle hashes over the normalized,
 * length-bounded text. Empty/whitespace input → []. Never throws.
 */
export function contentFingerprint(text: string): number[] {
  try {
    const norm = normalizeForFingerprint(text).slice(0, FINGERPRINT_MAX_CHARS);
    if (!norm) return [];
    const words = norm.split(' ').filter(Boolean);
    if (words.length === 0) return [];
    const k = Math.min(SHINGLE_WORDS, words.length);
    const set = new Set<number>();
    for (let i = 0; i + k <= words.length; i++) {
      set.add(hashString(words.slice(i, i + k).join(' ')));
    }
    if (set.size === 0) set.add(hashString(norm));
    return Array.from(set);
  } catch {
    return [];
  }
}

/** Jaccard similarity of two fingerprint sets, 0..1. Empty either ⇒ 0. */
export function fingerprintSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setB) if (setA.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Drop near-duplicate sources (compared against ALL previously-kept sources,
 * unlike frame-dedup's consecutive-only rule, since two different queries can
 * surface the same article). Keeps the first occurrence, assigns stable ids
 * 1..M to the kept set. Fail-open: an unfingerprintable source is kept. Never throws.
 */
export function dedupSources(
  sources: Array<Omit<CollectedSource, 'id'>>,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): { kept: CollectedSource[]; dropped: number } {
  const fingerprint = boundaries.fingerprint ?? contentFingerprint;
  const kept: CollectedSource[] = [];
  const keptPrints: number[][] = [];
  let dropped = 0;

  for (const src of sources) {
    let print: number[] = [];
    try {
      print = fingerprint(src.content);
    } catch {
      print = [];
    }
    let isDup = false;
    if (print.length > 0) {
      for (const prev of keptPrints) {
        if (fingerprintSimilarity(print, prev) >= opts.dedupThreshold) {
          isDup = true;
          break;
        }
      }
    }
    if (isDup) {
      dropped++;
      continue;
    }
    kept.push({ ...src, id: kept.length + 1 });
    keptPrints.push(print);
  }

  return { kept, dropped };
}

// ============================================================================
// 4. Citation registry rendering
// ============================================================================

export function toSourceRegistry(sources: CollectedSource[]): SourceRef[] {
  return sources.map((s) => ({ id: s.id, url: s.url, title: s.title }));
}

/** Deterministic numbered references section. Always rendered from the registry. */
export function renderReferences(sources: SourceRef[]): string {
  if (sources.length === 0) {
    return '## Références\n\n_Aucune source citable n\'a pu être collectée._';
  }
  const lines = ['## Références', ''];
  for (const s of sources) {
    lines.push(`[${s.id}] ${s.title} — ${s.url}`);
  }
  return lines.join('\n');
}

/** Strip a trailing references/sources heading the LLM may have added (we own that section). */
function stripTrailingReferences(body: string): string {
  return body.replace(/\n+#{1,6}\s*(références|references|sources|bibliographie)\b[\s\S]*$/i, '').trimEnd();
}

/**
 * Remove `[n]` citation markers the LLM fabricated — any number outside `1..validCount`
 * (0, or higher than the number of real sources). `renderReferences` only ever lists
 * ids `1..validCount`, so an unstripped `[7]` against 5 sources would be a PHANTOM citation
 * (unresolvable in the report). Mirrors the anti-hallucination `stripInvalidMarkers` in
 * `src/research/paper-qa/answer.ts` (which stays untouched — it is not exported). Pure; never throws.
 */
export function stripInvalidCitationMarkers(body: string, validCount: number): string {
  if (typeof body !== 'string' || body.length === 0) return typeof body === 'string' ? body : '';
  const max = Number.isInteger(validCount) && validCount > 0 ? validCount : 0;
  return body.replace(/\[(\d{1,5})\]/g, (full, num: string) => {
    const n = Number(num);
    return Number.isInteger(n) && n >= 1 && n <= max ? full : '';
  });
}

// ============================================================================
// 5. Objective synthesis (cited)
// ============================================================================

const SYNTH_SYSTEM = [
  'You are an objective research synthesizer. Combine the provided sources into a single,',
  'well-structured Markdown report. Requirements:',
  '- Start with a "## TL;DR" of 2-4 sentences.',
  '- Then one "## " section per sub-question, answering it from the sources.',
  '- Aggregate MULTIPLE sources per claim to reduce bias; note disagreements explicitly.',
  '- Cite every non-trivial claim with inline markers like [1], [2] using the given source ids.',
  '- Do NOT invent sources or ids. Do NOT write your own references section — it is appended for you.',
  '- Be concise and factual; no meta-commentary.',
].join('\n');

/**
 * Synthesize the deduped, cited sources into a structured report. One LLM call;
 * deterministic fallback body on failure. The "## Références" section is ALWAYS
 * appended from the registry so citation traceability never depends on the LLM.
 * Never throws.
 */
export async function synthesize(
  question: string,
  plan: DeepQueryPlan,
  sources: CollectedSource[],
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
): Promise<{ report: string; llmUsed: boolean }> {
  const registry = toSourceRegistry(sources);
  const references = renderReferences(registry);

  if (sources.length === 0) {
    const body = [
      `# Deep Research: ${question}`,
      '',
      '## TL;DR',
      '',
      'Aucune source exploitable n\'a pu être collectée (recherche ou scraping indisponible). Rapport non concluant.',
    ].join('\n');
    return { report: `${body}\n\n${references}`, llmUsed: false };
  }

  const sourceBlock = sources
    .map((s) => `[${s.id}] ${s.title} (${s.url})\n${s.content.slice(0, opts.perSourceChars)}`)
    .join('\n\n---\n\n');

  const subQuestionList = plan.subQuestions.map((sq, i) => `${i + 1}. ${sq.subQuestion}`).join('\n');

  const userPrompt = [
    `Question: ${question}`,
    '',
    'Sub-questions to answer:',
    subQuestionList,
    '',
    'Sources (cite by the bracketed id):',
    '',
    sourceBlock,
  ].join('\n');

  try {
    const raw = await boundaries.llm([
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: userPrompt },
    ]);
    // Strip the LLM's own references heading, THEN drop any fabricated `[n]` beyond the real
    // source count so every surviving marker resolves in the deterministic References section.
    const body = stripInvalidCitationMarkers(stripTrailingReferences((raw || '').trim()), sources.length);
    if (body.length > 0) {
      return { report: `${body}\n\n${references}`, llmUsed: true };
    }
  } catch (err) {
    logger.debug(`[deep-research] synthesis LLM failed: ${errMsg(err)}`);
  }

  return { report: `${buildFallbackBody(question, plan, sources)}\n\n${references}`, llmUsed: false };
}

/** Deterministic report body when the synthesizer LLM is unavailable — still cited. */
function buildFallbackBody(question: string, plan: DeepQueryPlan, sources: CollectedSource[]): string {
  const lines: string[] = [`# Deep Research: ${question}`, '', '## TL;DR', ''];
  lines.push(
    `Synthèse déterministe (LLM indisponible) à partir de ${sources.length} source(s) dédupliquée(s). ` +
      'Chaque section liste les extraits collectés avec leur marqueur de citation.',
  );
  for (const sq of plan.subQuestions) {
    lines.push('', `## ${sq.subQuestion}`, '');
    // Attach every source whose surfacing query belongs to this sub-question.
    const querySet = new Set(sq.queries);
    const related = sources.filter((s) => querySet.has(s.query));
    const chosen = related.length > 0 ? related : sources;
    for (const s of chosen) {
      const excerpt = s.content.replace(/\s+/g, ' ').trim().slice(0, 400);
      lines.push(`- ${excerpt} [${s.id}]`);
    }
  }
  return lines.join('\n');
}

// ============================================================================
// Orchestration entry point (pure — the class method wires real boundaries)
// ============================================================================

/**
 * Run the full Phase-A pipeline. Never throws: every stage degrades gracefully.
 * Emits coarse progress via the optional callback.
 */
export async function runDeepResearchPipeline(
  question: string,
  boundaries: DeepResearchBoundaries,
  options: DeepResearchOptions = {},
  onProgress?: (s: DeepResearchStage) => void,
): Promise<DeepResearchResult> {
  const opts = resolveDeepResearchOptions(options);
  const started = Date.now();
  const emit = (s: DeepResearchStage) => {
    try {
      onProgress?.(s);
    } catch {
      /* progress must never break research */
    }
  };

  emit({ stage: 'planning' });
  const { plan, llmUsed: plannerLlmUsed } = await planQueries(question, boundaries, opts);
  const queryCount = plan.subQuestions.reduce((n, sq) => n + sq.queries.length, 0);
  emit({ stage: 'planned', subQuestions: plan.subQuestions.length, queries: queryCount, llmUsed: plannerLlmUsed });

  const trace = emptyDeepResearchTrace();
  emit({ stage: 'collecting', urls: opts.maxSources });
  let rawSources: Array<Omit<CollectedSource, 'id'>> = [];
  try {
    rawSources = await collectSources(plan, boundaries, opts, trace);
  } catch (err) {
    logger.debug(`[deep-research] collection failed: ${errMsg(err)}`);
    rawSources = [];
  }
  emit({
    stage: 'searched',
    queries: trace.queries,
    hits: trace.searchHits,
    urls: trace.uniqueUrls,
  });
  emit({ stage: 'collected', scraped: rawSources.length });

  const { kept, dropped } = dedupSources(rawSources, boundaries, opts);
  trace.dedupKept = kept.length;
  trace.dedupDropped = dropped;
  emit({ stage: 'deduped', kept: kept.length, dropped });
  logger.info('[deep-research] dedup stage', { kept: kept.length, dropped });

  emit({ stage: 'synthesizing' });
  const { report, llmUsed: synthesisLlmUsed } = await synthesize(question, plan, kept, boundaries, opts);

  const result: DeepResearchResult = {
    question,
    plan,
    sources: toSourceRegistry(kept),
    report,
    durationMs: Date.now() - started,
    plannerLlmUsed,
    synthesisLlmUsed,
    duplicatesDropped: dropped,
    trace,
  };
  emit({ stage: 'done', sources: kept.length });
  return result;
}

// ============================================================================
// Phase B — iterative gap loop (research → draft → gap analysis → re-search)
//
// The Phase-A pipeline above is ONE round. Phase B wraps it in a BOUNDED loop:
// after the initial round produces a draft, a gap-analysis LLM call inspects the
// draft + sub-questions + collected sources and proposes NEW targeted queries;
// those feed another DETERMINISTIC fan-out whose sources are deduped AGAINST the
// already-collected set (same fingerprint mechanism) and merged into the SAME
// citation registry (ids continue 1,2,…). It repeats until convergence ("no
// significant gaps"), a marginal-gain-of-zero round, the accumulated-source cap,
// or the hard round cap. Every stage is never-throws.
//
// STRICTLY additive: `rounds <= 1` (the default) DELEGATES to the exact Phase-A
// `runDeepResearchPipeline`, so `buddy research --deep` without `--iterations`
// is byte-identical to Phase A. The gap-analysis boundary is only ever touched
// when `rounds > 1`.
// ============================================================================

/** Absolute ceiling on sources accumulated across ALL rounds (bounded cost). */
const LOOP_TOTAL_SOURCE_CAP = 50;
/** Draft chars fed to the gap analyzer (bounded token cost). */
const GAP_DRAFT_CHARS = 4000;
/** Hard ceiling on rounds regardless of what the caller asks for. */
const LOOP_MAX_ROUNDS = 5;

export interface DeepResearchLoopOptions extends DeepResearchOptions {
  /**
   * Number of research rounds. Default 1 ⇒ Phase A byte-identical (no gap loop).
   * >1 enables the iterative gap loop; clamped to [1, 5]. Recommended: 2-3.
   */
  rounds?: number;
}

/** The structured output of one gap-analysis pass. */
export interface GapAnalysis {
  /** True when the draft is judged sufficiently covered (convergence signal). */
  sufficient: boolean;
  /** Human-readable description of what is missing (for provenance/progress). */
  gaps: string[];
  /** New targeted search queries to fill the gaps. Empty ⇒ converged. */
  queries: string[];
}

/** Everything the gap analyzer sees about the current state. */
export interface GapAnalysisInput {
  question: string;
  plan: DeepQueryPlan;
  /** The current draft report (already cited). */
  draft: string;
  /** The sources already collected (registry — title/url/id, no content). */
  sources: SourceRef[];
  /** 1-based round about to be researched (>=2). */
  round: number;
}

/** Per-round accounting for the loop result. */
export interface DeepResearchRoundInfo {
  round: number;
  /** The gap queries that triggered this round (empty for round 1). */
  gapQueries: string[];
  /** New sources actually merged this round. */
  newSources: number;
  /** Sources dropped this round as (cross-round) duplicates. */
  duplicatesDropped: number;
}

/** The Phase-B result — a superset of {@link DeepResearchResult}. */
export interface DeepResearchLoopResult extends DeepResearchResult {
  /** Rounds that actually collected sources (1 = Phase A). */
  rounds: number;
  /** True when the loop stopped on convergence (not the hard round cap / failure). */
  converged: boolean;
  /** Per-round accounting. */
  roundInfos: DeepResearchRoundInfo[];
}

export function resolveLoopRounds(n: number | undefined): number {
  return clampInt(n, 1, 1, LOOP_MAX_ROUNDS);
}

const GAP_SYSTEM = [
  'You are a meticulous research gap analyst. You are given a research question, its',
  'sub-questions, the CURRENT DRAFT report, and the list of sources already collected.',
  'Identify what is MISSING: sub-questions that are unanswered or thinly supported, claims',
  'lacking evidence, unresolved contradictions, and important angles not yet covered.',
  'Then propose concrete NEW web search queries that would fill those gaps — queries targeting',
  'information NOT already covered by the collected sources (do not re-request known sources).',
  'If the draft already answers the question well with sufficient evidence, say so.',
  'Return ONLY a JSON object of the exact shape:',
  '{"sufficient": true, "gaps": ["..."], "queries": ["new query 1","new query 2"]}',
  'When sufficient is true, return an empty queries array. No prose, no markdown fences.',
].join('\n');

/**
 * Default gap analyzer — one bounded LLM call through the `llm` boundary. MAY
 * throw (the loop treats a throw as a clean stop). Unparseable/empty output is
 * treated as convergence (sufficient=true, no queries).
 */
async function defaultAnalyzeGaps(
  input: GapAnalysisInput,
  boundaries: DeepResearchBoundaries,
): Promise<GapAnalysis> {
  const subList = input.plan.subQuestions.map((sq, i) => `${i + 1}. ${sq.subQuestion}`).join('\n');
  const sourceList =
    input.sources.map((s) => `[${s.id}] ${s.title} — ${s.url}`).join('\n') || '(none)';
  const userPrompt = [
    `Question: ${input.question}`,
    '',
    'Sub-questions:',
    subList || '(none)',
    '',
    'Current draft report:',
    (input.draft || '').slice(0, GAP_DRAFT_CHARS),
    '',
    'Sources already collected (do NOT request these again):',
    sourceList,
    '',
    'Identify the gaps and propose NEW search queries. Return the JSON object only.',
  ].join('\n');

  const raw = await boundaries.llm([
    { role: 'system', content: GAP_SYSTEM },
    { role: 'user', content: userPrompt },
  ]);
  return parseGapAnalysis(raw);
}

/** Parse a gap-analysis LLM response. Unparseable ⇒ convergence (never throws). */
export function parseGapAnalysis(raw: string): GapAnalysis {
  const json = extractJsonObject(raw);
  if (!json) return { sufficient: true, gaps: [], queries: [] };
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { sufficient: true, gaps: [], queries: [] };
  }
  const o = obj as { sufficient?: unknown; gaps?: unknown; queries?: unknown };
  const gaps = Array.isArray(o.gaps)
    ? o.gaps.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim())
    : [];
  const queries = Array.isArray(o.queries)
    ? o.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim())
    : [];
  // sufficient is explicit true, OR implied when there is nothing more to search.
  const sufficient = o.sufficient === true || queries.length === 0;
  return { sufficient, gaps, queries };
}

/**
 * Merge freshly-collected sources into an already-accumulated, id-stable set.
 * Cross-round dedup is enforced TWICE: exact URL match (a URL surfaced in an
 * earlier round is never re-collected) AND content fingerprint (a near-duplicate
 * under a different URL). New sources get CONTINUING ids (M+1, M+2, …) so the
 * citation registry stays coherent across rounds. Bounded by `totalCap`.
 * Mutates `accumulated`/`accumulatedPrints` in place. Never throws.
 */
export function mergeSources(
  accumulated: CollectedSource[],
  accumulatedPrints: number[][],
  incoming: Array<Omit<CollectedSource, 'id'>>,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
  totalCap: number,
): { added: number; dropped: number } {
  const fingerprint = boundaries.fingerprint ?? contentFingerprint;
  const seenUrls = new Set(accumulated.map((s) => s.url));
  let added = 0;
  let dropped = 0;

  for (const src of incoming) {
    if (accumulated.length >= totalCap) break;
    if (seenUrls.has(src.url)) {
      dropped++;
      continue;
    }
    let print: number[] = [];
    try {
      print = fingerprint(src.content);
    } catch {
      print = [];
    }
    let isDup = false;
    if (print.length > 0) {
      for (const prev of accumulatedPrints) {
        if (fingerprintSimilarity(print, prev) >= opts.dedupThreshold) {
          isDup = true;
          break;
        }
      }
    }
    if (isDup) {
      dropped++;
      continue;
    }
    accumulated.push({ ...src, id: accumulated.length + 1 });
    accumulatedPrints.push(print);
    seenUrls.add(src.url);
    added++;
  }

  return { added, dropped };
}

/** collectSources guarded so a total failure degrades to zero sources (never throws). */
async function safeCollect(
  plan: DeepQueryPlan,
  boundaries: DeepResearchBoundaries,
  opts: ResolvedOptions,
  trace: DeepResearchTrace = emptyDeepResearchTrace(),
): Promise<Array<Omit<CollectedSource, 'id'>>> {
  try {
    return await collectSources(plan, boundaries, opts, trace);
  } catch (err) {
    logger.debug(`[deep-research] collection failed: ${errMsg(err)}`);
    return [];
  }
}

/**
 * Run the BOUNDED iterative gap loop. Default `rounds <= 1` delegates to the
 * exact Phase-A pipeline (byte-identical). Never throws.
 */
export async function runDeepResearchLoop(
  question: string,
  boundaries: DeepResearchBoundaries,
  options: DeepResearchLoopOptions = {},
  onProgress?: (s: DeepResearchStage) => void,
): Promise<DeepResearchLoopResult> {
  const rounds = resolveLoopRounds(options.rounds);

  // DEFAULT: 1 round ⇒ Phase A, byte-identical. The gap-analysis boundary is
  // NEVER touched on this path.
  if (rounds <= 1) {
    const base = await runDeepResearchPipeline(question, boundaries, options, onProgress);
    return {
      ...base,
      rounds: 1,
      converged: true,
      roundInfos: [
        {
          round: 1,
          gapQueries: [],
          newSources: base.sources.length,
          duplicatesDropped: base.duplicatesDropped,
        },
      ],
    };
  }

  const opts = resolveDeepResearchOptions(options);
  const started = Date.now();
  const emit = (s: DeepResearchStage) => {
    try {
      onProgress?.(s);
    } catch {
      /* progress must never break research */
    }
  };
  const totalCap = Math.min(opts.maxSources * rounds, LOOP_TOTAL_SOURCE_CAP);

  // ---- Round 1: plan → collect → merge(empty) → synthesize draft -----------
  emit({ stage: 'planning' });
  const { plan: initialPlan, llmUsed: plannerLlmUsed } = await planQueries(question, boundaries, opts);
  const queryCount = initialPlan.subQuestions.reduce((n, sq) => n + sq.queries.length, 0);
  emit({ stage: 'planned', subQuestions: initialPlan.subQuestions.length, queries: queryCount, llmUsed: plannerLlmUsed });

  const accumulated: CollectedSource[] = [];
  const accumulatedPrints: number[][] = [];
  const roundInfos: DeepResearchRoundInfo[] = [];
  const usedQueries = new Set<string>();
  const accumulatedPlan: DeepQueryPlan = { question, subQuestions: [...initialPlan.subQuestions] };
  for (const sq of initialPlan.subQuestions) for (const q of sq.queries) usedQueries.add(q.toLowerCase());

  const trace = emptyDeepResearchTrace();
  emit({ stage: 'collecting', urls: opts.maxSources });
  const round1Raw = await safeCollect(initialPlan, boundaries, opts, trace);
  emit({
    stage: 'searched',
    queries: trace.queries,
    hits: trace.searchHits,
    urls: trace.uniqueUrls,
  });
  const round1Merge = mergeSources(accumulated, accumulatedPrints, round1Raw, boundaries, opts, totalCap);
  emit({ stage: 'collected', scraped: round1Raw.length });
  emit({ stage: 'deduped', kept: accumulated.length, dropped: round1Merge.dropped });
  trace.dedupKept = accumulated.length;
  trace.dedupDropped = round1Merge.dropped;
  roundInfos.push({ round: 1, gapQueries: [], newSources: round1Merge.added, duplicatesDropped: round1Merge.dropped });

  emit({ stage: 'synthesizing' });
  let synth = await synthesize(question, accumulatedPlan, accumulated, boundaries, opts);
  let report = synth.report;
  let synthesisLlmUsed = synth.llmUsed;

  // ---- Rounds 2..N: gap analysis → re-search → merge → re-synthesize -------
  let converged = false;
  for (let round = 2; round <= rounds; round++) {
    emit({ stage: 'gap-analysis', round });

    let gap: GapAnalysis;
    try {
      const analyze = boundaries.analyzeGaps ?? ((input: GapAnalysisInput) => defaultAnalyzeGaps(input, boundaries));
      gap = await analyze({
        question,
        plan: accumulatedPlan,
        draft: report,
        sources: toSourceRegistry(accumulated),
        round,
      });
    } catch (err) {
      logger.debug(`[deep-research] gap analysis failed at round ${round}: ${errMsg(err)}`);
      emit({ stage: 'converged', round, reason: 'gap-analysis-failed' });
      break; // clean stop with the current draft (converged stays false)
    }

    const newQueries = dedupStrings(gap.queries)
      .filter((q) => !usedQueries.has(q.toLowerCase()))
      .slice(0, opts.queriesPerSubQuestion * 2);
    emit({ stage: 'gaps', round, gaps: gap.gaps.length, queries: newQueries.length, sufficient: gap.sufficient });

    if (gap.sufficient || newQueries.length === 0) {
      converged = true;
      emit({ stage: 'converged', round, reason: 'sufficient' });
      break;
    }
    if (accumulated.length >= totalCap) {
      converged = true;
      emit({ stage: 'converged', round, reason: 'source-cap' });
      break;
    }

    for (const q of newQueries) usedQueries.add(q.toLowerCase());
    const gapSubQuestion: SubQuestionPlan = {
      subQuestion: `Follow-up (round ${round}): ${gap.gaps.slice(0, 3).join('; ') || 'fill remaining gaps'}`,
      queries: newQueries,
    };
    accumulatedPlan.subQuestions.push(gapSubQuestion);

    const gapRaw = await safeCollect({ question, subQuestions: [gapSubQuestion] }, boundaries, opts, trace);
    emit({ stage: 'collecting', urls: gapRaw.length });
    const gapMerge = mergeSources(accumulated, accumulatedPrints, gapRaw, boundaries, opts, totalCap);
    emit({ stage: 'collected', scraped: gapRaw.length });
    emit({ stage: 'merged', round, added: gapMerge.added, dropped: gapMerge.dropped, total: accumulated.length });
    roundInfos.push({ round, gapQueries: newQueries, newSources: gapMerge.added, duplicatesDropped: gapMerge.dropped });

    if (gapMerge.added === 0) {
      // No marginal gain this round ⇒ converged (nothing new to synthesize on).
      converged = true;
      emit({ stage: 'converged', round, reason: 'no-new-sources' });
      break;
    }

    emit({ stage: 'synthesizing' });
    synth = await synthesize(question, accumulatedPlan, accumulated, boundaries, opts);
    report = synth.report;
    synthesisLlmUsed = synth.llmUsed;
  }

  emit({ stage: 'done', sources: accumulated.length });
  trace.dedupKept = accumulated.length;

  return {
    question,
    plan: accumulatedPlan,
    sources: toSourceRegistry(accumulated),
    report,
    durationMs: Date.now() - started,
    plannerLlmUsed,
    synthesisLlmUsed,
    duplicatesDropped: roundInfos.reduce((n, r) => n + r.duplicatesDropped, 0),
    trace,
    rounds: roundInfos.length,
    converged,
    roundInfos,
  };
}

// ============================================================================
// Small shared helpers
// ============================================================================

/** Extract the first JSON object OR array substring from an LLM response. */
function extractJsonObject(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const objStart = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  const candidates: Array<[number, string, string]> = [];
  if (objStart >= 0) candidates.push([objStart, '{', '}']);
  if (arrStart >= 0) candidates.push([arrStart, '[', ']']);
  if (candidates.length === 0) return null;
  // Prefer whichever opening delimiter appears first.
  candidates.sort((a, b) => a[0] - b[0]);
  const [start, , close] = candidates[0]!;
  const end = raw.lastIndexOf(close);
  if (end <= start) return null;
  return raw.slice(start, end + 1);
}

function dedupStrings(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const key = s.trim();
    if (!key || seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(key);
  }
  return out;
}

async function defaultMapBatched<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  const step = Math.max(1, size);
  for (let i = 0; i < items.length; i += step) {
    const batch = items.slice(i, i + step);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
