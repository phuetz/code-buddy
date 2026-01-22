/**
 * Web Tool Adapters
 *
 * ITool-compliant adapters for WebSearchTool operations.
 * These adapters wrap the existing WebSearchTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { WebSearchTool } from '../web-search.js';

// ============================================================================
// Shared WebSearchTool Instance
// ============================================================================

let webSearchInstance: WebSearchTool | null = null;

function getWebSearch(): WebSearchTool {
  if (!webSearchInstance) {
    webSearchInstance = new WebSearchTool();
  }
  return webSearchInstance;
}

/**
 * Reset the shared WebSearchTool instance (for testing)
 */
export function resetWebSearchInstance(): void {
  webSearchInstance = null;
}

// ============================================================================
// WebSearchExecuteTool
// ============================================================================

/**
 * WebSearchExecuteTool - ITool adapter for web search
 */
export class WebSearchExecuteTool implements ITool {
  readonly name = 'web_search';
  readonly description = 'Search the web using DuckDuckGo and return relevant results';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const options = {
      maxResults: input.max_results as number | undefined,
      safeSearch: input.safe_search as boolean | undefined,
    };

    return await getWebSearch().search(query, options);
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
            description: 'The search query',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
            default: 5,
          },
          safe_search: {
            type: 'boolean',
            description: 'Enable safe search filtering',
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
      category: 'web' as ToolCategoryType,
      keywords: ['search', 'web', 'internet', 'duckduckgo', 'google'],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// WebFetchTool
// ============================================================================

/**
 * WebFetchTool - ITool adapter for fetching web pages
 */
export class WebFetchTool implements ITool {
  readonly name = 'web_fetch';
  readonly description = 'Fetch and extract text content from a web page';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const prompt = input.prompt as string | undefined;

    return await getWebSearch().fetchPage(url, prompt);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          prompt: {
            type: 'string',
            description: 'Optional prompt for content extraction',
          },
        },
        required: ['url'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.url !== 'string' || data.url.trim() === '') {
      return { valid: false, errors: ['url must be a non-empty string'] };
    }

    // Basic URL validation
    try {
      new URL(data.url);
    } catch {
      return { valid: false, errors: ['url must be a valid URL'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['fetch', 'web', 'page', 'url', 'content', 'scrape'],
      priority: 6,
      modifiesFiles: false,
      makesNetworkRequests: true,
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
 * Create all web tool instances
 */
export function createWebTools(): ITool[] {
  return [
    new WebSearchExecuteTool(),
    new WebFetchTool(),
  ];
}
