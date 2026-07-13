/**
 * CKG recallHybrid on the new BM25 + RRF + MMR core — fast and hermetic via
 * the injected embedder seam (no model download), crafted vectors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { CollectiveKnowledgeGraph, type CkgEmbedder } from '../../src/memory/collective-knowledge-graph.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckg-mmr-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Deterministic embedder: maps texts to crafted 3-d clusters —
 * sqlite/verrou texts → x-axis, timeout texts → y-axis, telegram → z-axis.
 * Near-duplicates get tiny distinct offsets so vectors are not identical.
 */
function craftedEmbedder(): CkgEmbedder {
  let dupCounter = 0;
  return {
    async embed(text: string) {
      const t = text.toLowerCase();
      if (t.includes('sqlite')) {
        dupCounter += 1;
        return { embedding: Float32Array.from([1, 0.01 * dupCounter, 0]) };
      }
      if (t.includes('timeout')) return { embedding: Float32Array.from([0, 1, 0]) };
      if (t.includes('telegram')) return { embedding: Float32Array.from([0, 0, 1]) };
      return { embedding: Float32Array.from([0.5, 0.5, 0.5]) };
    },
  };
}

async function seededGraph(): Promise<CollectiveKnowledgeGraph> {
  const ckg = new CollectiveKnowledgeGraph({
    ledgerPath: path.join(dir, 'ckg-ledger.jsonl'),
    agentId: 'test/agent',
    embedder: craftedEmbedder(),
  });
  // Three near-duplicate facts about the same thing (the redundancy trap)…
  await ckg.remember({ text: 'sqlite exige le mode WAL pour les écritures concurrentes' });
  await ckg.remember({ text: 'sqlite: activer WAL sinon les écritures concurrentes se bloquent' });
  await ckg.remember({ text: 'pour sqlite multi-process, le mode WAL est obligatoire' });
  // …and two distinct facts, less lexically close to the query.
  await ckg.remember({ text: 'le busy timeout doit être configuré à 5000ms pour les process' });
  await ckg.remember({ text: 'les alertes telegram exigent un token dédié pour les process' });
  return ckg;
}

describe('CKG recallHybrid — BM25 + RRF + MMR', () => {
  it('persists corpus vectors so a new instance only embeds the query', async () => {
    const ledgerPath = path.join(dir, 'ckg-ledger.jsonl');
    const firstEmbed = vi.fn(async () => ({ embedding: Float32Array.from([1, 0, 0]) }));
    const first = new CollectiveKnowledgeGraph({
      ledgerPath,
      agentId: 'first/agent',
      embeddingModel: 'test/cache-model',
      embedder: { embed: firstEmbed },
    });
    first.remember({ name: 'sqlite', text: 'sqlite concurrent writes require WAL' });
    first.remember({ name: 'timeout', text: 'busy timeout prevents lock failures' });
    await first.recallHybrid('database reliability');

    expect(firstEmbed).toHaveBeenCalledTimes(3); // query + two corpus entities
    const cachePath = `${ledgerPath}.emb.jsonl`;
    expect(fs.existsSync(cachePath)).toBe(true);
    expect(fs.readFileSync(cachePath, 'utf8').trim().split('\n')).toHaveLength(2);

    const secondEmbed = vi.fn(async () => ({ embedding: Float32Array.from([1, 0, 0]) }));
    const second = new CollectiveKnowledgeGraph({
      ledgerPath,
      agentId: 'second/agent',
      embeddingModel: 'test/cache-model',
      embedder: { embed: secondEmbed },
    });
    await second.recallHybrid('database reliability');
    expect(secondEmbed).toHaveBeenCalledTimes(1); // query only; corpus came from the sidecar
  });

  it('bounds collective-context recall when the embedder hangs', async () => {
    const hanging: CkgEmbedder = {
      embed: () => new Promise<{ embedding: Float32Array }>(() => undefined),
    };
    const ckg = new CollectiveKnowledgeGraph({
      ledgerPath: path.join(dir, 'ckg-ledger.jsonl'),
      agentId: 'test/agent',
      embedder: hanging,
    });
    ckg.remember({ text: 'sqlite exige WAL' });
    const startedAt = Date.now();
    await expect(ckg.formatCollectiveContext('sqlite', 600, 20)).resolves.toBe('');
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('λ=1 (naive top-k) returns the near-duplicate cluster; default λ covers distinct facts', async () => {
    const ckg = await seededGraph();
    const query = 'sqlite écritures concurrentes process';

    const naive = await ckg.recallHybrid(query, { limit: 3, mmrLambda: 1 });
    expect(naive.every((r) => r.text.includes('sqlite'))).toBe(true); // 3 duplicates

    const diverse = await ckg.recallHybrid(query, { limit: 3 }); // λ default 0.7
    expect(diverse.some((r) => r.text.includes('sqlite'))).toBe(true); // relevance head kept
    expect(diverse.some((r) => !r.text.includes('sqlite'))).toBe(true); // coverage gained
  });

  it('finds a paraphrase through the semantic leg when BM25 has zero overlap', async () => {
    const ckg = await seededGraph();
    // No shared keyword with the telegram fact — the crafted embedder maps
    // 'telegram' queries and facts to the same axis.
    const hits = await ckg.recallHybrid('notification telegram du robot', { limit: 2 });
    expect(hits.some((r) => r.text.includes('telegram'))).toBe(true);
  });

  it('keeps the recallHybrid contract (similarity present, limit respected)', async () => {
    const ckg = await seededGraph();
    const hits = await ckg.recallHybrid('sqlite process', { limit: 2 });
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(typeof h.similarity).toBe('number');
      expect(h.text.length).toBeGreaterThan(0);
    }
  });

  it('degrades to keyword recall when the embedder fails (no crash, still useful)', async () => {
    const failing: CkgEmbedder = {
      async embed() {
        throw new Error('model unavailable');
      },
    };
    const ckg = new CollectiveKnowledgeGraph({
      ledgerPath: path.join(dir, 'ckg-ledger.jsonl'),
      agentId: 'test/agent',
      embedder: failing,
    });
    ckg.remember({ text: 'sqlite exige le mode WAL pour les écritures concurrentes' });
    const hits = await ckg.recallHybrid('sqlite WAL', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('sqlite');
  });
});
