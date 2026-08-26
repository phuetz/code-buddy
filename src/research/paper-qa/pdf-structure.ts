/**
 * PaperQA2-lite — structural PDF parser (Phase 1).
 *
 * Produces a {@link StructuredDoc} with REAL page boundaries and best-effort
 * section detection, all indexed by consistent character offsets. Unlike the
 * two existing PDF paths (`src/tools/pdf-tool.ts`, `src/agent/specialized/pdf-agent.ts`)
 * this NEVER fabricates page numbers via uniform division: it uses pdf-parse v2's
 * genuine per-page text.
 *
 * Pure, injectable, never-throws: an absent/encrypted/scanned/unreadable PDF
 * yields `null` (logged), never an exception.
 *
 * Scanned/image pages fall back to bounded local OCR (pdf-parse rendering +
 * Tesseract.js). OCR is injectable and can be disabled; any failure remains a
 * never-throw `null`/partial-text degradation.
 */

import { createHash } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import { findPageNo } from './provenance.js';
import type {
  PageSpan,
  ParsedPdf,
  ParsePdfStructureOptions,
  PdfOcrFn,
  PdfParseFn,
  PdfStructureDeps,
  SectionSpan,
  StructuredDoc,
} from './types.js';

/** Separator inserted between pages in `fullText` (kept out of every PageSpan). */
const PAGE_SEPARATOR = '\n\n';

/** Default caps — bounded so a pathological PDF cannot explode memory. */
const DEFAULT_MAX_PAGES = 5000;
const DEFAULT_MAX_SECTIONS = 1000;

/** Upper bound on heading-line length; longer lines are prose, not headings. */
const MAX_HEADING_LEN = 120;
const PDF_PARSE_SPECIFIER = 'pdf-parse';

/**
 * Minimal structural view of the pdf-parse v2 module, typed locally so the
 * library's `any`-typed metadata never leaks into this module.
 */
interface PdfParseModuleV2 {
  PDFParse: new (opts: { data: Uint8Array; verbosity?: number }) => {
    getText(params?: { pageJoiner?: string; lineEnforce?: boolean }): Promise<{
      pages?: Array<{ num?: number; text?: string }>;
      text?: string;
      total?: number;
    }>;
    getInfo(): Promise<{ info?: Record<string, unknown> | null }>;
    getScreenshot(params?: {
      partial?: number[];
      desiredWidth?: number;
      imageDataUrl?: boolean;
      imageBuffer?: boolean;
    }): Promise<{
      pages: Array<{ data: Uint8Array; pageNumber: number }>;
    }>;
    destroy(): Promise<void>;
  };
}

/**
 * Default pdf-parse boundary (pdf-parse v2 `PDFParse` class). Returns `null`
 * when the library is absent or the buffer cannot be parsed.
 */
const defaultParsePdf: PdfParseFn = async (data) => {
  let mod: PdfParseModuleV2;
  try {
    mod = (await import(PDF_PARSE_SPECIFIER)) as unknown as PdfParseModuleV2;
  } catch {
    logger.warn('paper-qa: pdf-parse not installed — cannot parse PDF structure');
    return null;
  }
  if (typeof mod?.PDFParse !== 'function') return null;

  const parser = new mod.PDFParse({ data, verbosity: 0 });
  try {
    // pageJoiner:'' — do NOT let pdf-parse inject "-- N of M --" page markers;
    // we build fullText ourselves and record the real offsets.
    const res = await parser.getText({ pageJoiner: '' });
    const rawPages = Array.isArray(res?.pages) ? res.pages : [];
    const pages = rawPages.map((p, i) => ({
      num: typeof p?.num === 'number' && p.num > 0 ? p.num : i + 1,
      text: typeof p?.text === 'string' ? p.text : '',
    }));

    let title: string | undefined;
    try {
      const info = await parser.getInfo();
      const rawTitle: unknown = info?.info?.Title;
      if (typeof rawTitle === 'string' && rawTitle.trim().length > 0) {
        title = rawTitle.trim();
      }
    } catch {
      // metadata is best-effort; ignore failures
    }

    const total = typeof res?.total === 'number' && res.total > 0 ? res.total : pages.length;
    const out: ParsedPdf = { pages, total };
    if (title !== undefined) out.title = title;
    return out;
  } catch {
    return null;
  } finally {
    try {
      await parser.destroy();
    } catch {
      // ignore teardown errors
    }
  }
};

const OCR_BATCH_SIZE = 4;
const DEFAULT_MAX_OCR_PAGES = 50;
const MIN_USEFUL_PAGE_TEXT = 20;

/**
 * Render selected pages and recognize them with one reused Tesseract worker.
 * Pages are rendered in small batches to bound peak image memory.
 */
const defaultOcrPdf: PdfOcrFn = async (data, pageNumbers, language) => {
  if (pageNumbers.length === 0) return [];
  const [pdfModule, tesseractModule] = await Promise.all([
    import(PDF_PARSE_SPECIFIER) as unknown as Promise<PdfParseModuleV2>,
    import('tesseract.js'),
  ]);
  const worker = await tesseractModule.createWorker(language);
  const parser = new pdfModule.PDFParse({ data, verbosity: 0 });
  const pages: ParsedPdf['pages'] = [];
  try {
    for (let offset = 0; offset < pageNumbers.length; offset += OCR_BATCH_SIZE) {
      const partial = pageNumbers.slice(offset, offset + OCR_BATCH_SIZE);
      const rendered = await parser.getScreenshot({
        partial,
        desiredWidth: 1800,
        imageDataUrl: false,
        imageBuffer: true,
      });
      for (const page of rendered.pages) {
        const result = await worker.recognize(Buffer.from(page.data));
        pages.push({ num: page.pageNumber, text: result.data.text.trim() });
      }
    }
    return pages;
  } finally {
    await Promise.allSettled([worker.terminate(), parser.destroy()]);
  }
};

/** Default file reader (lazy `fs/promises` import to keep this tree-shakeable). */
const defaultReadFile = async (path: string): Promise<Buffer> => {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
};

/** Canonical scientific-paper section markers (lower-cased, normalized). */
const CANONICAL_SECTIONS = new Set([
  'abstract',
  'introduction',
  'background',
  'related work',
  'motivation',
  'preliminaries',
  'methods',
  'method',
  'methodology',
  'materials and methods',
  'approach',
  'experiments',
  'experimental setup',
  'evaluation',
  'results',
  'results and discussion',
  'discussion',
  'analysis',
  'limitations',
  'conclusion',
  'conclusions',
  'future work',
  'references',
  'bibliography',
  'acknowledgements',
  'acknowledgments',
  'appendix',
]);

interface HeadingHit {
  title: string;
  level: number;
  /** Priority: higher wins when several heuristics fire on the same line. */
  priority: number;
  /** Absolute offset of the heading (first non-space char) in `fullText`. */
  offset: number;
}

/** Strip a trailing colon and surrounding whitespace from a heading. */
function cleanHeading(line: string): string {
  return line.trim().replace(/\s*:\s*$/, '').trim();
}

/**
 * Classify a single trimmed line as a heading, or `null`.
 * Heuristics, in priority order (canonical > numbered > all-caps > short lead-in).
 */
function classifyHeading(trimmed: string, nextTrimmed: string | undefined): HeadingHit | null {
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_LEN) return null;

  // Normalize: drop a leading section number for canonical matching ("1. Introduction").
  const withoutNumber = trimmed.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  const canonicalKey = cleanHeading(withoutNumber).toLowerCase();

  // 1) Canonical scientific markers (level 1).
  if (CANONICAL_SECTIONS.has(canonicalKey)) {
    return { title: cleanHeading(trimmed), level: 1, priority: 4, offset: 0 };
  }

  // 2) Numbered headings: "1", "2.1", "3.2.4 Something".
  const numbered = /^(\d+(?:\.\d+)*)\.?(?:\s+(\S.*))?$/.exec(trimmed);
  if (numbered && numbered[1]) {
    const depth = numbered[1].split('.').length;
    const rest = numbered[2] ?? '';
    const restWords = rest.length > 0 ? rest.split(/\s+/).filter(Boolean) : [];
    // A genuine numbered heading is short AND either has no trailing text
    // ("3."), starts with a capital / bracket (title casing), or is an
    // ultra-short label (≤3 tokens). Length alone let a sentence that merely
    // OPENS with a number — "2020 was a record year" — become a phantom heading,
    // which planted a spurious section frontier (finding D2).
    const titleLike = /^[A-Z([]/.test(rest);
    const ultraShort = restWords.length > 0 && restWords.length <= 3;
    if (
      rest.length <= 80 &&
      !/[.!?]$/.test(rest) &&
      (restWords.length === 0 || titleLike || ultraShort)
    ) {
      return { title: cleanHeading(trimmed), level: depth, priority: 3, offset: 0 };
    }
  }

  // 3) ALL-CAPS short headings ("METHODS", "RELATED WORK").
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (
    letters.length >= 2 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]/.test(trimmed) &&
    trimmed.length <= 60 &&
    trimmed.split(/\s+/).length <= 8 &&
    !/[.!?]$/.test(trimmed)
  ) {
    return { title: cleanHeading(trimmed), level: 1, priority: 2, offset: 0 };
  }

  // 4) Short Title-Case lead-in followed by a substantial paragraph.
  if (
    nextTrimmed !== undefined &&
    nextTrimmed.length >= 40 &&
    trimmed.length <= 60 &&
    trimmed.split(/\s+/).length <= 8 &&
    !/[.!?,;:]$/.test(trimmed) &&
    /^[A-Z]/.test(trimmed) &&
    !/[.]/.test(trimmed)
  ) {
    return { title: cleanHeading(trimmed), level: 2, priority: 1, offset: 0 };
  }

  return null;
}

/**
 * Detect sections over `fullText`. Best-effort and bounded: returns `[]` when
 * nothing looks like a heading.
 */
function detectSections(
  fullText: string,
  pages: readonly PageSpan[],
  maxSections: number,
): SectionSpan[] {
  const hits: HeadingHit[] = [];
  const lines = fullText.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const lineStart = offset;
    // Advance past this line plus the '\n' that `split` removed.
    offset += line.length + 1;

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const nextTrimmed = i + 1 < lines.length ? (lines[i + 1] ?? '').trim() : undefined;
    const hit = classifyHeading(trimmed, nextTrimmed || undefined);
    if (!hit) continue;

    // Point charStart at the first non-space char of the heading line.
    const leadingWs = line.length - line.trimStart().length;
    hits.push({ ...hit, offset: lineStart + leadingWs });

    if (hits.length >= maxSections) break;
  }

  if (hits.length === 0) return [];

  const sections: SectionSpan[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit) continue;
    const next = hits[i + 1];
    const charStart = hit.offset;
    const charEnd = next ? next.offset : fullText.length;
    sections.push({
      title: hit.title,
      level: hit.level,
      pageNo: findPageNo(charStart, pages),
      charStart,
      charEnd,
    });
  }
  return sections;
}

/** Derive a stable docId from the source path. */
function deriveDocId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16);
}

/**
 * Parse a PDF into a {@link StructuredDoc} with real page boundaries, best-effort
 * sections, and consistent offsets. Returns `null` (never throws) on any failure.
 *
 * @param pdfPath Absolute or relative path to the PDF file.
 * @param deps    Injectable boundaries (pdf-parse access, file reading, logging).
 * @param opts    Bounded caps and overrides.
 */
export async function parsePdfStructure(
  pdfPath: string,
  deps: PdfStructureDeps = {},
  opts: ParsePdfStructureOptions = {},
): Promise<StructuredDoc | null> {
  const warn = deps.warn ?? ((message, context) => logger.warn(message, context));
  try {
    const readFile = deps.readFile ?? defaultReadFile;
    const parsePdf = deps.parsePdf ?? defaultParsePdf;
    const maxPages = clampInt(opts.maxPages, DEFAULT_MAX_PAGES, 1, 200000);
    const maxSections = clampInt(opts.maxSections, DEFAULT_MAX_SECTIONS, 0, 100000);
    const maxOcrPages = clampInt(opts.maxOcrPages, DEFAULT_MAX_OCR_PAGES, 1, 500);

    let buffer: Buffer;
    try {
      buffer = await readFile(pdfPath);
    } catch (error) {
      warn('paper-qa: cannot read PDF file', { path: pdfPath, error: errText(error) });
      return null;
    }

    const data = new Uint8Array(buffer);
    const parsed = await parsePdf(data);
    if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) {
      warn('paper-qa: no extractable pages (absent/encrypted/scanned pdf-parse?)', {
        path: pdfPath,
      });
      return null;
    }

    // OCR only pages with no useful text layer. Native text always wins when it
    // is at least as informative as OCR output.
    const limited = parsed.pages.slice(0, maxPages);
    if (opts.ocr !== false) {
      const candidates = limited
        .filter((page) => page.text.trim().length < MIN_USEFUL_PAGE_TEXT)
        .slice(0, maxOcrPages)
        .map((page) => page.num);
      if (candidates.length > 0) {
        try {
          const language =
            opts.ocrLanguage?.trim() ||
            process.env.CODEBUDDY_PAPER_QA_OCR_LANGUAGE?.trim() ||
            'eng';
          const ocrPages = await (deps.ocrPdf ?? defaultOcrPdf)(data, candidates, language);
          const byPage = new Map(ocrPages.map((page) => [page.num, page.text.trim()]));
          for (const page of limited) {
            const ocrText = byPage.get(page.num);
            if (ocrText && ocrText.length > page.text.trim().length) page.text = ocrText;
          }
        } catch (error) {
          warn('paper-qa: scanned-page OCR unavailable', {
            path: pdfPath,
            pages: candidates.length,
            error: errText(error),
          });
        }
      }
    }

    // Build pages + fullText with exact offsets. NO uniform division.
    const pages: PageSpan[] = [];
    const parts: string[] = [];
    let cursor = 0;
    for (let i = 0; i < limited.length; i++) {
      const raw = limited[i];
      const text = typeof raw?.text === 'string' ? raw.text : '';
      const pageNo = typeof raw?.num === 'number' && raw.num > 0 ? raw.num : i + 1;
      const charStart = cursor;
      parts.push(text);
      cursor += text.length;
      const charEnd = cursor;
      pages.push({ pageNo, text, charStart, charEnd });
      if (i < limited.length - 1) {
        parts.push(PAGE_SEPARATOR);
        cursor += PAGE_SEPARATOR.length;
      }
    }
    const fullText = parts.join('');
    if (fullText.trim().length === 0) {
      warn('paper-qa: PDF has no extractable text after OCR fallback', { path: pdfPath });
      return null;
    }

    const sections = maxSections > 0 ? detectSections(fullText, pages, maxSections) : [];

    const doc: StructuredDoc = {
      docId: opts.docId ?? deriveDocId(pdfPath),
      pages,
      sections,
      fullText,
    };
    if (parsed.title !== undefined) doc.title = parsed.title;
    return doc;
  } catch (error) {
    warn('paper-qa: unexpected failure — returning null', {
      path: pdfPath,
      error: errText(error),
    });
    return null;
  }
}

/** Clamp an optional integer into [min, max] with a fallback default. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Extract a safe message string from an unknown error. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { defaultParsePdf, defaultOcrPdf };
