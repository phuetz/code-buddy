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
  private readonly filePath: string;
  private readonly now: () => Date;

  constructor(options: EvolutionaryArchiveOptions = {}) {
    const root = options.workDir ?? process.cwd();
    this.filePath = path.join(root, '.codebuddy', 'self-improvement', 'archive.json');
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.filePath;
  }

  private read(): ArchiveFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<ArchiveFile>;
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
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  list(): ArchiveEntry[] {
    return this.read().entries;
  }

  /** Append a validated improvement. Returns the stored entry. */
  append(entry: Omit<ArchiveEntry, 'createdAt' | 'reviewedBy'> & { reviewedBy?: string }): ArchiveEntry {
    const file = this.read();
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
