import type { Command } from 'commander';
import path from 'node:path';

export function registerCatalogCommand(program: Command): void {
  const catalogCommand = program.command('catalog').description('Inspect the source code catalogue');
  catalogCommand
    .command('generate')
    .description('Generate a read-only catalogue from declarations in this checkout')
    .option('--json', 'write JSON to standard output')
    .option('--md', 'write Markdown to standard output')
    .action(async (options: { json?: boolean; md?: boolean }) => {
      if (options.json && options.md) throw new Error('Choose --json or --md');
      const { generateCatalog, renderCatalogMarkdown } = await import('../../catalog/generate.js');
      const catalog = generateCatalog(path.resolve(process.cwd()));
      process.stdout.write(options.json ? `${JSON.stringify(catalog, null, 2)}\n` : renderCatalogMarkdown(catalog));
    });

  catalogCommand.command('coverage')
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

  catalogCommand.command('articles')
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
