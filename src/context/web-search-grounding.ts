/**
 * Web Search Grounding
 *
 * Provides real-time web search capabilities for AI responses:
 * - Search engine integration (DuckDuckGo, Brave, Google)
 * - Result extraction and summarization
 * - Source citation
 * - Knowledge grounding
 *
 * Inspired by Gemini CLI's web search grounding feature.
 */

import { EventEmitter } from 'events';
import * as https from 'https';
import * as http from 'http';

// ============================================================================
// Types
// ============================================================================

export type SearchEngine = 'duckduckgo' | 'brave' | 'google' | 'searx' | 'auto';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  relevanceScore?: number;
}

export interface SearchResponse {
  query: string;
  engine: SearchEngine;
  results: SearchResult[];
  totalResults?: number;
  searchTime: number;
  timestamp: number;
}

export interface WebSearchConfig {
  /** Preferred search engine */
  engine: SearchEngine;
  /** Maximum results per search */
  maxResults: number;
  /** Include source citations */
  includeCitations: boolean;
  /** Safe search level */
  safeSearch: 'off' | 'moderate' | 'strict';
  /** API keys */
  apiKeys: {
    brave?: string;
    google?: string;
    googleCx?: string;
    searxInstance?: string;
  };
  /** Cache settings */
  cache: {
    enabled: boolean;
    ttl: number; // milliseconds
  };
  /** Timeout in ms */
  timeout: number;
}

export interface GroundingContext {
  query: string;
  results: SearchResult[];
  summary: string;
  citations: string[];
  confidence: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: WebSearchConfig = {
  engine: 'duckduckgo',
  maxResults: 5,
  includeCitations: true,
  safeSearch: 'moderate',
  apiKeys: {},
  cache: {
    enabled: true,
    ttl: 5 * 60 * 1000, // 5 minutes
  },
  timeout: 10000,
};

// ============================================================================
// Search Cache
// ============================================================================

interface CacheEntry {
  response: SearchResponse;
  expiresAt: number;
}

class SearchCache {
  private cache: Map<string, CacheEntry> = new Map();

  set(key: string, response: SearchResponse, ttl: number): void {
    this.cache.set(key, {
      response,
      expiresAt: Date.now() + ttl,
    });
  }

  get(key: string): SearchResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  clear(): void {
    this.cache.clear();
  }

  private generateKey(query: string, engine: SearchEngine): string {
    return `${engine}:${query.toLowerCase().trim()}`;
  }
}

// ============================================================================
// Web Search Manager
// ============================================================================

export class WebSearchManager extends EventEmitter {
  private config: WebSearchConfig;
  private cache: SearchCache;

  constructor(config: Partial<WebSearchConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = new SearchCache();
  }

  /**
   * Perform web search
   */
  async search(query: string, options: Partial<{
    engine: SearchEngine;
    maxResults: number;
  }> = {}): Promise<SearchResponse> {
    const engine = options.engine || this.config.engine;
    const maxResults = options.maxResults || this.config.maxResults;

    // Check cache
    const cacheKey = `${engine}:${query}`;
    if (this.config.cache.enabled) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.emit('cache:hit', { query, engine });
        return cached;
      }
    }

    const startTime = Date.now();
    let results: SearchResult[];

    this.emit('search:start', { query, engine });

    try {
      switch (engine) {
        case 'duckduckgo':
          results = await this.searchDuckDuckGo(query, maxResults);
          break;

        case 'brave':
          results = await this.searchBrave(query, maxResults);
          break;

        case 'google':
          results = await this.searchGoogle(query, maxResults);
          break;

        case 'searx':
          results = await this.searchSearx(query, maxResults);
          break;

        case 'auto':
        default:
          // Try in order of preference
          results = await this.searchWithFallback(query, maxResults);
          break;
      }
    } catch (error) {
      this.emit('search:error', { query, engine, error });
      // Return empty results instead of throwing
      results = [];
    }

    // Ensure results is always an array
    if (!Array.isArray(results)) {
      results = [];
    }

    const response: SearchResponse = {
      query,
      engine,
      results,
      searchTime: Date.now() - startTime,
      timestamp: Date.now(),
    };

    // Cache results
    if (this.config.cache.enabled) {
      this.cache.set(cacheKey, response, this.config.cache.ttl);
    }

    this.emit('search:complete', response);
    return response;
  }

  /**
   * Get grounding context for a query
   */
  async getGroundingContext(query: string): Promise<GroundingContext> {
    const response = await this.search(query);

    // Generate summary from results
    const summary = this.generateSummary(response.results);

    // Extract citations
    const citations = response.results.map((r, i) =>
      `[${i + 1}] ${r.title} - ${r.url}`
    );

    // Calculate confidence based on result quality
    const confidence = this.calculateConfidence(response.results);

    return {
      query,
      results: response.results,
      summary,
      citations,
      confidence,
    };
  }

  /**
   * Search and format for AI context
   */
  async searchForContext(query: string): Promise<string> {
    try {
      const context = await this.getGroundingContext(query);

      const lines: string[] = [
        `Web Search Results for: "${query}"`,
        '',
      ];

      for (let i = 0; i < context.results.length; i++) {
        const r = context.results[i];
        lines.push(`[${i + 1}] ${r.title}`);
        lines.push(`    URL: ${r.url}`);
        lines.push(`    ${r.snippet}`);
        lines.push('');
      }

      if (context.citations.length > 0) {
        lines.push('Sources:');
        lines.push(...context.citations.map(c => `  ${c}`));
      }

      return lines.join('\n');
    } catch (error) {
      return `Web search failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Clear search cache
   */
  clearCache(): void {
    this.cache.clear();
    this.emit('cache:cleared');
  }

  /**
   * Format search status
   */
  formatStatus(): string {
    const lines: string[] = [
      '🔍 Web Search Grounding',
      '═'.repeat(40),
      '',
      `Engine: ${this.config.engine}`,
      `Max Results: ${this.config.maxResults}`,
      `Safe Search: ${this.config.safeSearch}`,
      `Cache: ${this.config.cache.enabled ? 'Enabled' : 'Disabled'}`,
      '',
      'Available Engines:',
      '  • duckduckgo (default, no API key needed)',
    ];

    if (this.config.apiKeys.brave) {
      lines.push('  • brave (API key configured)');
    } else {
      lines.push('  • brave (needs API key)');
    }

    if (this.config.apiKeys.google && this.config.apiKeys.googleCx) {
      lines.push('  • google (API key configured)');
    } else {
      lines.push('  • google (needs API key)');
    }

    if (this.config.apiKeys.searxInstance) {
      lines.push(`  • searx (${this.config.apiKeys.searxInstance})`);
    } else {
      lines.push('  • searx (needs instance URL)');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods - Search Engines
  // ============================================================================

  private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
    // DuckDuckGo HTML API (no API key needed)
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    try {
      const html = await this.httpGet(url);
      return this.parseDuckDuckGoResults(html, maxResults);
    } catch {
      // Fallback to lite version
      const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`;
      const html = await this.httpGet(liteUrl);
      return this.parseDuckDuckGoResults(html, maxResults);
    }
  }

  private parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Parse result blocks
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const [, url, title, snippet] = match;

      // Clean up URL (DuckDuckGo redirects)
      const cleanUrl = this.cleanDuckDuckGoUrl(url);

      results.push({
        title: this.decodeHtml(title.trim()),
        url: cleanUrl,
        snippet: this.decodeHtml(snippet.trim()),
        source: 'duckduckgo',
      });
    }

    // Fallback parsing for different HTML structure
    if (results.length === 0) {
      const altRegex = /<td[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*class="result-snippet"[^>]*>([^<]+)<\/td>/gi;

      while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
        const [, url, title, snippet] = match;

        results.push({
          title: this.decodeHtml(title.trim()),
          url: this.cleanDuckDuckGoUrl(url),
          snippet: this.decodeHtml(snippet.trim()),
          source: 'duckduckgo',
        });
      }
    }

    return results;
  }

  private cleanDuckDuckGoUrl(url: string): string {
    // DuckDuckGo wraps URLs in a redirect
    const match = url.match(/uddg=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    return url;
  }

  private async searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
    if (!this.config.apiKeys.brave) {
      throw new Error('Brave Search API key not configured');
    }

    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`;

    const response = await this.httpGet(url, {
      'X-Subscription-Token': this.config.apiKeys.brave,
    });

    const data = JSON.parse(response);

    return (data.web?.results || []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      source: 'brave',
      publishedDate: r.page_age,
    }));
  }

  private async searchGoogle(query: string, maxResults: number): Promise<SearchResult[]> {
    if (!this.config.apiKeys.google || !this.config.apiKeys.googleCx) {
      throw new Error('Google Search API credentials not configured');
    }

    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${this.config.apiKeys.google}&cx=${this.config.apiKeys.googleCx}&q=${encodedQuery}&num=${maxResults}`;

    const response = await this.httpGet(url);
    const data = JSON.parse(response);

    return (data.items || []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      source: 'google',
    }));
  }

  private async searchSearx(query: string, maxResults: number): Promise<SearchResult[]> {
    if (!this.config.apiKeys.searxInstance) {
      throw new Error('SearX instance URL not configured');
    }

    const encodedQuery = encodeURIComponent(query);
    const url = `${this.config.apiKeys.searxInstance}/search?q=${encodedQuery}&format=json`;

    const response = await this.httpGet(url);
    const data = JSON.parse(response);

    return (data.results || []).slice(0, maxResults).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      source: 'searx',
      publishedDate: r.publishedDate,
    }));
  }

  private async searchWithFallback(query: string, maxResults: number): Promise<SearchResult[]> {
    // Try engines in order of preference
    const engines: Array<{ name: SearchEngine; condition: boolean }> = [
      { name: 'brave', condition: !!this.config.apiKeys.brave },
      { name: 'google', condition: !!(this.config.apiKeys.google && this.config.apiKeys.googleCx) },
      { name: 'searx', condition: !!this.config.apiKeys.searxInstance },
      { name: 'duckduckgo', condition: true },
    ];

    for (const { name, condition } of engines) {
      if (!condition) continue;

      try {
        const results = await this.searchByEngine(name, query, maxResults);
        if (results.length > 0) {
          return results;
        }
      } catch {
        // Try next engine
        continue;
      }
    }

    throw new Error('All search engines failed');
  }

  private async searchByEngine(engine: SearchEngine, query: string, maxResults: number): Promise<SearchResult[]> {
    switch (engine) {
      case 'duckduckgo':
        return this.searchDuckDuckGo(query, maxResults);
      case 'brave':
        return this.searchBrave(query, maxResults);
      case 'google':
        return this.searchGoogle(query, maxResults);
      case 'searx':
        return this.searchSearx(query, maxResults);
      default:
        throw new Error(`Unknown engine: ${engine}`);
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private generateSummary(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No relevant results found.';
    }

    // Combine snippets for summary
    const snippets = results.slice(0, 3).map(r => r.snippet).filter(Boolean);
    return snippets.join(' ').slice(0, 500);
  }

  private calculateConfidence(results: SearchResult[]): number {
    if (results.length === 0) return 0;

    // Base confidence on number and quality of results
    let confidence = Math.min(results.length / 5, 1) * 0.5;

    // Boost for diverse sources
    const sources = new Set(results.map(r => new URL(r.url).hostname));
    confidence += Math.min(sources.size / 3, 1) * 0.3;

    // Boost for snippet quality
    const avgSnippetLength = results.reduce((sum, r) => sum + (r.snippet?.length || 0), 0) / results.length;
    confidence += Math.min(avgSnippetLength / 200, 1) * 0.2;

    return Math.min(confidence, 1);
  }

  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/<[^>]+>/g, '');
  }

  private httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GrokCLI/1.0)',
          'Accept': 'text/html,application/json',
          ...headers,
        },
        timeout: this.config.timeout,
      };

      const req = client.request(options, (res) => {
        let data = '';

        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.httpGet(res.headers.location, headers).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          resolve(data);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let managerInstance: WebSearchManager | null = null;

export function getWebSearchManager(config?: Partial<WebSearchConfig>): WebSearchManager {
  if (!managerInstance) {
    managerInstance = new WebSearchManager(config);
  }
  return managerInstance;
}

export function resetWebSearchManager(): void {
  if (managerInstance) {
    managerInstance.clearCache();
  }
  managerInstance = null;
}
