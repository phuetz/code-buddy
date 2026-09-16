import type { CodeBuddyTool } from './types.js';

/** Read-only operational self-model backed by source and live runtime evidence. */
export const SELF_DESCRIBE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'self_describe',
    description:
      "Inspect this robot/agent's implementation and evidenced turn metadata: package/revision, relevant code areas, model/provider/surface, registered versus currently exposed tools, configuration-only faculties, and explicit limits. It performs no live hardware, process, service, or network probes; unavailable attestations remain unknown. " +
      'Optional operation=list/read/search explores attested implementation files under src/ or dist/ with paths and line numbers; no arbitrary workspace access. Use it for technical introspection and questions about current settings (theme, model, provider, permissions, turn limits) and capabilities. Its output is a verifiable operational self-model, never evidence of subjective consciousness.',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['list', 'read', 'search'], description: 'Omit for runtime settings and overview. Use list/read/search for deeper code research.' },
        path: { type: 'string', maxLength: 160, description: 'Relative core implementation path. Default src/ in a checkout, dist/ in an installed package.' },
        query: { type: 'string', maxLength: 160, description: 'Literal text for search, never a shell command or regex.' },
        offset: { type: 'integer', description: 'Zero-based list offset. Use returned nextOffset to continue a truncated directory listing.' },
        line: { type: 'integer', description: 'First line to read; returns at most 120 lines.' },
        focus: {
          type: 'string',
          maxLength: 320,
          description: 'The aspect of this agent to inspect, for example voice, memory, routing, architecture, or a current limitation.',
        },
        depth: {
          type: 'string',
          enum: ['summary', 'deep'],
          description: 'summary returns a compact snapshot; deep inspects more curated source areas.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const SELF_DESCRIBE_TOOLS: CodeBuddyTool[] = [SELF_DESCRIBE_TOOL];
