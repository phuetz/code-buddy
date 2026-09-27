import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPublications } from '../../src/research/publication-sources.js';
import { parseBlogFeed } from '../../src/research/blog-sources.js';
import { CollectiveKnowledgeGraph } from '../../src/memory/collective-knowledge-graph.js';

const fixtureDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const rss = readFileSync(join(fixtureDir, 'lab-blog.rss.xml'), 'utf8');
const atom = readFileSync(join(fixtureDir, 'lab-blog.atom.xml'), 'utf8');

describe('blog feeds (mocked network)', () => {
  it('does not turn a missing link or an opaque GUID into the feed URL', () => {
    const xml = '<rss><channel><item><title>Agent memory</title><guid isPermaLink="false">opaque</guid><description>Agent memory</description></item></channel></rss>';
    expect(parseBlogFeed(xml, 'https://example.org/feed.xml', 'agent memory', 6)).toEqual([]);
  });

  it('filters by every topic keyword, canonicalizes links and deduplicates across RSS and Atom', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blog-feeds-'));
    try {
      const feedsFile = join(dir, 'feeds.json');
      writeFileSync(feedsFile, JSON.stringify(['https://example.org/rss.xml', 'https://example.net/atom.xml']));
      const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(String(input).endsWith('rss.xml') ? rss : atom)) as unknown as typeof fetch;
      const pubs = await fetchPublications('agent memory', { source: 'blogs', feedsFile, fetcher, limit: 6 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(pubs).toHaveLength(2);
      expect(pubs.map((p) => p.id)).toEqual([
        'https://example.org/blog/agent-memory/',
        'https://example.net/posts/memory-agents',
      ]);
      expect(pubs[0]).toMatchObject({ source: 'blogs', url: 'https://example.org/blog/agent-memory/' });
      expect(pubs[0]!.abstract).toContain('Research on agent memory systems.');
      expect(pubs[1]!.abstract).toBe('Agent memory in practice.');
      expect(pubs.every((p) => !p.title.includes('vision'))).toBe(true);
      const bounded = await fetchPublications('agent memory', { source: 'blogs', feedsFile, fetcher, limit: 2 });
      expect(bounded.map((p) => p.id)).toEqual(pubs.map((p) => p.id));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ingests the same canonical URL only once in a temporary ledger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blog-ledger-'));
    try {
      const feedsFile = join(dir, 'feeds.json');
      const ledgerPath = join(dir, 'ledger.jsonl');
      writeFileSync(feedsFile, JSON.stringify(['https://example.org/rss.xml', 'https://example.net/atom.xml']));
      const fetcher = vi.fn(async (input: RequestInfo | URL) => new Response(String(input).endsWith('rss.xml') ? rss : atom)) as unknown as typeof fetch;
      const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'test/blogs', persistentEmbeddingCache: false, embedder: { embed: async () => ({ embedding: Float32Array.from([1, 0, 0]) }) } });
      for (let pass = 0; pass < 2; pass++) {
        for (const pub of await fetchPublications('agent memory', { source: 'blogs', feedsFile, fetcher })) await ckg.ingestPublication(pub);
      }
      expect(ckg.getStats().entities).toBe(2);
      expect(readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.includes('"kind":"entity"'))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails open for missing config, bad XML and HTTP errors, while continuing other feeds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blog-errors-'));
    try {
      const feedsFile = join(dir, 'feeds.json');
      expect(await fetchPublications('memory', { source: 'blogs', feedsFile, fetcher: vi.fn() as unknown as typeof fetch })).toEqual([]);
      writeFileSync(feedsFile, JSON.stringify(['https://example.org/bad', 'https://example.org/down', 'https://example.org/good']));
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/bad')) return new Response('<html>broken</html>');
        if (String(input).endsWith('/down')) return new Response('', { status: 503 });
        return new Response(rss);
      }) as unknown as typeof fetch;
      const pubs = await fetchPublications('agent memory', { source: 'blogs', feedsFile, fetcher });
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(pubs).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
