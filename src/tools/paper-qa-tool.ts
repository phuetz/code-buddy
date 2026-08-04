/**
 * Paper QA tool adapter (`paper_qa`).
 *
 * Exposes the PaperQA2-lite scientific-QA pipeline — until now reachable only as
 * library bricks under `src/research/paper-qa/` — to the agent IN CONVERSATION,
 * as a first-class, RAG-selectable, dispatchable tool (the sibling of
 * `deep_research`, wired identically). It is a thin ITool adapter that:
 *   1. resolves the input `paths` (PDF files / directories) to a bounded PDF list;
 *   2. resolves the ambient LLM provider (same path as the CLI,
 *      `resolveCommandProvider`) and wraps it as the paper-qa LLM boundary;
 *   3. delegates to the shared {@link runPaperQa} pipeline (corpus → search →
 *      grounded answer) — it duplicates NO business logic;
 *   4. returns the grounded, cited answer (page/section provenance + a
 *      "## Références" section) OR the honest "preuves insuffisantes" refusal.
 *
 * Deliberate design (mirrors `deep_research`):
 *   - CONSERVATIVE in-chat bounds — a mid-conversation call must not index a huge
 *     tree, so PDFs and retrieved passages are capped; heavy dirs (node_modules,
 *     .git, dist…) are skipped when walking a directory.
 *   - NEVER-THROWS — every failure degrades to `{ success:false, error }`; an
 *     honest evidence refusal is a SUCCESS (a valid grounded outcome).
 *   - All side-effecting edges (provider resolution, LLM construction, PDF path
 *     resolution, pdf-parse boundary, embedder) are INJECTABLE so the delegation
 *     is unit-testable with zero ONNX model and zero network.
 *
 * @module tools/paper-qa-tool
 */

import { stat as fsStat, readdir as fsReaddir } from 'fs/promises';
import path from 'path';

import type { ToolResult } from '../types/index.js';
import type {
  ITool,
  ToolSchema,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
} from './registry/types.js';
import type { ResolvedCommandProvider } from '../commands/llm-provider-resolution.js';
import type { CodeBuddyMessage } from '../codebuddy/client.js';
import type { PassageEmbedder } from '../research/paper-qa/passage-index.js';
import type { PassageLlmMessage, PassageQaLlm } from '../research/paper-qa/rcs.js';
import type { PdfStructureDeps } from '../research/paper-qa/types.js';
import {
  runPaperQa,
  formatPaperQaOutput,
  deriveSourceLabels,
} from '../research/paper-qa/paper-qa-pipeline.js';

// ============================================================================
// Injectable seams (real impls resolved lazily; fakes injected in tests)
// ============================================================================

/** Injectable dependencies (defaults wire the real CLI provider + local embedder). */
export interface PaperQaToolDeps {
  /** Resolve the ambient provider (apiKey/model/baseURL). Null ⇒ no provider. */
  resolveProvider?: () => ResolvedCommandProvider | null;
  /** Build the paper-qa LLM boundary from a resolved provider. */
  makeLlm?: (provider: ResolvedCommandProvider) => Promise<PassageQaLlm> | PassageQaLlm;
  /** Injected embedder (tests). Default: the index's lazy local `EmbeddingProvider`. */
  embedder?: PassageEmbedder;
  /** Injectable pdf-parse / file-read boundary forwarded to the corpus builder (tests). */
  pdfDeps?: PdfStructureDeps;
  /** Resolve input paths (files/dirs) to a concrete PDF list. Injectable for tests. */
  resolvePdfPaths?: (paths: string[], cap?: number) => Promise<string[]>;
}

// ============================================================================
// Conservative in-chat bounds
// ============================================================================

/** In-chat default cap on PDFs indexed per call (agent may raise via `max_pdfs`). */
const DEFAULT_MAX_PDFS = 25;
/** Explicit large-corpus ceiling; the default remains deliberately small. */
const MAX_PDFS_CAP = 100_000;
/** Default passages retrieved before RCS filtering. */
const DEFAULT_TOP_K = 8;
/** Hard ceiling on retrieved passages. */
const MAX_TOP_K = 50;
/** Bound on directory entries visited while walking a directory input. */
const MAX_WALK_ENTRIES = 100_000;

/** Directory names skipped when walking a directory input (never scientific corpora). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  'target',
  '.cache',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
]);

function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.max(min, Math.min(max, n));
}

function isPdf(p: string): boolean {
  return p.toLowerCase().endsWith('.pdf');
}

/** Coerce the `paths`/`path` input into a clean string[]. */
function normalizePaths(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  }
  if (typeof input === 'string' && input.trim().length > 0) return [input];
  return [];
}

/**
 * Default path resolution: expand each input into concrete PDF file paths.
 * A `.pdf` file is taken as-is; a directory is walked (recursively, skipping heavy
 * build/vcs dirs) for `*.pdf`. Bounded by `cap` and a visited-entry ceiling.
 * Never throws — an unreadable path/dir is skipped.
 */
export async function resolvePdfPaths(
  inputs: string[],
  cap: number = MAX_PDFS_CAP,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  let visited = 0;

  const addFile = (p: string): void => {
    const abs = path.resolve(p);
    if (!seen.has(abs) && isPdf(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  };

  const walkDir = async (dir: string): Promise<void> => {
    if (out.length >= cap || visited >= MAX_WALK_ENTRIES) return;
    let entries: string[];
    try {
      entries = await fsReaddir(dir);
    } catch {
      return; // unreadable dir → skip
    }
    for (const name of entries.sort()) {
      if (out.length >= cap || visited >= MAX_WALK_ENTRIES) break;
      if (SKIP_DIRS.has(name)) continue;
      visited++;
      const full = path.join(dir, name);
      let st: Awaited<ReturnType<typeof fsStat>>;
      try {
        st = await fsStat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) await walkDir(full);
      else if (st.isFile() && isPdf(full)) addFile(full);
    }
  };

  for (const input of inputs) {
    if (out.length >= cap) break;
    if (typeof input !== 'string' || input.length === 0) continue;
    let st: Awaited<ReturnType<typeof fsStat>>;
    try {
      st = await fsStat(input);
    } catch {
      continue; // absent path → skip
    }
    if (st.isDirectory()) await walkDir(input);
    else if (st.isFile()) addFile(input);
  }

  return out.slice(0, cap);
}

/**
 * Default LLM boundary: construct a single {@link CodeBuddyClient} for the
 * resolved provider and expose it as a paper-qa `PassageQaLlm`. Reused by both
 * the tool and the CLI so the provider→LLM wiring lives in one place.
 */
export async function makeDefaultPaperQaLlm(
  provider: ResolvedCommandProvider,
): Promise<PassageQaLlm> {
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const client = new CodeBuddyClient(provider.apiKey, provider.model, provider.baseURL);
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const chatMessages = messages.map(
      (m) => ({ role: m.role, content: m.content }),
    ) as CodeBuddyMessage[];
    const response = await client.chat(chatMessages);
    const content = response?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  };
}

// ============================================================================
// The adapter
// ============================================================================

export class PaperQaTool implements ITool {
  readonly name = 'paper_qa';
  readonly description =
    'Answer a question from a corpus of scientific PDF papers with an ANCHORED, CITED answer: it parses the PDFs, retrieves the most relevant passages, filters them for relevance, and synthesizes an answer where every claim cites the exact page/section it came from (a "## Références" section is appended from the real passage provenance). If the corpus does not support an answer, it REFUSES honestly ("preuves insuffisantes") instead of guessing. Use this (not deep_research/web_search) when the user points at local PDF files or a folder of papers and wants a grounded, source-cited answer.';

  private readonly deps: PaperQaToolDeps;

  constructor(deps: PaperQaToolDeps = {}) {
    this.deps = deps;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      if (!question) {
        return { success: false, error: 'paper_qa requires a non-empty "question".' };
      }

      const maxPdfs = clampInt(input.max_pdfs, DEFAULT_MAX_PDFS, 1, MAX_PDFS_CAP);
      const topK = clampInt(input.top_k, DEFAULT_TOP_K, 1, MAX_TOP_K);

      // Resolve the input paths (files/dirs) → concrete PDF list. Default: cwd.
      const requested = normalizePaths(input.paths ?? input.path);
      const searchRoots = requested.length > 0 ? requested : ['.'];
      const pdfPaths = (await this.resolvePdfPaths(searchRoots, maxPdfs)).slice(0, maxPdfs);
      if (pdfPaths.length === 0) {
        return {
          success: false,
          error:
            'paper_qa found no readable PDF in the given path(s). Point "paths" at a PDF file or a directory of papers.',
        };
      }

      // Resolve the LLM provider (needed for RCS + grounded synthesis).
      const provider = await this.resolveProvider();
      if (!provider) {
        return {
          success: false,
          error:
            'No LLM provider available for paper_qa — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        };
      }
      const llm = await this.makeLlm(provider);

      const result = await runPaperQa(question, pdfPaths, llm, {
        topK,
        maxDocs: maxPdfs,
        ...(this.deps.embedder ? { embedder: this.deps.embedder } : {}),
        ...(this.deps.pdfDeps ? { pdfDeps: this.deps.pdfDeps } : {}),
      });

      // Nothing readable indexed → not a grounded refusal, an infra miss.
      if (result.indexedPassages === 0) {
        return {
          success: false,
          error:
            'paper_qa could not extract any text from the resolved PDF(s) (scanned/encrypted/empty?). No index was built.',
        };
      }

      return { success: true, output: formatPaperQaOutput(result, deriveSourceLabels(pdfPaths)) };
    } catch (err) {
      return {
        success: false,
        error: `Paper QA failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Default seams (injectable; defaults wire the real edges)
  // --------------------------------------------------------------------------

  private async resolveProvider(): Promise<ResolvedCommandProvider | null> {
    if (this.deps.resolveProvider) return this.deps.resolveProvider();
    const { resolveCommandProvider } = await import('../commands/llm-provider-resolution.js');
    return resolveCommandProvider();
  }

  private async makeLlm(provider: ResolvedCommandProvider): Promise<PassageQaLlm> {
    if (this.deps.makeLlm) return this.deps.makeLlm(provider);
    return makeDefaultPaperQaLlm(provider);
  }

  private async resolvePdfPaths(paths: string[], cap: number): Promise<string[]> {
    if (this.deps.resolvePdfPaths) return this.deps.resolvePdfPaths(paths, cap);
    return resolvePdfPaths(paths, cap);
  }

  // --------------------------------------------------------------------------
  // ITool boilerplate
  // --------------------------------------------------------------------------

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to answer from the PDF corpus.',
          },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'PDF file paths and/or directories of papers to search. A directory is walked for *.pdf (heavy build/vcs dirs skipped). Defaults to the current directory when omitted.',
          },
          top_k: {
            type: 'number',
            description: `Number of passages to retrieve before relevance filtering (1-${MAX_TOP_K}, default ${DEFAULT_TOP_K}).`,
          },
          max_pdfs: {
            type: 'number',
            description: `Cap on PDFs indexed for this call (1-${MAX_PDFS_CAP}, default ${DEFAULT_MAX_PDFS}). Raise only when a broader corpus is truly needed (slower).`,
          },
        },
        required: ['question'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.question !== 'string' || data.question.trim() === '') {
      return { valid: false, errors: ['question must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: [
        'paper',
        'papers',
        'pdf',
        'scientific',
        'science',
        'article',
        'corpus',
        'cite',
        'citation',
        'page',
        'section',
        'papier',
        'papiers',
        'scientifique',
        'cite la source',
        'preuves',
        'grounded',
      ],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
