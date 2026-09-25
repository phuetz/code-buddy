import type { Command } from 'commander';
import path from 'node:path';

export function registerCatalogCommand(program: Command): void {
  program.command('catalog').description('Inspect the source code catalogue')
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
}
