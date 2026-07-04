/**
 * PaperQA2-lite — corpus indexing (Phase 2).
 *
 * Turns a set of PDF paths (a folder of papers) into a single queryable
 * {@link PassageIndex}: parse each PDF with the Phase 1 structural parser, then
 * chunk + embed + index it. Bounded (caps documents and, via the index, total
 * passages) and never-throws — an unreadable/absent/encrypted PDF is skipped
 * (Phase 1 already returns `null`), never fatal.
 */

import { logger } from '../../utils/logger.js';
import { parsePdfStructure } from './pdf-structure.js';
import { PassageIndex } from './passage-index.js';
import type { PassageIndexOptions } from './passage-index.js';
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
  const { index: reuse, maxDocs, pdfDeps, parseOptions, ...indexOptions } = options;

  const index = reuse ?? new PassageIndex(indexOptions);
  if (!Array.isArray(pdfPaths) || pdfPaths.length === 0) return index;

  const cap = clampInt(maxDocs, DEFAULT_MAX_DOCS, 1, MAX_DOCS_CAP);
  const paths = pdfPaths.slice(0, cap);

  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0) continue;
    try {
      const doc = await parsePdfStructure(path, pdfDeps ?? {}, parseOptions ?? {});
      if (!doc) continue; // unreadable/encrypted/scanned → already logged by Phase 1
      await index.addDocument(doc);
    } catch (err) {
      // Never let one bad PDF abort the corpus build.
      logger.debug(
        `[paper-qa] corpus: skipping "${path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return index;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
