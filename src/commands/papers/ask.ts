/**
 * `buddy papers ask "<question>" --path <dir|pdf>` — the Paper QA CLI flow.
 *
 * The user-facing counterpart of the `paper_qa` agent tool: it points the same
 * PaperQA2-lite pipeline (corpus → search → grounded answer) at a set of local
 * PDF paths and renders the anchored, cited answer (or the honest refusal) to
 * stdout / a report file.
 *
 * It duplicates NO pipeline logic — it reuses `runPaperQa` + `formatPaperQaOutput`
 * (shared with the tool) and the tool's `resolvePdfPaths` / `makeDefaultPaperQaLlm`
 * seams. Every side-effecting edge (provider resolution, LLM construction, PDF
 * path resolution, pdf-parse boundary, embedder, file writes) is injectable so
 * the flow is unit-testable with zero ONNX model and zero network. Never throws.
 *
 * @module commands/papers/ask
 */

import * as fs from 'fs/promises';
import path from 'path';

import type { ResolvedCommandProvider } from '../llm-provider-resolution.js';
import type { PassageEmbedder } from '../../research/paper-qa/passage-index.js';
import type { PassageQaLlm } from '../../research/paper-qa/rcs.js';
import type { PdfStructureDeps } from '../../research/paper-qa/types.js';
import {
  runPaperQa,
  formatPaperQaOutput,
  deriveSourceLabels,
} from '../../research/paper-qa/paper-qa-pipeline.js';
import {
  resolvePdfPaths as defaultResolvePdfPaths,
  makeDefaultPaperQaLlm,
} from '../../tools/paper-qa-tool.js';

/** In-chat/CLI default cap on PDFs indexed (agent may raise). */
const DEFAULT_MAX_PDFS = 25;
const MAX_PDFS_CAP = 200;
const DEFAULT_TOP_K = 8;
const MAX_TOP_K = 50;

export interface PapersAskOptions {
  /** Passages to retrieve before relevance filtering (1-50, default 8). */
  topK?: number;
  /** Cap on PDFs indexed (1-200, default 25). */
  maxPdfs?: number;
  /** Persist the rendered answer to this Markdown file instead of stdout. */
  report?: string;
  /** Model override forwarded to the provider resolver. */
  explicitModel?: string;
}

/** Injectable side-effecting seams (defaults wire the real edges; tests inject fakes). */
export interface PapersAskIo {
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
  writeFile?: (file: string, content: string) => Promise<void>;
  resolveProvider?: () => ResolvedCommandProvider | null;
  resolvePdfPaths?: (paths: string[]) => Promise<string[]>;
  makeLlm?: (provider: ResolvedCommandProvider) => Promise<PassageQaLlm> | PassageQaLlm;
  embedder?: PassageEmbedder;
  pdfDeps?: PdfStructureDeps;
}

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

/**
 * Run the Paper QA CLI flow: resolve PDFs + provider, run the pipeline, then
 * print or persist the anchored answer. Never throws — every failure is reported
 * (and a failure report is written when a file target was requested).
 */
export async function runPapersAskCli(
  question: string,
  paths: string[],
  opts: PapersAskOptions = {},
  io: PapersAskIo = {},
): Promise<void> {
  const log = io.log ?? ((m: string) => console.log(m));
  const errorLog = io.errorLog ?? ((m: string) => console.error(m));
  const writeFile =
    io.writeFile ??
    (async (file: string, content: string) => {
      const outputPath = path.resolve(file);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content, 'utf-8');
    });
  const reportPath = opts.report;

  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) {
    errorLog('❌ paper QA requires a non-empty question.');
    return;
  }

  const maxPdfs = clampInt(opts.maxPdfs, DEFAULT_MAX_PDFS, 1, MAX_PDFS_CAP);
  const topK = clampInt(opts.topK, DEFAULT_TOP_K, 1, MAX_TOP_K);

  try {
    // Resolve PDF paths (files/dirs) → concrete list.
    const resolvePaths = io.resolvePdfPaths ?? ((p: string[]) => defaultResolvePdfPaths(p));
    const searchRoots = paths.length > 0 ? paths : ['.'];
    const pdfPaths = (await resolvePaths(searchRoots)).slice(0, maxPdfs);
    if (pdfPaths.length === 0) {
      errorLog(`❌ No readable PDF found under: ${searchRoots.join(', ')}`);
      return;
    }
    log(`📚 Paper QA: "${q}"`);
    log(`   PDFs: ${pdfPaths.length} | top-k: ${topK}`);

    // Resolve the LLM provider (needed for RCS + grounded synthesis).
    const provider = (io.resolveProvider ?? (() => null))();
    if (!provider) {
      errorLog(
        '❌ No LLM provider available — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
      );
      return;
    }
    const llm = await (io.makeLlm ? io.makeLlm(provider) : makeDefaultPaperQaLlm(provider));

    const result = await runPaperQa(q, pdfPaths, llm, {
      topK,
      maxDocs: maxPdfs,
      ...(io.embedder ? { embedder: io.embedder } : {}),
      ...(io.pdfDeps ? { pdfDeps: io.pdfDeps } : {}),
    });

    if (result.indexedPassages === 0) {
      errorLog('❌ Could not extract any text from the resolved PDF(s) (scanned/encrypted/empty?).');
      return;
    }

    const content = formatPaperQaOutput(result, deriveSourceLabels(pdfPaths));
    if (reportPath) {
      await writeFile(reportPath, content);
      log(`\n📄 Answer saved: ${reportPath}`);
    } else {
      log(`\n${content}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorLog(`\n❌ Paper QA failed: ${message}`);
    if (reportPath) {
      const failure = [
        `# Paper QA : ${q}`,
        '',
        `Generated: ${new Date().toISOString()}`,
        'Status: failed',
        '',
        `Error: ${message}`,
      ].join('\n');
      await writeFile(reportPath, failure).catch(() => undefined);
    }
  }
}
