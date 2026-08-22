import { describe, expect, it } from 'vitest';

import {
  buildImprovementDigest,
  parseDigestSince,
  renderImprovementDigestHtml,
  renderImprovementDigestMarkdown,
  type ImprovementDigestSources,
} from '../../../src/agent/self-improvement/digest.js';

const since = new Date('2026-08-09T12:00:00.000Z');
const until = new Date('2026-08-16T12:00:00.000Z');

function fixtureSources(): ImprovementDigestSources {
  return {
    archiveMode: 'all-cycles',
    archive: [
      {
        createdAt: '2026-08-08T09:00:00.000Z',
        proposalId: 'old-tool',
        kind: 'tool',
        appliedRef: 'authored__old',
      },
      {
        createdAt: '2026-08-10T09:00:00.000Z',
        proposalId: 'tool-1',
        kind: 'tool',
        appliedRef: 'authored__summarise_logs',
      },
      {
        createdAt: '2026-08-11T09:00:00.000Z',
        proposalId: 'skill-1',
        kind: 'skill',
        appliedRef: 'authored-debug-playbook',
      },
      {
        createdAt: '2026-08-12T09:00:00.000Z',
        proposalId: 'tool-rejected',
        kind: 'tool',
        gate: { accepted: false, rejectionReason: 'heldout-fail' },
      },
      {
        createdAt: '2026-08-13T09:00:00.000Z',
        proposalId: 'lesson-1',
        kind: 'lesson',
        appliedRef: 'lesson-a',
        targetScenarioId: 'logger-not-console',
      },
    ],
    learningStore: [
      {
        id: 'v0',
        createdAt: '2026-08-08T10:00:00.000Z',
        reason: 'baseline',
        score: 0.25,
        lessons: [{ category: 'RULE', content: 'Old lesson.' }],
      },
      {
        id: 'v1',
        createdAt: '2026-08-13T10:00:00.000Z',
        reason: 'improve cycle',
        scenarioId: 'logger-not-console',
        score: 0.5,
        lessons: [
          { category: 'RULE', content: 'Old lesson.' },
          { id: 'lesson-a', category: 'RULE', content: 'Use logger, not console.log.' },
        ],
      },
      {
        id: 'v2',
        createdAt: '2026-08-15T10:00:00.000Z',
        reason: 'improve loop',
        score: 0.75,
        lessons: [
          { category: 'RULE', content: 'Old lesson.' },
          { id: 'lesson-a', category: 'RULE', content: 'Use logger, not console.log.' },
          { category: 'PATTERN', content: 'Filter npm tests by their path.' },
        ],
      },
    ],
    artifacts: [
      {
        name: 'imported-release-notes',
        kind: 'imported-skill',
        createdAt: '2026-08-14T09:00:00.000Z',
      },
      {
        name: 'authored-debug-playbook',
        kind: 'authored-skill',
        createdAt: '2026-08-15T09:00:00.000Z',
        estimated: true,
      },
    ],
  };
}

describe('self-improvement digest', () => {
  it('aggregates tools, skills, learned lessons, cycles and gate outcomes', () => {
    const digest = buildImprovementDigest(fixtureSources(), { since, until });

    expect(digest.tools).toEqual({
      count: 1,
      names: ['authored__summarise_logs'],
    });
    expect(digest.skills.authored).toEqual({
      count: 1,
      names: ['authored-debug-playbook'],
    });
    expect(digest.skills.imported).toEqual({
      count: 1,
      names: ['imported-release-notes'],
    });
    expect(digest.lessons.items.map((lesson) => lesson.content)).toEqual([
      'Use logger, not console.log.',
      'Filter npm tests by their path.',
    ]);
    expect(digest.cycles).toEqual({ launched: 4, complete: true });
    expect(digest.gates.passed).toBe(3);
    expect(digest.gates.rejected).toBe(1);
    expect(digest.gates.rejectionReasons).toEqual([{ reason: 'heldout-fail', count: 1 }]);
    expect(digest.benchmark.primaryModel).toBe('couche-apprenable');
    expect(digest.benchmark.startScore).toBe(0.25);
    expect(digest.benchmark.endScore).toBe(0.75);
    expect(digest.benchmark.delta).toBe(0.5);
    expect(digest.benchmark.deltaPercentPoints).toBe(50);
    expect(renderImprovementDigestMarkdown(digest)).toContain('Le benchmark a gagné 50 points.');
  });

  it('uses an inclusive --since boundary and excludes older activity', () => {
    const digest = buildImprovementDigest(fixtureSources(), {
      since: new Date('2026-08-14T09:00:00.000Z'),
      until,
    });

    expect(digest.tools.count).toBe(0);
    expect(digest.skills.authored.count).toBe(0);
    expect(digest.skills.imported.names).toEqual(['imported-release-notes']);
    expect(digest.lessons.items.map((lesson) => lesson.content)).toEqual([
      'Filter npm tests by their path.',
    ]);
    expect(digest.benchmark.startScore).toBe(0.5);
    expect(digest.benchmark.endScore).toBe(0.75);
    expect(digest.benchmark.delta).toBe(0.25);
  });

  it('averages benchmark scenarios per run before computing the score delta', () => {
    const digest = buildImprovementDigest(
      {
        benchmark: [
          {
            runId: 'before',
            model: 'model-a',
            scenario: 'a',
            score: 1,
            ts: '2026-08-08T00:00:00.000Z',
          },
          {
            runId: 'before',
            model: 'model-a',
            scenario: 'b',
            score: 0.5,
            ts: '2026-08-08T00:00:01.000Z',
          },
          {
            runId: 'after',
            model: 'model-a',
            scenario: 'a',
            score: 1,
            ts: '2026-08-15T00:00:00.000Z',
          },
          {
            runId: 'after',
            model: 'model-a',
            scenario: 'b',
            score: 1,
            ts: '2026-08-15T00:00:01.000Z',
          },
        ],
      },
      { since, until }
    );

    expect(digest.benchmark.startScore).toBe(0.75);
    expect(digest.benchmark.endScore).toBe(1);
    expect(digest.benchmark.delta).toBe(0.25);
    expect(digest.benchmark.deltaPercentPoints).toBe(25);
  });

  it('degrades cleanly when every source is absent or empty', () => {
    const absent = buildImprovementDigest({}, { since, until });
    const empty = buildImprovementDigest(
      { archive: [], learningStore: [], benchmark: [], artifacts: [] },
      { since, until }
    );

    for (const digest of [absent, empty]) {
      expect(digest.hasActivity).toBe(false);
      expect(digest.tools.count).toBe(0);
      expect(digest.skills.total).toBe(0);
      expect(digest.lessons.count).toBe(0);
      expect(digest.cycles.launched).toBe(0);
      expect(digest.gates).toEqual({
        passed: 0,
        rejected: 0,
        complete: false,
        rejectionReasons: [],
      });
      expect(digest.benchmark.delta).toBeNull();
      expect(renderImprovementDigestMarkdown(digest)).toContain('Rien à rapporter');
      const html = renderImprovementDigestHtml(digest);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Rien à rapporter');
      expect(html).not.toMatch(/https?:\/\//i);
      expect(html).not.toMatch(/<(?:script|iframe)\b/i);
    }
  });

  it('parses relative periods against an injected clock', () => {
    expect(parseDigestSince('7d', until).toISOString()).toBe('2026-08-09T12:00:00.000Z');
    expect(parseDigestSince('24h', until).toISOString()).toBe('2026-08-15T12:00:00.000Z');
    expect(() => parseDigestSince('tomorrow', until)).toThrow(/Période invalide/);
  });

  it('escapes untrusted artifact names in the standalone HTML', () => {
    const digest = buildImprovementDigest(
      {
        artifacts: [
          {
            name: 'imported-<script>alert(1)</script>',
            kind: 'imported-skill',
            createdAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      },
      { since, until }
    );

    const html = renderImprovementDigestHtml(digest);
    expect(html).toContain('imported-&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
