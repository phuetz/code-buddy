/**
 * Feature map — what Code Buddy knows about ITSELF, feature by feature.
 *
 * `docs/feature-map.json` links every inventoried feature to the code that
 * implements it, the tests that exercise it, the research papers behind it and
 * how far it has been proven (executed / tests only / never exercised). It is
 * built with Code Explorer, reviewed by a human, and validated against the
 * repository by `validateFeatureMap` (a test fails when a path drifts).
 *
 * Why the self-improvement loop needs it: the capability benchmark only checks
 * that retrievable lessons mention some substrings. It cannot tell which
 * features exist, which are weak, or which tests measure them. The map gives
 * the loop a TARGET (an unproven or untested feature), a FITNESS GUARD (that
 * feature's tests) and a GROUNDING (the papers whose mechanism it implements).
 *
 * Like the seed benchmark scenarios, the map is curated and structurally
 * separate from the proposer: the loop reads it, it never writes it.
 *
 * @module agent/self-improvement/feature-map
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const FEATURE_MAP_SCHEMA_VERSION = 1;

export const PROOF_LEVELS = ['executed', 'tests', 'unproven'] as const;
export type ProofLevel = (typeof PROOF_LEVELS)[number];

const arxivIdRe = /^\d{4}\.\d{4,5}$/;
const featureIdRe = /^[a-z0-9][a-z0-9-]{0,79}$/;
const repoPathRe = /^(?!\/)(?!.*\.\.)[\w@.\-/]+$/;

const paperLinkSchema = z
  .object({
    arxiv: z.string().regex(arxivIdRe),
    /** `cited`: the feature's code or doc cites the paper; `implements`: it implements its mechanism. */
    link: z.enum(['cited', 'implements']),
    /** Where the link is stated in the repository (`path:line`). */
    evidence: z.string().min(3).max(300),
  })
  .strict();

export const featureSchema = z
  .object({
    id: z.string().regex(featureIdRe),
    section: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    proof: z.array(z.enum(PROOF_LEVELS)).max(3),
    offByDefault: z.boolean(),
    gate: z.string().max(120).nullable(),
    code: z.array(z.string().regex(repoPathRe)).max(8),
    tests: z.array(z.string().regex(repoPathRe)).max(8),
    papers: z.array(paperLinkSchema).max(12),
    notes: z.string().max(600),
  })
  .strict();
export type Feature = z.infer<typeof featureSchema>;

export const paperSchema = z
  .object({
    title: z.string().min(1).max(300),
    authors: z.string().max(300).optional(),
    year: z.number().int().min(1990).max(2100).nullable().optional(),
    citedIn: z.array(z.string().max(300)).max(40),
    /** `true` once the title was checked on arxiv.org; `false` when it did not match. */
    verified: z.union([z.boolean(), z.literal('unreachable')]),
    arxivTitle: z.string().max(300).optional(),
  })
  .strict();
export type Paper = z.infer<typeof paperSchema>;

export const featureMapSchema = z
  .object({
    schemaVersion: z.literal(FEATURE_MAP_SCHEMA_VERSION),
    /** Commit the map was built from, and the Code Explorer index used. */
    builtFrom: z
      .object({
        commit: z.string().regex(/^[0-9a-f]{7,40}$/),
        inventory: z.string().regex(repoPathRe),
        codeExplorerIndexedAt: z.string().max(40),
      })
      .strict(),
    papers: z.record(z.string().regex(arxivIdRe), paperSchema),
    features: z.array(featureSchema).min(1).max(500),
  })
  .strict();
export type FeatureMap = z.infer<typeof featureMapSchema>;

export type FeatureMapProblemKind =
  | 'duplicate-id'
  | 'missing-code-path'
  | 'missing-test-path'
  | 'unknown-paper'
  | 'paper-title-mismatch'
  | 'no-code';

export interface FeatureMapProblem {
  kind: FeatureMapProblemKind;
  featureId?: string;
  detail: string;
  /** Errors break the map; warnings are facts worth surfacing (e.g. a feature with no code). */
  severity: 'error' | 'warning';
}

export function parseFeatureMap(raw: unknown): FeatureMap {
  return featureMapSchema.parse(raw);
}

export function loadFeatureMap(file: string): FeatureMap {
  return parseFeatureMap(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Check the map against the repository. `exists` answers for a repo-relative
 * path (injected so the check is pure and testable).
 */
export function validateFeatureMap(
  map: FeatureMap,
  exists: (repoPath: string) => boolean,
): FeatureMapProblem[] {
  const problems: FeatureMapProblem[] = [];
  const seen = new Set<string>();
  for (const feature of map.features) {
    if (seen.has(feature.id)) {
      problems.push({ kind: 'duplicate-id', featureId: feature.id, detail: feature.id, severity: 'error' });
    }
    seen.add(feature.id);
    for (const path of feature.code) {
      if (!exists(path)) {
        problems.push({ kind: 'missing-code-path', featureId: feature.id, detail: path, severity: 'error' });
      }
    }
    for (const path of feature.tests) {
      if (!exists(path)) {
        problems.push({ kind: 'missing-test-path', featureId: feature.id, detail: path, severity: 'error' });
      }
    }
    for (const paper of feature.papers) {
      if (!map.papers[paper.arxiv]) {
        problems.push({ kind: 'unknown-paper', featureId: feature.id, detail: paper.arxiv, severity: 'error' });
      }
    }
    if (feature.code.length === 0) {
      problems.push({
        kind: 'no-code',
        featureId: feature.id,
        detail: feature.notes || 'no implementing file found',
        severity: 'warning',
      });
    }
  }
  for (const [id, paper] of Object.entries(map.papers)) {
    if (paper.verified === false) {
      problems.push({
        kind: 'paper-title-mismatch',
        detail: `${id}: « ${paper.title} » ≠ arXiv « ${paper.arxivTitle ?? '?'} »`,
        severity: 'warning',
      });
    }
  }
  return problems;
}

export interface FeatureTarget {
  feature: Feature;
  score: number;
  /** Plain-language reasons, in the order they weighed. */
  reasons: string[];
  /** Tests to run as the regression guard for any change aimed at this feature. */
  fitnessTests: string[];
  /** Papers the proposer may read for the mechanism to imitate. */
  grounding: Array<{ arxiv: string; title: string }>;
}

/**
 * Rank the features the loop should work on. Deterministic: the weakest
 * evidence first (never exercised, then no tests), a feature nobody runs by
 * default next, and papers only as a tie-break (grounding available). A
 * feature without code is not a target — there is nothing to improve, only a
 * facade to report.
 */
export function selectFeatureTargets(map: FeatureMap, limit = 5): FeatureTarget[] {
  const targets = map.features
    .filter((feature) => feature.code.length > 0)
    .map((feature): FeatureTarget => {
      const reasons: string[] = [];
      let score = 0;
      if (!feature.proof.includes('executed')) {
        if (feature.proof.includes('unproven') || feature.proof.length === 0) {
          score += 4;
          reasons.push('never exercised in real use');
        } else {
          score += 2;
          reasons.push('proven by tests only, never by execution');
        }
      }
      if (feature.tests.length === 0) {
        score += 3;
        reasons.push('no test exercises it');
      }
      if (feature.offByDefault) {
        score += 1;
        reasons.push(`off by default${feature.gate ? ` (${feature.gate})` : ''}`);
      }
      const grounding = feature.papers
        .map((paper) => ({ arxiv: paper.arxiv, title: map.papers[paper.arxiv]?.title ?? paper.arxiv }));
      if (grounding.length > 0) {
        score += 0.5;
        reasons.push(`grounded in ${grounding.length} paper(s)`);
      }
      return { feature, score, reasons, fitnessTests: [...feature.tests], grounding };
    })
    .filter((target) => target.score >= 1)
    .sort((a, b) => b.score - a.score || a.feature.id.localeCompare(b.feature.id));
  return targets.slice(0, Math.max(0, limit));
}

export interface FeatureMapSummary {
  features: number;
  executed: number;
  testsOnly: number;
  unproven: number;
  withoutCode: number;
  withoutTests: number;
  withPapers: number;
  papers: number;
}

export function summarizeFeatureMap(map: FeatureMap): FeatureMapSummary {
  const f = map.features;
  return {
    features: f.length,
    executed: f.filter((x) => x.proof.includes('executed')).length,
    testsOnly: f.filter((x) => !x.proof.includes('executed') && x.proof.includes('tests')).length,
    unproven: f.filter((x) => !x.proof.includes('executed') && !x.proof.includes('tests')).length,
    withoutCode: f.filter((x) => x.code.length === 0).length,
    withoutTests: f.filter((x) => x.tests.length === 0).length,
    withPapers: f.filter((x) => x.papers.length > 0).length,
    papers: Object.keys(map.papers).length,
  };
}
