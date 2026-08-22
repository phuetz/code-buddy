/**
 * Web Tool Adapters
 *
 * ITool-compliant adapters for WebSearchTool operations.
 * These adapters wrap the existing WebSearchTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { WebSearchTool, WeatherTool, StockQuoteTool } from '../index.js';
import { WebScrapeTool, type WebScrapeInput } from '../web-scrape-tool.js';

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
export class CommunitySearchExecuteTool implements ITool {
  readonly name = 'community_search';
  readonly description =
    'Search what PEOPLE say — Hacker News, Stack Overflow, GitHub, arXiv and Reddit — '
    + 'ranked by real engagement (votes, points, stars) over a recent window. '
    + 'Complements web_search, which indexes what publishers write. '
    + 'Free, no API key required.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const { communitySearchTool } = await import('../community-search.js');
    return communitySearchTool.search(input.query as string, {
      days: input.days as number | undefined,
      limit: input.limit as number | undefined,
      sources: input.sources as import('../community-search.js').CommunitySource[] | undefined,
    });
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
            description: 'What to look for. Plain words work best — this searches discussions, not pages.',
          },
          days: {
            type: 'number',
            description: 'How far back to look, in days (1-365, default 30). Beyond ~30 it stops being current.',
            default: 30,
          },
          limit: {
            type: 'number',
            description: 'How many results to return (1-60, default 25)',
            default: 25,
          },
          sources: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['hackernews', 'stackexchange', 'github', 'arxiv', 'reddit'],
            },
            description: 'Restrict to specific sources. All by default.',
          },
        },
        required: ['query'],
      },
    };
  }
}

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
// WebScrapeExecuteTool
// ============================================================================

/** ITool adapter for the optional local Scrapling sidecar. */
export class WebScrapeExecuteTool implements ITool {
  readonly name = 'web_scrape';
  readonly description = 'Scrape locally with Scrapling using HTTP, stealth, or dynamic browser rendering';
  private readonly scraper = new WebScrapeTool();

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await this.scraper.execute(input as unknown as WebScrapeInput);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Public HTTP or HTTPS URL to scrape' },
          mode: {
            type: 'string',
            enum: ['http', 'stealth', 'dynamic'],
            description: 'Scraping mode (default: http)',
            default: 'http',
          },
          format: {
            type: 'string',
            enum: ['markdown', 'text', 'html'],
            description: 'Output format (default: markdown)',
            default: 'markdown',
          },
          css: {
            type: 'object',
            description: 'Map of output field names to CSS selectors',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds',
            minimum: 1,
            maximum: 600000,
          },
          impersonate: { type: 'string', description: 'Optional browser identity for HTTP mode' },
          solveCloudflare: {
            type: 'boolean',
            description: 'Attempt Cloudflare challenge handling in stealth mode',
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
    try {
      new URL(data.url);
    } catch {
      return { valid: false, errors: ['url must be a valid URL'] };
    }
    if (data.mode !== undefined && !['http', 'stealth', 'dynamic'].includes(String(data.mode))) {
      return { valid: false, errors: ['mode must be http, stealth, or dynamic'] };
    }
    if (data.format !== undefined && !['markdown', 'text', 'html'].includes(String(data.format))) {
      return { valid: false, errors: ['format must be markdown, text, or html'] };
    }
    if (data.css !== undefined && (typeof data.css !== 'object' || data.css === null || Array.isArray(data.css))) {
      return { valid: false, errors: ['css must be an object of named selectors'] };
    }
    if (data.css && Object.entries(data.css as Record<string, unknown>).some(
      ([field, selector]) => !field.trim() || typeof selector !== 'string' || !selector.trim(),
    )) {
      return { valid: false, errors: ['css must map non-empty field names to non-empty selectors'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['scrape', 'crawl', 'extract', 'cloudflare', 'anti-bot', 'stealth', 'html', 'markdown', 'adaptive', 'selector'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// WeatherExecuteTool
// ============================================================================

// Lazy singleton — same lifecycle pattern as the web-search instance above.
let weatherInstance: WeatherTool | null = null;
function getWeather(): WeatherTool {
  if (!weatherInstance) weatherInstance = new WeatherTool();
  return weatherInstance;
}

/**
 * WeatherExecuteTool - ITool adapter for the real Open-Meteo weather tool.
 */
export class WeatherExecuteTool implements ITool {
  readonly name = 'weather';
  readonly description =
    'Current weather and forecast for a city via Open-Meteo (no API key). Use for weather/météo/forecast questions.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getWeather().getWeather(
      input.location as string,
      input.days as number | undefined,
      input.units as 'metric' | 'imperial' | undefined,
    );
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: "City name as the user said it (e.g. 'Paris', 'La Roche-sur-Yon')",
          },
          days: {
            type: 'number',
            description: 'Forecast days 1-7 (default 1 = today only)',
            default: 1,
          },
          units: {
            type: 'string',
            description: "Units: 'metric' (default, °C) or 'imperial' (°F)",
          },
        },
        required: ['location'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.location !== 'string' || data.location.trim() === '') {
      return { valid: false, errors: ['location must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['weather', 'météo', 'meteo', 'forecast', 'prévisions', 'température', 'temperature'],
      priority: 8,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// StockQuoteExecuteTool
// ============================================================================

// Lazy singleton — same lifecycle pattern as the weather instance above.
let stockInstance: StockQuoteTool | null = null;
function getStock(): StockQuoteTool {
  if (!stockInstance) stockInstance = new StockQuoteTool();
  return stockInstance;
}

/**
 * StockQuoteExecuteTool - ITool adapter for the real stock/market quote tool.
 * Emits a `data` payload of shape StockWidgetData so the curated stock widget
 * renders inline.
 */
export class StockQuoteExecuteTool implements ITool {
  readonly name = 'stock_quote';
  readonly description =
    'Real stock/index market quote via Yahoo Finance (free, no API key), Stooq fallback. Use for stock price / cours de bourse / market index questions. Symbol e.g. AAPL, MC.PA (LVMH), ^FCHI (CAC 40).';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getStock().getQuote(input.symbol as string);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description:
              "Ticker symbol. US stocks plain (e.g. 'AAPL', 'TSLA'); other exchanges suffixed (e.g. 'MC.PA' for LVMH, 'BMW.DE'); indices prefixed with ^ (e.g. '^FCHI' CAC 40, '^GSPC' S&P 500).",
          },
        },
        required: ['symbol'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.symbol !== 'string' || data.symbol.trim() === '') {
      return { valid: false, errors: ['symbol must be a non-empty string'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['stock', 'bourse', 'cours', 'action', 'quote', 'ticker', 'market', 'index', 'indice', 'nasdaq', 'cac', 'cotation'],
      priority: 8,
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
    new CommunitySearchExecuteTool(),
    new WebFetchTool(),
    new WebScrapeExecuteTool(),
    new WeatherExecuteTool(),
    new StockQuoteExecuteTool(),
  ];
}
