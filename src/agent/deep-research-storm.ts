/**
 * Deep Research — Phase C (STORM multi-perspective, Stanford-inspired).
 *
 * Phase A (`deep-research.ts runDeepResearchPipeline`) is ONE researcher on ONE
 * angle. Phase B (`runDeepResearchLoop`) iterates that single angle to fill its
 * own gaps. Both share a single point of view: the planner's decomposition of
 * the question. STORM's insight is that a fact-heavy, encyclopedic article is
 * better served by DIVERSE points of view, each researching the topic through
 * its own lens, then co-writing an outline-first article with per-section
 * citations — exactly what neither Phase A/B nor the council produces (the
 * council's personas reason in pure LLM, they never touch the web).
 *
 * Phase C couples the two:
 *
 *   1. perspectives — instantiate N diversified perspectives (default 4) DERIVED
 *                     from the council persona angles (`council/conductor.ts`
 *                     ROLE_SETS: practitioner, skeptic, architect, reviewer,
 *                     strategist, verifier) PLUS a STORM-signature historian /
 *                     state-of-the-art angle. Injectable (`generatePerspectives`)
 *                     for a topic-specific LLM derivation; deterministic default.
 *   2. per-perspective research — each perspective frames the topic through its
 *                     angle → runs the DETERMINISTIC Phase-A fan-out (reused:
 *                     `planQueries` → `collectSources` → `dedupSources`) → its
 *                     own cited sources. Perspectives run in PARALLEL (`mapBatched`).
 *   3. cross-perspective merge — `mergeSources` (reused Phase A/B) into a SHARED
 *                     citation registry: the same content found by two personas
 *                     collapses to ONE source, ids stay contiguous.
 *   4. outline-first co-writing — (a) build a structured table of contents from
 *                     the accumulated perspectives + sources; (b) write EACH
 *                     section grounded in its relevant cited sources → a
 *                     structured article with inline [n] per section, a ToC, and
 *                     a single renumbered "## Références" from the shared registry.
 *
 * STRICTLY ADDITIVE: nothing here runs on the Phase-A/B path. `runStormResearch`
 * is a NEW entry point; `deep-research.ts` is untouched and only its exported
 * building blocks are reused. Every stage is never-throws — a perspective that
 * fails is dropped and the article is written from the others; an outline that
 * fails degrades to the flat Phase-A `synthesize`. All side-effecting edges are
 * INJECTABLE (`StormBoundaries`) so the whole pipeline is unit-testable offline.
 *
 * @module agent/deep-research-storm
 */

import { logger } from '../utils/logger.js';
import { ROLE_SETS } from '../council/conductor.js';
import type { CouncilRole } from '../council/types.js';
import {
  planQueries,
  collectSources,
  dedupSources,
  mergeSources,
  synthesize,
  toSourceRegistry,
  renderReferences,
  stripInvalidCitationMarkers,
  stripTrailingReferences,
  groundCitedClaims,
  resolveDeepResearchOptions,
  type DeepResearchBoundaries,
  type DeepResearchOptions,
  type DeepResearchResult,
  type DeepQueryPlan,
  type CollectedSource,
  type SourceRef,
  type DeepLlmMessage,
} from './deep-research.js';

// ============================================================================
// Options (all BOUNDED — token/time cost is capped regardless of the topic)
// ============================================================================

export interface StormResearchOptions extends DeepResearchOptions {
  /** Number of diversified perspectives (default 4, clamped [2, 6]). */
  perspectives?: number;
  /** Absolute cap on sources accumulated across ALL perspectives (default 24). */
  maxTotalSources?: number;
}

/** Default perspective count when `--perspectives`/`--storm` asks for STORM. */
export const DEFAULT_STORM_PERSPECTIVES = 4;
/** Hard ceiling on perspectives regardless of what the caller asks for. */
const STORM_MAX_PERSPECTIVES = 6;
const STORM_MIN_PERSPECTIVES = 2;
/** Hard ceiling on sources accumulated across ALL perspectives (bounded cost). */
const STORM_TOTAL_SOURCE_CAP = 40;
/** How many perspectives research at once (bounded fan-out). */
const STORM_PERSPECTIVE_CONCURRENCY = 4;
/** How many perspective/section LLM co-writes run at once. */
const STORM_SECTION_CONCURRENCY = 4;
/** Per-source content chars fed to the section writer (bounded token cost). */
const STORM_SECTION_SOURCE_CHARS = 1800;
/** Max sources handed to a single section (keeps the section prompt bounded). */
const STORM_SOURCES_PER_SECTION = 8;

export function resolveStormPerspectiveCount(n: number | undefined): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : DEFAULT_STORM_PERSPECTIVES;
  return Math.max(STORM_MIN_PERSPECTIVES, Math.min(STORM_MAX_PERSPECTIVES, v));
}

function resolveMaxTotalSources(n: number | undefined, perPerspectiveCap: number, count: number): number {
  const requested =
    typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : perPerspectiveCap * count;
  return Math.max(1, Math.min(STORM_TOTAL_SOURCE_CAP, requested));
}

// ============================================================================
// Data types
// ============================================================================

/** One diversified point of view driving both research and section writing. */
export interface StormPerspective {
  id: string;
  label: string;
  /** The mission/angle that orients this perspective's queries + prose. */
  angle: string;
  /** What this perspective emphasises. */
  focus: string[];
}

export interface ResearchOutlineSection {
  title: string;
  subsections?: string[];
}

export interface ResearchOutline {
  title: string;
  sections: ResearchOutlineSection[];
}

/** Per-perspective accounting for the result. */
export interface StormPerspectiveResult {
  perspective: StormPerspective;
  /** Sources this perspective surfaced (pre cross-perspective merge). */
  sourceCount: number;
  /** Sub-questions this perspective's planner produced. */
  subQuestions: number;
  /** True when the perspective's research threw and it was dropped. */
  failed: boolean;
  /** True when the perspective's planner used the LLM (false ⇒ deterministic). */
  plannerLlmUsed: boolean;
}

/** The Phase-C result — a superset of {@link DeepResearchResult}. */
export interface StormResearchResult extends DeepResearchResult {
  /** The diversified perspectives and what each contributed. */
  perspectives: StormPerspectiveResult[];
  /** The structured table of contents the article was written against. */
  outline: ResearchOutline;
  /** True when the outline came from the LLM (false ⇒ deterministic fallback). */
  outlineLlmUsed: boolean;
  /** True when the article was written outline-first (false ⇒ flat Phase-A fallback). */
  coWritten: boolean;
}

export type StormStage =
  | { stage: 'perspectives' }
  | { stage: 'perspectives-ready'; count: number }
  | { stage: 'perspective-planning'; perspective: string }
  | { stage: 'perspective-done'; perspective: string; sources: number; failed: boolean }
  | { stage: 'merged-perspectives'; total: number; dropped: number }
  | { stage: 'outlining' }
  | { stage: 'outlined'; sections: number; llmUsed: boolean }
  | { stage: 'writing' }
  | { stage: 'written'; sections: number; coWritten: boolean }
  | { stage: 'storm-done'; sources: number };

/** Progress channel for the STORM path (distinct from the Phase-A/B `deep` channel). */
export type StormProgress = { type: 'storm' } & StormStage;

// ============================================================================
// Boundaries (INJECTABLE edges — reuse the Phase-A/B ones + three STORM seams)
// ============================================================================

export interface OutlineInput {
  topic: string;
  perspectives: StormPerspective[];
  sources: SourceRef[];
}

export interface SectionWriteInput {
  topic: string;
  section: ResearchOutlineSection;
  /** The sources most relevant to this section (a subset of the registry). */
  relevant: CollectedSource[];
  /** The FULL registry (a section may cite any id). */
  registry: SourceRef[];
}

export interface StormBoundaries extends DeepResearchBoundaries {
  /**
   * Instantiate N topic-specific perspectives. Optional — when absent, the
   * default derives them deterministically from the council persona angles.
   * MAY throw (caller falls back to the deterministic seeds).
   */
  generatePerspectives?(topic: string, n: number): Promise<StormPerspective[]>;
  /**
   * Build the article outline (ToC). Optional — when absent, an LLM call through
   * `llm` drives it with a deterministic fallback. MAY throw (caller degrades to
   * the flat Phase-A synthesis).
   */
  buildOutline?(input: OutlineInput): Promise<ResearchOutline>;
  /**
   * Write one section grounded in its relevant cited sources. Optional — when
   * absent, an LLM call through `llm` drives it with a deterministic cited
   * fallback. MAY throw (caller degrades that section to the deterministic body).
   */
  writeSection?(input: SectionWriteInput): Promise<string>;
}

// ============================================================================
// 1. Perspective instantiation (derived from council persona angles)
// ============================================================================

function roleToPerspective(role: CouncilRole): StormPerspective {
  return { id: role.id, label: role.label, angle: role.mission, focus: [...role.focus] };
}

/** STORM's signature encyclopedic angle — no direct council equivalent. */
const HISTORIAN_PERSPECTIVE: StormPerspective = {
  id: 'historian',
  label: 'Historian / State of the art',
  angle:
    'Trace the origin, evolution and current state of the art of the topic, situating it against prior approaches and landmark milestones.',
  focus: ['background', 'timeline', 'prior art', 'current consensus'],
};

/** Lookup helper that never throws on a missing council role. */
function councilRole(setKey: string, roleId: string): CouncilRole | undefined {
  return ROLE_SETS[setKey]?.find((r) => r.id === roleId);
}

/**
 * Deterministic, ORDERED perspective seeds derived from the council persona
 * angles (`council/conductor.ts`) plus the historian angle. The order surfaces
 * the most diverse lenses first so a small `n` still spans practitioner /
 * skeptic / historian / architect. Built defensively — a missing council role
 * is skipped, and a hardcoded floor guarantees ≥2 distinct perspectives.
 */
export function defaultStormPerspectives(n: number): StormPerspective[] {
  const seeds: StormPerspective[] = [];
  const push = (p: StormPerspective | undefined): void => {
    if (p && !seeds.some((s) => s.id === p.id)) seeds.push(p);
  };
  const fromCouncil = (setKey: string, roleId: string): StormPerspective | undefined => {
    const role = councilRole(setKey, roleId);
    return role ? roleToPerspective(role) : undefined;
  };

  push(fromCouncil('general', 'practitioner'));
  push(fromCouncil('reasoning', 'skeptic') ?? fromCouncil('general', 'skeptic'));
  push(HISTORIAN_PERSPECTIVE);
  push(fromCouncil('code', 'architect'));
  push(fromCouncil('code', 'reviewer'));
  push(fromCouncil('general', 'strategist'));
  push(fromCouncil('reasoning', 'verifier') ?? fromCouncil('code', 'verifier'));

  // Hardcoded floor: never return fewer than a diverse pair even if the council
  // definitions vanish under some refactor.
  if (seeds.length < STORM_MIN_PERSPECTIVES) {
    push({
      id: 'practitioner',
      label: 'Practitioner',
      angle: 'Make the answer operational and concrete.',
      focus: ['steps', 'constraints', 'what to do now'],
    });
    push(HISTORIAN_PERSPECTIVE);
  }
  return seeds.slice(0, n);
}

const PERSPECTIVE_SYSTEM = [
  'You are a research editor assembling a diverse panel of perspectives for an in-depth,',
  'Wikipedia-style article. Given a topic, propose distinct points of view that TOGETHER give',
  'broad, non-overlapping coverage (e.g. practitioner, skeptic, historical/state-of-the-art,',
  'architect, critic). Each perspective must have a clear research angle.',
  'Return ONLY a JSON object of the exact shape:',
  '{"perspectives":[{"label":"...","angle":"...","focus":["...","..."]}]}',
  'No prose, no markdown fences.',
].join('\n');

/**
 * Instantiate the perspectives. If a `generatePerspectives` boundary is injected
 * it wins (falling back to the deterministic seeds on throw/empty). Otherwise an
 * LLM derivation is attempted (topic-specific), again falling back to the seeds.
 * Never throws; always returns between {@link STORM_MIN_PERSPECTIVES} and `n`.
 */
export async function deriveStormPerspectives(
  topic: string,
  n: number,
  boundaries: StormBoundaries,
): Promise<StormPerspective[]> {
  const fallback = defaultStormPerspectives(n);

  if (boundaries.generatePerspectives) {
    try {
      const custom = await boundaries.generatePerspectives(topic, n);
      const normalized = normalizePerspectives(custom, n);
      if (normalized.length >= STORM_MIN_PERSPECTIVES) return normalized;
    } catch (err) {
      logger.debug(`[storm] generatePerspectives boundary failed: ${errMsg(err)}`);
    }
    return fallback;
  }

  // Default: try an LLM derivation seeded with the council-derived labels.
  try {
    const seedLabels = fallback.map((p) => p.label).join(', ');
    const raw = await boundaries.llm([
      { role: 'system', content: PERSPECTIVE_SYSTEM },
      {
        role: 'user',
        content: [
          `Topic: ${topic}`,
          '',
          `Propose exactly ${n} perspectives. Anchor them on angles like: ${seedLabels}.`,
          'Return the JSON object only.',
        ].join('\n'),
      },
    ]);
    const parsed = parsePerspectives(raw, n);
    if (parsed.length >= STORM_MIN_PERSPECTIVES) return parsed;
  } catch (err) {
    logger.debug(`[storm] perspective LLM derivation failed: ${errMsg(err)}`);
  }
  return fallback;
}

function parsePerspectives(raw: string, n: number): StormPerspective[] {
  const json = extractJsonObject(raw);
  if (!json) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(obj)
    ? (obj as unknown[])
    : Array.isArray((obj as { perspectives?: unknown })?.perspectives)
      ? (obj as { perspectives: unknown[] }).perspectives
      : [];
  return normalizePerspectives(list, n);
}

/** Coerce arbitrary perspective-ish objects into well-formed, de-duplicated seeds. */
function normalizePerspectives(list: unknown, n: number): StormPerspective[] {
  if (!Array.isArray(list)) return [];
  const out: StormPerspective[] = [];
  const seenLabel = new Set<string>();
  for (const entry of list) {
    if (out.length >= n) break;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: unknown; label?: unknown; angle?: unknown; mission?: unknown; focus?: unknown };
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    const angle =
      typeof e.angle === 'string' && e.angle.trim().length > 0
        ? e.angle.trim()
        : typeof e.mission === 'string'
          ? e.mission.trim()
          : '';
    if (!label || !angle) continue;
    const key = label.toLowerCase();
    if (seenLabel.has(key)) continue;
    seenLabel.add(key);
    const focus = Array.isArray(e.focus)
      ? e.focus.filter((f): f is string => typeof f === 'string' && f.trim().length > 0).map((f) => f.trim())
      : [];
    const id = typeof e.id === 'string' && e.id.trim() ? e.id.trim() : slugify(label);
    out.push({ id, label, angle, focus });
  }
  return out;
}

// ============================================================================
// 2. Per-perspective research (reuse the Phase-A deterministic fan-out)
// ============================================================================

/** Frame the topic through a perspective's angle so the planner biases its queries. */
export function framePerspectiveQuestion(topic: string, p: StormPerspective): string {
  const focus = p.focus.length > 0 ? ` Emphasise: ${p.focus.join(', ')}.` : '';
  return `${topic}\n\nResearch this specifically from the "${p.label}" perspective: ${p.angle}${focus}`;
}

interface PerspectiveOutput {
  perspective: StormPerspective;
  plan: DeepQueryPlan;
  kept: CollectedSource[];
  plannerLlmUsed: boolean;
  failed: boolean;
}

/**
 * Research one perspective end-to-end through the reused Phase-A stages. Never
 * throws: any failure (including an injected boundary throwing) drops the
 * perspective (`failed: true`, no sources) so the article is written from the
 * others.
 */
async function researchOnePerspective(
  topic: string,
  perspective: StormPerspective,
  boundaries: StormBoundaries,
  opts: ReturnType<typeof resolveDeepResearchOptions>,
  emit: (s: StormStage) => void,
): Promise<PerspectiveOutput> {
  emit({ stage: 'perspective-planning', perspective: perspective.label });
  try {
    const question = framePerspectiveQuestion(topic, perspective);
    const { plan, llmUsed } = await planQueries(question, boundaries, opts);
    // Keep the ORIGINAL topic as the plan question (sub-questions carry the angle).
    const angledPlan: DeepQueryPlan = { question: topic, subQuestions: plan.subQuestions };
    const raw = await collectSources(angledPlan, boundaries, opts);
    const { kept } = dedupSources(raw, boundaries, opts);
    emit({ stage: 'perspective-done', perspective: perspective.label, sources: kept.length, failed: false });
    return { perspective, plan: angledPlan, kept, plannerLlmUsed: llmUsed, failed: false };
  } catch (err) {
    logger.debug(`[storm] perspective "${perspective.label}" failed: ${errMsg(err)}`);
    emit({ stage: 'perspective-done', perspective: perspective.label, sources: 0, failed: true });
    return {
      perspective,
      plan: { question: topic, subQuestions: [] },
      kept: [],
      plannerLlmUsed: false,
      failed: true,
    };
  }
}

// ============================================================================
// 4a. Outline generation
// ============================================================================

const OUTLINE_SYSTEM = [
  'You are an expert editor drafting the OUTLINE (table of contents) of an in-depth,',
  'Wikipedia-style article. You are given the topic, the research perspectives that were',
  'explored, and the collected sources (titles only). Produce a coherent structure: a small',
  'set of top-level sections (with optional subsections) that together cover the topic from',
  'the given perspectives, ordered from background to analysis to outlook. Do NOT write the',
  'body — only the structure.',
  'Return ONLY a JSON object of the exact shape:',
  '{"title":"...","sections":[{"title":"...","subsections":["...","..."]}]}',
  'No prose, no markdown fences.',
].join('\n');

/** Cap outline size so the article stays bounded. */
const OUTLINE_MAX_SECTIONS = 8;
const OUTLINE_MAX_SUBSECTIONS = 6;

/**
 * Build the outline. If a `buildOutline` boundary is injected it is used AS-IS
 * (it MAY throw — the caller degrades to the flat synthesis). Otherwise an LLM
 * call is attempted with a deterministic fallback derived from the perspectives.
 * The default path never throws.
 */
export async function buildResearchOutline(
  topic: string,
  perspectives: StormPerspective[],
  sources: CollectedSource[],
  boundaries: StormBoundaries,
): Promise<{ outline: ResearchOutline; llmUsed: boolean }> {
  const registry = toSourceRegistry(sources);

  if (boundaries.buildOutline) {
    // Injected outline: let it throw so the co-writer can degrade to flat synth.
    const outline = await boundaries.buildOutline({ topic, perspectives, sources: registry });
    return { outline: clampOutline(outline, topic), llmUsed: true };
  }

  try {
    const perspectiveList = perspectives.map((p) => `- ${p.label}: ${p.angle}`).join('\n');
    const sourceList = registry.map((s) => `[${s.id}] ${s.title}`).join('\n') || '(none)';
    const raw = await boundaries.llm([
      { role: 'system', content: OUTLINE_SYSTEM },
      {
        role: 'user',
        content: [
          `Topic: ${topic}`,
          '',
          'Perspectives explored:',
          perspectiveList,
          '',
          'Collected sources:',
          sourceList,
          '',
          'Return the outline JSON object only.',
        ].join('\n'),
      },
    ]);
    const parsed = parseOutline(raw, topic);
    if (parsed && parsed.sections.length > 0) return { outline: parsed, llmUsed: true };
  } catch (err) {
    logger.debug(`[storm] outline LLM failed: ${errMsg(err)}`);
  }
  return { outline: fallbackOutline(topic, perspectives), llmUsed: false };
}

function parseOutline(raw: string, topic: string): ResearchOutline | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  const o = obj as { title?: unknown; sections?: unknown };
  const sections = Array.isArray(o.sections) ? o.sections : [];
  const parsedSections: ResearchOutlineSection[] = [];
  for (const s of sections) {
    if (parsedSections.length >= OUTLINE_MAX_SECTIONS) break;
    if (!s || typeof s !== 'object') continue;
    const sec = s as { title?: unknown; subsections?: unknown };
    const title = typeof sec.title === 'string' ? sec.title.trim() : '';
    if (!title) continue;
    const subsections = Array.isArray(sec.subsections)
      ? sec.subsections
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, OUTLINE_MAX_SUBSECTIONS)
      : [];
    parsedSections.push(subsections.length > 0 ? { title, subsections } : { title });
  }
  if (parsedSections.length === 0) return null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : topic;
  return { title, sections: parsedSections };
}

/** Deterministic outline: background + one section per perspective + synthesis. */
export function fallbackOutline(topic: string, perspectives: StormPerspective[]): ResearchOutline {
  const sections: ResearchOutlineSection[] = [{ title: 'Overview' }];
  const seen = new Set<string>(['overview']);
  for (const p of perspectives) {
    const title = p.label;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sections.push(p.focus.length > 0 ? { title, subsections: p.focus.slice(0, OUTLINE_MAX_SUBSECTIONS) } : { title });
    if (sections.length >= OUTLINE_MAX_SECTIONS - 1) break;
  }
  sections.push({ title: 'Synthesis and outlook' });
  return { title: topic, sections };
}

function clampOutline(outline: ResearchOutline, topic: string): ResearchOutline {
  const title = outline.title?.trim() || topic;
  const sections = (Array.isArray(outline.sections) ? outline.sections : [])
    .filter((s): s is ResearchOutlineSection => !!s && typeof s.title === 'string' && s.title.trim().length > 0)
    .slice(0, OUTLINE_MAX_SECTIONS)
    .map((s) => {
      const subs = Array.isArray(s.subsections)
        ? s.subsections.filter((x) => typeof x === 'string' && x.trim().length > 0).slice(0, OUTLINE_MAX_SUBSECTIONS)
        : [];
      return subs.length > 0 ? { title: s.title.trim(), subsections: subs } : { title: s.title.trim() };
    });
  return { title, sections };
}

// ============================================================================
// 4b. Section writing (grounded in the relevant cited sources)
// ============================================================================

const SECTION_SYSTEM = [
  'You are writing ONE section of an in-depth, objective research article. You are given the',
  'section heading and a set of sources with bracketed ids. Write the section body in Markdown:',
  '- Do NOT repeat the section heading (it is added for you).',
  '- Ground every non-trivial claim in the sources with inline markers like [1], [2].',
  '- Use ONLY the given ids; never invent sources or ids.',
  '- Aggregate multiple sources per claim where possible; note disagreements.',
  '- Be concise and factual; no meta-commentary; do NOT write a references section.',
].join('\n');

/**
 * Rank the registry by keyword overlap with the section heading/subsections and
 * return the top-K sources most relevant to grounding this section. Falls back
 * to the whole (bounded) registry when nothing overlaps, so a section is never
 * left without citable material.
 */
export function selectRelevantSources(
  section: ResearchOutlineSection,
  sources: CollectedSource[],
  limit = STORM_SOURCES_PER_SECTION,
): CollectedSource[] {
  if (sources.length === 0) return [];
  const terms = new Set(
    tokenize(`${section.title} ${(section.subsections ?? []).join(' ')}`).filter((t) => t.length > 2),
  );
  if (terms.size === 0) return sources.slice(0, limit);

  const scored = sources.map((s) => {
    const hay = new Set(tokenize(`${s.title} ${s.content.slice(0, 2000)}`));
    let score = 0;
    for (const t of terms) if (hay.has(t)) score++;
    return { s, score };
  });
  const matched = scored.filter((x) => x.score > 0);
  if (matched.length === 0) return sources.slice(0, limit);
  // Stable ordering: score desc, then original id asc.
  matched.sort((a, b) => b.score - a.score || a.s.id - b.s.id);
  return matched.slice(0, limit).map((x) => x.s);
}

/**
 * Write one section. If a `writeSection` boundary is injected it is used
 * (falling back to the deterministic body on throw/empty). Otherwise an LLM call
 * is attempted with a deterministic cited fallback. Never throws.
 */
export async function writeSectionBody(
  topic: string,
  section: ResearchOutlineSection,
  relevant: CollectedSource[],
  registry: SourceRef[],
  boundaries: StormBoundaries,
): Promise<{ body: string; llmUsed: boolean }> {
  if (boundaries.writeSection) {
    try {
      const body = (await boundaries.writeSection({ topic, section, relevant, registry })).trim();
      if (body.length > 0) {
        return { body: stripLeadingSectionHeading(stripSectionReferences(body), section.title), llmUsed: true };
      }
    } catch (err) {
      logger.debug(`[storm] writeSection boundary failed for "${section.title}": ${errMsg(err)}`);
    }
    return { body: fallbackSectionBody(section, relevant), llmUsed: false };
  }

  if (relevant.length > 0) {
    try {
      const sourceBlock = relevant
        .map((s) => `[${s.id}] ${s.title} (${s.url})\n${s.content.slice(0, STORM_SECTION_SOURCE_CHARS)}`)
        .join('\n\n---\n\n');
      const subs = (section.subsections ?? []).length > 0 ? `\nSubsections to cover: ${(section.subsections ?? []).join('; ')}` : '';
      const raw = await boundaries.llm([
        { role: 'system', content: SECTION_SYSTEM },
        {
          role: 'user',
          content: [
            `Article topic: ${topic}`,
            `Section heading: ${section.title}${subs}`,
            '',
            'Sources (cite by the bracketed id):',
            '',
            sourceBlock,
          ].join('\n'),
        },
      ]);
      const body = stripLeadingSectionHeading(stripSectionReferences((raw || '').trim()), section.title);
      if (body.length > 0) return { body, llmUsed: true };
    } catch (err) {
      logger.debug(`[storm] section LLM failed for "${section.title}": ${errMsg(err)}`);
    }
  }
  return { body: fallbackSectionBody(section, relevant), llmUsed: false };
}

/** Deterministic section body — cited excerpts of the relevant sources. */
function fallbackSectionBody(section: ResearchOutlineSection, relevant: CollectedSource[]): string {
  if (relevant.length === 0) {
    return '_Aucune source pertinente collectée pour cette section._';
  }
  const lines: string[] = [];
  for (const s of relevant) {
    const excerpt = s.content.replace(/\s+/g, ' ').trim().slice(0, 400);
    lines.push(`- ${excerpt} [${s.id}]`);
  }
  return lines.join('\n');
}

// ============================================================================
// 4c. Article assembly (outline-first co-writing)
// ============================================================================

interface CoWriteResult {
  report: string;
  outline: ResearchOutline;
  outlineLlmUsed: boolean;
  coWritten: boolean;
  sectionsLlmUsed: number;
}

async function coWriteArticle(
  topic: string,
  perspectives: StormPerspective[],
  sources: CollectedSource[],
  boundaries: StormBoundaries,
  opts: ReturnType<typeof resolveDeepResearchOptions>,
  emit: (s: StormStage) => void,
): Promise<CoWriteResult> {
  const registry = toSourceRegistry(sources);
  const references = renderReferences(registry);

  // ---- Outline ------------------------------------------------------------
  emit({ stage: 'outlining' });
  let outline: ResearchOutline | null = null;
  let outlineLlmUsed = false;
  try {
    const built = await buildResearchOutline(topic, perspectives, sources, boundaries);
    outline = built.outline;
    outlineLlmUsed = built.llmUsed;
  } catch (err) {
    // An injected buildOutline threw — degrade to flat Phase-A synthesis.
    logger.debug(`[storm] outline build threw, degrading to flat synthesis: ${errMsg(err)}`);
    outline = null;
  }

  const usableOutline = outline && outline.sections.length > 0 ? outline : null;

  // ---- Flat fallback (outline failed OR no sources) → Phase-A synthesize ---
  if (!usableOutline || sources.length === 0) {
    emit({ stage: 'outlined', sections: usableOutline?.sections.length ?? 0, llmUsed: outlineLlmUsed });
    emit({ stage: 'writing' });
    const flatPlan: DeepQueryPlan = {
      question: topic,
      subQuestions: perspectives.map((p) => ({ subQuestion: p.label, queries: [] })),
    };
    const flat = await synthesize(topic, flatPlan, sources, boundaries, opts);
    emit({ stage: 'written', sections: 0, coWritten: false });
    return {
      report: flat.report,
      outline: usableOutline ?? { title: topic, sections: [] },
      outlineLlmUsed,
      coWritten: false,
      sectionsLlmUsed: 0,
    };
  }

  emit({ stage: 'outlined', sections: usableOutline.sections.length, llmUsed: outlineLlmUsed });

  // ---- Section-by-section writing (parallel, order preserved) -------------
  emit({ stage: 'writing' });
  const mapBatched = boundaries.mapBatched ?? defaultMapBatched;
  const written = await mapBatched(usableOutline.sections, STORM_SECTION_CONCURRENCY, async (section) => {
    const relevant = selectRelevantSources(section, sources);
    return writeSectionBody(topic, section, relevant, registry, boundaries);
  });
  const sectionsLlmUsed = written.filter((w) => w.llmUsed).length;

  // ---- Assemble the article: title + ToC + sections + references ----------
  const parts: string[] = [`# ${usableOutline.title}`, '', renderTableOfContents(usableOutline)];
  usableOutline.sections.forEach((section, i) => {
    parts.push('', `## ${section.title}`, '', written[i]!.body.trim());
  });
  // Drop any fabricated `[n]` beyond the shared registry so no co-written section leaves a phantom
  // citation the single renumbered "## Références" (rendered from `registry`) can't resolve.
  const body = groundCitedClaims(
    stripInvalidCitationMarkers(stripSectionReferences(parts.join('\n')), registry.length),
    sources,
  );
  emit({ stage: 'written', sections: usableOutline.sections.length, coWritten: true });
  return {
    report: `${body}\n\n${references}`,
    outline: usableOutline,
    outlineLlmUsed,
    coWritten: true,
    sectionsLlmUsed,
  };
}

/** Deterministic table of contents rendered from the outline. */
export function renderTableOfContents(outline: ResearchOutline): string {
  const lines = ['## Table des matières', ''];
  outline.sections.forEach((section, i) => {
    lines.push(`${i + 1}. ${section.title}`);
    for (const sub of section.subsections ?? []) {
      lines.push(`   - ${sub}`);
    }
  });
  return lines.join('\n');
}

// ============================================================================
// Orchestration entry point (pure — the class method wires real boundaries)
// ============================================================================

/**
 * Run the full Phase-C STORM pipeline. Never throws: perspectives that fail are
 * dropped, an outline that fails degrades to the flat Phase-A synthesis, and a
 * total failure yields an honest non-conclusive cited report. Emits coarse
 * progress via the optional callback (its own `storm` channel).
 */
export async function runStormResearch(
  topic: string,
  boundaries: StormBoundaries,
  options: StormResearchOptions = {},
  onProgress?: (s: StormStage) => void,
): Promise<StormResearchResult> {
  const opts = resolveDeepResearchOptions(options);
  const count = resolveStormPerspectiveCount(options.perspectives);
  const totalCap = resolveMaxTotalSources(options.maxTotalSources, opts.maxSources, count);
  const started = Date.now();
  const emit = (s: StormStage): void => {
    try {
      onProgress?.(s);
    } catch {
      /* progress must never break research */
    }
  };

  // ---- 1. Perspectives ----------------------------------------------------
  emit({ stage: 'perspectives' });
  const perspectives = await deriveStormPerspectives(topic, count, boundaries);
  emit({ stage: 'perspectives-ready', count: perspectives.length });

  // ---- 2. Research per perspective, IN PARALLEL ---------------------------
  const mapBatched = boundaries.mapBatched ?? defaultMapBatched;
  const outputs = await mapBatched(perspectives, STORM_PERSPECTIVE_CONCURRENCY, (perspective) =>
    researchOnePerspective(topic, perspective, boundaries, opts, emit),
  );

  // ---- 3. Cross-perspective merge into a shared citation registry ---------
  const accumulated: CollectedSource[] = [];
  const accumulatedPrints: number[][] = [];
  let duplicatesDropped = 0;
  for (const out of outputs) {
    if (out.failed || out.kept.length === 0) continue;
    const incoming = out.kept.map((s) => ({ url: s.url, title: s.title, content: s.content, query: s.query }));
    const merge = mergeSources(accumulated, accumulatedPrints, incoming, boundaries, opts, totalCap);
    duplicatesDropped += merge.dropped;
  }
  emit({ stage: 'merged-perspectives', total: accumulated.length, dropped: duplicatesDropped });

  // ---- 4. Outline-first co-writing ----------------------------------------
  const coWrite = await coWriteArticle(topic, perspectives, accumulated, boundaries, opts, emit);

  const aggregatePlan: DeepQueryPlan = {
    question: topic,
    subQuestions: outputs.flatMap((o) => o.plan.subQuestions),
  };

  emit({ stage: 'storm-done', sources: accumulated.length });

  return {
    question: topic,
    plan: aggregatePlan,
    sources: toSourceRegistry(accumulated),
    report: coWrite.report,
    durationMs: Date.now() - started,
    plannerLlmUsed: outputs.some((o) => o.plannerLlmUsed),
    synthesisLlmUsed: coWrite.coWritten || coWrite.sectionsLlmUsed > 0,
    duplicatesDropped,
    perspectives: outputs.map((o) => ({
      perspective: o.perspective,
      sourceCount: o.kept.length,
      subQuestions: o.plan.subQuestions.length,
      failed: o.failed,
      plannerLlmUsed: o.plannerLlmUsed,
    })),
    outline: coWrite.outline,
    outlineLlmUsed: coWrite.outlineLlmUsed,
    coWritten: coWrite.coWritten,
  };
}

// ============================================================================
// Small shared helpers (self-contained — deep-research.ts internals are private)
// ============================================================================

/** Extract the first JSON object OR array substring from an LLM response. */
function extractJsonObject(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const objStart = raw.indexOf('{');
  const arrStart = raw.indexOf('[');
  const candidates: Array<[number, string]> = [];
  if (objStart >= 0) candidates.push([objStart, '}']);
  if (arrStart >= 0) candidates.push([arrStart, ']']);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a[0] - b[0]);
  const [start, close] = candidates[0]!;
  const end = raw.lastIndexOf(close);
  if (end <= start) return null;
  return raw.slice(start, end + 1);
}

/** Strip a trailing references/sources heading a section writer may have added. */
function stripSectionReferences(body: string): string {
  return stripTrailingReferences(body);
}

/**
 * Drop a leading ATX heading that repeats the section title. The assembler
 * already emits `## ${title}`; live GK33 STORM left `# Title` then `## Title`.
 */
export function stripLeadingSectionHeading(body: string, title: string): string {
  if (typeof body !== 'string' || body.length === 0 || !title.trim()) return typeof body === 'string' ? body : '';
  const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`^#{1,6}\\s*${escaped}\\s*(?:\\n+|$)`, 'i'), '').trimStart();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function slugify(label: string): string {
  return (
    tokenize(label).join('-').slice(0, 40) || `perspective-${Math.random().toString(36).slice(2, 8)}`
  );
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
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Re-export for tooling / callers that only import the STORM module.
export type { DeepLlmMessage };
