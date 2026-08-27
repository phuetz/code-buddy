/** `buddy explain` — turn an unfamiliar repository into one orientation artifact. */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import {
  collectRepoExplanationInput,
  type RepoExplanationCollectorOptions,
} from '../analytics/repo-explainer-collector.js';
import {
  explainRepository,
  type RepoExplainDepth,
  type RepoExplanationInput,
} from '../analytics/repo-explainer.js';
import {
  renderRepoExplanationHtml,
  renderRepoExplanationMarkdown,
} from '../export/repo-explanation.js';
import { renderMermaidPng } from '../tools/video/mermaid-render.js';
import { logger } from '../utils/logger.js';

interface ExplainOptions {
  out?: string;
  depth: RepoExplainDepth;
  html: boolean;
}

export interface ExplainCommandDependencies {
  cwd?: string;
  now?: () => Date;
  collect?: (options: RepoExplanationCollectorOptions) => Promise<RepoExplanationInput>;
  renderMermaid?: typeof renderMermaidPng;
}

function parseDepth(value: string): RepoExplainDepth {
  if (value === 'quick' || value === 'deep') return value;
  throw new InvalidArgumentError('La profondeur doit être `quick` ou `deep`.');
}

function safeRepoName(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-+/g, '-');
  return slug || 'repo';
}

function resolveOutput(
  cwd: string,
  rootPath: string,
  options: ExplainOptions
): { outputPath: string; format: 'markdown' | 'html' } {
  const requested = options.out?.trim();
  const extension = requested ? path.extname(requested).toLowerCase() : '';
  if (requested && extension !== '.md' && extension !== '.html') {
    throw new Error('Le fichier de sortie doit se terminer par `.md` ou `.html`.');
  }
  if (options.html && extension === '.md') {
    throw new Error('`--html` est incompatible avec un fichier de sortie `.md`.');
  }
  const format: 'markdown' | 'html' = options.html || extension === '.html' ? 'html' : 'markdown';
  const defaultName = `codebuddy-explain-${safeRepoName(path.basename(rootPath))}.${format === 'html' ? 'html' : 'md'}`;
  return {
    outputPath: path.resolve(cwd, requested || defaultName),
    format,
  };
}

async function ensureDirectory(rootPath: string): Promise<void> {
  const stat = await fs.stat(rootPath).catch(() => undefined);
  if (!stat) throw new Error(`Chemin introuvable : ${rootPath}`);
  if (!stat.isDirectory())
    throw new Error(`Le chemin à expliquer n’est pas un dossier : ${rootPath}`);
}

function minimalInput(
  rootPath: string,
  depth: RepoExplainDepth,
  generatedAt: Date,
  reason: string
): RepoExplanationInput {
  return {
    rootPath,
    rootName: path.basename(rootPath) || 'repo',
    depth,
    generatedAt: generatedAt.toISOString(),
    files: [],
    git: { available: false },
    codeExplorer: { indexed: false },
    notices: [`Collecte globale incomplète : ${reason}`],
  };
}

async function renderDiagramDataUri(
  mermaid: string,
  renderer: typeof renderMermaidPng
): Promise<string | undefined> {
  let tempDirectory: string | undefined;
  try {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buddy-explain-mermaid-'));
    const outputPath = path.join(tempDirectory, 'architecture.png');
    const rendered = await renderer(mermaid, outputPath, { timeoutMs: 30_000 });
    if (!rendered) return undefined;
    const png = await fs.readFile(rendered);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (error) {
    logger.debug('[repo-explainer] rendu Mermaid local indisponible', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export function createExplainCommand(dependencies: ExplainCommandDependencies = {}): Command {
  return new Command('explain')
    .description('Comprendre un dépôt inconnu dans un artefact Markdown ou HTML autonome')
    .argument('[chemin]', 'Dossier du dépôt à analyser', '.')
    .option('--out <fichier.md|.html>', 'Fichier de sortie (Markdown par défaut)')
    .option('--depth <quick|deep>', 'Profondeur de collecte', parseDepth, 'quick')
    .option('--html', 'Produire un HTML autonome zéro CDN', false)
    .action(async (requestedPath: string, options: ExplainOptions, command: Command) => {
      const cwd = path.resolve(dependencies.cwd ?? process.cwd());
      const rootPath = path.resolve(cwd, requestedPath || '.');
      // Un chemin absent/non-dossier est une erreur d'usage : la rendre en erreur
      // CLI propre (exit 1), jamais laisser l'Error s'échapper de l'action async —
      // il deviendrait une « Unhandled promise rejection » + un crash recovery.
      try {
        await ensureDirectory(rootPath);
      } catch (error) {
        command.error(error instanceof Error ? error.message : String(error));
        return;
      }
      const { outputPath, format } = resolveOutput(cwd, rootPath, options);
      const generatedAt = dependencies.now?.() ?? new Date();

      let input: RepoExplanationInput;
      try {
        input = await (dependencies.collect ?? collectRepoExplanationInput)({
          rootPath,
          depth: options.depth,
          generatedAt,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn('[repo-explainer] collecte globale interrompue; artefact minimal produit', {
          rootPath,
          error: reason,
        });
        input = minimalInput(rootPath, options.depth, generatedAt, reason);
      }

      const explanation = explainRepository(input);
      let artifact: string;
      if (format === 'html') {
        const diagramDataUri = await renderDiagramDataUri(
          explanation.architecture.diagram.mermaid,
          dependencies.renderMermaid ?? renderMermaidPng
        );
        artifact = renderRepoExplanationHtml(explanation, { diagramDataUri });
      } else {
        artifact = renderRepoExplanationMarkdown(explanation);
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, artifact, 'utf8');
      logger.info(`Explication du repo générée : ${outputPath}`);
    });
}
