/**
 * EnhancedMemory.recall — semantic ranking survives (regression: an
 * unconditional importance/recency re-sort used to DESTROY the similarity
 * ordering of every query branch) and MMR keeps the selection diverse.
 * Hermetic: fake home dir, injected deterministic embedder, no model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const homeHolder = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeHolder.dir || actual.tmpdir(), default: { ...actual, homedir: () => homeHolder.dir || actual.tmpdir() } };
});

import * as realOs from 'node:os';
import { EnhancedMemory, type MemoryEmbedder } from '../../src/memory/enhanced-memory.js';

let tmpHome: string;
let memory: EnhancedMemory | null = null;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(realOs.tmpdir(), 'enhanced-mem-'));
  homeHolder.dir = tmpHome;
  // NOTE: the data dirs are deliberately NOT pre-created — every async
  // public method awaits `ready` (initialize barrier), so an immediate
  // store() on a fresh HOME must no longer race ensureDir/loadMemories.
});

afterEach(async () => {
  try {
    memory?.dispose();
    // dispose() kicks off a fire-and-forget saveAll(); wait for it to settle so
    // the cleanup below never races the last write (ENOTEMPTY seen on macOS CI).
    await memory?.flush();
  } catch {
    /* ignore */
  }
  memory = null;
  fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/**
 * Deterministic embedder, geometry chosen so that: the MMR query is closest
 * to the sqlite cluster but still above the 0.5 similarity floor for the
 * timeout fact, while the two clusters stay far apart (the diversity gain).
 */
function craftedEmbedder(): MemoryEmbedder {
  let dup = 0;
  return {
    async embed(text: string) {
      const t = text.toLowerCase();
      if (t.includes('contraintes')) return { embedding: Float32Array.from([0.95, 0, 0.312]) }; // the MMR query
      if (t.includes('sqlite')) {
        dup += 1;
        return { embedding: Float32Array.from([1, 0.01 * dup, 0]) };
      }
      if (t.includes('timeout')) return { embedding: Float32Array.from([0.55, 0, 0.835]) };
      return { embedding: Float32Array.from([0, 1, 0]) };
    },
  };
}

async function seeded(): Promise<EnhancedMemory> {
  const m = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
  memory = m;
  m.setEmbeddingProvider(craftedEmbedder());
  // Three near-duplicate facts (high importance) + one distinct, LESS important fact.
  await m.store({ type: 'fact', content: 'sqlite exige le mode WAL pour la concurrence', importance: 0.9 });
  await m.store({ type: 'fact', content: 'sqlite: activer WAL sinon blocage concurrent', importance: 0.9 });
  await m.store({ type: 'fact', content: 'sqlite multi-process impose WAL', importance: 0.9 });
  await m.store({ type: 'fact', content: 'le busy timeout doit être 5000ms', importance: 0.1 });
  return m;
}

describe('EnhancedMemory.recall — semantic ordering survives (regression)', () => {
  it('orders by similarity, not by the old unconditional importance/recency re-sort', async () => {
    const m = new EnhancedMemory({ useSQLite: false, embeddingEnabled: false });
    memory = m;
    m.setEmbeddingProvider(craftedEmbedder());
    // LOW-importance memory that matches the query best vs HIGH-importance weaker match.
    await m.store({ type: 'fact', content: 'sqlite exige le mode WAL', importance: 0.05 });
    await m.store({ type: 'fact', content: 'le busy timeout doit être 5000ms', importance: 1.0 });

    const hits = await m.recall({ query: 'sqlite WAL concurrence', mmrLambda: 1 });

    expect(hits.length).toBeGreaterThanOrEqual(2);
    // Before the fix, importance 1.0 won regardless of similarity.
    expect(hits[0]!.content).toContain('sqlite');
  });

  it('browsing (no query) still sorts by importance and recency', async () => {
    const m = await seeded();
    const hits = await m.recall({ limit: 2 });
    expect(hits[0]!.importance).toBeGreaterThanOrEqual(hits[1]!.importance);
  });
});

describe('EnhancedMemory.recall — MMR diversity', () => {
  const MMR_QUERY = 'quelles contraintes pour plusieurs processus ?';

  it('λ=1 (naive top-k) fills the limit with near-duplicates', async () => {
    const m = await seeded();
    const hits = await m.recall({ query: MMR_QUERY, limit: 3, mmrLambda: 1 });
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.content.includes('sqlite'))).toBe(true);
  });

  it('default λ keeps the best duplicate and covers the distinct fact at the same limit', async () => {
    const m = await seeded();
    const hits = await m.recall({ query: MMR_QUERY, limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits.some((h) => h.content.includes('sqlite'))).toBe(true);
    expect(hits.some((h) => h.content.includes('timeout'))).toBe(true);
  });
});
