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
  const catalog = program.command('catalog').description('Inspect feature code, wiring, real-world evidence and deployment');
  const show = (json: boolean): void => {
    const result = buildCatalog(options ?? defaultOptions());
    console.log(json ? JSON.stringify(result, null, 2) : renderCatalogMarkdown(result));
  };
  catalog.action(() => show(false));
  catalog.command('status')
    .description('Generate feature status from the inventory and evidence')
    .option('--json', 'output JSON instead of Markdown')
    .action((flags: { json?: boolean }) => show(flags.json === true));
}
