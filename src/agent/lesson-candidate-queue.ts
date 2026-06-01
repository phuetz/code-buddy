/**
 * Lesson candidate review queue (Hermes parity TODO item 7).
 *
 * Hermes' defining feature is a *closed* learning loop: after a complex
 * successful run the agent PROPOSES a lesson, and a human approves, edits, or
 * discards it. The acceptance criterion is "no silent procedural memory
 * mutation" — proposing a lesson must never write to `lessons.md` on its own.
 *
 * This queue is the general counterpart to the narrower research-script SKILL
 * candidate queue (`buddy tools skill-candidate`). It keeps a side-car JSON
 * file (`.codebuddy/lesson-candidates.json`) so the `lessons.md` format and the
 * per-turn injection hot path stay untouched:
 *
 *   - `propose(...)`  — enqueue a PENDING candidate. Never touches lessons.md.
 *                       Identical pending (category + content) proposals, and
 *                       proposals already recorded as lessons, are de-duplicated
 *                       so an over-eager agent cannot spam review work.
 *   - `list(status?)` / `get(id)` — review surface.
 *   - `approve(id, …)` — the ONLY path that writes a lesson. Requires an
 *                        explicit human reviewer, supports inline edits, routes
 *                        through `LessonsTracker.add` with provenance, and links
 *                        the created lesson id back onto the candidate.
 *   - `discard(id, …)` — reject a candidate with an optional reason.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { getLessonsTracker } from './lessons-tracker.js';
import type { LessonCategory, LessonItem } from './lessons-tracker.js';

export const LESSON_CANDIDATE_SCHEMA_VERSION = 1;

const VALID_CATEGORIES: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];

export type LessonCandidateStatus = 'pending' | 'approved' | 'discarded';

export interface LessonCandidateProvenance {
  runId?: string;
  outcomeId?: string;
  sagaId?: string;
  /** Free-form note, e.g. "proposed after passing verification on task X". */
  note?: string;
}

export interface LessonCandidate {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;
  status: LessonCandidateStatus;
  createdAt: number;
  /** Who/what proposed it. The agent proposes as `self_observed`. */
  source: 'self_observed' | 'manual';
  provenance?: LessonCandidateProvenance;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  /** Set when approved: the id of the lesson written into lessons.md. */
  approvedLessonId?: string;
}

export interface ProposeLessonCandidateInput {
  category: LessonCategory;
  content: string;
  context?: string;
  source?: 'self_observed' | 'manual';
  provenance?: LessonCandidateProvenance;
}

export interface ProposeLessonCandidateResult {
  candidate?: LessonCandidate;
  /** Set when the proposed lesson is already recorded in lessons.md. */
  existingLesson?: LessonItem;
  /** True when an identical pending candidate already existed or the lesson is already recorded. */
  deduped: boolean;
  alreadyRecorded?: boolean;
}

export interface ApproveLessonCandidateInput {
  /** Explicit human reviewer — required. Approving is the only write path. */
  reviewedBy: string;
  /** Optional inline edits applied before the lesson is written. */
  content?: string;
  category?: LessonCategory;
  context?: string;
  reviewNote?: string;
}

export interface ApproveLessonCandidateResult {
  candidate: LessonCandidate;
  lesson: LessonItem;
}

export interface DiscardLessonCandidateInput {
  reviewedBy?: string;
  reason?: string;
}

export interface LessonCandidateStats {
  total: number;
  byStatus: Record<LessonCandidateStatus, number>;
}

interface LessonCandidateFile {
  schemaVersion: typeof LESSON_CANDIDATE_SCHEMA_VERSION;
  candidates: LessonCandidate[];
}

// ============================================================================
// Singleton registry (one queue per working directory)
// ============================================================================

const registry = new Map<string, LessonCandidateQueue>();

export function getLessonCandidateQueue(workDir: string = process.cwd()): LessonCandidateQueue {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new LessonCandidateQueue(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

/** Test helper: drop cached queue instances so a fresh workDir is re-read. */
export function resetLessonCandidateQueues(): void {
  registry.clear();
}

// ============================================================================
// LessonCandidateQueue
// ============================================================================

export class LessonCandidateQueue {
  private filePath: string;
  private candidates: LessonCandidate[] = [];
  private loaded = false;

  constructor(private workDir: string = process.cwd()) {
    // Mirror LessonsTracker: keep the candidate side-car next to lessons.md so
    // approving a candidate and reading the resulting lesson stay co-located.
    this.filePath = path.join(workDir, '.codebuddy', 'lesson-candidates.json');
  }

  /**
   * Enqueue a PENDING candidate. This never writes a lesson — it is the
   * "agent proposes" half of the loop. Identical pending proposals (same
   * category + trimmed content) collapse onto the existing candidate.
   */
  propose(input: ProposeLessonCandidateInput): ProposeLessonCandidateResult {
    this.load();
    const category = normalizeCategory(input.category);
    const content = (input.content ?? '').trim();
    if (!content) {
      throw new Error('Lesson candidate content is required.');
    }

    const context = input.context?.trim() || undefined;
    const existing = this.candidates.find(
      (candidate) =>
        candidate.status === 'pending' &&
        candidate.category === category &&
        candidate.content.trim().toLowerCase() === content.toLowerCase(),
    );
    if (existing) {
      return { candidate: existing, deduped: true };
    }

    const existingLesson = getLessonsTracker(this.workDir)
      .list(category)
      .find((lesson) => lesson.content.trim().toLowerCase() === content.toLowerCase());
    if (existingLesson) {
      return { existingLesson, deduped: true, alreadyRecorded: true };
    }

    const candidate: LessonCandidate = {
      id: `lc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      category,
      content,
      ...(context ? { context } : {}),
      status: 'pending',
      createdAt: Date.now(),
      source: input.source ?? 'self_observed',
      ...(input.provenance && hasProvenance(input.provenance) ? { provenance: input.provenance } : {}),
    };
    this.candidates.push(candidate);
    this.save();
    return { candidate, deduped: false };
  }

  list(status?: LessonCandidateStatus): LessonCandidate[] {
    this.load();
    const items = status ? this.candidates.filter((c) => c.status === status) : this.candidates;
    // Newest first — reviewers care about recent proposals.
    return [...items].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): LessonCandidate | null {
    this.load();
    return this.candidates.find((c) => c.id === id) ?? null;
  }

  /**
   * Approve a pending candidate. This is the ONLY method that writes a lesson.
   * Requires an explicit human reviewer; supports inline edits; routes through
   * `LessonsTracker.add` with the candidate's provenance and links the created
   * lesson id back onto the candidate.
   */
  async approve(id: string, input: ApproveLessonCandidateInput): Promise<ApproveLessonCandidateResult> {
    this.load();
    const reviewedBy = input.reviewedBy?.trim();
    if (!reviewedBy) {
      throw new Error('Human approval (reviewedBy) is required before a lesson candidate can be written.');
    }

    const candidate = this.candidates.find((c) => c.id === id);
    if (!candidate) {
      throw new Error(`Lesson candidate not found: ${id}`);
    }
    if (candidate.status !== 'pending') {
      throw new Error(`Lesson candidate ${id} is already ${candidate.status}; only pending candidates can be approved.`);
    }

    const category = input.category ? normalizeCategory(input.category) : candidate.category;
    const content = (input.content ?? candidate.content).trim();
    if (!content) {
      throw new Error('Approved lesson content cannot be empty.');
    }
    const context = input.context !== undefined ? input.context.trim() || undefined : candidate.context;

    const tracker = getLessonsTracker(this.workDir);
    const lesson = tracker.add(
      category,
      content,
      'self_observed',
      context,
      candidate.provenance
        ? {
            ...(candidate.provenance.runId ? { runId: candidate.provenance.runId } : {}),
            ...(candidate.provenance.outcomeId ? { outcomeId: candidate.provenance.outcomeId } : {}),
            ...(candidate.provenance.sagaId ? { sagaId: candidate.provenance.sagaId } : {}),
            note: candidate.provenance.note ?? `approved from lesson candidate ${candidate.id}`,
          }
        : { note: `approved from lesson candidate ${candidate.id}` },
    );
    // Flush the tracker write chain so the lesson is durable before we return.
    await tracker.save();

    candidate.status = 'approved';
    candidate.category = category;
    candidate.content = content;
    if (context) {
      candidate.context = context;
    } else {
      delete candidate.context;
    }
    candidate.reviewedAt = Date.now();
    candidate.reviewedBy = reviewedBy;
    if (input.reviewNote?.trim()) {
      candidate.reviewNote = input.reviewNote.trim();
    }
    candidate.approvedLessonId = lesson.id;
    this.save();

    return { candidate, lesson };
  }

  /** Reject a pending candidate. Discarding a non-pending candidate throws. */
  discard(id: string, input: DiscardLessonCandidateInput = {}): LessonCandidate {
    this.load();
    const candidate = this.candidates.find((c) => c.id === id);
    if (!candidate) {
      throw new Error(`Lesson candidate not found: ${id}`);
    }
    if (candidate.status === 'approved') {
      throw new Error(`Lesson candidate ${id} was already approved and cannot be discarded.`);
    }
    candidate.status = 'discarded';
    candidate.reviewedAt = Date.now();
    if (input.reviewedBy?.trim()) {
      candidate.reviewedBy = input.reviewedBy.trim();
    }
    if (input.reason?.trim()) {
      candidate.reviewNote = input.reason.trim();
    }
    this.save();
    return candidate;
  }

  getStats(): LessonCandidateStats {
    this.load();
    const byStatus: Record<LessonCandidateStatus, number> = { pending: 0, approved: 0, discarded: 0 };
    for (const candidate of this.candidates) {
      byStatus[candidate.status] += 1;
    }
    return { total: this.candidates.length, byStatus };
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as LessonCandidateFile;
      if (Array.isArray(parsed.candidates)) {
        this.candidates = parsed.candidates.filter(isValidCandidate);
      }
    } catch (err) {
      logger.warn('[lesson-candidates] failed to load queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: LessonCandidateFile = {
        schemaVersion: LESSON_CANDIDATE_SCHEMA_VERSION,
        candidates: this.candidates,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logger.warn('[lesson-candidates] failed to save queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeCategory(value: LessonCategory | string): LessonCategory {
  const upper = String(value ?? '').toUpperCase() as LessonCategory;
  if (!VALID_CATEGORIES.includes(upper)) {
    throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  return upper;
}

function hasProvenance(provenance: LessonCandidateProvenance): boolean {
  return Boolean(provenance.runId || provenance.outcomeId || provenance.sagaId || provenance.note);
}

function isValidCandidate(value: unknown): value is LessonCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LessonCandidate>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.category === 'string' &&
    VALID_CATEGORIES.includes(candidate.category as LessonCategory) &&
    (candidate.status === 'pending' || candidate.status === 'approved' || candidate.status === 'discarded')
  );
}
