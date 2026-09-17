import path from 'node:path';

import { importFigma } from '../figma/import-figma.js';
import { FigmaImportError } from '../figma/types.js';
import type { ToolResult } from '../types/index.js';

export interface FigmaImportToolArgs {
  jsonPath?: string;
  fileKey?: string;
  token?: string;
  outDir?: string;
  designSystemId?: string;
  dryRun?: boolean;
}

export class FigmaImportTool {
  readonly name = 'figma_import';
  readonly description =
    'Import a Figma REST file JSON (local path) or a file key with a caller-supplied token into React screens. Unsupported nodes are listed, not approximated.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const args = parseArgs(input);
      const cwd = process.cwd();
      const result = await importFigma({
        jsonPath: args.jsonPath,
        fileKey: args.fileKey,
        token: args.token,
        outDir: args.outDir,
        designSystemId: args.designSystemId,
        dryRun: args.dryRun === true || !args.outDir,
        cwd,
      });

      const written = result.written.length > 0
        ? result.written.map((file) => path.posix.join(result.outDir ? path.relative(cwd, result.outDir) : '', file).replace(/\\/g, '/'))
        : [];

      return {
        success: true,
        output: [
          `Imported ${result.ir.screens.length} screen(s), ${result.ir.components.length} component(s).`,
          `Skipped ${result.ir.skips.length} unsupported node(s).`,
          written.length > 0 ? `Wrote: ${written.join(', ')}` : 'Dry run (no files written).',
          '',
          result.reportMarkdown,
        ].join('\n'),
        data: {
          screens: result.ir.screens.map((screen) => screen.name),
          components: result.ir.components.map((component) => component.name),
          skipped: result.ir.skips.length,
          written: result.written,
        },
      };
    } catch (error) {
      const message = error instanceof FigmaImportError || error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }
}

function parseArgs(input: Record<string, unknown>): FigmaImportToolArgs {
  const str = (key: string): string | undefined => {
    const value = input[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return {
    jsonPath: str('jsonPath') ?? str('json'),
    fileKey: str('fileKey') ?? str('file_key'),
    token: str('token'),
    outDir: str('outDir') ?? str('out'),
    designSystemId: str('designSystemId') ?? str('designSystem'),
    dryRun: input.dryRun === true,
  };
}

export const FIGMA_IMPORT_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'figma_import',
    description:
      'Import Figma frames into React screens. Prefer a local REST API JSON export (jsonPath). A fileKey requires token at call time and is never stored. Unsupported vectors/effects are listed in the import report instead of being faked.',
    parameters: {
      type: 'object',
      properties: {
        jsonPath: {
          type: 'string',
          description: 'Path to a Figma REST /v1/files JSON export on disk (no network).',
        },
        fileKey: {
          type: 'string',
          description: 'Figma file key. Requires token. Tests and default usage should use jsonPath instead.',
        },
        token: {
          type: 'string',
          description: 'Figma personal access token supplied at this call only. Never persist it.',
        },
        outDir: {
          type: 'string',
          description: 'Directory to write React + CSS into. Omit or set dryRun for a report-only run.',
        },
        designSystemId: {
          type: 'string',
          description: 'Optional vendored design-system id (spotify, figma, apple, …) applied via applyDesignSystem.',
        },
        dryRun: {
          type: 'boolean',
          description: 'When true, parse and report without writing files.',
        },
      },
    },
  },
};
