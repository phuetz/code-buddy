import type { CodeBuddyTool } from './types.js';

/**
 * Model-facing schema for the local Code Mode adapter. GPT-5.6 Sol's
 * Responses Lite transport rewrites this function to the wire-level custom
 * tool named `exec`; every other provider can use the normal function shape.
 */
export const CODE_EXEC_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'code_exec',
    description:
      'Run bounded JavaScript orchestration in an isolated local process. Use await tools.<name>({...}) or tools.call(name, {...}) to invoke normal Code Buddy tools; nested effects retain confirmations and policies. Helpers: text(), store()/load(), ALL_TOOLS, yield_control().',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript orchestration source. Top-level await is supported.',
        },
        timeout_ms: {
          type: 'number',
          description: 'Bounded execution timeout in milliseconds (100..60000; default 30000).',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
};

export const CODE_EXEC_TOOLS: CodeBuddyTool[] = [CODE_EXEC_TOOL];
