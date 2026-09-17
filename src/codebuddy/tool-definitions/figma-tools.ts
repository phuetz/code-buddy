import type { CodeBuddyTool } from './types.js';

export const FIGMA_IMPORT_TOOL: CodeBuddyTool = {
  type: 'function',
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
      required: [],
    },
  },
};

export const FIGMA_TOOLS: CodeBuddyTool[] = [FIGMA_IMPORT_TOOL];
