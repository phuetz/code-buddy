/**
 * Lesson provenance index.
 *
 * Hermes-style learning loop wants a lesson to answer two questions: "what
 * created me?" and "which runs have used me?". The lessons themselves live in
 * `lessons.md`; this keeps a separate, side-car provenance index in
 * `.codebuddy/lessons-provenance.json` so the `lessons.md` format and the
 * per-turn injection hot path stay untouched.
 *
 *   - `recordCreated(lessonId, …)` links a lesson to the run/outcome/saga that
 *     produced it (called from `LessonsTracker.add` when provenance is known).
 *   - `recordUsage(lessonId, runId)` records that a run loaded the lesson;
 *     idempotent per (lessonId, runId) so repeated calls are cheap no-ops.
 *   - `getProvenance(lessonId)` returns the "created by" + "used by" view a
 *     lesson page (CLI or Cowork) can render.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export interface LessonCreationProvenance {
  runId?: string;
  outcomeId?: string;
  sagaId?: string;
  /** Free-form note, e.g. "promoted from Fleet review outcome". */
  note?: string;
  at: number;
}

export interface LessonUsage {
  runId: string;
  at: number;
}

export interface LessonProvenanceRecord {
  lessonId: string;
  createdBy?: LessonCreationProvenance;
  usedBy: LessonUsage[];
}

interface ProvenanceFile {
  schemaVersion: 1;
  records: Record<string, LessonProvenanceRecord>;
}

const MAX_USAGE_PER_LESSON = 200;

export class LessonProvenanceIndex {
  private filePath: string;
  private records: Map<string, LessonProvenanceRecord> = new Map();
  private loaded = false;

  constructor(workDir: string = process.cwd()) {
    // Mirror LessonsTracker: project-local `.codebuddy/` when present, else home.
    const projectDir = path.join(workDir, '.codebuddy');
    const baseDir = fs.existsSync(projectDir) ? projectDir : path.join(os.homedir(), '.codebuddy');
    this.filePath = path.join(baseDir, 'lessons-provenance.json');
  }

  /** Link a lesson to the run/outcome that created it. */
  recordCreated(lessonId: string, provenance: Omit<LessonCreationProvenance, 'at'> & { at?: number }): void {
    if (!lessonId) return;
    this.load();
    const record = this.ensureRecord(lessonId);
    record.createdBy = {
      ...provenance,
      at: provenance.at ?? Date.now(),
    };
    this.save();
  }

  /**
   * Record that a run loaded the lesson. Idempotent: a (lessonId, runId) pair is
   * recorded once, so calling it on every turn does not grow the index or write
   * to disk repeatedly.
   */
  recordUsage(lessonId: string, runId: string): void {
    if (!lessonId || !runId) return;
    this.load();
    const record = this.ensureRecord(lessonId);
    if (record.usedBy.some((u) => u.runId === runId)) {
      return; // already recorded — no write
    }
    record.usedBy.push({ runId, at: Date.now() });
    if (record.usedBy.length > MAX_USAGE_PER_LESSON) {
      record.usedBy = record.usedBy.slice(-MAX_USAGE_PER_LESSON);
    }
    this.save();
  }

  getProvenance(lessonId: string): LessonProvenanceRecord | null {
    this.load();
    return this.records.get(lessonId) ?? null;
  }

  all(): LessonProvenanceRecord[] {
    this.load();
    return Array.from(this.records.values());
  }

  /** Drop provenance for lessons that no longer exist. */
  prune(existingLessonIds: Iterable<string>): number {
    this.load();
    const keep = new Set(existingLessonIds);
    let removed = 0;
    for (const id of [...this.records.keys()]) {
      if (!keep.has(id)) {
        this.records.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.save();
    return removed;
  }

  private ensureRecord(lessonId: string): LessonProvenanceRecord {
    let record = this.records.get(lessonId);
    if (!record) {
      record = { lessonId, usedBy: [] };
      this.records.set(lessonId, record);
    }
    return record;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = readJsonAtomicSync<ProvenanceFile | null>(this.filePath, null, {
        mode: 0o600,
        isValid: (value): value is ProvenanceFile => Boolean(
          value && typeof value === 'object' && !Array.isArray(value) &&
          (value as ProvenanceFile).schemaVersion === 1 &&
          typeof (value as ProvenanceFile).records === 'object',
        ),
      });
      if (!parsed) return;
      for (const [id, record] of Object.entries(parsed.records ?? {})) {
        this.records.set(id, { ...record, lessonId: id, usedBy: record.usedBy ?? [] });
      }
    } catch (err) {
      logger.debug('LessonProvenanceIndex: failed to load index', { error: String(err) });
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: ProvenanceFile = {
        schemaVersion: 1,
        records: Object.fromEntries(this.records),
      };
      writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
    } catch (err) {
      logger.debug('LessonProvenanceIndex: failed to save index', { error: String(err) });
    }
  }
}

let _instance: LessonProvenanceIndex | null = null;
let _instanceDir: string | null = null;

export function getLessonProvenanceIndex(workDir: string = process.cwd()): LessonProvenanceIndex {
  if (!_instance || _instanceDir !== workDir) {
    _instance = new LessonProvenanceIndex(workDir);
    _instanceDir = workDir;
  }
  return _instance;
}

export function resetLessonProvenanceIndex(): void {
  _instance = null;
  _instanceDir = null;
}
