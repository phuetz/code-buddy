/**
 * Tests for src/providers/local-model-resolver.ts.
 *
 * The regression guarded here: `CODEBUDDY_PROVIDER=ollama buddy` used to send
 * a stale cloud model id (`grok-code-fast-1`) to the local Ollama server,
 * yielding a cryptic `404 model 'grok-code-fast-1' not found`. The resolver
 * must instead pick a model that is ACTUALLY installed, and — when none is —
 * surface a clear `ollama pull …` hint rather than a 404.
 */

import { describe, it, expect } from 'vitest';
import {
  chooseInstalledOllamaModel,
  ollamaTagsUrl,
  fetchOllamaTags,
  resolveInstalledOllamaModel,
  buildOllamaPullHint,
  DEFAULT_OLLAMA_MODEL,
} from '../../src/providers/local-model-resolver.js';

const INSTALLED = [
  'llama3:latest',
  'devstral-small-2:24b-instruct-2512-q4_K_M',
  'qwen2.5:3b-instruct',
  'gemma4:12b',
];

function fakeFetch(payload: unknown, init: { ok?: boolean; throws?: boolean } = {}): typeof fetch {
  return (async () => {
    if (init.throws) throw new Error('ECONNREFUSED');
    return {
      ok: init.ok ?? true,
      json: async () => payload,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('chooseInstalledOllamaModel', () => {
  it('honors an exact requested tag when installed (case-insensitive)', () => {
    expect(chooseInstalledOllamaModel(INSTALLED, 'qwen2.5:3b-instruct')).toBe('qwen2.5:3b-instruct');
    expect(chooseInstalledOllamaModel(INSTALLED, 'QWEN2.5:3B-INSTRUCT')).toBe('qwen2.5:3b-instruct');
  });

  it('ignores a stale cloud slug and falls back to a coding model', () => {
    // The core regression: grok-code-fast-1 is NOT installed → never returned.
    const chosen = chooseInstalledOllamaModel(INSTALLED, 'grok-code-fast-1');
    expect(chosen).toBe('devstral-small-2:24b-instruct-2512-q4_K_M');
    expect(chosen).not.toBe('grok-code-fast-1');
  });

  it('ignores the advertised default when not installed, prefers a coder model', () => {
    // qwen2.5-coder:7b is the onboarding default but not pulled here.
    expect(chooseInstalledOllamaModel(INSTALLED, DEFAULT_OLLAMA_MODEL)).toBe(
      'devstral-small-2:24b-instruct-2512-q4_K_M',
    );
  });

  it('falls back to the first installed model when no coder model exists', () => {
    expect(chooseInstalledOllamaModel(['llama3:latest', 'gemma4:12b'], 'grok-code-fast-1')).toBe(
      'llama3:latest',
    );
  });

  it('returns null when nothing is installed', () => {
    expect(chooseInstalledOllamaModel([], 'grok-code-fast-1')).toBeNull();
    expect(chooseInstalledOllamaModel(['', '  '])).toBeNull();
  });
});

describe('ollamaTagsUrl', () => {
  it('strips a trailing /v1 and points at /api/tags', () => {
    expect(ollamaTagsUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/api/tags');
    expect(ollamaTagsUrl('http://localhost:11434')).toBe('http://localhost:11434/api/tags');
    expect(ollamaTagsUrl('localhost:11434/v1/')).toBe('http://localhost:11434/api/tags');
  });
});

describe('fetchOllamaTags', () => {
  it('parses model names from an /api/tags response', async () => {
    const fetchImpl = fakeFetch({
      models: [{ name: 'llama3:latest' }, { model: 'devstral-small-2:24b' }],
    });
    expect(await fetchOllamaTags('http://localhost:11434/v1', { fetchImpl })).toEqual([
      'llama3:latest',
      'devstral-small-2:24b',
    ]);
  });

  it('returns null (unreachable) when the fetch throws', async () => {
    const fetchImpl = fakeFetch(null, { throws: true });
    expect(await fetchOllamaTags('http://localhost:11434/v1', { fetchImpl })).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const fetchImpl = fakeFetch({}, { ok: false });
    expect(await fetchOllamaTags('http://localhost:11434/v1', { fetchImpl })).toBeNull();
  });
});

describe('resolveInstalledOllamaModel', () => {
  it('resolves a real installed model instead of the requested cloud slug', async () => {
    const fetchImpl = fakeFetch({ models: INSTALLED.map((name) => ({ name })) });
    const res = await resolveInstalledOllamaModel({
      baseURL: 'http://localhost:11434/v1',
      requested: 'grok-code-fast-1',
      fetchImpl,
    });
    expect(res.reachable).toBe(true);
    expect(res.installedCount).toBe(INSTALLED.length);
    expect(res.model).toBe('devstral-small-2:24b-instruct-2512-q4_K_M');
  });

  it('reports reachable-but-empty (no models installed)', async () => {
    const fetchImpl = fakeFetch({ models: [] });
    const res = await resolveInstalledOllamaModel({
      baseURL: 'http://localhost:11434/v1',
      requested: 'qwen2.5-coder:7b',
      fetchImpl,
    });
    expect(res).toEqual({ model: null, reachable: true, installedCount: 0 });
  });

  it('reports unreachable when the server is down', async () => {
    const fetchImpl = fakeFetch(null, { throws: true });
    const res = await resolveInstalledOllamaModel({
      baseURL: 'http://localhost:11434/v1',
      fetchImpl,
    });
    expect(res).toEqual({ model: null, reachable: false, installedCount: 0 });
  });
});

describe('buildOllamaPullHint', () => {
  it('tells the user to pull a model when the server is reachable but empty', () => {
    const hint = buildOllamaPullHint({
      baseURL: 'http://localhost:11434/v1',
      reachable: true,
      requested: 'qwen2.5-coder:7b',
    });
    expect(hint).toContain('ollama pull qwen2.5-coder:7b');
    expect(hint).not.toContain('grok');
    expect(hint).not.toContain('404');
  });

  it('tells the user to start Ollama when unreachable', () => {
    const hint = buildOllamaPullHint({ baseURL: 'http://localhost:11434/v1', reachable: false });
    expect(hint).toContain('not reachable');
    expect(hint).toContain('ollama serve');
    expect(hint).toContain(`ollama pull ${DEFAULT_OLLAMA_MODEL}`);
  });
});
