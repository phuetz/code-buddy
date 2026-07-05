/**
 * WebSearchTool — real loopback HTTP round-trips (no mocked transport): a local
 * server plays SearXNG and every wire parameter / fail-soft path is exercised.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WebSearchTool, setWebSearchMode } from '../../src/tools/web-search.js';

interface CapturedRequest {
  path: string;
  url: URL;
}

const SEARXNG_OK = {
  results: [
    {
      title: 'Code Buddy Docs',
      url: 'https://example.com/code-buddy',
      content: 'Open-source multi-provider AI coding agent.',
      publishedDate: '2026-07-05',
    },
    {
      title: 'Second result',
      url: 'https://example.org/second',
      content: 'Another parsed result.',
    },
  ],
};

describe('WebSearchTool (real loopback SearXNG)', () => {
  let server: http.Server;
  let baseUrl: string;
  let captured: CapturedRequest[];
  let searchStatus: number;
  let searchBody: unknown;
  let envBefore: NodeJS.ProcessEnv;

  beforeEach(async () => {
    envBefore = { ...process.env };
    delete process.env.BRAVE_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SERPER_API_KEY;
    setWebSearchMode('live');

    captured = [];
    searchStatus = 200;
    searchBody = SEARXNG_OK;
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      captured.push({ path: url.pathname, url });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/search') {
        res.statusCode = searchStatus;
        res.end(JSON.stringify(searchBody));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.SEARXNG_URL = baseUrl;
  });

  afterEach(async () => {
    process.env = envBefore;
    setWebSearchMode('live');
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const tool = (): WebSearchTool => new WebSearchTool();

  it('parses SearXNG results and sends the documented /search query params', async () => {
    const result = await tool().search('code buddy', { maxResults: 2, provider: 'searxng' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Code Buddy Docs');
    expect(result.output).toContain('https://example.com/code-buddy');
    expect(result.output).toContain('Open-source multi-provider AI coding agent.');
    expect(result.output).toContain('Second result');

    expect(captured).toHaveLength(1);
    const request = captured[0]!;
    expect(request.path).toBe('/search');
    expect(request.url.searchParams.get('q')).toBe('code buddy');
    expect(request.url.searchParams.get('format')).toBe('json');
    expect(request.url.searchParams.get('categories')).toBe('general');
    expect(request.url.searchParams.get('pageno')).toBe('1');
    expect(request.url.searchParams.get('safesearch')).toBe('0');
  });

  it('uses the forced provider option even when other providers are configured', async () => {
    process.env.SERPER_API_KEY = 'dummy-serper-key';

    const result = await tool().search('forced local provider', { provider: 'searxng', maxResults: 1 });

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.path).toBe('/search');
    expect(captured[0]!.url.searchParams.get('q')).toBe('forced local provider');
    expect(result.output).toContain('Code Buddy Docs');
    expect(result.output).not.toContain('Second result');
  });

  it('fails soft on SearXNG 500 when the provider is forced', async () => {
    searchStatus = 500;
    searchBody = { error: 'boom' };

    const result = await tool().search('server failure', { provider: 'searxng' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Web search failed');
    expect(captured).toHaveLength(1);
  });

  it('documents empty SearXNG payloads as a successful no-results response', async () => {
    searchBody = { results: [] };

    const result = await tool().search('empty payload', { provider: 'searxng' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('No results found for: "empty payload"');
    expect(captured).toHaveLength(1);
  });

  it('URL-encodes spaces and accents while preserving the decoded q parameter', async () => {
    await tool().search('été à Besançon', { provider: 'searxng', safeSearch: true, search_lang: 'fr' });

    expect(captured).toHaveLength(1);
    const rawUrl = captured[0]!.url.toString();
    expect(rawUrl).toContain('q=%C3%A9t%C3%A9+%C3%A0+Besan%C3%A7on');
    expect(captured[0]!.url.searchParams.get('q')).toBe('été à Besançon');
    expect(captured[0]!.url.searchParams.get('safesearch')).toBe('1');
    expect(captured[0]!.url.searchParams.get('language')).toBe('fr');
  });
});
