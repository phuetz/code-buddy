/**
 * Search Tool Adapters
 *
 * ITool-compliant adapters for SearchTool operations.
 * These adapters wrap the existing SearchTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { SearchTool } from '../search.js';

// ============================================================================
// Shared SearchTool Instance
// ============================================================================

let searchInstance: SearchTool | null = null;

function getSearch(): SearchTool {
  if (!searchInstance) {
    searchInstance = new SearchTool();
  }
  return searchInstance;
}

/**
 * Reset the shared SearchTool instance (for testing)
 */
export function resetSearchInstance(): void {
  searchInstance = null;
}

// ============================================================================
// UnifiedSearchTool
// ============================================================================

/**
 * UnifiedSearchTool - ITool adapter for unified text and file search
 */
export class UnifiedSearchTool implements ITool {
  readonly name = 'search';
  readonly description = 'Search for text content or find files using pattern matching';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const options = {
      searchType: input.search_type as 'text' | 'files' | 'both' | undefined,
      includePattern: input.include_pattern as string | undefined,
      excludePattern: input.exclude_pattern as string | undefined,
      caseSensitive: input.case_sensitive as boolean | undefined,
      wholeWord: input.whole_word as boolean | undefined,
      regex: input.regex as boolean | undefined,
      maxResults: input.max_results as number | undefined,
      fileTypes: input.file_types as string[] | undefined,
      includeHidden: input.include_hidden as boolean | undefined,
    };

    return await getSearch().search(query, options);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (text pattern or file name)',
          },
          search_type: {
            type: 'string',
            description: 'Type of search: "text", "files", or "both"',
            enum: ['text', 'files', 'both'],
          },
          include_pattern: {
            type: 'string',
            description: 'Glob pattern for files to include',
          },
          exclude_pattern: {
            type: 'string',
            description: 'Glob pattern for files to exclude',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Enable case-sensitive search',
          },
          whole_word: {
            type: 'boolean',
            description: 'Match whole words only',
          },
          regex: {
            type: 'boolean',
            description: 'Treat query as regex pattern',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return',
          },
          file_types: {
            type: 'array',
            description: 'File types to search (e.g., ["ts", "js"])',
            items: { type: 'string' },
          },
          include_hidden: {
            type: 'boolean',
            description: 'Include hidden files in search',
          },
        },
        required: ['query'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.query !== 'string' || data.query.trim() === '') {
      return { valid: false, errors: ['query must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_search' as ToolCategoryType,
      keywords: ['search', 'find', 'grep', 'pattern', 'text', 'files'],
      priority: 9,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// FindSymbolsTool
// ============================================================================

/**
 * FindSymbolsTool - ITool adapter for finding code symbols
 */
export class FindSymbolsTool implements ITool {
  readonly name = 'find_symbols';
  readonly description = 'Find functions, classes, interfaces, and other code symbols';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const name = input.name as string;
    const options = {
      types: input.types as ('function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'method')[] | undefined,
      exportedOnly: input.exported_only as boolean | undefined,
    };

    return await getSearch().findSymbols(name, options);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Symbol name or pattern to search for',
          },
          types: {
            type: 'array',
            description: 'Types of symbols to find',
            items: {
              type: 'string',
              enum: ['function', 'class', 'interface', 'type', 'const', 'variable', 'method'],
            },
          },
          exported_only: {
            type: 'boolean',
            description: 'Only return exported symbols',
          },
        },
        required: ['name'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.name !== 'string' || data.name.trim() === '') {
      return { valid: false, errors: ['name must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['symbol', 'function', 'class', 'interface', 'find', 'definition'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// FindReferencesTool
// ============================================================================

/**
 * FindReferencesTool - ITool adapter for finding symbol references
 */
export class FindReferencesTool implements ITool {
  readonly name = 'find_references';
  readonly description = 'Find all references to a symbol in the codebase';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const symbolName = input.symbol_name as string;
    const contextLines = (input.context_lines as number) ?? 2;

    return await getSearch().findReferences(symbolName, contextLines);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          symbol_name: {
            type: 'string',
            description: 'Name of the symbol to find references for',
          },
          context_lines: {
            type: 'number',
            description: 'Number of context lines to include (default: 2)',
            default: 2,
          },
        },
        required: ['symbol_name'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.symbol_name !== 'string' || data.symbol_name.trim() === '') {
      return { valid: false, errors: ['symbol_name must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['references', 'usage', 'find', 'symbol'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// FindDefinitionTool
// ============================================================================

/**
 * FindDefinitionTool - ITool adapter for finding symbol definitions
 */
export class FindDefinitionTool implements ITool {
  readonly name = 'find_definition';
  readonly description = 'Find the definition of a symbol';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const symbolName = input.symbol_name as string;

    return await getSearch().findDefinition(symbolName);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          symbol_name: {
            type: 'string',
            description: 'Name of the symbol to find the definition for',
          },
        },
        required: ['symbol_name'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.symbol_name !== 'string' || data.symbol_name.trim() === '') {
      return { valid: false, errors: ['symbol_name must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: ['definition', 'goto', 'find', 'symbol'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// SearchMultipleTool
// ============================================================================

/**
 * SearchMultipleTool - ITool adapter for multi-pattern search
 */
export class SearchMultipleTool implements ITool {
  readonly name = 'search_multi';
  readonly description = 'Search for multiple patterns with OR/AND logic';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const patterns = input.patterns as string[];
    const operator = (input.operator as 'OR' | 'AND') ?? 'OR';

    return await getSearch().searchMultiple(patterns, operator);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          patterns: {
            type: 'array',
            description: 'Array of patterns to search for',
            items: { type: 'string' },
          },
          operator: {
            type: 'string',
            description: 'Logical operator: "OR" (any pattern) or "AND" (all patterns)',
            enum: ['OR', 'AND'],
          },
        },
        required: ['patterns'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (!Array.isArray(data.patterns) || data.patterns.length === 0) {
      return { valid: false, errors: ['patterns must be a non-empty array'] };
    }

    if (!data.patterns.every((p: unknown) => typeof p === 'string')) {
      return { valid: false, errors: ['all patterns must be strings'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_search' as ToolCategoryType,
      keywords: ['search', 'multi', 'pattern', 'or', 'and'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all search tool instances
 */
export function createSearchTools(): ITool[] {
  return [
    new UnifiedSearchTool(),
    new FindSymbolsTool(),
    new FindReferencesTool(),
    new FindDefinitionTool(),
    new SearchMultipleTool(),
  ];
}
