/**
 * GitNexus Tool Definitions
 *
 * OpenAI function calling schema for the GitNexus tool.
 */

import type { CodeBuddyTool } from './types.js';

export const GITNEXUS_ASK_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'gitnexus_ask',
    description:
      'Consult GitNexus for a query or code understanding request. Returns related files, dependent symbols, tests to watch, and technical recommendations. This is a read-only tool.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query or task description to ask GitNexus about.',
        },
      },
      required: ['query'],
    },
  },
};

export const GITNEXUS_TOOLS: CodeBuddyTool[] = [GITNEXUS_ASK_TOOL];
