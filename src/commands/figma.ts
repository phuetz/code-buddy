import { Command } from 'commander';
import path from 'node:path';

import { FigmaImportError } from '../figma/types.js';
import { importFigma } from '../figma/import-figma.js';

export interface FigmaCommandDependencies {
  cwd?: string;
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  importFigma?: typeof importFigma;
}

interface ImportCliOptions {
  json?: string;
  fileKey?: string;
  token?: string;
  out?: string;
  designSystem?: string;
  dryRun?: boolean;
}

export function createFigmaCommand(dependencies: FigmaCommandDependencies = {}): Command {
  const cwd = dependencies.cwd ?? process.cwd();
  const write = dependencies.stdout ?? ((message: string) => process.stdout.write(`${message}\n`));
  const writeErr = dependencies.stderr ?? ((message: string) => process.stderr.write(`${message}\n`));
  const runImport = dependencies.importFigma ?? importFigma;

  const cmd = new Command('figma');
  cmd.description('Import a Figma file export into React screens (local JSON, or file key + token at call time)');

  cmd
    .command('import')
    .description('Parse a Figma REST JSON export (or fetch a file with a caller-supplied token) and generate React screens')
    .option('--json <file>', 'Path to a Figma REST API file JSON export (no network)')
    .option('--file-key <id>', 'Figma file key; requires a token at call time')
    .option('--token <token>', 'Figma personal access token (never stored; FIGMA_TOKEN / CODEBUDDY_FIGMA_TOKEN also accepted)')
    .option('--out <dir>', 'Output directory for generated React + CSS')
    .option('--design-system <id>', 'Optional vendored design-system id to apply (e.g. spotify, figma)')
    .option('--dry-run', 'Parse and report without writing files', false)
    .action(async (options: ImportCliOptions) => {
      try {
        const result = await runImport({
          jsonPath: options.json,
          fileKey: options.fileKey,
          token: options.token,
          outDir: options.out,
          designSystemId: options.designSystem,
          dryRun: options.dryRun === true || !options.out,
          cwd,
        });
        write(formatCliResult(result, cwd));
      } catch (error) {
        const message = error instanceof FigmaImportError ? error.message : error instanceof Error ? error.message : String(error);
        writeErr(`figma import failed: ${message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}

function formatCliResult(result: Awaited<ReturnType<typeof importFigma>>, cwd: string): string {
  const lines: string[] = [];
  lines.push(`Figma import: ${result.ir.screens.length} screen(s), ${result.ir.components.length} component(s), ${result.ir.skips.length} skipped`);
  for (const screen of result.ir.screens) {
    lines.push(`  screen ${screen.name} → src/screens/${screen.componentName}.tsx`);
  }
  for (const skip of result.ir.skips.slice(0, 12)) {
    lines.push(`  skip ${skip.type} ${skip.name}: ${skip.reason}`);
  }
  if (result.ir.skips.length > 12) {
    lines.push(`  … ${result.ir.skips.length - 12} more skipped (see IMPORT-REPORT.md)`);
  }
  if (result.outDir && result.written.length > 0) {
    lines.push(`Wrote ${result.written.length} file(s) under ${path.relative(cwd, result.outDir) || result.outDir}`);
  } else {
    lines.push('Dry run — no files written. Pass --out <dir> to generate.');
  }
  return lines.join('\n');
}
