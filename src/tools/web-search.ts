import axios from 'axios';
import { ToolResult, getErrorMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { assertSafeUrl } from '../security/ssrf-guard.js';

// ============================================================================
// Types
// ============================================================================

export type SearchProvider = 'brave' | 'perplexity' | 'serper' | 'duckduckgo' | 'brave-mcp';

/**
 * Web search mode (Codex-inspired prompt injection mitigation).
 * - 'disabled' — no web search allowed
 * - 'cached'   — use cached/indexed results only (reduced prompt injection risk)
 * - 'live'     — full live browsing (default)
 */
export type WebSearchMode = 'disabled' | 'cached' | 'live';

export interface WebSearchOptions {
  maxResults?: number;
  safeSearch?: boolean;
  /** 2-letter country code for region-specific results (e.g., 'DE', 'US'). */
  country?: string;
  /** ISO language code for search results (e.g., 'de', 'en', 'fr'). */
  search_lang?: string;
  /** ISO language code for UI elements. */
  ui_lang?: string;
  /**
   * Filter results by discovery time (Brave only).
   * Values: 'pd' (past 24h), 'pw' (past week), 'pm' (past month),
   * 'py' (past year), or date range 'YYYY-MM-DDtoYYYY-MM-DD'.
   */
  freshness?: string;
  /** Force a specific provider instead of auto-fallback. */
  provider?: SearchProvider;
  /**
   * Override the global search mode for this call.
   * Useful when forcing live mode in YOLO/full-auto contexts.
   */
  mode?: WebSearchMode;
}

export interface WebSearchDomainPolicy {
  /** Only return results from these domains (exact or *.domain.com) */
  allowedDomains?: string[];
  /** Never return results from these domains */
  blockedDomains?: string[];
}

// Global search mode and domain policy (configurable via TOML / runtime)
let _globalSearchMode: WebSearchMode = 'live';
let _domainPolicy: WebSearchDomainPolicy = {};

/**
 * Set the global web search mode.
 * Called at startup from config.toml or agent autonomy settings.
 */
export function setWebSearchMode(mode: WebSearchMode): void {
  _globalSearchMode = mode;
}

export function getWebSearchMode(): WebSearchMode {
  return _globalSearchMode;
}

export function setWebSearchDomainPolicy(policy: WebSearchDomainPolicy): void {
  _domainPolicy = policy;
}

function isDomainAllowed(url: string): boolean {
  if (!_domainPolicy.allowedDomains?.length && !_domainPolicy.blockedDomains?.length) return true;
  let hostname = '';
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return false; }

  if (_domainPolicy.blockedDomains?.length) {
    if (_domainPolicy.blockedDomains.some(d => hostname === d || hostname.endsWith('.' + d))) return false;
  }
  if (_domainPolicy.allowedDomains?.length) {
    return _domainPolicy.allowedDomains.some(d =>
      d.startsWith('*.') ? hostname.endsWith(d.slice(1)) : hostname === d
    );
  }
  return true;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Hostname extracted from URL */
  siteName?: string;
  /** Age/published info (Brave only) */
  published?: string;
}

export interface PerplexitySearchResult {
  content: string;
  citations: string[];
  model: string;
}

// ============================================================================
// Serper API types
// ============================================================================

interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
  answerBox?: {
    title?: string;
    answer?: string;
    snippet?: string;
  };
  knowledgeGraph?: {
    title?: string;
    description?: string;
  };
}

// ============================================================================
// Brave API types
// ============================================================================

interface BraveSearchResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveSearchResult[];
  };
}

// ============================================================================
// Perplexity API types
// ============================================================================

interface PerplexityResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  citations?: string[];
}

// ============================================================================
// Constants
// ============================================================================

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_PERPLEXITY_BASE_URL = 'https://openrouter.ai/api/v1';
const PERPLEXITY_DIRECT_BASE_URL = 'https://api.perplexity.ai';
const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro';
const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 20000;

const BRAVE_FRESHNESS_SHORTCUTS = new Set(['pd', 'pw', 'pm', 'py']);
const BRAVE_FRESHNESS_RANGE = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/;

// ============================================================================
// Helpers
// ============================================================================

function normalizeFreshness(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (BRAVE_FRESHNESS_SHORTCUTS.has(trimmed)) return trimmed;
  const match = value.trim().match(BRAVE_FRESHNESS_RANGE);
  if (match) return `${match[1]}to${match[2]}`;
  return undefined;
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function resolvePerplexityBaseUrl(apiKey?: string): string {
  if (!apiKey) return DEFAULT_PERPLEXITY_BASE_URL;
  if (apiKey.startsWith('pplx-')) return PERPLEXITY_DIRECT_BASE_URL;
  return DEFAULT_PERPLEXITY_BASE_URL; // OpenRouter key or unknown
}

/**
 * Web Search Tool — OpenClaw-aligned provider chain
 *
 * Provider resolution (auto mode):
 *   Brave MCP → Brave API → Perplexity → Serper → DuckDuckGo
 *
 * Supports country, search_lang, ui_lang, freshness (Brave), Perplexity AI search.
 */
export class WebSearchTool {
  private cache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map();
  private perplexityCache: Map<string, { result: PerplexitySearchResult; timestamp: number }> = new Map();
  private cacheTTL = 15 * 60 * 1000; // 15 minutes

  // API keys resolved once at construction
  private serperApiKey: string | undefined;
  private braveApiKey: string | undefined;
  private perplexityApiKey: string | undefined;

  constructor() {
    this.serperApiKey = process.env.SERPER_API_KEY;
    this.braveApiKey = process.env.BRAVE_API_KEY;
    this.perplexityApiKey = process.env.PERPLEXITY_API_KEY || process.env.OPENROUTER_API_KEY;

    const providers: string[] = [];
    if (this.braveApiKey) providers.push('brave');
    if (this.perplexityApiKey) providers.push('perplexity');
    if (this.serperApiKey) providers.push('serper');
    providers.push('duckduckgo');
    logger.debug('Web search providers available', { providers });
  }

  // ============================================================================
  // Main search entry point
  // ============================================================================

  // Cache failed queries to avoid repeated timeouts (TTL: 2 minutes)
  private failedQueries = new Map<string, number>();
  private static readonly FAILED_QUERY_TTL = 120000;

  async search(query: string, options: WebSearchOptions = {}): Promise<ToolResult> {
    // Mode check (Codex-inspired prompt injection mitigation)
    const effectiveMode = options.mode ?? _globalSearchMode;
    if (effectiveMode === 'disabled') {
      return { success: false, error: 'Web search is disabled by configuration (mode: disabled).' };
    }
    // 'cached' mode: only use providers that return indexed/cached results (Brave index, Perplexity)
    if (effectiveMode === 'cached' && !options.provider) {
      options = { ...options, provider: this.braveApiKey ? 'brave' : this.perplexityApiKey ? 'perplexity' : 'duckduckgo' };
      logger.debug('WebSearch: cached mode — using indexed provider', { provider: options.provider });
    }

    const { maxResults = DEFAULT_SEARCH_COUNT } = options;
    const count = Math.max(1, Math.min(MAX_SEARCH_COUNT, maxResults));

    try {
      // Check cache
      const cacheKey = this.buildCacheKey(query, count, options);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return { success: true, output: this.formatResults(cached.results, query) };
      }

      // Check if this query recently failed (avoid wasting 20s+ on repeated timeouts)
      const failedAt = this.failedQueries.get(query);
      if (failedAt && Date.now() - failedAt < WebSearchTool.FAILED_QUERY_TTL) {
        return { success: false, error: 'Web search is unavailable (all providers failed recently). Do NOT retry — proceed using your own knowledge to complete the task.' };
      }

      // If forced provider
      if (options.provider) {
        return await this.searchWithProvider(options.provider, query, count, options, cacheKey);
      }

      // Auto fallback chain: Brave MCP → Brave API → Perplexity → Serper → DuckDuckGo
      const chain = this.buildProviderChain();
      let lastError: string | undefined;
      let emptyResult: ToolResult | undefined;

      for (const provider of chain) {
        try {
          const result = await this.searchWithProvider(provider, query, count, options, cacheKey);
          // If the provider returned "no results", continue to next provider instead of stopping
          if (result.success && result.output?.startsWith('No results found')) {
            emptyResult = result;
            logger.debug(`Search provider ${provider} returned 0 results, trying next`);
            continue;
          }
          return result;
        } catch (error) {
          lastError = getErrorMessage(error);
          logger.debug(`Search provider ${provider} failed, trying next`, { error: lastError });
        }
      }

      // If any provider returned an empty-but-successful result, prefer it over error
      // (e.g. brave-mcp always throws when not connected, but duckduckgo gave 0 results)
      if (emptyResult) {
        return emptyResult;
      }

      // Cache the failure to prevent repeated timeouts
      this.failedQueries.set(query, Date.now());

      // Surface CAPTCHA / API key hint prominently
      const isCaptcha = lastError?.includes('CAPTCHA') || lastError?.includes('bot detection');
      const hint = isCaptcha
        ? lastError!
        : `All search providers failed. Last error: ${lastError}. Add BRAVE_API_KEY or SERPER_API_KEY for reliable search.`;
      return { success: false, error: `${hint} Do NOT retry — proceed using your own knowledge.` };
    } catch (error) {
      return { success: false, error: `Web search failed: ${getErrorMessage(error)}` };
    }
  }

  /**
   * Perplexity AI search — returns synthesized answer with citations
   */
  async searchPerplexity(query: string, options: WebSearchOptions = {}): Promise<ToolResult> {
    if (!this.perplexityApiKey) {
      return {
        success: false,
        error: 'Perplexity search requires PERPLEXITY_API_KEY or OPENROUTER_API_KEY.',
      };
    }

    const cacheKey = `perplexity:${query}`;
    const cached = this.perplexityCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return { success: true, output: this.formatPerplexityResult(cached.result, query) };
    }

    const result = await this.runPerplexitySearch(query, options);

    this.perplexityCache.set(cacheKey, { result, timestamp: Date.now() });
    return { success: true, output: this.formatPerplexityResult(result, query) };
  }

  // ============================================================================
  // Provider chain
  // ============================================================================

  private buildProviderChain(): SearchProvider[] {
    const chain: SearchProvider[] = [];
    // Brave MCP is checked dynamically
    chain.push('brave-mcp');
    if (this.braveApiKey) chain.push('brave');
    if (this.perplexityApiKey) chain.push('perplexity');
    if (this.serperApiKey) chain.push('serper');
    chain.push('duckduckgo');
    return chain;
  }

  private async searchWithProvider(
    provider: SearchProvider,
    query: string,
    count: number,
    options: WebSearchOptions,
    cacheKey: string,
  ): Promise<ToolResult> {
    let results: SearchResult[];

    switch (provider) {
      case 'brave-mcp':
        if (!(await this.isBraveMCPAvailable())) {
          throw new Error('Brave MCP not connected');
        }
        results = await this.searchViaBraveMCP(query, count);
        break;
      case 'brave':
        results = await this.searchBraveAPI(query, count, options);
        break;
      case 'perplexity': {
        const pResult = await this.runPerplexitySearch(query, options);
        // Convert perplexity to SearchResult[] for caching/formatting uniformity
        results = pResult.citations.map((url, i) => ({
          title: `Citation ${i + 1}`,
          url,
          snippet: i === 0 ? pResult.content.slice(0, 300) : '',
          siteName: resolveSiteName(url),
        }));
        if (results.length === 0) {
          results = [{ title: 'Perplexity Answer', url: '', snippet: pResult.content }];
        }
        break;
      }
      case 'serper':
        results = await this.searchSerper(query, count);
        break;
      case 'duckduckgo':
        results = await this.searchDuckDuckGo(query, count);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    if (results.length === 0) {
      return { success: true, output: `No results found for: "${query}"` };
    }

    this.cache.set(cacheKey, { results, timestamp: Date.now() });
    return { success: true, output: this.formatResults(results, query) };
  }

  private buildCacheKey(query: string, count: number, options: WebSearchOptions): string {
    const parts = [
      options.provider || 'auto',
      query,
      count,
      options.country || 'default',
      options.search_lang || 'default',
      options.freshness || 'default',
    ];
    return parts.join(':');
  }

  // ============================================================================
  // Brave MCP
  // ============================================================================

  private async isBraveMCPAvailable(): Promise<boolean> {
    try {
      const { getMCPManager } = await import('../codebuddy/tools.js');
      const manager = getMCPManager();
      return manager.getServers().includes('brave-search');
    } catch {
      return false;
    }
  }

  private async searchViaBraveMCP(query: string, maxResults: number): Promise<SearchResult[]> {
    const { getMCPManager } = await import('../codebuddy/tools.js');
    const manager = getMCPManager();

    const result = await manager.callTool('mcp__brave-search__brave_web_search', {
      query,
      count: maxResults,
    });

    const results: SearchResult[] = [];
    if (result.content) {
      for (const item of result.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          try {
            const parsed = JSON.parse(item.text);
            const webResults = parsed.web?.results || parsed.results || [];
            for (const r of webResults.slice(0, maxResults)) {
              results.push({
                title: r.title || '',
                url: r.url || '',
                snippet: r.description || r.snippet || '',
                siteName: resolveSiteName(r.url),
              });
            }
          } catch {
            results.push({ title: 'Brave Search Result', url: '', snippet: item.text });
          }
        }
      }
    }

    logger.debug('Brave MCP search completed', { query, resultCount: results.length });
    return results;
  }

  // ============================================================================
  // Brave Direct API (OpenClaw-aligned)
  // ============================================================================

  private async searchBraveAPI(
    query: string,
    count: number,
    options: WebSearchOptions,
  ): Promise<SearchResult[]> {
    const url = new URL(BRAVE_SEARCH_ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    if (options.country) url.searchParams.set('country', options.country);
    if (options.search_lang) url.searchParams.set('search_lang', options.search_lang);
    if (options.ui_lang) url.searchParams.set('ui_lang', options.ui_lang);

    const freshness = normalizeFreshness(options.freshness);
    if (freshness) url.searchParams.set('freshness', freshness);

    const response = await axios.get<BraveSearchResponse>(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': this.braveApiKey!,
      },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    const webResults = response.data.web?.results || [];
    const results: SearchResult[] = webResults.map((entry) => ({
      title: entry.title || '',
      url: entry.url || '',
      snippet: entry.description || '',
      siteName: resolveSiteName(entry.url),
      published: entry.age || undefined,
    }));

    logger.debug('Brave API search completed', { query, resultCount: results.length });
    return results;
  }

  // ============================================================================
  // Perplexity (OpenClaw-aligned: direct or via OpenRouter)
  // ============================================================================

  private async runPerplexitySearch(
    query: string,
    _options: WebSearchOptions,
  ): Promise<PerplexitySearchResult> {
    const apiKey = this.perplexityApiKey!;
    const baseUrl = resolvePerplexityBaseUrl(apiKey);
    const model = process.env.PERPLEXITY_MODEL || DEFAULT_PERPLEXITY_MODEL;

    const endpoint = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const response = await axios.post<PerplexityResponse>(
      endpoint,
      {
        model,
        messages: [{ role: 'user', content: query }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/code-buddy',
          'X-Title': 'Code Buddy Web Search',
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
    );

    const content = response.data.choices?.[0]?.message?.content ?? 'No response';
    const citations = response.data.citations ?? [];

    logger.debug('Perplexity search completed', { query, model, citationCount: citations.length });
    return { content, citations, model };
  }

  // ============================================================================
  // Serper (Google Search)
  // ============================================================================

  private async searchSerper(query: string, maxResults: number): Promise<SearchResult[]> {
    const response = await axios.post<SerperResponse>(
      'https://google.serper.dev/search',
      { q: query, num: maxResults },
      {
        headers: {
          'X-API-KEY': this.serperApiKey!,
          'Content-Type': 'application/json',
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
    );

    const results: SearchResult[] = [];

    if (response.data.answerBox?.answer) {
      results.push({
        title: response.data.answerBox.title || 'Answer',
        url: '',
        snippet: response.data.answerBox.answer,
      });
    }

    if (response.data.knowledgeGraph?.description) {
      results.push({
        title: response.data.knowledgeGraph.title || 'Knowledge',
        url: '',
        snippet: response.data.knowledgeGraph.description,
      });
    }

    if (response.data.organic) {
      for (const result of response.data.organic.slice(0, maxResults)) {
        results.push({
          title: result.title,
          url: result.link,
          snippet: result.snippet,
          siteName: resolveSiteName(result.link),
        });
      }
    }

    logger.debug('Serper search completed', { query, resultCount: results.length });
    return results;
  }

  // ============================================================================
  // DuckDuckGo (ultimate fallback, no API key needed)
  // ============================================================================

  private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      timeout: DEFAULT_TIMEOUT_MS,
    });

    // Cap HTML size to prevent regex backtracking on very large pages
    const html = typeof response.data === 'string' && response.data.length > 2_000_000
      ? response.data.slice(0, 2_000_000)
      : response.data;

    // Detect CAPTCHA / bot challenge page — DuckDuckGo returns an anomaly-modal instead of results
    if (typeof html === 'string' && html.includes('anomaly-modal')) {
      throw new Error(
        'DuckDuckGo returned a CAPTCHA challenge (bot detection). ' +
        'Add a BRAVE_API_KEY or SERPER_API_KEY environment variable to enable reliable web search.'
      );
    }
    const results: SearchResult[] = [];

    const resultRegex = /<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    const titleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i;
    const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const resultHtml = match[1];
      const titleMatch = titleRegex.exec(resultHtml);
      const snippetMatch = snippetRegex.exec(resultHtml);

      if (titleMatch) {
        let url = titleMatch[1];
        if (url.includes('uddg=')) {
          const uddgMatch = url.match(/uddg=([^&]+)/);
          if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
        }

        results.push({
          title: this.decodeHtmlEntities(titleMatch[2].trim()),
          url,
          snippet: snippetMatch
            ? this.decodeHtmlEntities(this.stripHtml(snippetMatch[1]).trim())
            : '',
          siteName: resolveSiteName(url),
        });
      }
    }

    // Fallback parsing
    if (results.length === 0) {
      const linkRegex = /<a[^>]*class="[^"]*result__url[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1];
        if (url.includes('uddg=')) {
          const uddgMatch = url.match(/uddg=([^&]+)/);
          if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
        }
        results.push({
          title: this.decodeHtmlEntities(match[2].trim()) || url,
          url,
          snippet: '',
          siteName: resolveSiteName(url),
        });
      }
    }

    return results;
  }

  // ============================================================================
  // Fetch page
  // ============================================================================

  async fetchPage(url: string, _prompt?: string): Promise<ToolResult> {
    // Enforce WebSearchMode — fetchPage should respect the same mode as search()
    if (_globalSearchMode === 'disabled') {
      return { success: false, output: '', error: 'Web access is disabled by configuration' };
    }

    try {
      // SSRF guard: block requests to internal/private network addresses
      const ssrfCheck = await assertSafeUrl(url);
      if (!ssrfCheck.safe) {
        return {
          success: false,
          output: '',
          error: `URL blocked by SSRF guard: ${ssrfCheck.reason}`,
        };
      }

      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CodeBuddyCLI/1.0; +https://github.com/code-buddy)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: DEFAULT_TIMEOUT_MS,
        maxRedirects: 5,
      });

      const html = response.data;
      const text = this.extractTextFromHtml(html);

      const maxLength = 8000;
      const truncatedText = text.length > maxLength
        ? text.substring(0, maxLength) + '\n\n[Content truncated...]'
        : text;

      return {
        success: true,
        output: `Content from ${url}:\n\n${truncatedText}`,
        data: { url, contentLength: text.length },
      };
    } catch (error) {
      return { success: false, error: `Failed to fetch page: ${getErrorMessage(error)}` };
    }
  }

  // ============================================================================
  // Formatting
  // ============================================================================

  private formatPerplexityResult(result: PerplexitySearchResult, query: string): string {
    const lines: string[] = [];
    lines.push(`\nPerplexity Search: "${query}" (${result.model})`);
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(result.content);
    if (result.citations.length > 0) {
      lines.push('');
      lines.push('Citations:');
      result.citations.forEach((url, i) => {
        lines.push(`  ${i + 1}. ${url}`);
      });
    }
    lines.push('');
    lines.push('-'.repeat(50));
    return lines.join('\n');
  }

  private isWeatherQuery(query: string): boolean {
    const weatherKeywords = ['météo', 'meteo', 'weather', 'température', 'temperature', 'forecast', 'prévisions'];
    const q = query.toLowerCase();
    return weatherKeywords.some(kw => q.includes(kw));
  }

  private getWeatherEmoji(text: string): string {
    const t = text.toLowerCase();
    if (t.includes('soleil') || t.includes('sunny') || t.includes('ensoleillé')) return '☀️';
    if (t.includes('pluie') || t.includes('rain') || t.includes('averse')) return '🌧️';
    if (t.includes('nuage') || t.includes('cloud') || t.includes('couvert')) return '☁️';
    if (t.includes('neige') || t.includes('snow')) return '❄️';
    if (t.includes('orage') || t.includes('thunder') || t.includes('storm')) return '⛈️';
    if (t.includes('brouillard') || t.includes('fog')) return '🌫️';
    if (t.includes('vent') || t.includes('wind')) return '💨';
    if (t.includes('éclaircies') || t.includes('partly')) return '⛅';
    return '🌡️';
  }

  private formatWeatherResults(results: SearchResult[], query: string): string {
    const lines: string[] = [];
    const location = query.replace(/météo|meteo|weather/gi, '').trim();
    lines.push(`\n🌍 Météo ${location || 'actuelle'}`);
    lines.push('═'.repeat(40));
    lines.push('');

    for (const result of results.slice(0, 4)) {
      const emoji = this.getWeatherEmoji(result.snippet);
      if (!result.url && result.snippet) {
        lines.push(`${emoji} ${result.title}: ${result.snippet}`);
        lines.push('');
      } else if (result.url) {
        lines.push(`${emoji} **${result.title}**`);
        if (result.snippet) {
          const cleanSnippet = result.snippet.replace(/·/g, '|').replace(/\s+/g, ' ').trim();
          lines.push(`   ${cleanSnippet}`);
        }
        lines.push(`   🔗 ${result.url}`);
        lines.push('');
      }
    }

    lines.push('─'.repeat(40));
    return lines.join('\n');
  }

  private formatResults(results: SearchResult[], query: string): string {
    // Apply domain policy filter (Codex-inspired allowlist/denylist)
    const filtered = results.filter(r => !r.url || isDomainAllowed(r.url));

    if (this.isWeatherQuery(query)) {
      return this.formatWeatherResults(filtered, query);
    }

    results = filtered;
    const lines: string[] = [];
    lines.push(`\n🔍 Résultats pour: "${query}"`);
    lines.push('═'.repeat(50));
    lines.push('');

    // Collect sources for citation block
    const citedSources: Array<{ n: number; title: string; url: string }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const num = i + 1;

      if (!result.url && result.snippet) {
        lines.push(`📌 ${result.title}`);
        lines.push(`   ${result.snippet}`);
      } else {
        // Inline citation marker [n] after the title
        lines.push(`${num}. **${result.title}** [${num}]`);
        if (result.snippet) lines.push(`   ${result.snippet}`);
        if (result.published) lines.push(`   📅 ${result.published}`);
        if (result.url) {
          citedSources.push({ n: num, title: result.title, url: result.url });
        }
      }
      lines.push('');
    }

    // Append sources / references block (Manus AI-style inline citations)
    if (citedSources.length > 0) {
      lines.push('─'.repeat(50));
      lines.push('**Sources:**');
      for (const { n, title, url } of citedSources) {
        lines.push(`[${n}] ${title} — ${url}`);
      }
    } else {
      lines.push('─'.repeat(50));
    }

    return lines.join('\n');
  }

  // ============================================================================
  // HTML helpers
  // ============================================================================

  private extractTextFromHtml(html: string): string {
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    text = text
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ');

    text = this.stripHtml(text);
    text = this.decodeHtmlEntities(text);
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    return text;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
      '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&ndash;': '–',
      '&mdash;': '—', '&hellip;': '…', '&copy;': '©', '&reg;': '®', '&trade;': '™',
    };

    let result = text;
    for (const [entity, char] of Object.entries(entities)) {
      result = result.replace(new RegExp(entity, 'gi'), char);
    }
    result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    return result;
  }

  clearCache(): void {
    this.cache.clear();
    this.perplexityCache.clear();
    this.failedQueries.clear();
  }
}

// ============================================================================
// Exported helpers for testing
// ============================================================================

export const __testing = {
  normalizeFreshness,
  resolveSiteName,
  resolvePerplexityBaseUrl,
} as const;
