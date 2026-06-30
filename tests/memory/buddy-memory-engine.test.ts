import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import {
  CollectiveKnowledgeGraph,
  resetCollectiveKnowledgeGraph,
} from '../../src/memory/collective-knowledge-graph.js';

// The Rust engine MVP (Phase 1): keyword recall over the shared JSONL ledger via a sidecar.
// Skips cleanly where the binary isn't built.
function findBin(): string | null {
  const env = process.env.CODEBUDDY_BUDDY_MEMORY_BIN;
  if (env && existsSync(env)) return env;
  for (const sub of ['release', 'debug']) {
    const p = join(homedir(), 'DEV', 'buddy-memory', 'target', sub, 'buddy-memory');
    if (existsSync(p)) return p;
  }
  return null;
}
const bin = findBin();
const hasBin = bin !== null;
/** Heuristic: a release/embeddings build is needed for semantic recall (Phase 2). */
const hasEmbeddings = !!bin && bin.includes('/release/');

describe('CKG Rust engine (CODEBUDDY_CKG_ENGINE=rust)', () => {
  let dir: string;
  let ledgerPath: string;
  let prevEngine: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-engine-'));
    ledgerPath = join(dir, 'ledger.jsonl');
    prevEngine = process.env.CODEBUDDY_CKG_ENGINE;
    process.env.CODEBUDDY_CKG_ENGINE = 'rust';
  });
  afterEach(() => {
    if (prevEngine === undefined) delete process.env.CODEBUDDY_CKG_ENGINE;
    else process.env.CODEBUDDY_CKG_ENGINE = prevEngine;
    resetCollectiveKnowledgeGraph();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it.skipIf(!hasBin)('ingest via the engine → recall finds it (TS↔Rust round-trip)', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    await ckg.ingest({ name: 'voice', text: 'La réponse vocale est trop lente, router vers le cloud.' });
    const hits = await ckg.recallHybrid('réponse vocale lente cloud', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.name === 'voice')).toBe(true);
  }, 30000);

  it.skipIf(!hasBin)('engine writes to the SHARED ledger (TS sync getStats sees it)', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    await ckg.ingest({ name: 'd1', text: 'une découverte de test pour le moteur rust' });
    // getStats() is the pure-TS sync path reading the same ledger the engine appended to.
    const stats = ckg.getStats();
    expect(stats.entities).toBeGreaterThanOrEqual(1);
    expect(existsSync(ledgerPath)).toBe(true);
  }, 30000);

  it.skipIf(!hasEmbeddings)('Phase 2: hybrid recall finds a FR paraphrase semantically (TS→Rust)', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    await ckg.ingest({ name: 'voice', text: 'La réponse vocale du robot est beaucoup trop lente.' });
    await ckg.ingest({ name: 'cake', text: 'La recette de gâteau demande trois œufs et du beurre.' });
    // Paraphrase with no shared keywords → only semantics surfaces the voice discovery.
    const hits = await ckg.recallHybrid('mon assistant parle avec beaucoup de retard', { limit: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.name).toBe('voice');
    expect((hits[0]!.similarity ?? 0)).toBeGreaterThan(0.2);
  }, 60000);

  it.skipIf(!hasBin)('corroboration: same fact from two agents → corroborations=2 via engine', async () => {
    const a = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'ministar/code-buddy' });
    const b = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'laptop/code-buddy' });
    const fact = { name: 'k', text: 'le journal append-only évite les pertes concurrentes', confidence: 0.6 };
    await a.ingest(fact);
    await b.ingest(fact); // distinct agent corroborates, same shared ledger
    const hits = await b.recallHybrid('journal pertes concurrentes', { limit: 1 });
    expect(hits[0]?.corroborations).toBe(2);
  }, 30000);
});
