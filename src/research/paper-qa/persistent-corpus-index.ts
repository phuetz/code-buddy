/**
 * Sharded, process-persistent PaperQA corpus index.
 *
 * One small JSON record is stored per source PDF. Records are addressed by the
 * normalized source path, validated against a SHA-256 of the PDF bytes and an
 * indexing-configuration fingerprint, and loaded only when that PDF is part of
 * the requested corpus. Passage vectors remain in DiskEmbeddingCache and are
 * referenced here by their model-scoped fingerprints. The live query path
 * still rebuilds an in-memory BM25 structure and performs exact dense scans;
 * a durable inverted/ANN index remains the explicit large-corpus follow-up.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PersistedPassageRecord } from './passage-index.js';

const SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;

interface DocumentShard {
  schemaVersion: typeof SCHEMA_VERSION;
  sourcePath: string;
  sourceHash: string;
  configFingerprint: string;
  indexedAt: string;
  passages: PersistedPassageRecord[];
}

export interface PersistentCorpusIndexOptions {
  directory?: string;
}

export class PersistentCorpusIndex {
  readonly directory: string;

  constructor(options: PersistentCorpusIndexOptions = {}) {
    this.directory =
      options.directory ??
      process.env.CODEBUDDY_PAPER_QA_INDEX_DIR ??
      join(process.cwd(), '.codebuddy', 'paper-qa', 'index');
  }

  load(
    sourcePath: string,
    sourceHash: string,
    configFingerprint: string,
  ): PersistedPassageRecord[] | null {
    if (!SHA256_PATTERN.test(sourceHash) || !SHA256_PATTERN.test(configFingerprint)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.pathFor(sourcePath), 'utf8')) as unknown;
      if (!isDocumentShard(parsed)) return null;
      if (
        parsed.sourcePath !== sourcePath ||
        parsed.sourceHash !== sourceHash ||
        parsed.configFingerprint !== configFingerprint
      ) {
        return null;
      }
      return parsed.passages;
    } catch {
      return null;
    }
  }

  save(
    sourcePath: string,
    sourceHash: string,
    configFingerprint: string,
    passages: PersistedPassageRecord[],
  ): void {
    if (!SHA256_PATTERN.test(sourceHash) || !SHA256_PATTERN.test(configFingerprint)) return;
    const target = this.pathFor(sourcePath);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const shard: DocumentShard = {
      schemaVersion: SCHEMA_VERSION,
      sourcePath,
      sourceHash,
      configFingerprint,
      indexedAt: new Date().toISOString(),
      passages,
    };
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(shard)}\n`, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, target);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup; persistence must never break live research.
      }
    }
  }

  private pathFor(sourcePath: string): string {
    const key = createHash('sha1').update(resolve(sourcePath)).digest('hex');
    return join(this.directory, 'documents', key.slice(0, 2), `${key}.json`);
  }
}

export function fingerprintIndexConfiguration(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isDocumentShard(value: unknown): value is DocumentShard {
  if (!value || typeof value !== 'object') return false;
  const shard = value as Partial<DocumentShard>;
  return (
    shard.schemaVersion === SCHEMA_VERSION &&
    typeof shard.sourcePath === 'string' &&
    typeof shard.sourceHash === 'string' &&
    SHA256_PATTERN.test(shard.sourceHash) &&
    typeof shard.configFingerprint === 'string' &&
    SHA256_PATTERN.test(shard.configFingerprint) &&
    typeof shard.indexedAt === 'string' &&
    Array.isArray(shard.passages) &&
    shard.passages.every(isPersistedPassageRecord)
  );
}

function isPersistedPassageRecord(value: unknown): value is PersistedPassageRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PersistedPassageRecord>;
  const passage = record.passage;
  return (
    typeof record.embeddingFingerprint === 'string' &&
    SHA1_PATTERN.test(record.embeddingFingerprint) &&
    typeof record.vectorStored === 'boolean' &&
    !!passage &&
    typeof passage.docId === 'string' &&
    Number.isInteger(passage.page) &&
    (passage.section === undefined || typeof passage.section === 'string') &&
    Number.isInteger(passage.charStart) &&
    Number.isInteger(passage.charEnd) &&
    typeof passage.text === 'string' &&
    Number.isInteger(passage.index)
  );
}
