import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type Feature,
  type FeatureMap,
  loadFeatureMap,
  parseFeatureMap,
  selectFeatureTargets,
  summarizeFeatureMap,
  validateFeatureMap,
} from '../../../src/agent/self-improvement/feature-map.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function feature(overrides: Partial<Feature> & { id: string }): Feature {
  return {
    section: '1. Test',
    name: overrides.id,
    proof: ['tests'],
    offByDefault: false,
    gate: null,
    code: ['src/a.ts'],
    tests: ['tests/a.test.ts'],
    papers: [],
    notes: '',
    ...overrides,
  };
}

function map(features: Feature[], papers: FeatureMap['papers'] = {}): FeatureMap {
  return parseFeatureMap({
    schemaVersion: 1,
    builtFrom: { commit: 'abcdef1', inventory: 'docs/INVENTAIRE-FONCTIONNALITES.md', codeExplorerIndexedAt: '2026-09-24T07:27:30Z' },
    papers,
    features,
  });
}

const paper = { title: 'Darwin Gödel Machine', citedIn: ['docs/x.md:1'], verified: true as const };

describe('feature map schema', () => {
  it('rejects unknown keys, absolute paths and traversal', () => {
    expect(() => map([{ ...feature({ id: 'a' }), extra: 1 } as unknown as Feature])).toThrow();
    expect(() => map([feature({ id: 'a', code: ['/etc/passwd'] })])).toThrow();
    expect(() => map([feature({ id: 'a', tests: ['../outside.test.ts'] })])).toThrow();
    expect(() => map([feature({ id: 'a', papers: [{ arxiv: 'not-an-id', link: 'cited', evidence: 'x:1' }] })])).toThrow();
  });
});

describe('validateFeatureMap', () => {
  it('reports drifted paths, unknown papers and duplicates as errors, no-code as a warning', () => {
    const problems = validateFeatureMap(
      map([
        feature({ id: 'a', code: ['src/gone.ts'], tests: ['tests/gone.test.ts'] }),
        feature({ id: 'a' }),
        feature({ id: 'b', code: [], papers: [{ arxiv: '2505.22954', link: 'cited', evidence: 'x:1' }] }),
      ]),
      (p) => p === 'src/a.ts' || p === 'tests/a.test.ts',
    );
    expect(problems.map((p) => [p.kind, p.severity])).toEqual([
      ['missing-code-path', 'error'],
      ['missing-test-path', 'error'],
      ['duplicate-id', 'error'],
      ['unknown-paper', 'error'],
      ['no-code', 'warning'],
    ]);
  });

  it('surfaces a paper whose title does not match arXiv', () => {
    const problems = validateFeatureMap(
      map([feature({ id: 'a' })], { '2505.22954': { ...paper, verified: false, arxivTitle: 'Other' } }),
      () => true,
    );
    expect(problems).toEqual([expect.objectContaining({ kind: 'paper-title-mismatch', severity: 'warning' })]);
  });
});

describe('selectFeatureTargets', () => {
  it('puts the weakest evidence first and never targets a feature without code', () => {
    const targets = selectFeatureTargets(
      map(
        [
          feature({ id: 'proven', proof: ['executed', 'tests'] }),
          feature({ id: 'tests-only' }),
          feature({ id: 'never-run', proof: ['unproven'], tests: [] }),
          feature({ id: 'facade', proof: ['unproven'], code: [], tests: [] }),
          feature({
            id: 'dormant',
            proof: ['tests'],
            offByDefault: true,
            gate: 'CODEBUDDY_X',
            papers: [{ arxiv: '2505.22954', link: 'implements', evidence: 'x:1' }],
          }),
        ],
        { '2505.22954': paper },
      ),
    );
    expect(targets.map((t) => t.feature.id)).toEqual(['never-run', 'dormant', 'tests-only']);
    expect(targets[0]?.reasons).toEqual(['never exercised in real use', 'no test exercises it']);
    expect(targets[1]).toMatchObject({
      fitnessTests: ['tests/a.test.ts'],
      grounding: [{ arxiv: '2505.22954', title: 'Darwin Gödel Machine' }],
    });
  });
});

describe('the committed docs/feature-map.json', () => {
  const file = path.join(repoRoot, 'docs', 'feature-map.json');

  it('parses and has no error-level drift against the repository', () => {
    const committed = loadFeatureMap(file);
    const errors = validateFeatureMap(committed, (p) => existsSync(path.join(repoRoot, p)))
      .filter((problem) => problem.severity === 'error');
    expect(errors).toEqual([]);
    const summary = summarizeFeatureMap(committed);
    expect(summary.features).toBeGreaterThan(40);
    expect(summary.executed + summary.testsOnly + summary.unproven).toBe(summary.features);
  });
});
