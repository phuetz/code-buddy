/**
 * `buddy papers ask` CLI wiring (PaperQA2-lite Phase 4).
 *
 * No-mocks: the REAL corpus→search→answer pipeline runs behind the CLI, with an
 * injected deterministic pdf-parse boundary, bag-of-words embedder, and fake LLM.
 * No filesystem PDFs, no ONNX model, no network.
 *
 * Proves: the `ask` subcommand exposes --path/--top-k/--report; the flow renders
 * a grounded cited answer to stdout and persists it to a report file; and it
 * NEVER throws (no PDF, no provider).
 */
import { describe, it, expect } from 'vitest';

import { createPapersCommand } from '../../../src/commands/papers/index.js';
import { runPapersAskCli, type PapersAskIo } from '../../../src/commands/papers/ask.js';
import type { PassageEmbedder } from '../../../src/research/paper-qa/passage-index.js';
import type { PassageLlmMessage, PassageQaLlm } from '../../../src/research/paper-qa/rcs.js';
import type { ParsedPdf, PdfStructureDeps } from '../../../src/research/paper-qa/types.js';
import type { ResolvedCommandProvider } from '../../../src/commands/llm-provider-resolution.js';

// --- Deterministic fakes ----------------------------------------------------

function bowEmbedder(dim = 64): PassageEmbedder {
  const embed = async (text: string): Promise<{ embedding: Float32Array }> => {
    const v = new Float32Array(dim);
    const toks = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
    for (const tok of toks) {
      let h = 0;
      for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
      v[h % dim] = (v[h % dim] ?? 0) + 1;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (v[i] ?? 0) * (v[i] ?? 0);
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / norm;
    return { embedding: v };
  };
  return { embed };
}

function corpusDeps(corpus: Record<string, string[]>): PdfStructureDeps {
  return {
    readFile: async (p: string) => Buffer.from(p, 'utf8'),
    parsePdf: async (data: Uint8Array): Promise<ParsedPdf | null> => {
      const p = Buffer.from(data).toString('utf8');
      const pages = corpus[p];
      if (!pages) return null;
      return { pages: pages.map((text, i) => ({ num: i + 1, text })), total: pages.length };
    },
  };
}

function fakeLlm(keyword: string): PassageQaLlm {
  return async (messages: PassageLlmMessage[]): Promise<string> => {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    if (system.startsWith('You judge')) {
      const passage = user.slice(user.indexOf('Passage:') + 'Passage:'.length);
      return passage.toLowerCase().includes(keyword.toLowerCase())
        ? 'RELEVANCE: 0.9\nSUMMARY: relevant evidence'
        : 'RELEVANCE: 0.1\nSUMMARY: NONE';
    }
    const markers = new Set<number>();
    const re = /^\[(\d+)\]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(user)) !== null) markers.add(Number(m[1]));
    return [...markers].sort((a, b) => a - b).map((n) => `Claim ${n} holds [${n}].`).join(' ');
  };
}

const CORPUS: Record<string, string[]> = {
  '/papers/photosynthesis.pdf': [
    'Photosynthesis converts light energy into chemical energy inside plant chloroplasts every day. ' +
      'The light-dependent reactions split water and release oxygen as a by-product of photosynthesis.',
  ],
};

const PROVIDER: ResolvedCommandProvider = {
  apiKey: 'k',
  model: 'm',
  baseURL: 'https://example.test/v1',
  providerLabel: 'test',
};

function makeIo(overrides: Partial<PapersAskIo> = {}): PapersAskIo {
  return {
    resolveProvider: () => PROVIDER,
    resolvePdfPaths: async () => Object.keys(CORPUS),
    embedder: bowEmbedder(),
    pdfDeps: corpusDeps(CORPUS),
    makeLlm: () => fakeLlm('photosynthesis'),
    ...overrides,
  };
}

// --- Command surface --------------------------------------------------------

describe('papers command surface', () => {
  it('exposes an `ask` subcommand with --path, --top-k and --report options', () => {
    const cmd = createPapersCommand();
    const ask = cmd.commands.find((c) => c.name() === 'ask');
    expect(ask, 'ask subcommand must exist').toBeDefined();
    const longs = ask!.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--path', '--top-k', '--report']));
  });
});

// --- runPapersAskCli (injected pipeline, no network) ------------------------

describe('runPapersAskCli (injected pipeline, no network)', () => {
  it('renders a grounded, cited answer to stdout', async () => {
    const logs: string[] = [];
    await runPapersAskCli(
      'How does photosynthesis convert light energy?',
      ['/papers'],
      { topK: 4 },
      makeIo({ log: (m) => logs.push(m) }),
    );
    const out = logs.join('\n');
    expect(out).toContain('# Paper QA : How does photosynthesis convert light energy?');
    expect(out).toContain('## Références');
    expect(out).toContain('photosynthesis.pdf');
    expect(out).toContain('p.1');
  });

  it('persists the answer to the requested report file', async () => {
    const written: Array<{ file: string; content: string }> = [];
    await runPapersAskCli(
      'How does photosynthesis convert light energy?',
      ['/papers'],
      { report: 'out/answer.md' },
      makeIo({ log: () => undefined, writeFile: async (file, content) => { written.push({ file, content }); } }),
    );
    expect(written).toHaveLength(1);
    expect(written[0]!.file).toBe('out/answer.md');
    expect(written[0]!.content).toContain('## Références');
    expect(written[0]!.content).toContain('photosynthesis.pdf');
  });

  it('never throws when no PDF is resolved (reports, returns)', async () => {
    const errors: string[] = [];
    await expect(
      runPapersAskCli(
        'Q',
        ['/nope'],
        {},
        makeIo({ resolvePdfPaths: async () => [], errorLog: (m) => errors.push(m) }),
      ),
    ).resolves.toBeUndefined();
    expect(errors.join('\n')).toContain('No readable PDF');
  });

  it('never throws when no provider is available (reports, returns)', async () => {
    const errors: string[] = [];
    await expect(
      runPapersAskCli('Q', ['/papers'], {}, makeIo({ resolveProvider: () => null, errorLog: (m) => errors.push(m) })),
    ).resolves.toBeUndefined();
    expect(errors.join('\n')).toContain('No LLM provider');
  });
});
