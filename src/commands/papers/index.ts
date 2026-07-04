/**
 * `buddy papers` — Paper QA CLI command (PaperQA2-lite Phase 4).
 *
 * Sub-commands:
 *   buddy papers ask "<question>" --path <dir|pdf> [--top-k N] [--max-pdfs N] [--report out.md]
 *
 * `ask` points the shipped PaperQA2-lite pipeline at a local PDF corpus and
 * renders a grounded, cited answer (page/section provenance + "## Références"),
 * or an honest refusal when the corpus does not support one. It reuses the same
 * pipeline as the `paper_qa` agent tool — no duplicated logic.
 *
 * Usage:
 *   buddy papers ask "What optimizer did they use?" --path ./papers
 *   buddy papers ask "Résume la méthode" -p a.pdf -p b.pdf --report out.md
 *
 * @module commands/papers
 */

import { Command } from 'commander';
import { resolveCommandProvider } from '../llm-provider-resolution.js';
import { runPapersAskCli, type PapersAskIo } from './ask.js';

/** Commander collector: accumulate repeated `--path` values into an array. */
function collectPath(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function createPapersCommand(): Command {
  const cmd = new Command('papers').description(
    'Paper QA: ask a question over a local corpus of scientific PDFs and get a grounded, cited answer',
  );

  cmd
    .command('ask')
    .description('Answer a question from PDF papers with an anchored, cited answer (or an honest refusal)')
    .argument('<question>', 'The question to answer from the PDF corpus')
    .option('-p, --path <path>', 'PDF file or directory of papers (repeatable). Default: current directory', collectPath, [])
    .option('-k, --top-k <n>', 'Passages to retrieve before relevance filtering (1-50, default 8)', '8')
    .option('--max-pdfs <n>', 'Cap on PDFs indexed for this run (1-200, default 25)', '25')
    .option('-r, --report <file>', 'Save the answer to a Markdown file instead of stdout')
    .option('-m, --model <model>', 'Override the model for this run')
    .action(async (question: string, opts, command) => {
      const modelOverride: string | undefined = opts.model ?? command?.optsWithGlobals?.()?.model;
      const provider = resolveCommandProvider({ explicitModel: modelOverride });
      if (!provider) {
        console.error(
          '❌ No provider available — set an API key, run `buddy login`, or point CODEBUDDY_PROVIDER=ollama at a local Ollama.',
        );
        process.exit(1);
        return;
      }

      const paths: string[] = Array.isArray(opts.path) && opts.path.length > 0 ? opts.path : ['.'];
      const topK = parseInt(opts.topK, 10) || 8;
      const maxPdfs = parseInt(opts.maxPdfs, 10) || 25;

      const io: PapersAskIo = {
        resolveProvider: () => provider,
      };

      await runPapersAskCli(
        question,
        paths,
        { topK, maxPdfs, report: opts.report, explicitModel: modelOverride },
        io,
      );
    });

  return cmd;
}
