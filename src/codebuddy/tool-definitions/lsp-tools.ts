/**
 * LSP Tool Definitions
 *
 * OpenAI function-calling schemas for LSP navigation, diagnostics, rename,
 * and code action tools.
 */

import type { CodeBuddyTool } from './types.js';

const POSITION_PROPERTIES = {
  file: {
    type: 'string',
    description: 'Path to the source file, relative to the active workspace or absolute',
  },
  symbol: {
    type: 'string',
    description: 'Symbol name to locate in the file; use line and column for ambiguous occurrences',
  },
  line: {
    type: 'number',
    description: '1-based line number; must be paired with column',
  },
  column: {
    type: 'number',
    description: '1-based column number; must be paired with line',
  },
  col: {
    type: 'number',
    description: 'Alias for column (1-based)',
  },
};

export const LSP_DEFINITION_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_definition',
    description: 'Resolve the semantic definition of a symbol using the configured language server. Read-only. Provide either symbol or both 1-based line and column.',
    parameters: {
      type: 'object',
      properties: POSITION_PROPERTIES,
      required: ['file'],
      additionalProperties: false,
    },
  },
};

export const LSP_REFERENCES_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_references',
    description: 'Find semantic references to a symbol using the configured language server. Read-only. Provide either symbol or both 1-based line and column.',
    parameters: {
      type: 'object',
      properties: POSITION_PROPERTIES,
      required: ['file'],
      additionalProperties: false,
    },
  },
};

export const LSP_HOVER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_hover',
    description: 'Return semantic hover/type information from the configured language server. Read-only. Provide either symbol or both 1-based line and column.',
    parameters: {
      type: 'object',
      properties: POSITION_PROPERTIES,
      required: ['file'],
      additionalProperties: false,
    },
  },
};

export const LSP_SYMBOLS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_symbols',
    description: 'Return the semantic document outline (classes, functions, methods, variables, and nested symbols) from the configured language server. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to the source file, relative to the active workspace or absolute',
        },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
};

export const LSP_DIAGNOSTICS_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_diagnostics',
    description: 'Return diagnostics published by the configured language server for a source file. Read-only; distinguishes a clean file from an unavailable server.',
    parameters: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Path to the source file, relative to the active workspace or absolute',
        },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
};

export const LSP_RENAME_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_rename',
    description: 'Rename a symbol across the codebase using the Language Server Protocol. Performs a cross-file rename operation, updating all references. Requires the appropriate LSP server installed (e.g. typescript-language-server for TS/JS, pylsp for Python).',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file containing the symbol to rename',
        },
        line: {
          type: 'number',
          description: 'Line number of the symbol (1-based)',
        },
        character: {
          type: 'number',
          description: 'Column number of the symbol (1-based)',
        },
        new_name: {
          type: 'string',
          description: 'New name for the symbol',
        },
      },
      required: ['file_path', 'line', 'character', 'new_name'],
    },
  },
};

export const LSP_CODE_ACTION_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'lsp_code_action',
    description: 'Get available code actions (quick fixes, refactorings) for a position or range in a file using the Language Server Protocol.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file',
        },
        start_line: {
          type: 'number',
          description: 'Start line of the range (1-based)',
        },
        start_character: {
          type: 'number',
          description: 'Start column of the range (1-based)',
        },
        end_line: {
          type: 'number',
          description: 'End line of the range (1-based, defaults to start_line)',
        },
        end_character: {
          type: 'number',
          description: 'End column of the range (1-based, defaults to start_character)',
        },
      },
      required: ['file_path', 'start_line', 'start_character'],
    },
  },
};

export const LSP_TOOLS: CodeBuddyTool[] = [
  LSP_DEFINITION_TOOL,
  LSP_REFERENCES_TOOL,
  LSP_HOVER_TOOL,
  LSP_SYMBOLS_TOOL,
  LSP_DIAGNOSTICS_TOOL,
  LSP_RENAME_TOOL,
  LSP_CODE_ACTION_TOOL,
];
