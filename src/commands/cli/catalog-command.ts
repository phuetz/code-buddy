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
}
