import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CollectiveKnowledgeGraph,
  type CkgRememberInput,
} from '../../src/memory/collective-knowledge-graph.js';

// Real ledger on a tmp dir — no mocks. Two instances on the SAME ledger model two agents
// sharing one collective store.
describe('CollectiveKnowledgeGraph (Phase 0)', () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });
  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const lesson: CkgRememberInput = {
    text: 'Le mode action vocal local devstral 24B est trop lent ; router vers gpt-5.5 OAuth.',
    type: 'lesson',
    source: 'postmortem',
  };

  it('round-trips: remember then recall finds it', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember(lesson);
    const hits = ckg.recall('mode vocal lent devstral');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('devstral');
    expect(hits[0]!.type).toBe('lesson');
    expect(existsSync(ledgerPath)).toBe(true);
  });

  it('listEntities lists indexed entries (newest first) and filters by type', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ text: 'Un fait ancien sur les agents.', type: 'fact', source: 's1' });
    ckg.remember({ text: 'Une découverte récente sur le RAG.', type: 'discovery', source: 's2' });
    const all = ckg.listEntities({});
    expect(all.length).toBe(2);
    expect(all[0]!.createdAt >= all[1]!.createdAt).toBe(true); // newest first
    const docs = ckg.listEntities({ type: 'discovery' });
    expect(docs.length).toBe(1);
    expect(docs[0]!.type).toBe('discovery');
    expect(docs[0]!.source).toBe('s2');
    expect(ckg.listEntities({ limit: 1 }).length).toBe(1);
  });

  it('THESIS: agent B benefits from what agent A learned (shared ledger)', () => {
    const agentA = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'ministar/code-buddy' });
    const agentB = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'laptop/code-buddy' });

    // B knows nothing yet.
    expect(agentB.recall('comment router la voix').length).toBe(0);

    // A learns and records it to the collective.
    agentA.remember(lesson);

    // B — a DIFFERENT agent/instance — now recalls A's lesson, with A's attribution.
    const hits = agentB.recall('router la voix vers gpt-5.5');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('gpt-5.5');
    expect(hits[0]!.agentId).toBe('ministar/code-buddy');
  });

  it('reinforces: the SAME fact remembered twice accumulates mentions (not lost-update)', () => {
    const a = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'a/repo' });
    const b = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'b/repo' });
    a.remember(lesson);
    b.remember(lesson); // identical text → same id+contentHash → reinforce
    const hits = b.recall('devstral lent vocal');
    expect(hits.length).toBe(1); // deduped to one node
    expect(hits[0]!.mentions).toBe(2); // both contributions counted (replay-from-ledger)
  });

  it('keeps the incremental view identical to a full replay after 5k cross-instance writes', () => {
    const writer = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'writer/repo' });
    const incremental = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'reader/repo' });

    for (let i = 0; i < 2_500; i++) {
      writer.remember({ name: `fact-${i}`, text: `shared ledger fact batch one ${i}`, type: 'fact' });
    }
    expect(incremental.getStats().entities).toBe(2_500); // establish the replay offset

    for (let i = 2_500; i < 5_000; i++) {
      writer.remember({ name: `fact-${i}`, text: `shared ledger fact batch two ${i}`, type: 'fact' });
    }
    writer.remember({
      name: 'fact-10',
      text: 'shared ledger fact ten was updated',
      type: 'fact',
      relations: [{ predicate: 'related_to', targetName: 'fact-12', targetType: 'fact' }],
    });
    writer.retract('fact-11', { reason: 'obsolete fixture' });

    // `incremental` consumes only the appended half; `fullReplay` starts from byte zero.
    const incrementalStats = incremental.getStats();
    const fullReplay = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'fresh/repo' });
    expect(incrementalStats).toEqual(fullReplay.getStats());
    expect(incremental.listEntities({ limit: 6_000 })).toEqual(fullReplay.listEntities({ limit: 6_000 }));
    const incrementalHistory = incremental.getSuperseded()
      .map(({ salience: _timeDependentSalience, ...hit }) => hit);
    const fullReplayHistory = fullReplay.getSuperseded()
      .map(({ salience: _timeDependentSalience, ...hit }) => hit);
    expect(incrementalHistory).toEqual(fullReplayHistory);
    const recallView = (ckg: CollectiveKnowledgeGraph) =>
      ckg.recall('', { limit: 6_000 })
        .map(({ salience: _timeDependentSalience, ...hit }) => hit)
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(recallView(incremental)).toEqual(recallView(fullReplay));
  });

  it('stores typed relations (Code-Explorer edge shape) and returns them on recall', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({
      text: 'La voix doit router vers gpt-5.5.',
      type: 'lesson',
      relations: [{ predicate: 'learned_from', targetName: 'audit-voix-2026-06-30', targetType: 'task', reason: 'postmortem' }],
    });
    const hits = ckg.recall('voix gpt-5.5');
    expect(hits[0]!.relations.length).toBe(1);
    expect(hits[0]!.relations[0]!.predicate).toBe('learned_from');
    expect(hits[0]!.relations[0]!.target).toContain('task:collective:');
    expect(hits[0]!.relations[0]!.reason).toBe('postmortem');
  });

  it('redacts secrets before persisting (the lesson is kept, the secret is not)', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    const token = `ghp_${'A'.repeat(36)}`;
    ckg.remember({ text: `Le token de déploiement est ${token} — ne pas le perdre.`, type: 'fact' });
    const hits = ckg.recall('token de déploiement');
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).not.toContain(token);
    expect(hits[0]!.text.toLowerCase()).toContain('token'); // surrounding knowledge preserved
  });

  it('formats a <collective_knowledge> prompt block', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember(lesson);
    const block = await ckg.formatCollectiveContext('mode vocal devstral');
    expect(block).toContain('<collective_knowledge>');
    expect(block).toContain('devstral');
    expect(block).toContain('host/repo');
  }, 60000);

  it('filters by type', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ text: 'un fait quelconque sur les tokens', type: 'fact' });
    ckg.remember({ text: 'une leçon sur les tokens', type: 'lesson' });
    const onlyLessons = ckg.recall('tokens', { types: ['lesson'] });
    expect(onlyLessons.length).toBe(1);
    expect(onlyLessons[0]!.type).toBe('lesson');
  });

  it('empty text is ignored (never-throws)', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    expect(ckg.remember({ text: '   ' })).toBeNull();
    expect(ckg.recall('anything')).toEqual([]);
  });

  // --- Phase 1: bi-temporal supersede ---
  it('supersedes a fact that changes (same stable name, new text)', () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ name: 'voice-agent-model', type: 'decision', text: 'On route la voix vers devstral 24B local.' });
    ckg.remember({ name: 'voice-agent-model', type: 'decision', text: 'On route la voix vers gpt-5.5 (devstral trop lent).' });

    const hits = ckg.recall('route voix', { types: ['decision'] });
    expect(hits.length).toBe(1); // only the current version is recalled
    expect(hits[0]!.text).toContain('gpt-5.5');
    expect(hits[0]!.relations.some((r) => r.predicate === 'supersedes')).toBe(true);

    const old = ckg.getSuperseded();
    expect(old.length).toBe(1);
    expect(old[0]!.text).toContain('devstral 24B');
    expect(old[0]!.validTo).toBeTruthy(); // invalidated, not deleted
  });
});

// --- Phase 1: hybrid (semantic) retrieval + the measurable "B benefits from A" metric ---
// Uses REAL local embeddings ($0, Xenova) — first run loads the model, hence the timeout.
describe('CollectiveKnowledgeGraph — hybrid recall (semantic, $0)', () => {
  let dir: string;
  let ledgerPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-sem-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('paraphrase with no shared keywords still finds the right knowledge', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ type: 'lesson', text: 'La voix du robot répond avec beaucoup de retard.' });
    ckg.remember({ type: 'lesson', text: 'La recette de gâteau demande trois œufs et du beurre.' });
    const hits = await ckg.recallHybrid('mon assistant parle trop lentement', { limit: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.text).toContain('robot');
  }, 60000);

  it('METRIC — agent B answers paraphrased queries correctly thanks to A (≥2/3 vs 0/3 baseline)', async () => {
    const agentA = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'ministar/code-buddy' });
    const agentB = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'laptop/code-buddy' });

    // Three semantically well-separated lessons (no shared keywords with the probes).
    const lessons = [
      { key: 'voice', text: 'La voix du robot répond avec beaucoup de retard.' },
      { key: 'money', text: 'Le budget restant du projet est presque épuisé.' },
      { key: 'food', text: 'La recette demande trois œufs, de la farine et du beurre.' },
    ];
    const probes = [
      { key: 'voice', q: 'mon assistant parle trop lentement' },
      { key: 'money', q: "il ne reste presque plus d'argent pour le travail" },
      { key: 'food', q: 'quels ingrédients pour la pâtisserie' },
    ];

    // Baseline: B with an EMPTY collective → cannot answer anything.
    let baseline = 0;
    for (const p of probes) if ((await agentB.recallHybrid(p.q, { limit: 1 })).length > 0) baseline++;
    expect(baseline).toBe(0);

    // A capitalizes the lessons into the collective.
    for (const l of lessons) agentA.remember({ type: 'lesson', name: l.key, text: l.text });

    // B now recalls the RIGHT lesson for the paraphrased probes. Bar = ≥2/3: an honest,
    // falsifiable capitalization proof that is robust to the default embedding model's known
    // weakness on French (all-MiniLM is English-leaning — multilingual upgrade is a tracked
    // improvement). The point is measurable: B went from 0 to ≥2 of 3 thanks to A.
    let score = 0;
    for (const p of probes) {
      const top = await agentB.recallHybrid(p.q, { limit: 1 });
      if (top[0]?.name === p.key) score++;
    }
    expect(score).toBe(3); // measurable capitalization: B went from 0/3 to 3/3 thanks to A
  }, 90000);

  it('IMPROVEMENT — MMR returns DIVERSE results, not near-duplicates', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    ckg.remember({ type: 'lesson', name: 'v1', text: 'La voix du robot répond trop lentement.' });
    ckg.remember({ type: 'lesson', name: 'v2', text: 'Le robot met trop de temps à répondre vocalement.' });
    ckg.remember({ type: 'lesson', name: 'sync', text: 'Le partage entre machines se fait par un push git.' });
    const q = 'le robot parle lentement';
    // Pure relevance (λ=1) surfaces the two near-duplicate voice lessons.
    const relevanceOnly = await ckg.recallHybrid(q, { limit: 2, mmrLambda: 1.0 });
    expect(new Set(relevanceOnly.map((h) => h.name))).toEqual(new Set(['v1', 'v2']));
    // MMR (λ low) swaps a redundant near-duplicate for the diverse fact.
    const diverse = await ckg.recallHybrid(q, { limit: 2, mmrLambda: 0.2 });
    expect(diverse.map((h) => h.name)).toContain('sync');
  }, 60000);
});

// --- Improvement: cross-agent corroboration (collective trust) ---
describe('CollectiveKnowledgeGraph — cross-agent corroboration', () => {
  let dir: string;
  let ledgerPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-corr-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('two DISTINCT agents agreeing raises corroboration + confidence', () => {
    const a = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'ministar/code-buddy' });
    const b = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'laptop/code-buddy' });
    const fact = { type: 'fact' as const, name: 'ledger', text: 'le journal append-only évite les pertes concurrentes', confidence: 0.6 };
    a.remember(fact);
    b.remember(fact); // a different agent independently confirms
    const r = b.recall('journal pertes concurrentes')[0]!;
    expect(r.corroborations).toBe(2);
    expect(r.confidence).toBeGreaterThan(0.6); // boosted above the base
  });

  it('same agent repeating does NOT inflate corroboration (no echo chamber)', () => {
    const a = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'solo/repo' });
    const fact = { type: 'fact' as const, name: 'k', text: 'fait répété par le même agent', confidence: 0.6 };
    a.remember(fact);
    a.remember(fact);
    a.remember(fact);
    const r = a.recall('fait répété')[0]!;
    expect(r.corroborations).toBe(1);
    expect(r.confidence).toBe(0.6); // unchanged
    expect(r.mentions).toBe(3);
  });

  it('a corroborated fact outranks a one-off for the same query', () => {
    const a = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'a/repo' });
    const b = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'b/repo' });
    a.remember({ type: 'fact', name: 'oneoff', text: 'budget tokens version alpha' });
    a.remember({ type: 'fact', name: 'corrob', text: 'budget tokens version beta' });
    b.remember({ type: 'fact', name: 'corrob', text: 'budget tokens version beta' }); // corroborated
    const hits = a.recall('budget tokens', { limit: 2 });
    expect(hits[0]!.name).toBe('corrob');
  });
});

// --- Patrice's vision: ingest scientific discoveries, auto-link to nearest neighbours ---
describe('CollectiveKnowledgeGraph — scientific discovery ingestion + auto-linking', () => {
  let dir: string;
  let ledgerPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ckg-disc-'));
    ledgerPath = join(dir, 'ckg-ledger.jsonl');
  });
  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('auto-links a new discovery to its nearest neighbour, NOT to unrelated ones', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    // Two oncology/immunology findings (neighbours) + one astronomy finding (unrelated).
    await ckg.ingest({ name: 'd1', text: "L'immunothérapie par inhibiteurs de points de contrôle traite certains cancers.", autoLinkThreshold: 0.4 });
    const d2 = await ckg.ingest({ name: 'd2', text: 'Les anticorps anti-PD-1 stimulent le système immunitaire contre les tumeurs.', autoLinkThreshold: 0.4 });
    const d3 = await ckg.ingest({ name: 'd3', text: 'La distance des galaxies se mesure par le décalage vers le rouge.', autoLinkThreshold: 0.4 });

    // d2 (medical) linked itself to d1 (medical).
    const d2links = d2!.relations.filter((r) => r.predicate === 'related_to').map((r) => r.target);
    expect(d2links).toContain('discovery:collective:d1');
    // d3 (astronomy) did NOT link to the medical discoveries.
    const d3links = d3!.relations.filter((r) => r.predicate === 'related_to').map((r) => r.target);
    expect(d3links).not.toContain('discovery:collective:d1');
    expect(d3links).not.toContain('discovery:collective:d2');
  }, 90000);

  it('tags neighbour links as supports/contradicts via a classifier (the "what works/doesn\'t" signal)', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    // Stub NLI classifier: a finding that says "ne marche pas" contradicts its neighbour.
    const classifier = async (subject: string): Promise<'supports' | 'contradicts' | 'related_to'> =>
      subject.includes('ne marche pas') ? 'contradicts' : 'supports';
    await ckg.ingest({ name: 'a', text: 'Le traitement X réduit fortement la maladie Y.', autoLinkThreshold: 0.3 });
    const b = await ckg.ingest({
      name: 'b',
      text: 'Le traitement X ne marche pas contre la maladie Y.',
      autoLinkThreshold: 0.3,
      relationClassifier: classifier,
    });
    const preds = b!.relations.map((r) => r.predicate);
    expect(preds).toContain('contradicts'); // conflicting finding detected, not just "related"
    expect(preds).not.toContain('related_to');
  }, 90000);

  it('ingestPublication stores a discovery recallable by paraphrase', async () => {
    const ckg = new CollectiveKnowledgeGraph({ ledgerPath, agentId: 'host/repo' });
    await ckg.ingestPublication({
      id: 'PMID:1',
      title: 'La metformine réduit la glycémie chez les patients diabétiques de type 2',
      abstract: 'Essai clinique montrant une baisse significative de l’hémoglobine glyquée.',
      source: 'europepmc',
    });
    const hits = await ckg.recallHybrid('quel médicament contre le diabète', { limit: 1 });
    expect(hits.length).toBe(1);
    expect(hits[0]!.type).toBe('discovery');
    expect(hits[0]!.text.toLowerCase()).toContain('metformine');
  }, 90000);
});
