/**
 * GitNexus Tool Adapter
 *
 * ITool-compliant adapter for the GitNexus tool.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { GitNexusTool } from '../gitnexus-tool.js';

export class GitNexusAskTool implements ITool {
  readonly name = 'gitnexus_ask';
  readonly description =
    'Consult GitNexus for a query or code understanding request. Returns related files, dependent symbols, tests to watch, and technical recommendations. This is a read-only tool.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = typeof input.query === 'string' ? input.query : '';
    if (!query) {
      return {
        success: false,
        error: 'Missing required parameter "query".',
      };
    }

    try {
      const gitNexus = new GitNexusTool();
      const result = await gitNexus.ask(query);
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
            description: 'The query or task description to ask GitNexus about.',
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
      keywords: ['gitnexus', 'ask', 'query', 'understand', 'explain', 'search', 'related files', 'dependents', 'tests'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createGitNexusTools(): ITool[] {
  return [new GitNexusAskTool()];
}

export function resetGitNexusInstances(): void {
  // Stateless tool — nothing to reset
}
