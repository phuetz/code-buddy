import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerEvolveCommands } from '../../../src/commands/cli/evolve-command.js';
import { runArchivedFicheExperiment } from '../../../src/agent/self-improvement/evolution/archived-experiment.js';
import { proposeResearchImprovement } from '../../../src/agent/self-improvement/evolution/proposal-engine.js';
import { completeFiche } from '../../agent/self-improvement/evolution/experiment-fixture.js';
import { CollectiveKnowledgeGraph } from '../../../src/memory/collective-knowledge-graph.js';
import { createLessonMutatorPort } from '../../../src/agent/self-improvement/index.js';
import { scoreBenchmark } from '../../../src/agent/self-improvement/capability-benchmark.js';

const fiche = {
  ...completeFiche, lane: 'research' as const,
  hypothesis: { metric: 'covered_scenarios', direction: 'increase', minimumImprovement: 1 },
  comparison: { ...completeFiche.comparison, equalBudget: {
    runsPerArm: 2, maxDurationMsPerArm: 60000, maxCostUsdPerArm: 0,
  } },
  acceptance: { minResult: 1, maxDurationMs: 120000, maxCostUsd: 0 },
};
const features = [{ id: 'context-rag', name: 'Context and RAG', description: 'Context retrieval',
  paths: ['src/context/'], catalogIds: ['tool:context_expand'] }];
const discovery = { id: 'article-1', name: 'arxiv:2605.01664v1', type: 'discovery', source: 'arxiv',
  text: 'A reliable contextual method.', similarity: 0.75, confidence: 0.9 };
const scenarios = [{ id: 'context-case', query: 'context retrieval', expectIncludes: ['source attribution'],
  description: 'Context response cites a source', source: 'benchmark:context-case' }];

async function plan(root: string, graph: CollectiveKnowledgeGraph) {
  return proposeResearchImprovement({ fiche, features, graph, archiveRoot: path.join(root, 'proposals'),
    recall: async () => [discovery],
    chat: async (prompt) => prompt.includes('Réponds STRICTEMENT en JSON')
      ? JSON.stringify({ approach: 'fresh', summary: 'Compare methods', steps: [{ title: 'Measure', description: 'Run paired trials.' }] })
      : 'Test contextual reranking against the existing ranker.',
  });
}

describe('evolve experiment', () => {
  it('exposes a product command to run an archived fiche', () => {
    const program = new Command();
    registerEvolveCommands(program);
    const evolve = program.commands.find((command) => command.name() === 'evolve');
    expect(evolve?.commands.map((command) => command.name())).toContain('experiment');
  });

  for (const [status, content] of [
    ['passed', 'For context retrieval, provide source attribution in the answer.'],
    ['failed', 'For context retrieval, ignore unrelated coffee preferences.'],
  ] as const) {
    it(`runs an archived fiche, records ${status}, rolls back, then suppresses the tried idea`, async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'dgm-archived-experiment-'));
      try {
        const graph = new CollectiveKnowledgeGraph({ ledgerPath: path.join(root, 'ledger.jsonl'), persistentEmbeddingCache: false });
        const proposed = await plan(root, graph);
        expect(proposed.status).toBe('planned');
        if (proposed.status !== 'planned') return;
        const port = createLessonMutatorPort(root);
        expect(scoreBenchmark(scenarios, port).covered).toBe(0);
        const search = vi.spyOn(port, 'search');
        const result = runArchivedFicheExperiment(proposed.record.id, {
          targetScenarioId: 'context-case', scenarios, lesson: { category: 'RULE', content },
        }, { archiveRoot: path.join(root, 'proposals'), graph, port, workDir: root,
          revision: 'test-revision', machine: 'test-machine', now: () => new Date('2026-09-26T10:30:00.000Z') });
        expect(result.outcome.accepted).toBe(status === 'passed');
        expect(result.outcome.rolledBack).toBe(true);
        expect(search).toHaveBeenCalledTimes(4); // two measurements in each arm
        expect(scoreBenchmark(scenarios, port).covered).toBe(0);
        const lessons = graph.getCurrentEntitiesByNamePrefix('lesson', 'dgm-experiment-');
        expect(lessons).toHaveLength(1);
        expect(lessons[0]?.text).toContain(`"status":"${status}"`);
        expect(() => runArchivedFicheExperiment(proposed.record.id, {
          targetScenarioId: 'context-case', scenarios, lesson: { category: 'RULE', content },
        }, { archiveRoot: path.join(root, 'proposals'), graph, port, workDir: root,
          revision: 'test-revision', machine: 'test-machine' })).toThrow(/ALREADY_TRIED/);
        const repeated = await plan(root, graph);
        expect(repeated.status).toBe('stopped');
        if (repeated.status === 'stopped') expect(repeated.reason).toBe('ALREADY_TRIED');
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
});
