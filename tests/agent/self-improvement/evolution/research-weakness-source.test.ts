import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  isContradicted,
  matchScore,
  selectMatches,
  buildGoalPrompt,
  parseGoal,
  fetchResearchGoals,
  filterResearchHits,
  scholarlyIdentity,
  type ResearchHit,
  type FeatureMatch,
} from '../../../../src/agent/self-improvement/evolution/research-weakness-source.js';
import type { FeatureArea } from '../../../../src/agent/self-improvement/evolution/feature-map.js';

const feat = (id: string): FeatureArea => ({ id, name: `Feat ${id}`, description: `desc ${id}`, paths: [`src/${id}.ts`] });
const hit = (over: Partial<ResearchHit> = {}): ResearchHit => ({ name: 'arxiv:2606.20023v2', type: 'discovery', source: 'arxiv', text: 'A paper about X', confidence: 0.8, similarity: 0.6, relations: [], ...over });

describe('prioritization (pure)', () => {
  it('checks the 20 annotated relevance queries against the default scientific guard', () => {
    const queries = JSON.parse(readFileSync(new URL('../../../fixtures/dgm-relevance-20.json', import.meta.url), 'utf8')) as
      Array<{ domain: string; query: string; relevant: string[] }>;
    expect(queries).toHaveLength(20);
    expect(new Set(queries.map((row) => row.domain)).size).toBe(20);
    for (const row of queries) {
      const feature = { ...feat(row.domain), description: row.query };
      const candidates: FeatureMatch[] = [
        { feature, hit: hit({ name: 'arxiv:9999.99999', similarity: 0.44, confidence: 0.95 }), score: 0.418 },
        { feature, hit: hit({ name: 'video:irrelevant', source: 'video', similarity: 0.99 }), score: 0.99 },
      ];
      if (row.relevant[0]) {
        candidates.push({ feature, hit: hit({ name: row.relevant[0], similarity: 0.46, confidence: 0.9 }), score: 0.414 });
      }
      const selected = filterResearchHits(candidates);
      expect(selected.map((item) => scholarlyIdentity(item.hit)), row.domain).toEqual(row.relevant[0] ? [row.relevant[0]] : []);
    }
  });

  it('isContradicted flags a contradicts relation', () => {
    expect(isContradicted(hit({ relations: [{ predicate: 'contradicts', target: 'y' }] }))).toBe(true);
    expect(isContradicted(hit({ relations: [{ predicate: 'supports', target: 'y' }] }))).toBe(false);
  });

  it('matchScore rewards similarity × confidence, lifts supported/corroborated', () => {
    const base = matchScore(hit({ similarity: 0.6, confidence: 0.8 }));
    const supported = matchScore(hit({ similarity: 0.6, confidence: 0.8, relations: [{ predicate: 'supports', target: 'y' }] }));
    const corroborated = matchScore(hit({ similarity: 0.6, confidence: 0.8, corroborations: 3 }));
    expect(supported).toBeGreaterThan(base);
    expect(corroborated).toBeGreaterThan(base);
  });

  it('selectMatches drops sub-threshold + contradicted, keeps one best per feature, ranked', () => {
    const cands: FeatureMatch[] = [
      { feature: feat('a'), hit: hit({ similarity: 0.7 }), score: 0.7 },
      { feature: feat('a'), hit: hit({ similarity: 0.5 }), score: 0.5 }, // same feature, lower → dropped
      { feature: feat('b'), hit: hit({ similarity: 0.1 }), score: 0.1 }, // below floor → dropped
      { feature: feat('c'), hit: hit({ similarity: 0.9, relations: [{ predicate: 'contradicts', target: 'y' }] }), score: 0.9 }, // contradicted → dropped
      { feature: feat('d'), hit: hit({ name: 'arxiv:2607.05441v1', text: 'A different paper about tools', similarity: 0.6 }), score: 0.6 },
    ];
    const out = selectMatches(cands, { minSimilarity: 0.32, limit: 5 });
    expect(out.map((m) => m.feature.id)).toEqual(['a', 'd']); // a (0.7) before d (0.6), one per feature
  });

  it('selectMatches respects the limit', () => {
    const cands: FeatureMatch[] = [
      { feature: feat('a'), hit: hit({ similarity: 0.9 }), score: 0.9 },
      { feature: feat('b'), hit: hit({ name: 'arxiv:2607.05441v1', similarity: 0.8 }), score: 0.8 },
    ];
    expect(selectMatches(cands, { limit: 1 })).toHaveLength(1);
  });
});

describe('prompt + parse (pure)', () => {
  it('buildGoalPrompt includes feature name, paths, article text, and the NONE escape', () => {
    const p = buildGoalPrompt(feat('voice'), hit({ text: 'Barge-in via streaming VAD' }));
    expect(p).toContain('Feat voice');
    expect(p).toContain('src/voice.ts');
    expect(p).toContain('Barge-in');
    expect(p).toContain('NONE');
  });
  it('parseGoal strips quotes/first line, rejects NONE/short', () => {
    expect(parseGoal('"Ajoute le barge-in au voice loop via un VAD streaming."')).toContain('barge-in');
    expect(parseGoal('NONE')).toBeNull();
    expect(parseGoal('  none ')).toBeNull();
    expect(parseGoal('short')).toBeNull();
    expect(parseGoal(null)).toBeNull();
    expect(parseGoal('First actionable line here.\nsome rationale')).toBe('First actionable line here.');
  });
});

describe('fetchResearchGoals (injected features + recall + chat)', () => {
  const features = [feat('voice'), feat('memory')];

  it('produces article-grounded weaknesses (kind research)', async () => {
    const recall = async () => [hit({ similarity: 0.7, text: 'technique T' })];
    const chat = async () => 'Applique la technique T au module concerné.';
    const goals = await fetchResearchGoals({ features, recall, chat, limit: 5, persistLinks: false });
    expect(goals.length).toBeGreaterThan(0);
    expect(goals.every((g) => g.kind === 'research')).toBe(true);
    expect(goals[0]!.goal).toContain('technique T');
  });

  it('skips when the model judges it not actionable (NONE)', async () => {
    const goals = await fetchResearchGoals({ features, recall: async () => [hit({ similarity: 0.7 })], chat: async () => 'NONE', persistLinks: false });
    expect(goals).toEqual([]);
  });

  it('empty CKG → [] (falls back to other sources)', async () => {
    const goals = await fetchResearchGoals({ features, recall: async () => [], chat: async () => 'x'.repeat(20), persistLinks: false });
    expect(goals).toEqual([]);
  });

  it('never throws — a recall/chat that throws → []', async () => {
    const goals = await fetchResearchGoals({ features, recall: async () => { throw new Error('ckg down'); }, chat: async () => 'g', persistLinks: false });
    expect(goals).toEqual([]);
  });
});
