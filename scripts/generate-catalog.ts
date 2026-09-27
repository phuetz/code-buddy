import path from 'node:path';
import { generateCatalog, renderCatalogMarkdown } from '../src/catalog/generate.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--json', '--md'].includes(arg)) || (args.includes('--json') && args.includes('--md'))) {
  process.stderr.write('Usage: generate-catalog.ts [--json|--md]\n');
  process.exitCode = 2;
} else {
  const catalog = generateCatalog(path.resolve(process.cwd()));
  process.stdout.write(args.includes('--json') ? `${JSON.stringify(catalog, null, 2)}\n` : renderCatalogMarkdown(catalog));
}
