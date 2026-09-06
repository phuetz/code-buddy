/**
 * GK2 — searchStructured must not treat empty-URL hits as success.
 *
 * A provider that returns title/snippet with `url: ''` used to stop the
 * fallback chain. Deep Research then dropped every hit (`if (!url) continue`)
 * and synthesized a 0-source report.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = axios as unknown as { get: Mock; post: Mock };

import { WebSearchTool, type WebSearchHttpGet } from '../../src/tools/web-search.js';

const DDG_HTML = `
  <div class="result">
    <a class="result__a" href="https://ddg-fallback.example/page">DDG Fallback Result</a>
    <a class="result__snippet">Came from DuckDuckGo</a>
  </div></div>
`;

const ENV_KEYS = [
  'SEARXNG_URL',
  'BRAVE_API_KEY',
  'SERPER_API_KEY',
  'PERPLEXITY_API_KEY',
  'OPENROUTER_API_KEY',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('searchStructured — empty-URL hits do not stop the chain', () => {
  it('falls through to the next provider when Perplexity returns 5 citation-less answers', async () => {
    // Perplexity with zero citations synthesizes `{ url: '' }` placeholders.
    // Those used to count as a successful structured result and abort the chain
    // before DuckDuckGo — Deep Research then dropped every hit.
    process.env.PERPLEXITY_API_KEY = 'pplx-test-key';
    mockedAxios.post.mockResolvedValue({
      data: {
        choices: [{ message: { content: 'synthetic answer with no citations' } }],
        citations: [],
      },
    });
    mockedAxios.get.mockResolvedValue({ data: DDG_HTML });
    const tool = new WebSearchTool({ httpGet: vi.fn() as unknown as WebSearchHttpGet });

    const hits = await tool.searchStructured('anything', { maxResults: 5 });

    expect(mockedAxios.post).toHaveBeenCalled();
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.url).toContain('ddg-fallback');
    expect(hits.every((h) => typeof h.url === 'string' && h.url.trim().length > 0)).toBe(true);
  });
});
