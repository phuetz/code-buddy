/**
 * Web Tool Adapters
 *
 * ITool-compliant adapters for WebSearchTool operations.
 * These adapters wrap the existing WebSearchTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { WebSearchTool } from '../index.js';

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
  readonly description = 'Search the web using Brave Search, Perplexity, Serper (Google), or DuckDuckGo. Supports region, language, and freshness filters.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const options = {
      maxResults: input.max_results as number | undefined,
      safeSearch: input.safe_search as boolean | undefined,
      country: input.country as string | undefined,
      search_lang: input.search_lang as string | undefined,
      ui_lang: input.ui_lang as string | undefined,
      freshness: input.freshness as string | undefined,
      provider: input.provider as import('../web-search.js').SearchProvider | undefined,
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
            description: 'Number of results to return (1-10, default: 5)',
            default: 5,
          },
          country: {
            type: 'string',
            description: '2-letter country code for region-specific results (e.g., "DE", "US", "FR")',
          },
          search_lang: {
            type: 'string',
            description: 'ISO language code for search results (e.g., "de", "en", "fr")',
          },
          freshness: {
            type: 'string',
            description: 'Filter by discovery time (Brave only): "pd" (24h), "pw" (week), "pm" (month), "py" (year), or "YYYY-MM-DDtoYYYY-MM-DD"',
          },
          provider: {
            type: 'string',
            description: 'Force a specific provider: "brave", "perplexity", "serper", "duckduckgo". Default: auto-fallback chain.',
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
      keywords: ['search', 'web', 'internet', 'brave', 'perplexity', 'google', 'duckduckgo'],
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

    if (typeof prompt === 'string' && prompt.length > 0) {
      return await getWebSearch().fetchPage(url, prompt);
    }

    return await getWebSearch().fetchPage(url);
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
