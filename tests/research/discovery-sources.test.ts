import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchPublications } from '../../src/research/publication-sources.js';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

const github = {
  items: [
    { full_name: 'alpha/engine', description: 'Agent framework', topics: ['ai', 'agents'], language: 'TypeScript', stargazers_count: 700, pushed_at: '2026-09-20T10:00:00Z' },
    { full_name: 'beta/small', description: 'Small', topics: [], language: 'Python', stargazers_count: 499, pushed_at: '2026-09-20T10:00:00Z' },
    { full_name: 'old/engine', description: 'Old', topics: [], language: 'Rust', stargazers_count: 900, pushed_at: '2026-08-01T10:00:00Z' },
  ],
};

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('public CKG discovery sources (injected fetch, no network)', () => {
  it('queries GitHub with minimum stars and push date, and rejects under-threshold results locally', async () => {
    const fetcher = vi.fn(async () => response(github, 200, { 'x-ratelimit-remaining': '1' })) as unknown as typeof fetch;
    const repos = await fetchPublications('agent memory', {
      source: 'github', limit: 6, minStars: 500, pushedSince: '2026-09-01', sort: 'recent', fetcher,
    });
    const url = new URL(String(vi.mocked(fetcher).mock.calls[0]![0]));
    expect(url.host).toBe('api.github.com');
    expect(url.searchParams.get('q')).toBe('agent memory stars:>=500 pushed:>=2026-09-01');
    expect(url.searchParams.get('sort')).toBe('updated');
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatchObject({ id: 'github:alpha/engine', source: 'github' });
    expect(repos[0]!.abstract).toContain('Topics : ai, agents');
    expect(repos[0]!.abstract).toContain('Étoiles : 700');
    expect(repos[0]!.abstract).toContain('Dernier push : 2026-09-20');
  });

  it('queries Hugging Face for text generation and builds a card from published metadata', async () => {
    const fetcher = vi.fn(async () => response([
      { id: 'lab/model', pipeline_tag: 'text-generation', createdAt: '2026-09-21T00:00:00Z', cardData: { license: 'apache-2.0', context_length: 32768 }, safetensors: { total: 7_000_000_000 } },
      { id: 'lab/image', pipeline_tag: 'text-to-image', createdAt: '2026-09-21T00:00:00Z' },
    ])) as unknown as typeof fetch;
    const models = await fetchPublications('model', { source: 'models', limit: 4, sort: 'trending', fetcher });
    const url = new URL(String(vi.mocked(fetcher).mock.calls[0]![0]));
    expect(url.host).toBe('huggingface.co');
    expect(url.searchParams.get('pipeline_tag')).toBe('text-generation');
    expect(url.searchParams.get('sort')).toBe('trendingScore');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'hf:lab/model', source: 'models' });
    expect(models[0]!.abstract).toContain('7000000000 paramètres');
    expect(models[0]!.abstract).toContain('Licence : apache-2.0');
    expect(models[0]!.abstract).toContain('Contexte : 32768 tokens');
    expect(models[0]!.abstract).toContain('Créé le : 2026-09-21');
  });

  it('ingests the same repository and model only once in a real temporary CKG ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'discovery-ckg-'));
    try {
      const ledgerPath = join(dir, 'ledger.jsonl');
      const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'test/discovery', persistentEmbeddingCache: false, embedder: { embed: async () => ({ embedding: Float32Array.from([1, 0, 0]) }) } });
      const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('github')
        ? response({ items: [github.items[0]] })
        : response([{ id: 'lab/model', pipeline_tag: 'text-generation', createdAt: '2026-09-21T00:00:00Z' }])) as unknown as typeof fetch;
      const opts = { fetcher, limit: 2, pushedSince: '2026-09-01' };
      for (let pass = 0; pass < 2; pass++) {
        for (const source of ['github', 'models'] as const) {
          for (const pub of await fetchPublications('agent', { ...opts, source })) await ckg.ingestPublication(pub);
        }
      }
      expect(ckg.getStats().entities).toBe(2);
      const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n');
      expect(lines.filter((line) => line.includes('"kind":"entity"'))).toHaveLength(2);
      expect(ckg.getEntity('github:alpha/engine').entity?.source).toBe('github');
      expect(ckg.getEntity('hf:lab/model').entity?.source).toBe('models');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails open on GitHub 429 and Hugging Face 500 without retrying', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).includes('github')
      ? response({}, 429, { 'x-ratelimit-remaining': '0' })
      : response({}, 500)) as unknown as typeof fetch;
    expect(await fetchPublications('agent', { source: 'github', fetcher })).toEqual([]);
    expect(await fetchPublications('agent', { source: 'models', fetcher })).toEqual([]);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });
});
