import type { CodeBuddyTool } from './types.js';

/** Read-only release notes for the agent's own recent evolution. */
export const SELF_EVOLUTION_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'self_evolution',
    description:
      "Read Code Buddy's structured CHANGELOG notes about what changed recently, since a date, or on a subject. It is local, read-only, and reports documented changes only; it never edits source code, probes services, or infers subjective experience.",
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'Optional inclusive start date in YYYY-MM-DD format.',
          maxLength: 10,
        },
        subject: {
          type: 'string',
          description: 'Optional subject such as voice, memory, companion, context, or reliability.',
          maxLength: 120,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (1–20, default 5).',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const SELF_EVOLUTION_TOOLS: CodeBuddyTool[] = [SELF_EVOLUTION_TOOL];
