import type { ToolSchema } from './types.js';

/** Advertise one spelling per field; legacy aliases remain a runtime concern. */
export const REPLACEMENT_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', minLength: 1, description: 'Path to the file to edit' },
    old_str: { type: 'string', minLength: 1, description: 'Exact existing text to replace, including whitespace; may span multiple lines' },
    new_str: { type: 'string', description: 'Literal replacement text; may be empty to delete the matched text' },
    replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false, only replaces first occurrence)' },
  },
  required: ['path', 'old_str', 'new_str'],
} satisfies ToolSchema['parameters'];
