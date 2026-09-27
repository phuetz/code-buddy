import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { buildCatalog, renderCatalogMarkdown, type CatalogOptions } from '../../catalog/status.js';

function defaultOptions(): CatalogOptions {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  let revision: string | null = null;
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { /* npm packages normally have no Git metadata. */ }

  let installed: CatalogOptions['installed'];
  try {
    const executable = realpathSync(process.argv[1] ?? '');
    const packageName = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string; version?: string };
    const packageSegment = path.join('node_modules', '@phuetz', 'code-buddy');
    if (packageName.name === '@phuetz/code-buddy'
      && typeof packageName.version === 'string'
      && root.includes(packageSegment)
      && executable === path.join(root, 'dist', 'cli-boot.js')) {
      installed = { confirmed: true, version: packageName.version };
    }
  } catch { /* A source checkout does not establish deployment. */ }
  return { root, revision, installed };
}

export function registerCatalogCommands(program: Command, options?: CatalogOptions): void {
  const catalog = program.command('catalog')
    .description('Inspect feature code, wiring, real-world evidence, deployment and the source-code catalogue');
  const show = (json: boolean): void => {
    const result = buildCatalog(options ?? defaultOptions());
    console.log(json ? JSON.stringify(result, null, 2) : renderCatalogMarkdown(result));
  };
  catalog.action(() => show(false));
  catalog.command('status')
    .description('Generate feature status from the inventory and evidence')
    .option('--json', 'output JSON instead of Markdown')
    .action((flags: { json?: boolean }) => show(flags.json === true));

  catalog
    .command('generate')
    .description('Generate a read-only catalogue from declarations in this checkout')
    .option('--json', 'write JSON to standard output')
    .option('--md', 'write Markdown to standard output')
    .action(async (options: { json?: boolean; md?: boolean }) => {
      if (options.json && options.md) throw new Error('Choose --json or --md');
      const { generateCatalog, renderCatalogMarkdown: renderSourceCatalogMarkdown } = await import('../../catalog/generate.js');
      const generated = generateCatalog(path.resolve(process.cwd()));
      process.stdout.write(options.json ? `${JSON.stringify(generated, null, 2)}\n` : renderSourceCatalogMarkdown(generated));
    });

  catalog.command('coverage')
    .description('Show deterministic DGM domain coverage and unmatched catalogue IDs')
    .option('--json', 'write JSON to standard output')
    .option('--md', 'write Markdown to standard output')
    .action(async (options: { json?: boolean; md?: boolean }) => {
      if (options.json && options.md) throw new Error('Choose --json or --md');
      const { generateCatalog } = await import('../../catalog/generate.js');
      const { buildCatalogCoverage, renderCatalogCoverageMarkdown } = await import('../../catalog/coverage.js');
      const { CURATED_FEATURES } = await import('../../agent/self-improvement/evolution/feature-map.js');
      const coverage = buildCatalogCoverage(generateCatalog(path.resolve(process.cwd())), CURATED_FEATURES);
      process.stdout.write(options.json ? `${JSON.stringify(coverage, null, 2)}\n` : renderCatalogCoverageMarkdown(coverage));
    });

  catalog.command('articles')
    .description('Read the persisted DGM feature-to-publication table')
    .option('--json', 'export JSON to standard output')
    .option('--csv', 'export CSV to standard output')
    .option('--md', 'export Markdown to standard output')
    .option('--file <path>', 'read an explicit JSONL snapshot')
    .option('--audit', 'show catalogue coverage, unknown links and stale records as JSON')
    .action(async (options: { json?: boolean; csv?: boolean; md?: boolean; file?: string; audit?: boolean }) => {
      if ([options.json, options.csv, options.md].filter(Boolean).length > 1) throw new Error('Choose one export format');
      if (options.audit && (options.csv || options.md)) throw new Error('--audit uses JSON output');
      const { auditArticleLinks, exportArticleLinks, readArticleLinks } = await import('../../catalog/article-links.js');
      const rows = readArticleLinks(options.file);
      if (options.audit) {
        const { generateCatalog } = await import('../../catalog/generate.js');
        const { CURATED_FEATURES } = await import('../../agent/self-improvement/evolution/feature-map.js');
        const audit = auditArticleLinks(rows, generateCatalog(path.resolve(process.cwd())).entries.map((item) => item.id),
          CURATED_FEATURES.map((item) => item.id));
        process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
        return;
      }
      process.stdout.write(exportArticleLinks(rows, options.json ? 'json' : options.csv ? 'csv' : 'md'));
    });
}

/** Former entry point of the source-code catalogue (PR #239); same `catalog` command. */
export function registerCatalogCommand(program: Command): void {
  registerCatalogCommands(program);
}
