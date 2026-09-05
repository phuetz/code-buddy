/**
 * GK14 — parallel `searchStructured` calls on one WebSearchTool must not mix
 * provider attempts. Deep Research fans out ~12 queries; a shared
 * `lastStructuredAttempts` array reset+pushed without isolation made each
 * query's "no usable URLs" error list every in-flight provider, producing a
 * 17 KB failure report of duplicated CAPTCHA lines.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WebSearchTool, type WebSearchHttpGet } from '../../src/tools/web-search.js';

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
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('searchStructured — parallel calls isolate provider attempts', () => {
  it('does not leak the other query into getLastStructuredAttempts', async () => {
    process.env.SEARXNG_URL = 'http://127.0.0.1:46714';
    let started = 0;
    let releaseOverlap: () => void = () => undefined;
    const overlap = new Promise<void>((resolve) => {
      releaseOverlap = resolve;
    });
    const httpGet: WebSearchHttpGet = async (url) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      started += 1;
      if (started >= 2) releaseOverlap();
      await overlap;
      throw new Error(`searx-fail-${q}`);
    };
    const tool = new WebSearchTool({ httpGet });

    const run = async (q: string): Promise<string> => {
      const { results, attempts } = await tool.searchStructuredTraced(q, {
        provider: 'searxng',
        maxResults: 3,
      });
      expect(results).toEqual([]);
      return attempts.map((a) => a.error ?? '').join('|');
    };

    const [alpha, beta] = await Promise.all([run('alpha-unique'), run('beta-unique')]);

    expect(alpha).toContain('searx-fail-alpha-unique');
    expect(alpha).not.toContain('beta-unique');
    expect(beta).toContain('searx-fail-beta-unique');
    expect(beta).not.toContain('alpha-unique');
  });
});
