/**
 * Terminate Tool — OpenManus-compatible
 * Explicit completion signal for the LLM agent to call when a task is done.
 * Sets AgentStatus.FINISHED and returns the final status message.
 */

import type { ToolResult } from './index.js';

/** Sentinel value detected by the agent executor to stop the loop */
export const TERMINATE_SIGNAL = '__AGENT_TERMINATE__';

export interface TerminateArgs {
  /** Final status message explaining what was accomplished */
  status: string;
}

/**
 * Execute the terminate tool.
 * Returns a ToolResult whose output starts with the TERMINATE_SIGNAL
 * so the executor can detect it and break out of the loop.
 */
export async function executeTerminate(args: TerminateArgs): Promise<ToolResult> {
  const status = args.status || 'Task completed.';
  return {
    success: true,
    output: `${TERMINATE_SIGNAL}\n${status}`,
  };
}

/** OpenAI function calling definition for the terminate tool */
export const TERMINATE_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'terminate',
    description:
      'Signal that the current task is complete. Call this when you have finished all required work and want to end the execution loop. Provide a brief status summary of what was accomplished.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description:
            'A brief summary of what was accomplished (e.g., "Fixed the bug in auth.ts by correcting the token validation logic")',
        },
      },
      required: ['status'],
    },
  },
};

/** Tool metadata for RAG selection */
export const TERMINATE_TOOL_METADATA = {
  name: 'terminate',
  category: 'control',
  keywords: ['terminate', 'finish', 'done', 'complete', 'end', 'stop', 'exit'],
  priority: 5,
  description: 'Signal task completion and end the agent loop',
};
