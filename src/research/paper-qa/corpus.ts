/**
 * PaperQA2-lite — corpus indexing (Phase 2).
 *
 * Turns a set of PDF paths (a folder of papers) into a single queryable
 * {@link PassageIndex}: parse each PDF with the Phase 1 structural parser, then
 * chunk + embed + index it. Bounded (caps documents and, via the index, total
 * passages) and never-throws — an unreadable/absent/encrypted PDF is skipped
 * (Phase 1 already returns `null`), never fatal.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';
import { parsePdfStructure } from './pdf-structure.js';
import { PassageIndex } from './passage-index.js';
import type { PassageIndexOptions } from './passage-index.js';
import {
  fingerprintIndexConfiguration,
  PersistentCorpusIndex,
} from './persistent-corpus-index.js';
import type { ParsePdfStructureOptions, PdfStructureDeps } from './types.js';

const DEFAULT_MAX_DOCS = 2000;
const MAX_DOCS_CAP = 100000;

/** Bounded knobs for {@link buildCorpusIndex}. */
export interface BuildCorpusOptions extends PassageIndexOptions {
  /** Reuse an existing index (adds documents to it). Default: a fresh index. */
  index?: PassageIndex;
  /** Hard cap on the number of PDFs parsed (default 2000). */
  maxDocs?: number;
  /** Injectable PDF-parse / file-read boundaries (tests inject deterministic fakes). */
  pdfDeps?: PdfStructureDeps;
  /** Bounded knobs forwarded to `parsePdfStructure`. */
  parseOptions?: ParsePdfStructureOptions;
  /** Persist document shards and incrementally reuse unchanged PDFs. */
  persistentIndex?: boolean;
  /** Override `.codebuddy/paper-qa/index` (or CODEBUDDY_PAPER_QA_INDEX_DIR). */
  persistentIndexDirectory?: string;
}

/**
 * Parse and index every readable PDF in `pdfPaths`, returning a searchable
 * {@link PassageIndex}. Distinct `docId`s (derived per path by the parser) keep
 * each paper's provenance separate.
 *
 * @param pdfPaths Absolute or relative PDF paths.
 * @param options  Bounded knobs (index reuse, embedder, caps, injectable deps).
 */
export async function buildCorpusIndex(
  pdfPaths: string[],
  options: BuildCorpusOptions = {},
): Promise<PassageIndex> {
  const {
    index: reuse,
    maxDocs,
    pdfDeps,
    parseOptions,
    persistentIndex,
    persistentIndexDirectory,
    ...rawIndexOptions
  } = options;

  const shouldPersist =
    persistentIndex ?? (reuse === undefined && pdfDeps === undefined && options.embedder === undefined);
  const persistent = shouldPersist
    ? new PersistentCorpusIndex({
        ...(persistentIndexDirectory ? { directory: persistentIndexDirectory } : {}),
      })
    : null;
  const indexOptions: PassageIndexOptions = { ...rawIndexOptions };
  if (persistent && !indexOptions.embeddingCacheDirectory) {
    indexOptions.embeddingCacheDirectory = join(persistent.directory, 'embeddings');
  }

  const index = reuse ?? new PassageIndex(indexOptions);
  if (!Array.isArray(pdfPaths) || pdfPaths.length === 0) return index;

  const cap = clampInt(maxDocs, DEFAULT_MAX_DOCS, 1, MAX_DOCS_CAP);
  const paths = pdfPaths.slice(0, cap);
  const configFingerprint = fingerprintIndexConfiguration({
    // v2 excludes every cache/shard produced while simulated fallback vectors
    // were still possible.
    schema: 2,
    embeddingModel:
      indexOptions.embeddingModel ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    embedCharLimit: indexOptions.embedCharLimit ?? 2000,
    chunkOptions: indexOptions.chunkOptions ?? {},
    parseOptions: parseOptions ?? {},
  });

  for (const pdfPath of paths) {
    // Do not persist empty shards for documents that could not fit in the
    // active exact-scan index. A future larger-cap run must still index them.
    if (index.isFull()) break;
    if (typeof pdfPath !== 'string' || pdfPath.length === 0) continue;
    try {
      let sourceHash: string | null = null;
      if (persistent) {
        sourceHash = await hashPdfSource(pdfPath, pdfDeps);
        if (sourceHash) {
          const stored = persistent.load(pdfPath, sourceHash, configFingerprint);
          if (stored) {
            await index.addPersistedPassages(stored);
            continue;
          }
        }
      }

      const doc = await parsePdfStructure(pdfPath, pdfDeps ?? {}, parseOptions ?? {});
      if (!doc) continue; // unreadable/encrypted/scanned → already logged by Phase 1
      await index.addDocument(doc);
      if (persistent && sourceHash) {
        persistent.save(
          pdfPath,
          sourceHash,
          configFingerprint,
          index.exportDocument(doc.docId),
        );
      }
    } catch (err) {
      // Never let one bad PDF abort the corpus build.
      logger.debug(
        `[paper-qa] corpus: skipping "${pdfPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return index;
}

async function hashPdfSource(
  pdfPath: string,
  pdfDeps: PdfStructureDeps | undefined,
): Promise<string | null> {
  try {
    const data = pdfDeps?.readFile ? await pdfDeps.readFile(pdfPath) : await readFile(pdfPath);
    return createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
