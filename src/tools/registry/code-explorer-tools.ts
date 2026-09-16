/**
 * CodeExplorer Tool Adapter
 *
 * ITool-compliant adapter for the CodeExplorer tool.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { CodeExplorerTool } from '../code-explorer-tool.js';

export class CodeExplorerAskTool implements ITool {
  readonly name = 'code_explorer_ask';
  readonly description =
    'Consult CodeExplorer for a query or code understanding request. Returns related files, dependent symbols, tests to watch, and technical recommendations. This is a read-only tool.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof input.query === 'string' ? input.query : '';
    if (!query) {
      return {
        success: false,
        error: 'Missing required parameter "query".',
      };
    }
    const repo = typeof input.repo === 'string' && input.repo.trim() ? input.repo.trim() : undefined;

    try {
      const codeExplorer = new CodeExplorerTool();
      const result = await codeExplorer.ask(query, repo);
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
            description: 'The query or task description to ask CodeExplorer about.',
          },
          repo: {
            type: 'string',
            description: 'Indexed repository path or id. Defaults to the graph that contains the current working directory.',
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
    const typed = input as Record<string, unknown>;
    if (typeof typed.query !== 'string' || !typed.query.trim()) {
      return { valid: false, errors: ['Parameter "query" is required and must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['code-explorer', 'ask', 'query', 'understand', 'explain', 'search', 'related files', 'dependents', 'tests'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createCodeExplorerTools(): ITool[] {
  return [new CodeExplorerAskTool()];
}

export function resetCodeExplorerInstances(): void {
  // Stateless tool — nothing to reset
}
