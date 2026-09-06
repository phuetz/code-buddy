/**
 * Local SearXNG discovery for Deep Research — fail-open, never starts a service.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { maybeDiscoverLocalSearxng } from '../../../src/commands/research/discover-searxng.js';

describe('maybeDiscoverLocalSearxng', () => {
  const original = process.env.SEARXNG_URL;
  const originalFlag = process.env.CODEBUDDY_SEARXNG_AUTODISCOVER;

  afterEach(() => {
    if (original === undefined) delete process.env.SEARXNG_URL;
    else process.env.SEARXNG_URL = original;
    if (originalFlag === undefined) delete process.env.CODEBUDDY_SEARXNG_AUTODISCOVER;
    else process.env.CODEBUDDY_SEARXNG_AUTODISCOVER = originalFlag;
  });

  it('returns the existing SEARXNG_URL without probing', async () => {
    const env: NodeJS.ProcessEnv = { SEARXNG_URL: 'http://127.0.0.1:9999/' };
    const fetchImpl = async () => {
      throw new Error('must not probe');
    };
    const found = await maybeDiscoverLocalSearxng({
      env,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(found).toBe('http://127.0.0.1:9999');
  });

  it('is disabled by CODEBUDDY_SEARXNG_AUTODISCOVER=false', async () => {
    const env: NodeJS.ProcessEnv = { CODEBUDDY_SEARXNG_AUTODISCOVER: 'false' };
    const found = await maybeDiscoverLocalSearxng({
      env,
      fetchImpl: (async () => {
        throw new Error('must not probe');
      }) as unknown as typeof fetch,
    });
    expect(found).toBeUndefined();
  });

  it('sets SEARXNG_URL when a loopback instance answers SearXNG JSON', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/search?');
      expect(url).toContain('format=json');
      return {
        ok: true,
        json: async () => ({ results: [] }),
      } as Response;
    };
    const found = await maybeDiscoverLocalSearxng({ env, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(found).toBe('http://127.0.0.1:8888');
    expect(env.SEARXNG_URL).toBe('http://127.0.0.1:8888');
  });

  it('fail-open: a dead probe leaves SEARXNG_URL unset', async () => {
    const env: NodeJS.ProcessEnv = {};
    const found = await maybeDiscoverLocalSearxng({
      env,
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    expect(found).toBeUndefined();
    expect(env.SEARXNG_URL).toBeUndefined();
  });
});
