import type { CodeBuddyTool } from './types.js';

/**
 * Schéma exposé au modèle pour le catalogue de design local.
 * L'exécution reste portée par DesignSystemExecuteTool dans le registre formel.
 */
export const DESIGN_SYSTEM_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'design_system',
    description: 'List available brand design systems and read DESIGN.md guidance for UI generation.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get'],
          description: "Use 'list' to browse styles, 'get' to read one style's DESIGN.md guidance.",
        },
        id: {
          type: 'string',
          description: "Design system id for action='get' (e.g. 'spotify', 'apple', 'brutalism').",
        },
        category: {
          type: 'string',
          description: "Optional category filter for action='list' (case-insensitive).",
        },
        query: {
          type: 'string',
          description: "Optional search over id, name, category, and tagline for action='list'.",
        },
      },
      required: ['action'],
    },
  },
};
