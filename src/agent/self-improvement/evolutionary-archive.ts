/**
 * Evolutionary archive — keeps every empirically-validated improvement as a
 * stepping stone (Darwin Gödel Machine's open-ended archive). Future cycles can
 * build on past wins rather than hill-climbing a single best agent. V1 stores a
 * flat, append-only JSON log; the lineage fields support later genealogy.
 *
 * @module agent/self-improvement/evolutionary-archive
 */

import fs from 'fs';
import path from 'path';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../../utils/atomic-write.js';

import type { ArchiveEntry } from './types.js';

export const SELF_IMPROVEMENT_ARCHIVE_SCHEMA_VERSION = 1;

interface ArchiveFile {
  schemaVersion: number;
  entries: ArchiveEntry[];
}

export interface EvolutionaryArchiveOptions {
  workDir?: string;
  now?: () => Date;
}

export class EvolutionaryArchive {
  readonly workDir: string;
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: EvolutionaryArchiveOptions = {}) {
    this.workDir = options.workDir ?? process.cwd();
    this.filePath = path.join(this.workDir, '.codebuddy', 'self-improvement', 'archive.json');
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.filePath;
  }

  private read(strict = false): ArchiveFile {
    if (strict) {
      let raw: string;
      try { raw = fs.readFileSync(this.filePath, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { schemaVersion: SELF_IMPROVEMENT_ARCHIVE_SCHEMA_VERSION, entries: [] };
        }
        throw error;
      }
      const parsed = JSON.parse(raw) as Partial<ArchiveFile> | null;
      if (!parsed || parsed.schemaVersion !== SELF_IMPROVEMENT_ARCHIVE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error('Invalid evolution archive; refusing to overwrite evidence');
      }
      return parsed as ArchiveFile;
    }
    try {
      const parsed = readJsonAtomicSync<Partial<ArchiveFile>>(this.filePath, {}, { mode: 0o600 });
      if (Array.isArray(parsed.entries)) {
        return { schemaVersion: SELF_IMPROVEMENT_ARCHIVE_SCHEMA_VERSION, entries: parsed.entries };
      }
    } catch {
      /* no archive yet */
    }
    return { schemaVersion: SELF_IMPROVEMENT_ARCHIVE_SCHEMA_VERSION, entries: [] };
  }

  private write(file: ArchiveFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeJsonAtomicSync(this.filePath, file, { mode: 0o600 });
  }

  list(): ArchiveEntry[] {
    return this.read().entries;
  }

  /** Append a validated improvement. Idempotent on kind+proposalId+targetScenarioId. */
  append(entry: Omit<ArchiveEntry, 'createdAt' | 'reviewedBy'> & { reviewedBy?: string }): ArchiveEntry {
    const file = this.read(true);
    const existing = file.entries.find(
      (stored) =>
        stored.proposalId === entry.proposalId &&
        stored.kind === entry.kind &&
        stored.targetScenarioId === entry.targetScenarioId,
    );
    if (existing) {
      const previousSha = existing.evidence?.artifactSha256;
      const nextSha = entry.evidence?.artifactSha256;
      if (typeof previousSha === 'string' && typeof nextSha === 'string' && previousSha !== nextSha) {
        throw new Error(
          `archive fingerprint conflict for ${entry.kind}:${entry.proposalId}:${entry.targetScenarioId}`,
        );
      }
      return existing;
    }
    const stored: ArchiveEntry = {
      ...entry,
      createdAt: this.now().toISOString(),
      reviewedBy: entry.reviewedBy ?? 'auto:self-improve',
    };
    file.entries.push(stored);
    this.write(file);
    return stored;
  }

  /** Summary stats over the archive (for `status`). */
  summary(): { count: number; totalDelta: number; lastAt: string | null } {
    const entries = this.list();
    return {
      count: entries.length,
      totalDelta: entries.reduce((sum, e) => sum + (e.delta ?? 0), 0),
      lastAt: entries.length > 0 ? entries[entries.length - 1]!.createdAt : null,
    };
  }
}
