/**
 * Search Tool Definitions
 *
 * Tools for searching code and finding symbols:
 * - Unified search (text + files)
 * - Symbol search
 * - Reference finding
 * - Definition lookup
 * - Multi-pattern search
 */

import type { GrokTool } from './types.js';

// Unified search tool
export const SEARCH_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "search",
    description: "Unified search tool for finding text content or files (similar to Cursor's search)",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to search for or file name/path pattern",
        },
        search_type: {
          type: "string",
          enum: ["text", "files", "both"],
          description: "Type of search: 'text' for content search, 'files' for file names, 'both' for both (default: 'both')",
        },
        include_pattern: {
          type: "string",
          description: "Glob pattern for files to include (e.g. '*.ts', '*.js')",
        },
        exclude_pattern: {
          type: "string",
          description: "Glob pattern for files to exclude (e.g. '*.log', 'node_modules')",
        },
        case_sensitive: {
          type: "boolean",
          description: "Whether search should be case sensitive (default: false)",
        },
        whole_word: {
          type: "boolean",
          description: "Whether to match whole words only (default: false)",
        },
        regex: {
          type: "boolean",
          description: "Whether query is a regex pattern (default: false)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 50)",
        },
        file_types: {
          type: "array",
          items: { type: "string" },
          description: "File types to search (e.g. ['js', 'ts', 'py'])",
        },
        include_hidden: {
          type: "boolean",
          description: "Whether to include hidden files (default: false)",
        },
      },
      required: ["query"],
    },
  },
};

// Find symbols tool
export const FIND_SYMBOLS_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "find_symbols",
    description: "Find code symbols (functions, classes, interfaces, types, constants) by name. Useful for understanding code structure and finding definitions.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Symbol name or partial name to search for",
        },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["function", "class", "interface", "type", "const", "variable", "method"],
          },
          description: "Types of symbols to find (default: all types)",
        },
        exported_only: {
          type: "boolean",
          description: "Only find exported/public symbols (default: false)",
        },
      },
      required: ["name"],
    },
  },
};

// Find references tool
export const FIND_REFERENCES_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "find_references",
    description: "Find all references/usages of a symbol in the codebase. Useful for understanding how a function, class, or variable is used.",
    parameters: {
      type: "object",
      properties: {
        symbol_name: {
          type: "string",
          description: "The symbol name to find references for",
        },
        context_lines: {
          type: "number",
          description: "Number of context lines before/after each match (default: 2)",
        },
      },
      required: ["symbol_name"],
    },
  },
};

// Find definition tool
export const FIND_DEFINITION_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "find_definition",
    description: "Find the definition of a symbol (where it's declared). Returns the file, line, and signature.",
    parameters: {
      type: "object",
      properties: {
        symbol_name: {
          type: "string",
          description: "The symbol name to find the definition for",
        },
      },
      required: ["symbol_name"],
    },
  },
};

// Multi-pattern search tool
export const SEARCH_MULTI_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "search_multi",
    description: "Search for multiple patterns at once with OR (any pattern) or AND (all patterns) logic.",
    parameters: {
      type: "object",
      properties: {
        patterns: {
          type: "array",
          items: { type: "string" },
          description: "Array of patterns to search for",
        },
        operator: {
          type: "string",
          enum: ["OR", "AND"],
          description: "OR: find files with any pattern. AND: find files with all patterns (default: OR)",
        },
      },
      required: ["patterns"],
    },
  },
};

/**
 * All search tools as an array
 */
export const SEARCH_TOOLS: GrokTool[] = [
  SEARCH_TOOL,
  FIND_SYMBOLS_TOOL,
  FIND_REFERENCES_TOOL,
  FIND_DEFINITION_TOOL,
  SEARCH_MULTI_TOOL,
];
