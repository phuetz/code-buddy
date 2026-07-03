/**
 * Lessons Tracker — Self-improvement loop for recurring patterns
 *
 * Maintains a persistent `lessons.md` in `.codebuddy/lessons.md` (project)
 * and `~/.codebuddy/lessons.md` (global). On every agent turn the active
 * lessons are injected BEFORE the todo suffix (stable rules before recency
 * bias), so the model internalises learned patterns across sessions.
 *
 * The agent calls `lessons_add` to capture a new lesson after a correction;
 * `lessons_search` to find relevant lessons before similar tasks.
 *
 * Categories follow a structured taxonomy:
 *  PATTERN — "What went wrong → correct approach"
 *  RULE    — Invariant to always follow (e.g. "run tests before marking done")
 *  CONTEXT — Project/domain-specific facts (e.g. "this repo uses ESM imports")
 *  INSIGHT — Non-obvious observation useful for future tasks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger.js';
import { getLessonProvenanceIndex } from './lesson-provenance.js';
import { BM25Index } from '../search/bm25.js';

// ============================================================================
// Types
// ============================================================================

export type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';

export interface LessonItem {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;   // e.g. "TypeScript", "React", "bash"
  createdAt: number;
  source: 'user_correction' | 'self_observed' | 'manual';
}

/** Which lessons.md file a lesson lives in. */
export type LessonScope = 'project' | 'global';
export interface LessonLocation {
  scope: LessonScope;
  path: string;
}

/** Patch for `update()` — `context: null` clears the context. */
export interface LessonPatch {
  content?: string;
  category?: LessonCategory;
  context?: string | null;
}

/** Options for the per-turn lessons context block. */
export interface LessonsContextOptions {
  /** Rank lessons against this text (BM25) within each category; default = recency. */
  query?: string;
  /** Character budget for the lesson lines (default 2000). */
  maxChars?: number;
}

/** Default per-turn character budget for `<lessons_context>`. */
export const DEFAULT_LESSONS_CONTEXT_CHARS = 2000;

export type LessonConceptSource = 'context' | 'wiki_link' | 'markdown_link' | 'tag' | 'related' | 'keyword';
export type LessonGraphRenderFormat = 'summary' | 'json' | 'markdown' | 'mermaid';

export interface LessonConceptRef {
  slug: string;
  label: string;
  sources: LessonConceptSource[];
}

export interface LessonConceptNode {
  id: string;
  label: string;
  lessonIds: string[];
  sources: LessonConceptSource[];
  weight: number;
}

export interface LessonGraphEdge {
  from: string;
  to: string;
  sharedConcepts: string[];
  weight: number;
}

export interface LessonConceptGraph {
  schemaVersion: 1;
  generatedAt: number;
  filters: LessonConceptGraphFilters;
  lessons: LessonItem[];
  concepts: LessonConceptNode[];
  lessonConcepts: Record<string, LessonConceptRef[]>;
  backlinks: Record<string, string[]>;
  relatedLessons: LessonGraphEdge[];
}

export interface LessonConceptGraphFilters {
  query?: string;
  concept?: string;
  category?: LessonCategory;
  includeKeywords: boolean;
  limit: number;
}

export interface LessonVaultFile {
  path: string;
  content: string;
}

export interface LessonVaultManifest {
  vaultSchemaVersion: 1;
  graphSchemaVersion: LessonConceptGraph['schemaVersion'];
  generatedAt: string;
  entrypoints: {
    index: string;
    conceptsIndex: string;
    lessonsIndex: string;
    graphJson: string;
    graphMermaid: string;
    manifest: string;
  };
  counts: {
    lessons: number;
    concepts: number;
    relations: number;
    files: number;
  };
  filters: LessonConceptGraphFilters;
  concepts: Array<{
    id: string;
    label: string;
    path: string;
    sources: LessonConceptSource[];
    lessonIds: string[];
  }>;
  lessons: Array<{
    id: string;
    category: LessonCategory;
    path: string;
    conceptIds: string[];
  }>;
  files: string[];
}

export interface LessonGraphOptions {
  query?: string;
  concept?: string;
  category?: LessonCategory;
  includeKeywords?: boolean;
  limit?: number;
}

export function renderLessonConceptGraphMermaid(
  graph: LessonConceptGraph,
  maxLinks: number = 80,
): string {
  const lines = ['graph TD'];
  const lessonNodeById = new Map<string, string>();
  const conceptNodeById = new Map<string, string>();

  graph.lessons.forEach((lesson, index) => {
    const nodeId = `L${index}`;
    lessonNodeById.set(lesson.id, nodeId);
    lines.push(`  ${nodeId}["${escapeMermaidLabel(`${lesson.category}: ${truncateLabel(lesson.content, 64)}`)}"]`);
  });

  graph.concepts.forEach((concept, index) => {
    const nodeId = `C${index}`;
    conceptNodeById.set(concept.id, nodeId);
    lines.push(`  ${nodeId}(("${escapeMermaidLabel(concept.label)}"))`);
  });

  let emittedLinks = 0;
  for (const [lessonId, concepts] of Object.entries(graph.lessonConcepts)) {
    const lessonNode = lessonNodeById.get(lessonId);
    if (!lessonNode) continue;
    for (const concept of concepts) {
      const conceptNode = conceptNodeById.get(concept.slug);
      if (!conceptNode) continue;
      lines.push(`  ${lessonNode} --> ${conceptNode}`);
      emittedLinks++;
      if (emittedLinks >= maxLinks) return lines.join('\n');
    }
  }

  return lines.join('\n');
}

export function renderLessonConceptGraph(
  graph: LessonConceptGraph,
  format: LessonGraphRenderFormat = 'summary',
): string {
  if (format === 'json') {
    return JSON.stringify(graph, null, 2);
  }
  if (format === 'markdown') {
    return renderLessonConceptGraphMarkdown(graph);
  }
  if (format === 'mermaid') {
    return renderLessonConceptGraphMermaid(graph);
  }
  return renderLessonConceptGraphSummary(graph);
}

export function renderLessonConceptGraphMarkdown(graph: LessonConceptGraph): string {
  if (graph.lessons.length === 0) {
    return '# Lessons Graph\n\nNo lessons available for graphing.';
  }

  const lessonsById = new Map(graph.lessons.map(lesson => [lesson.id, lesson]));
  const lines = [
    '# Lessons Graph',
    '',
    `Generated: ${new Date(graph.generatedAt).toISOString()}`,
    `Lessons: ${graph.lessons.length}`,
    `Concepts: ${graph.concepts.length}`,
    `Relations: ${graph.relatedLessons.length}`,
    ...renderLessonGraphFilterLines(graph.filters),
    '',
    '## Concepts',
  ];

  for (const concept of graph.concepts) {
    lines.push('', `### [[${concept.id}|${concept.label}]]`);
    lines.push(`- Sources: ${concept.sources.join(', ')}`);
    lines.push(`- Weight: ${concept.weight}`);
    lines.push('- Backlinks:');
    for (const lessonId of graph.backlinks[concept.id] ?? concept.lessonIds) {
      const lesson = lessonsById.get(lessonId);
      const label = lesson ? `${lesson.category}: ${lesson.content}` : lessonId;
      lines.push(`  - [${lessonId}] ${label}`);
    }
  }

  lines.push('', '## Related Lessons');
  if (graph.relatedLessons.length === 0) {
    lines.push('- No lesson-to-lesson relations yet.');
  } else {
    for (const edge of graph.relatedLessons) {
      const shared = edge.sharedConcepts.map(slug => `[[${slug}]]`).join(', ');
      lines.push(`- [${edge.from}] <-> [${edge.to}] via ${shared}`);
    }
  }

  return lines.join('\n');
}

export function renderLessonConceptVaultFiles(graph: LessonConceptGraph): LessonVaultFile[] {
  const files: LessonVaultFile[] = [];
  const lessonsById = new Map(graph.lessons.map(lesson => [lesson.id, lesson]));

  files.push({
    path: 'index.md',
    content: renderLessonVaultIndex(graph),
  });
  files.push({
    path: '_concepts.md',
    content: renderLessonVaultConceptIndex(graph),
  });
  files.push({
    path: '_lessons.md',
    content: renderLessonVaultLessonIndex(graph),
  });

  for (const concept of graph.concepts) {
    files.push({
      path: `concepts/${safeVaultSegment(concept.id)}.md`,
      content: renderLessonVaultConcept(graph, concept, lessonsById),
    });
  }

  for (const lesson of graph.lessons) {
    files.push({
      path: `lessons/${safeVaultSegment(lesson.id)}.md`,
      content: renderLessonVaultLesson(graph, lesson),
    });
  }

  files.push({ path: 'graph.json', content: renderLessonConceptGraph(graph, 'json') });
  files.push({ path: 'graph.mmd', content: renderLessonConceptGraph(graph, 'mermaid') });
  files.push({
    path: 'manifest.json',
    content: renderLessonVaultManifest(graph, [...files.map(file => file.path), 'manifest.json']),
  });

  return files;
}

export function renderLessonConceptGraphSummary(
  graph: LessonConceptGraph,
  maxConcepts: number = 12,
  maxRelations: number = 10,
): string {
  if (graph.lessons.length === 0) {
    return 'No lessons available for graphing.';
  }

  const conceptLines = graph.concepts.slice(0, maxConcepts).map(concept => {
    const sources = concept.sources.join(',');
    return `- ${concept.label} (${concept.lessonIds.length} lesson(s); ${sources})`;
  });
  const relatedLines = graph.relatedLessons.slice(0, maxRelations).map(edge => {
    const left = graph.lessons.find(lesson => lesson.id === edge.from);
    const right = graph.lessons.find(lesson => lesson.id === edge.to);
    return [
      `- [${edge.from}] ${left?.content ?? edge.from}`,
      `  <-> [${edge.to}] ${right?.content ?? edge.to}`,
      `  shared: ${edge.sharedConcepts.join(', ')}`,
    ].join('\n');
  });
  const backlinkLines = graph.concepts.slice(0, maxConcepts).map(concept => {
    const ids = (graph.backlinks[concept.id] ?? concept.lessonIds).map(id => `[${id}]`).join(', ');
    return `- ${concept.label}: ${ids}`;
  });

  return [
    `Lesson graph: ${graph.lessons.length} lesson(s), ${graph.concepts.length} concept(s), ${graph.relatedLessons.length} relation(s).`,
    ...renderLessonGraphFilterLines(graph.filters),
    '',
    '## Concepts',
    conceptLines.length > 0 ? conceptLines.join('\n') : '- No concepts extracted.',
    '',
    '## Backlinks',
    backlinkLines.length > 0 ? backlinkLines.join('\n') : '- No concept backlinks yet.',
    '',
    '## Related Lessons',
    relatedLines.length > 0 ? relatedLines.join('\n') : '- No lesson-to-lesson relations yet.',
  ].join('\n');
}

export interface LessonsStats {
  total: number;
  byCategory: Record<LessonCategory, number>;
  bySource: Record<LessonItem['source'], number>;
  oldestAt: number | null;
  newestAt: number | null;
}

// ============================================================================
// Singleton registry (one tracker per working directory)
// ============================================================================

const registry = new Map<string, LessonsTracker>();

export function getLessonsTracker(workDir: string = process.cwd()): LessonsTracker {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new LessonsTracker(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

// ============================================================================
// LessonsTracker
// ============================================================================

export class LessonsTracker {
  private projectPath: string;
  private globalPath: string;
  private items: LessonItem[] = [];
  /** Which file(s) each lesson id was loaded from (see load()). */
  private locationsById = new Map<string, LessonLocation[]>();
  private loaded = false;
  private _cachedBlock: string | null = null;
  private _cachedKey = '';
  private _cacheTime = 0;
  /**
   * Serialized write chain (F33).
   *
   * Previously `add()` did load → mutate `this.items` → `save()` without
   * any lock. Two concurrent calls — realistic when a multi-agent spawn
   * runs in parallel — both pushed their own lesson into the in-memory
   * array and then each `save()` wrote a snapshot to disk, so the second
   * writer's snapshot silently clobbered the first writer's lesson.
   *
   * The queue serializes every disk write through a chained promise so
   * only one `fs.writeFileSync` runs at a time, and each write re-reads
   * the canonical disk state just before writing — matching the F17
   * SessionStore lock pattern but lighter-weight since lessons are
   * append-only.
   */
  private _writeChain: Promise<void> = Promise.resolve();

  constructor(private workDir: string) {
    const projectDir = path.join(workDir, '.codebuddy');
    this.projectPath = path.join(projectDir, 'lessons.md');
    this.globalPath = path.join(os.homedir(), '.codebuddy', 'lessons.md');
  }

  /**
   * Enqueue a write through the serialized chain. Errors are logged but
   * don't break the chain so later writes can still proceed.
   */
  private enqueueWrite(fn: () => void): Promise<void> {
    this._writeChain = this._writeChain
      .then(() => {
        try {
          fn();
        } catch (err) {
          logger.warn('[lessons] write failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return this._writeChain;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const globalItems = this.loadFile(this.globalPath);
    const projectItems = this.loadFile(this.projectPath);
    // Origin tracking: management ops (rm/edit) must rewrite the FILE(S) an id
    // actually lives in — rewriting only the project file resurrects a
    // global-only lesson on the next fresh load.
    this.locationsById.clear();
    const record = (items: LessonItem[], scope: LessonScope, filePath: string): void => {
      for (const item of items) {
        const arr = this.locationsById.get(item.id) ?? [];
        arr.push({ scope, path: filePath });
        this.locationsById.set(item.id, arr);
      }
    };
    record(globalItems, 'global', this.globalPath);
    record(projectItems, 'project', this.projectPath);
    // Merge: project overrides global for duplicate ids (warn on content mismatch)
    const byId = new Map<string, LessonItem>();
    for (const item of [...globalItems, ...projectItems]) {
      const existing = byId.get(item.id);
      if (existing && existing.content !== item.content) {
        logger.warn(`[lessons] duplicate ID "${item.id}" — project overrides global`);
      }
      byId.set(item.id, item);
    }
    this.items = Array.from(byId.values());
  }

  /**
   * Save to project path only (global is managed manually or via
   * `lessons_add --global`). Routed through the serialized write queue
   * so concurrent add/remove calls cannot clobber each other (F33).
   *
   * The fire-and-forget nature is preserved — callers that want to
   * observe write completion can `await tracker.save()` explicitly.
   */
  save(): Promise<void> {
    this.load();
    return this.enqueueWrite(() => {
      const dir = path.dirname(this.projectPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Only PROJECT-origin lessons belong in the project file. Writing the
      // merged set used to duplicate every global (~/.codebuddy) lesson into
      // each project's lessons.md on the first add(). locationsOf defaults to
      // project, so runtime-added items are always included.
      const projectItems = this.items.filter(item =>
        this.locationsOf(item.id).some(loc => loc.path === this.projectPath),
      );
      fs.writeFileSync(this.projectPath, this.serialiseItems(projectItems), 'utf-8');
    });
  }

  add(
    category: LessonCategory,
    content: string,
    source: LessonItem['source'] = 'manual',
    context?: string,
    provenance?: { runId?: string; outcomeId?: string; sagaId?: string; note?: string }
  ): LessonItem {
    this.load();
    const item: LessonItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      category,
      content,
      context,
      createdAt: Date.now(),
      source,
    };
    this.items.push(item);
    this.locationsById.set(item.id, [{ scope: 'project', path: this.projectPath }]);
    this._cachedBlock = null;
    this.save();

    // Record "created by" provenance in the side-car index when known.
    if (provenance && (provenance.runId || provenance.outcomeId || provenance.sagaId)) {
      try {
        getLessonProvenanceIndex(this.workDir).recordCreated(item.id, provenance);
      } catch {
        // Provenance is best-effort; never fail a lesson write on it.
      }
    }

    return item;
  }

  /**
   * Delete a lesson (fire-and-forget). Rewrites every file the id lives in —
   * the previous implementation rewrote only the PROJECT file, so removing a
   * lesson that lived only in `~/.codebuddy/lessons.md` resurrected it on the
   * next fresh load. Use `removeWithReport()` to await the writes and learn
   * which file(s) were touched.
   */
  remove(id: string): boolean {
    this.load();
    if (!this.items.some(i => i.id === id)) return false;
    void this.removeWithReport(id);
    return true;
  }

  /** Look up one lesson by id, with the file location(s) it lives in. */
  get(id: string): (LessonItem & { locations: LessonLocation[] }) | undefined {
    this.load();
    const item = this.items.find(i => i.id === id);
    if (!item) return undefined;
    return { ...item, locations: this.locationsOf(id) };
  }

  /**
   * Edit a lesson in place. `id`, `createdAt` and `source` are preserved (the
   * metadata comment is regenerated from them); a category change regroups the
   * line under the new `## CATEGORY` heading at serialisation. Every file the
   * id lives in is rewritten atomically. Throws on a patch that would corrupt
   * the markdown line format.
   */
  async update(id: string, patch: LessonPatch): Promise<(LessonItem & { locations: LessonLocation[] }) | undefined> {
    this.load();
    const item = this.items.find(i => i.id === id);
    if (!item) return undefined;
    // The line format is `- [id] content <!-- date source[:context] -->`: the
    // parser cuts content at the first `<!--`, and context is matched by
    // `[^-]+` so it cannot contain hyphens; both must stay single-line.
    if (patch.content !== undefined) {
      const content = patch.content.trim();
      if (!content) throw new Error('lesson content cannot be empty');
      if (/[\r\n]/.test(content) || content.includes('<!--') || content.includes('-->')) {
        throw new Error('lesson content must be a single line without HTML comment markers');
      }
      item.content = content;
    }
    if (patch.category !== undefined) item.category = patch.category;
    if (patch.context !== undefined) {
      const context = patch.context === null ? '' : patch.context.trim();
      if (/[-\r\n]/.test(context)) {
        throw new Error('lesson context cannot contain hyphens or newlines (markdown metadata format)');
      }
      if (context) item.context = context;
      else delete item.context;
    }
    this._cachedBlock = null;
    const locations = this.locationsOf(id);
    const updated = { ...item };
    for (const loc of locations) {
      await this.rewriteLessonsFile(loc.path, items => items.map(it => (it.id === id ? { ...updated } : it)));
    }
    return { ...updated, locations };
  }

  /** Delete a lesson from every file it lives in, reporting which ones. */
  async removeWithReport(id: string): Promise<{ removed: boolean; removedFrom: LessonLocation[] }> {
    this.load();
    const idx = this.items.findIndex(i => i.id === id);
    if (idx === -1) return { removed: false, removedFrom: [] };
    const locations = this.locationsOf(id);
    this.items.splice(idx, 1);
    this.locationsById.delete(id);
    this._cachedBlock = null;
    for (const loc of locations) {
      await this.rewriteLessonsFile(loc.path, items => items.filter(it => it.id !== id));
    }
    return { removed: true, removedFrom: locations };
  }

  private locationsOf(id: string): LessonLocation[] {
    return this.locationsById.get(id) ?? [{ scope: 'project', path: this.projectPath }];
  }

  /**
   * Atomically rewrite ONE lessons file through the serialized write queue:
   * the file is re-read fresh inside the queue (so a concurrent writer's
   * changes are preserved), mutated, written to `<file>.tmp` and renamed over.
   */
  private rewriteLessonsFile(filePath: string, mutate: (items: LessonItem[]) => LessonItem[]): Promise<void> {
    return this.enqueueWrite(() => {
      const next = mutate(this.loadFile(filePath));
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, this.serialiseItems(next), 'utf-8');
      fs.renameSync(tmp, filePath);
    });
  }

  clearByCategory(category?: LessonCategory): number {
    this.load();
    const before = this.items.length;
    this.items = category
      ? this.items.filter(i => i.category !== category)
      : [];
    this._cachedBlock = null;
    this.save();
    return before - this.items.length;
  }

  list(category?: LessonCategory): LessonItem[] {
    this.load();
    return category ? this.items.filter(i => i.category === category) : this.items;
  }

  search(query: string, category?: LessonCategory): LessonItem[] {
    this.load();
    const q = query.toLowerCase();
    return this.items.filter(item => {
      if (category && item.category !== category) return false;
      return (
        item.content.toLowerCase().includes(q) ||
        (item.context?.toLowerCase().includes(q) ?? false)
      );
    });
  }

  buildConceptGraph(options: LessonGraphOptions = {}): LessonConceptGraph {
    this.load();
    const { query, category } = options;
    const limit = normalizeGraphLimit(options.limit);
    const includeKeywords = options.includeKeywords !== false;
    const normalizedQuery = query?.toLowerCase().trim();
    const normalizedConcept = normalizeGraphConceptFilter(options.concept);
    const lessons = this.items
      .filter(item => !category || item.category === category)
      .filter(item => {
        if (!normalizedQuery) return true;
        return (
          item.content.toLowerCase().includes(normalizedQuery) ||
          (item.context?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      })
      .filter(item => {
        if (!normalizedConcept) return true;
        return extractLessonConcepts(item, { includeKeywords }).some(concept => (
          concept.slug === normalizedConcept ||
          slugifyConcept(concept.label) === normalizedConcept
        ));
      })
      .slice(0, limit);

    const conceptMap = new Map<string, LessonConceptNode>();
    const lessonConcepts: Record<string, LessonConceptRef[]> = {};

    for (const lesson of lessons) {
      const concepts = extractLessonConcepts(lesson, { includeKeywords });
      lessonConcepts[lesson.id] = concepts;
      for (const concept of concepts) {
        const existing = conceptMap.get(concept.slug);
        if (existing) {
          if (!existing.lessonIds.includes(lesson.id)) {
            existing.lessonIds.push(lesson.id);
          }
          for (const source of concept.sources) {
            if (!existing.sources.includes(source)) {
              existing.sources.push(source);
            }
          }
          existing.weight = existing.lessonIds.length;
        } else {
          conceptMap.set(concept.slug, {
            id: concept.slug,
            label: concept.label,
            lessonIds: [lesson.id],
            sources: [...concept.sources],
            weight: 1,
          });
        }
      }
    }

    const concepts = Array.from(conceptMap.values())
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
    const backlinks = buildConceptBacklinks(concepts);
    const relatedLessons = buildRelatedLessonEdges(lessons, lessonConcepts);

    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      filters: buildLessonGraphFilters({ query, concept: options.concept, category, includeKeywords, limit }),
      lessons,
      concepts,
      lessonConcepts,
      backlinks,
      relatedLessons,
    };
  }

  getConceptDetails(conceptName: string): {
    concept: { id: string; label: string; weight: number };
    lessons: Array<{
      id: string;
      category: string;
      content: string;
      context?: string;
      createdBy?: { runId?: string; outcomeId?: string; sagaId?: string; note?: string; at: number };
      usedBy?: Array<{ runId: string; at: number }>;
    }>;
    backlinks: string[];
  } | null {
    const graph = this.buildConceptGraph({ includeKeywords: true, limit: 1000 });
    const slug = conceptName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const conceptNode = graph.concepts.find(c => c.id === slug || c.label.toLowerCase() === conceptName.toLowerCase());
    if (!conceptNode) return null;

    const provIndex = getLessonProvenanceIndex(this.workDir);

    const lessons = graph.lessons
      .filter(l => conceptNode.lessonIds.includes(l.id))
      .map(l => {
        const prov = provIndex.getProvenance(l.id);
        return {
          id: l.id,
          category: l.category,
          content: l.content,
          context: l.context,
          createdBy: prov?.createdBy,
          usedBy: prov?.usedBy,
        };
      });

    const backlinkIds = new Set<string>();
    for (const rel of graph.relatedLessons) {
      if (conceptNode.lessonIds.includes(rel.from) || conceptNode.lessonIds.includes(rel.to)) {
        for (const c of rel.sharedConcepts) {
          if (c !== conceptNode.id) {
            backlinkIds.add(c);
          }
        }
      }
    }

    const backlinks = Array.from(backlinkIds)
      .map(id => graph.concepts.find(c => c.id === id)?.label)
      .filter(Boolean) as string[];

    return {
      concept: {
        id: conceptNode.id,
        label: conceptNode.label,
        weight: conceptNode.weight,
      },
      lessons,
      backlinks,
    };
  }

  /**
   * Build the per-turn context block injected BEFORE the todo suffix.
   * Returns null when there are no lessons (avoids noisy injections).
   *
   * BUDGETED: the block used to emit EVERY active lesson on EVERY turn (and
   * again on every round) — an unbounded per-turn token tax that grows as
   * lessons accumulate. It now packs a character budget in priority order:
   * category first (RULE is contractual and always outranks INSIGHT), then
   * BM25 relevance to the current message when provided, else recency.
   * Packing stops at the first overflow so a low-priority lesson can never
   * displace a higher-priority one, and the dropped count is stated honestly
   * instead of silently truncating.
   */
  buildContextBlock(options: LessonsContextOptions = {}): string | null {
    const maxChars = options.maxChars ?? DEFAULT_LESSONS_CONTEXT_CHARS;
    const cacheKey = `${maxChars}|${options.query ?? ''}`;
    if (this._cachedBlock !== null && this._cachedKey === cacheKey && Date.now() - this._cacheTime < 5000) {
      return this._cachedBlock;
    }
    this.load();
    if (this.items.length === 0) return null;

    // Relevance ranking within categories: BM25 against the current message
    // (transient index, small corpus — same pattern as the CKG's hybrid leg).
    let relevance: Map<string, number> | null = null;
    if (options.query?.trim() && this.items.length > 1) {
      try {
        const index = new BM25Index();
        index.addDocuments(this.items.map(item => ({ id: item.id, content: `${item.context ?? ''} ${item.content}` })));
        relevance = new Map(index.search(options.query, this.items.length).map(r => [r.id, r.score]));
      } catch {
        relevance = null; // lexical ranking is best-effort — recency still applies
      }
    }
    const byRankThenRecency = (a: LessonItem, b: LessonItem): number => {
      if (relevance) {
        const diff = (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0);
        if (diff !== 0) return diff;
      }
      return b.createdAt - a.createdAt;
    };

    const grouped = new Map<LessonCategory, LessonItem[]>();
    for (const item of this.items) {
      const arr = grouped.get(item.category) ?? [];
      arr.push(item);
      grouped.set(item.category, arr);
    }

    const lines = [
      '<lessons_context>',
      '## Active Lessons (apply to this turn)',
      '',
    ];
    const shownIds: string[] = [];
    let used = 0;
    // Best-fit packing IN priority order: try categories RULE→…→INSIGHT and, within each, rank/recency.
    // A single over-budget item is SKIPPED (not a hard stop), so one long RULE lesson no longer starves
    // the shorter PATTERN/CONTEXT/INSIGHT lessons that would still fit — while a lower-priority lesson
    // is only ever packed into the budget LEFT after the higher-priority ones (priority is preserved).
    const order: LessonCategory[] = ['RULE', 'PATTERN', 'CONTEXT', 'INSIGHT'];
    for (const cat of order) {
      const catItems = (grouped.get(cat) ?? []).slice().sort(byRankThenRecency);
      for (const item of catItems) {
        const ctx = item.context ? ` _(${item.context})_` : '';
        const line = `**[${item.category}]**${ctx} ${item.content}`;
        if (used + line.length > maxChars) continue; // skip this over-budget item, keep packing smaller ones
        lines.push(line);
        used += line.length;
        shownIds.push(item.id);
      }
    }
    const dropped = this.items.length - shownIds.length;
    if (dropped > 0) {
      lines.push(
        '',
        `_(+${dropped} lesson${dropped > 1 ? 's' : ''} over the ${maxChars}-char budget, ranked ${relevance ? 'by relevance to this message' : 'by recency'} — see /lessons)_`,
      );
    }
    lines.push('</lessons_context>');

    // Record usage off the hot path — only for the lessons actually INJECTED
    // (the old version claimed usage for every lesson every turn, which would
    // skew provenance stats once budgeting drops some).
    const workDir = this.workDir;
    Promise.resolve().then(async () => {
      try {
        const { RunStore } = await import('../observability/run-store.js');
        const activeRunId = RunStore.getInstance().getCurrentRunId();
        if (activeRunId) {
          const index = getLessonProvenanceIndex(workDir);
          for (const id of shownIds) {
            index.recordUsage(id, activeRunId);
          }
        }
      } catch (err) {
        logger.debug('[lessons] failed to record usage in background', { error: String(err) });
      }
    });

    const result = lines.join('\n');
    this._cachedBlock = result;
    this._cachedKey = cacheKey;
    this._cacheTime = Date.now();
    return result;
  }

  // --------------------------------------------------------------------------
  // Analytics
  // --------------------------------------------------------------------------

  getStats(): LessonsStats {
    this.load();
    const byCategory: Record<LessonCategory, number> = { PATTERN: 0, RULE: 0, CONTEXT: 0, INSIGHT: 0 };
    const bySource: Record<LessonItem['source'], number> = { user_correction: 0, self_observed: 0, manual: 0 };
    let oldestAt: number | null = null;
    let newestAt: number | null = null;

    for (const item of this.items) {
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
      if (item.createdAt > 0) {
        if (oldestAt === null || item.createdAt < oldestAt) oldestAt = item.createdAt;
        if (newestAt === null || item.createdAt > newestAt) newestAt = item.createdAt;
      }
    }

    return { total: this.items.length, byCategory, bySource, oldestAt, newestAt };
  }

  export(format: 'json' | 'md' | 'csv' = 'md'): string {
    this.load();
    if (format === 'json') {
      return JSON.stringify(this.items, null, 2);
    }
    if (format === 'csv') {
      const header = 'id,category,source,createdAt,context,content';
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = this.items.map(item =>
        [
          escape(item.id),
          escape(item.category),
          escape(item.source),
          escape(new Date(item.createdAt).toISOString()),
          escape(item.context ?? ''),
          escape(item.content),
        ].join(',')
      );
      return [header, ...rows].join('\n');
    }
    // 'md' — default
    return this.serialise();
  }

  autoDecay(maxAgeDays: number = 90): number {
    this.load();
    const threshold = Date.now() - maxAgeDays * 86_400_000;
    const before = this.items.length;
    this.items = this.items.filter(
      item => !(item.category === 'INSIGHT' && item.createdAt > 0 && item.createdAt < threshold)
    );
    const removed = before - this.items.length;
    if (removed > 0) {
      this._cachedBlock = null;
      this.save();
    }
    return removed;
  }

  // --------------------------------------------------------------------------
  // Markdown serialisation / parsing
  // --------------------------------------------------------------------------

  private serialise(): string {
    return this.serialiseItems(this.items);
  }

  private serialiseItems(items: LessonItem[]): string {
    const lines = [
      '# Lessons Learned',
      `<!-- auto-generated by Code Buddy — last updated ${new Date().toISOString()} -->`,
      '',
    ];

    const grouped = new Map<LessonCategory, LessonItem[]>();
    for (const item of items) {
      const arr = grouped.get(item.category) ?? [];
      arr.push(item);
      grouped.set(item.category, arr);
    }

    const order: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    for (const cat of order) {
      const catItems = grouped.get(cat);
      if (!catItems || catItems.length === 0) continue;
      lines.push(`## ${cat}`);
      for (const item of catItems) {
        const date = new Date(item.createdAt).toISOString().slice(0, 10);
        const ctx = item.context ? `:${item.context}` : '';
        lines.push(`- [${item.id}] ${item.content} <!-- ${date} ${item.source}${ctx} -->`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private loadFile(filePath: string): LessonItem[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseMd(content);
    } catch {
      return [];
    }
  }

  private parseMd(content: string): LessonItem[] {
    const items: LessonItem[] = [];
    let currentCategory: LessonCategory = 'INSIGHT';

    for (const rawLine of content.split('\n')) {
      // Category header: ## PATTERN
      const catMatch = rawLine.match(/^## (PATTERN|RULE|CONTEXT|INSIGHT)\s*$/);
      if (catMatch) {
        currentCategory = catMatch[1] as LessonCategory;
        continue;
      }

      // Item: - [id] content <!-- date source:context -->
      const itemMatch = rawLine.match(/^- \[([^\]]+)\] (.+?) <!-- ([^\s]+) ([^\s:]+)(?::([^-]+))? -->/);
      if (itemMatch) {
        const [, id, rawContent, dateStr, sourceStr, ctx] = itemMatch;
        if (id === undefined || rawContent === undefined || dateStr === undefined || sourceStr === undefined) continue;
        items.push({
          id,
          content: rawContent.trim(),
          category: currentCategory,
          createdAt: new Date(dateStr).getTime() || 0,
          source: (sourceStr as LessonItem['source']) ?? 'manual',
          context: ctx?.trim() || undefined,
        });
        continue;
      }

      // Plain item fallback: - content
      const plainMatch = rawLine.match(/^- (.+)/);
      if (plainMatch) {
        const plainContent = plainMatch[1];
        if (plainContent === undefined) continue;
        items.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          content: plainContent.trim(),
          category: currentCategory,
          createdAt: 0,
          source: 'manual',
        });
      }
    }

    return items;
  }
}

const CONCEPT_STOP_WORDS = new Set([
  'about', 'after', 'again', 'ainsi', 'always', 'avant', 'avoir', 'because',
  'before', 'cette', 'comme', 'dans', 'faire', 'from', 'leurs', 'mettre',
  'pour', 'quand', 'should', 'then', 'this', 'tool', 'tools', 'tout',
  'toute', 'use', 'using', 'with',
]);

function extractLessonConcepts(
  lesson: LessonItem,
  options: { includeKeywords?: boolean } = {},
): LessonConceptRef[] {
  const concepts = new Map<string, LessonConceptRef>();
  const add = (rawLabel: string, source: LessonConceptSource, rawSlug: string = rawLabel): void => {
    const label = normalizeConceptLabel(rawLabel);
    const slug = slugifyConcept(normalizeConceptLabel(rawSlug));
    if (!slug || CONCEPT_STOP_WORDS.has(slug)) return;
    const existing = concepts.get(slug);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      return;
    }
    concepts.set(slug, { slug, label, sources: [source] });
  };

  if (lesson.context) add(lesson.context, 'context');

  for (const match of lesson.content.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const inner = match[1];
    if (inner === undefined) continue;
    const { label, target } = parseWikiLink(inner);
    add(label, 'wiki_link', target);
  }

  for (const match of lesson.content.matchAll(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g)) {
    const linkLabel = match[1];
    const linkTarget = match[2];
    if (linkLabel === undefined || linkTarget === undefined) continue;
    const target = normalizeMarkdownLinkTarget(linkTarget);
    if (target) add(linkLabel, 'markdown_link', target);
  }

  for (const match of lesson.content.matchAll(/(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_-]{1,64})/g)) {
    const tag = match[1];
    if (tag === undefined) continue;
    add(tag, 'tag');
  }

  for (const match of lesson.content.matchAll(/\b(?:tags?|related)\s*:\s*([^.;\n]+)/gi)) {
    const tagList = match[1];
    if (tagList === undefined) continue;
    for (const part of tagList.split(/[,|]/)) {
      add(part, match[0].toLowerCase().startsWith('related') ? 'related' : 'tag');
    }
  }

  if (options.includeKeywords !== false) {
    const cleanedContent = lesson.content
      .replace(/\[\[[^\]]+\]\]/g, ' ')
      .replace(/(?<!!)\[[^\]]+\]\([^)]+\)/g, ' ')
      .replace(/<!--.*?-->/g, ' ')
      .replace(/\b(?:tags?|related)\s*:\s*([^.;\n]+)/gi, ' ');
    for (const rawWord of cleanedContent.split(/[^A-Za-z0-9À-ÖØ-öø-ÿ_-]+/u)) {
      const label = normalizeConceptLabel(rawWord);
      const slug = slugifyConcept(label);
      if (slug.length >= 5 && !CONCEPT_STOP_WORDS.has(slug)) {
        add(label, 'keyword');
      }
      if (concepts.size >= 12) break;
    }
  }

  return Array.from(concepts.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildRelatedLessonEdges(
  lessons: LessonItem[],
  lessonConcepts: Record<string, LessonConceptRef[]>,
): LessonGraphEdge[] {
  const edges: LessonGraphEdge[] = [];

  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const left = lessons[i];
      const right = lessons[j];
      if (left === undefined || right === undefined) continue;
      const leftConcepts = new Set((lessonConcepts[left.id] ?? []).map(concept => concept.slug));
      const sharedConcepts = (lessonConcepts[right.id] ?? [])
        .map(concept => concept.slug)
        .filter(slug => leftConcepts.has(slug));
      if (sharedConcepts.length === 0) continue;
      edges.push({
        from: left.id,
        to: right.id,
        sharedConcepts,
        weight: sharedConcepts.length,
      });
    }
  }

  return edges.sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from));
}

function buildConceptBacklinks(concepts: LessonConceptNode[]): Record<string, string[]> {
  const backlinks: Record<string, string[]> = {};
  for (const concept of concepts) {
    backlinks[concept.id] = [...concept.lessonIds];
  }
  return backlinks;
}

function renderLessonVaultIndex(graph: LessonConceptGraph): string {
  const lines = [
    ...renderYamlFrontmatter([
      ['type', 'lessons-vault-index'],
      ['schemaVersion', graph.schemaVersion],
      ['generatedAt', new Date(graph.generatedAt).toISOString()],
      ['lessons', graph.lessons.length],
      ['concepts', graph.concepts.length],
      ['relations', graph.relatedLessons.length],
    ]),
    '# Lessons Vault',
    '',
    `Generated: ${new Date(graph.generatedAt).toISOString()}`,
    `Schema version: ${graph.schemaVersion}`,
    `Lessons: ${graph.lessons.length}`,
    `Concepts: ${graph.concepts.length}`,
    `Relations: ${graph.relatedLessons.length}`,
    ...renderLessonGraphFilterLines(graph.filters),
    '',
    '## Indexes',
    `- ${vaultWikiLink('_concepts', 'Concept index')}`,
    `- ${vaultWikiLink('_lessons', 'Lesson index')}`,
    '',
    '## Concepts',
  ];

  if (graph.concepts.length === 0) {
    lines.push('- No concepts extracted.');
  } else {
    for (const concept of graph.concepts) {
      lines.push(`- ${vaultWikiLink(`concepts/${concept.id}`, concept.label)} (${concept.lessonIds.length} lesson(s); ${concept.sources.join(', ')})`);
    }
  }

  lines.push('', '## Lessons');
  if (graph.lessons.length === 0) {
    lines.push('- No lessons available.');
  } else {
    for (const lesson of graph.lessons) {
      lines.push(`- ${vaultWikiLink(`lessons/${lesson.id}`, `${lesson.category}: ${truncateLabel(lesson.content, 80)}`)}`);
    }
  }

  lines.push('', '## Artifacts');
  lines.push('- `graph.json`');
  lines.push('- `graph.mmd`');
  lines.push('- `manifest.json`');

  return lines.join('\n');
}

function renderLessonVaultManifest(graph: LessonConceptGraph, files: string[]): string {
  const manifest: LessonVaultManifest = {
    vaultSchemaVersion: 1,
    graphSchemaVersion: graph.schemaVersion,
    generatedAt: new Date(graph.generatedAt).toISOString(),
    entrypoints: {
      index: 'index.md',
      conceptsIndex: '_concepts.md',
      lessonsIndex: '_lessons.md',
      graphJson: 'graph.json',
      graphMermaid: 'graph.mmd',
      manifest: 'manifest.json',
    },
    counts: {
      lessons: graph.lessons.length,
      concepts: graph.concepts.length,
      relations: graph.relatedLessons.length,
      files: files.length,
    },
    filters: graph.filters,
    concepts: graph.concepts.map(concept => ({
      id: concept.id,
      label: concept.label,
      path: `concepts/${safeVaultSegment(concept.id)}.md`,
      sources: concept.sources,
      lessonIds: graph.backlinks[concept.id] ?? concept.lessonIds,
    })),
    lessons: graph.lessons.map(lesson => ({
      id: lesson.id,
      category: lesson.category,
      path: `lessons/${safeVaultSegment(lesson.id)}.md`,
      conceptIds: (graph.lessonConcepts[lesson.id] ?? []).map(concept => concept.slug),
    })),
    files,
  };

  return JSON.stringify(manifest, null, 2);
}

function renderLessonVaultConceptIndex(graph: LessonConceptGraph): string {
  const lines = [
    ...renderYamlFrontmatter([
      ['type', 'lessons-vault-concepts-index'],
      ['schemaVersion', graph.schemaVersion],
      ['generatedAt', new Date(graph.generatedAt).toISOString()],
      ['concepts', graph.concepts.map(concept => concept.id)],
    ]),
    '# Concept Index',
    '',
  ];

  if (graph.concepts.length === 0) {
    lines.push('- No concepts extracted.');
  } else {
    for (const concept of graph.concepts) {
      const sources = concept.sources.join(', ');
      const link = vaultWikiLink(`concepts/${concept.id}`, concept.label);
      lines.push(`- ${link} (${concept.lessonIds.length} lesson(s); ${sources})`);
    }
  }

  return lines.join('\n');
}

function renderLessonVaultLessonIndex(graph: LessonConceptGraph): string {
  const lines = [
    ...renderYamlFrontmatter([
      ['type', 'lessons-vault-lessons-index'],
      ['schemaVersion', graph.schemaVersion],
      ['generatedAt', new Date(graph.generatedAt).toISOString()],
      ['lessonIds', graph.lessons.map(lesson => lesson.id)],
    ]),
    '# Lesson Index',
    '',
  ];

  if (graph.lessons.length === 0) {
    lines.push('- No lessons available.');
  } else {
    for (const lesson of graph.lessons) {
      const concepts = (graph.lessonConcepts[lesson.id] ?? [])
        .map(concept => vaultWikiLink(`concepts/${concept.slug}`, concept.label))
        .join(', ');
      const label = `${lesson.category}: ${truncateLabel(lesson.content, 96)}`;
      const suffix = concepts ? ` concepts: ${concepts}` : '';
      lines.push(`- ${vaultWikiLink(`lessons/${lesson.id}`, label)}${suffix}`);
    }
  }

  return lines.join('\n');
}

function renderLessonVaultConcept(
  graph: LessonConceptGraph,
  concept: LessonConceptNode,
  lessonsById: Map<string, LessonItem>,
): string {
  const lines = [
    ...renderYamlFrontmatter([
      ['type', 'lesson-concept'],
      ['id', concept.id],
      ['label', concept.label],
      ['sources', concept.sources],
      ['lessonIds', graph.backlinks[concept.id] ?? concept.lessonIds],
      ['weight', concept.weight],
    ]),
    `# ${concept.label}`,
    '',
    `Concept id: \`${concept.id}\``,
    `Sources: ${concept.sources.join(', ')}`,
    `Weight: ${concept.weight}`,
    '',
    '## Backlinks',
  ];

  for (const lessonId of graph.backlinks[concept.id] ?? concept.lessonIds) {
    const lesson = lessonsById.get(lessonId);
    const label = lesson ? `${lesson.category}: ${truncateLabel(lesson.content, 96)}` : lessonId;
    lines.push(`- ${vaultWikiLink(`lessons/${lessonId}`, label)}`);
  }

  const related = graph.relatedLessons.filter(edge => edge.sharedConcepts.includes(concept.id));
  lines.push('', '## Related Lessons');
  if (related.length === 0) {
    lines.push('- No lesson-to-lesson relations through this concept yet.');
  } else {
    for (const edge of related) {
      lines.push(`- ${vaultWikiLink(`lessons/${edge.from}`, edge.from)} <-> ${vaultWikiLink(`lessons/${edge.to}`, edge.to)}`);
    }
  }

  return lines.join('\n');
}

function renderLessonVaultLesson(graph: LessonConceptGraph, lesson: LessonItem): string {
  const concepts = graph.lessonConcepts[lesson.id] ?? [];
  const lines = [
    ...renderYamlFrontmatter([
      ['type', 'lesson'],
      ['id', lesson.id],
      ['category', lesson.category],
      ['source', lesson.source],
      ['createdAt', lesson.createdAt ? new Date(lesson.createdAt).toISOString() : undefined],
      ['context', lesson.context],
      ['concepts', concepts.map(concept => concept.slug)],
    ]),
    `# ${lesson.category}: ${lesson.id}`,
    '',
    `Category: ${lesson.category}`,
    `Source: ${lesson.source}`,
    `Created: ${lesson.createdAt ? new Date(lesson.createdAt).toISOString() : 'unknown'}`,
    ...(lesson.context ? [`Context: ${lesson.context}`] : []),
    '',
    '## Content',
    lesson.content,
    '',
    '## Concepts',
  ];

  if (concepts.length === 0) {
    lines.push('- No concepts extracted.');
  } else {
    for (const concept of concepts) {
      lines.push(`- ${vaultWikiLink(`concepts/${concept.slug}`, concept.label)} (${concept.sources.join(', ')})`);
    }
  }

  const related = graph.relatedLessons.filter(edge => edge.from === lesson.id || edge.to === lesson.id);
  lines.push('', '## Related Lessons');
  if (related.length === 0) {
    lines.push('- No related lessons yet.');
  } else {
    for (const edge of related) {
      const otherId = edge.from === lesson.id ? edge.to : edge.from;
      const shared = edge.sharedConcepts.map(slug => vaultWikiLink(`concepts/${slug}`, slug)).join(', ');
      lines.push(`- ${vaultWikiLink(`lessons/${otherId}`, otherId)} via ${shared}`);
    }
  }

  return lines.join('\n');
}

function vaultWikiLink(target: string, label: string): string {
  const safeLabel = label.replace(/[[\]|]/g, '').replace(/\s+/g, ' ').trim();
  return `[[${target}|${safeLabel || target}]]`;
}

function renderYamlFrontmatter(
  entries: Array<[string, string | number | boolean | string[] | undefined]>,
): string[] {
  const lines = ['---'];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${yamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---', '');
  return lines;
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function safeVaultSegment(value: string): string {
  return slugifyConcept(value) || 'unknown';
}

function buildLessonGraphFilters(filters: LessonConceptGraphFilters): LessonConceptGraphFilters {
  return {
    ...(filters.query ? { query: filters.query } : {}),
    ...(filters.concept ? { concept: filters.concept } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    includeKeywords: filters.includeKeywords,
    limit: filters.limit,
  };
}

function renderLessonGraphFilterLines(filters?: LessonConceptGraphFilters): string[] {
  if (!filters) return [];
  return [
    `Filters: query=${filters.query ?? 'any'}; concept=${filters.concept ?? 'any'}; category=${filters.category ?? 'any'}; includeKeywords=${filters.includeKeywords}; limit=${filters.limit}`,
  ];
}

function normalizeGraphLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.floor(value), 1), 200);
}

function normalizeGraphConceptFilter(value: string | undefined): string | null {
  if (!value) return null;
  const target = normalizeMarkdownLinkTarget(value) ?? value;
  const slug = slugifyConcept(normalizeConceptLabel(target));
  return slug || null;
}

function parseWikiLink(value: string): { label: string; target: string } {
  const [target = '', alias] = value.split('|', 2).map(part => part.trim());
  return {
    label: alias || target,
    target: normalizeMarkdownLinkTarget(target) ?? target,
  };
}

function normalizeMarkdownLinkTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  const [withoutQuery = ''] = trimmed.startsWith('#') ? [trimmed.slice(1)] : trimmed.split(/[?#]/, 1);
  const normalized = withoutQuery.replace(/\\/g, '/').replace(/\/+$/g, '');
  const basename = normalized.split('/').pop() ?? normalized;
  const withoutExtension = basename.replace(/\.md$/i, '');
  return withoutExtension || null;
}

function normalizeConceptLabel(value: string): string {
  return value
    .replace(/^#+/, '')
    .replace(/[[\]`*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function truncateLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function slugifyConcept(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
