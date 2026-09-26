import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeResearchImprovement } from '../../../../src/agent/self-improvement/evolution/proposal-engine.js';
import { registerEvolveCommands } from '../../../../src/commands/cli/evolve-command.js';
import type { FeatureArea } from '../../../../src/agent/self-improvement/evolution/feature-map.js';
import type { VariantRecord } from '../../../../src/agent/self-improvement/evolution/code-variant-store.js';
import { completeFiche } from './experiment-fixture.js';
import { CollectiveKnowledgeGraph } from '../../../../src/memory/collective-knowledge-graph.js';
import { recordExperimentLesson } from '../../../../src/agent/self-improvement/evolution/experiment-lessons.js';
import { parseExperimentFiche } from '../../../../src/agent/self-improvement/evolution/experiment-fiche.js';

const fiche = { ...completeFiche, lane: 'research' as const };

const features: FeatureArea[] = [{
  id: 'context-rag', name: 'Context and RAG', description: 'Retrieve reliable context for agent turns',
  paths: ['src/context/'], catalogIds: ['tool:context_expand'],
}];
const discovery = {
  id: 'arxiv-0000', name: 'arxiv:2605.01664v1', type: 'discovery', source: 'arxiv', text: 'A reliable method for contextual retrieval.',
  similarity: 0.75, confidence: 0.9,
};
const dreamRecords: VariantRecord[] = [
  {
    id: 'prior-low', branch: 'evolve/low', sha: 'low', baselineSha: 'base', score: 0.2,
    passedAll: true, regressions: [], createdAt: '2026-09-25T00:00:01.000Z',
    discovery: { worldId: 'base', primaryParentId: 'root', weaknessId: 'research-context-rag', baselineScore: 0.1 },
  },
  {
    id: 'prior-high', branch: 'evolve/high', sha: 'high', baselineSha: 'base', score: 0.9,
    passedAll: true, regressions: [], createdAt: '2026-09-25T00:00:02.000Z',
    discovery: { worldId: 'base', primaryParentId: 'root', weaknessId: 'research-self-improvement-1', baselineScore: 0.1 },
  },
];
const roots: string[] = [];
const originalCwd = process.cwd();

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'evolve-propose-'));
  roots.push(root);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'marker.ts'), 'export const marker = 1;\n');
  mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
  process.chdir(root);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('evolve propose', () => {
  it('routes an observed failure to article recall and archives only an experiment', async () => {
    const root = project();
    const recall = vi.fn(async () => [discovery]);
    const chat = vi.fn(async (prompt: string) => prompt.includes('Réponds STRICTEMENT en JSON')
      ? JSON.stringify({ approach: 'fresh', summary: 'Test the reranker', steps: [{ title: 'Compare', description: 'Run paired trials.' }] })
      : 'Compare the current ranker to contextual reranking.');
    const result = await proposeResearchImprovement({ fiche: completeFiche, features, recall, chat,
      archiveRoot: path.join(root, 'proposals') });
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.record.source).toBe('usage');
    expect(result.record.fiche.problem.evidence.reference).toBe('run-42/case-7');
    expect(recall.mock.calls[0]?.[0]).toContain('context benchmark misses');
    expect(readdirSync(path.join(root, '.git', 'refs', 'heads'))).toEqual([]);
  });

  it('allocates research after four usage proposals with the default budget', async () => {
    const root = project();
    const archiveRoot = path.join(root, 'proposals');
    mkdirSync(archiveRoot);
    for (let i = 0; i < 4; i++) writeFileSync(path.join(archiveRoot, `proposal-usage-${i}.json`),
      JSON.stringify({ fiche: completeFiche }));
    const result = await proposeResearchImprovement({ fiche, lane: 'auto', features,
      archiveRoot, recall: async () => [discovery], chat: async (prompt) => prompt.includes('Réponds STRICTEMENT en JSON')
        ? JSON.stringify({ approach: 'fresh', summary: 'Plan', steps: [{ title: 'Compare', description: 'Run paired trials.' }] })
        : 'Compare contextual reranking to the current ranker.' });
    expect(result.status).toBe('planned');
    if (result.status === 'planned') expect(result.record.source).toBe('research');
  });
  it('refuses an incomplete fiche before recall or archive', async () => {
    const root = project();
    const recall = vi.fn(async () => [discovery]);
    const result = await proposeResearchImprovement({ fiche: { ...fiche, acceptance: undefined },
      features, recall, archiveRoot: path.join(root, 'proposals') });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('FICHE_INCOMPLETE');
    expect(recall).not.toHaveBeenCalled();
    expect(readdirSync(root)).not.toContain('proposals');
  });

  it('refuses a fiche whose stable publication id differs from the recalled article', async () => {
    project();
    const result = await proposeResearchImprovement({ fiche: { ...fiche, research: {
      ...fiche.research, articleId: 'arxiv:2605.01665',
    } }, features, recall: async () => [discovery], hasProvider: () => true });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('FICHE_MISMATCH');
  });

  it('does not propose an article, feature and method already recorded as a failed lesson', async () => {
    const root = project();
    const graph = new CollectiveKnowledgeGraph({ ledgerPath: path.join(root, 'ledger.jsonl'), persistentEmbeddingCache: false });
    recordExperimentLesson(graph, { experimentId: 'failed-1', fiche: parseExperimentFiche(fiche),
      result: { status: 'failed', before: 0.7, after: 0.6, durationMs: 100, costUsd: 0, notes: ['regression'] },
      provenance: { at: '2026-09-26T10:00:00.000Z', revision: 'abc', machine: 'qa', model: 'fixture', conditions: 'paired trials' },
    });
    const chat = vi.fn(async () => 'No plan should be synthesized');
    const result = await proposeResearchImprovement({ fiche, features, graph, recall: async () => [discovery],
      chat, archiveRoot: path.join(root, 'proposals') });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('ALREADY_TRIED');
    expect(chat).not.toHaveBeenCalled();
    expect(readdirSync(root)).not.toContain('proposals');
  });
  it('registers propose separately from the mutating run command', () => {
    const program = new Command();
    registerEvolveCommands(program);
    const evolve = program.commands.find((command) => command.name() === 'evolve');
    expect(evolve?.commands.map((command) => command.name())).toContain('propose');
    expect(evolve?.commands.map((command) => command.name())).toContain('run');
  });

  it('names a missing provider before recall and writes no archive', async () => {
    const root = project();
    const chat = vi.fn(async () => 'should never be called');
    const recall = vi.fn(async () => [discovery]);
    const result = await proposeResearchImprovement({ fiche,
      features, recall, hasProvider: () => false, chat,
      archiveRoot: path.join(root, 'archive'),
    });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('PROVIDER_MISSING');
    expect(result.events.map((event) => event.code)).toEqual([
      'RESEARCH_SELECTED', 'PROVIDER_MISSING',
    ]);
    expect(recall).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(readdirSync(root)).not.toContain('archive');
  });

  it('distinguishes no recall from a recalled article below the similarity threshold', async () => {
    project();
    const missing = await proposeResearchImprovement({ fiche, features, recall: async () => [], hasProvider: () => true });
    expect(missing.status).toBe('stopped');
    if (missing.status === 'stopped') expect(missing.reason).toBe('NO_RECALL');

    const weak = await proposeResearchImprovement({ fiche,
      features, recall: async () => [{ ...discovery, similarity: 0.1 }], minSimilarity: 0.32,
      hasProvider: () => true,
    });
    expect(weak.status).toBe('stopped');
    if (weak.status === 'stopped') expect(weak.reason).toBe('BELOW_THRESHOLD');
    expect(weak.events.map((event) => event.code)).toContain('RECALL_FOUND');

    const failed = await proposeResearchImprovement({ fiche,
      features, recall: async () => { throw new Error('ledger unavailable'); }, hasProvider: () => true,
    });
    expect(failed.status).toBe('stopped');
    if (failed.status === 'stopped') expect(failed.reason).toBe('RECALL_ERROR');
  });

  it('stops before goal synthesis when recall contains only a non-publication video', async () => {
    project();
    const chat = vi.fn(async () => 'Applique la méthode au contexte.');
    const result = await proposeResearchImprovement({ fiche, features,
      recall: async () => [{ ...discovery, source: 'youtube:vision-ia', similarity: 0.95 }], chat });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('NO_SCIENTIFIC_MATCH');
    expect(chat).not.toHaveBeenCalled();
  });

  it('names an empty LLM response after selecting a research weakness', async () => {
    project();
    const result = await proposeResearchImprovement({ fiche,
      features, recall: async () => [discovery], chat: async () => null,
    });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('GOAL_LLM_UNAVAILABLE');
    expect(result.events.map((event) => event.code)).toContain('WEAKNESS_SELECTED');
  });

  it('archives an injected LLM plan without writing under src or creating a branch', async () => {
    const root = project();
    const beforeSource = readdirSync(path.join(root, 'src'));
    const beforeContent = readFileSync(path.join(root, 'src', 'marker.ts'), 'utf8');
    const beforeBranches = readdirSync(path.join(root, '.git', 'refs', 'heads'));
    const chat = vi.fn(async (prompt: string) => prompt.includes('Réponds STRICTEMENT en JSON')
      ? JSON.stringify({ approach: 'fresh', summary: 'Améliorer le rappel contextuel', steps: [{ title: 'Mesurer', description: 'Ajouter un banc de pertinence au rappel.' }] })
      : 'Améliore le rappel contextuel avec un banc de pertinence reproductible.');

    const result = await proposeResearchImprovement({ fiche,
      features, recall: async () => [discovery], chat,
      archiveRoot: path.join(root, 'isolated-profile', 'proposals'),
      now: () => new Date('2026-09-25T12:00:00.000Z'),
    });
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.events.map((event) => event.code)).toEqual([
      'RESEARCH_SELECTED', 'PROVIDER_AVAILABLE', 'RECALL_FOUND', 'WEAKNESS_SELECTED',
      'GOAL_SYNTHESIZED', 'PLAN_CREATED', 'PLAN_ARCHIVED',
    ]);
    const saved = JSON.parse(readFileSync(result.archivePath, 'utf8')) as typeof result.record;
    expect(saved.feature.catalogIds).toEqual(['tool:context_expand']);
    expect(saved.article.id).toBe('arxiv-0000');
    expect(saved.plan.steps[0]?.title).toBe('Mesurer');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(readdirSync(path.join(root, 'src'))).toEqual(beforeSource);
    expect(readFileSync(path.join(root, 'src', 'marker.ts'), 'utf8')).toBe(beforeContent);
    expect(readdirSync(path.join(root, '.git', 'refs', 'heads'))).toEqual(beforeBranches);
    if (process.platform !== 'win32') expect(statSync(result.archivePath).mode & 0o777).toBe(0o600);
  });

  it('refuses an archive redirected into src before creating a file', async () => {
    const root = project();
    const result = await proposeResearchImprovement({ fiche,
      features, recall: async () => [discovery],
      chat: async (prompt) => prompt.includes('Réponds STRICTEMENT en JSON')
        ? JSON.stringify({ approach: 'fresh', summary: 'Plan', steps: [{ title: 'Étape', description: 'Tester le rappel.' }] })
        : 'Améliore le rappel avec une vérification reproductible.',
      archiveRoot: path.join(root, 'src', 'proposals'),
    });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('ARCHIVE_FAILED');
    expect(readdirSync(path.join(root, 'src'))).toEqual(['marker.ts']);
  });

  it('keeps the original source path when dream is disabled', async () => {
    project();
    vi.stubEnv('CODEBUDDY_DREAM_RSI', '');
    const recall = vi.fn(async () => [discovery]);
    const result = await proposeResearchImprovement({ fiche,
      features, recall, hasProvider: () => true, dreamRecords: [],
      chat: async () => null,
    });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('GOAL_LLM_UNAVAILABLE');
    expect(result.events.map((event) => event.stage)).not.toContain('dream');
    expect(recall).toHaveBeenCalledOnce();
  });

  it('stops by name when dream is enabled but the archive has no replayable tree', async () => {
    project();
    const recall = vi.fn(async () => [discovery]);
    const result = await proposeResearchImprovement({ fiche,
      features, recall, hasProvider: () => true, dreamEnabled: true, dreamRecords: [],
    });
    expect(result.status).toBe('stopped');
    if (result.status === 'stopped') expect(result.reason).toBe('DREAM_ARCHIVE_INSUFFICIENT');
    expect(result.events.at(-1)?.stage).toBe('dream');
    expect(recall).not.toHaveBeenCalled();
  });

  it('uses the dreamed weakness and records its observed parent in a proposal', async () => {
    const root = project();
    const twoFeatures = [...features, {
      id: 'self-improvement', name: 'Self improvement', description: 'Improve the DGM policy',
      paths: ['src/agent/self-improvement/'], catalogIds: [],
    }];
    const recall = vi.fn(async () => [discovery]);
    const result = await proposeResearchImprovement({
      features: twoFeatures, fiche: { ...fiche, feature: { id: 'self-improvement', files: ['src/agent/self-improvement/evolution/dream-replay.ts'] } }, recall, dreamEnabled: true, dreamRecords, hasProvider: () => true,
      chat: async (prompt) => prompt.includes('Réponds STRICTEMENT en JSON')
        ? JSON.stringify({ approach: 'fresh', summary: 'Planifier la recherche', steps: [{ title: 'Mesurer', description: 'Mesurer le rejeu.' }] })
        : 'Améliore le rejeu des branches avec une mesure reproductible.',
      archiveRoot: path.join(root, 'proposals'),
    });
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.record.feature.id).toBe('self-improvement');
    expect(result.record.weakness.id).toBe('research-self-improvement-1');
    expect(result.record.dream?.parentId).toBe('root');
    expect(result.record.dream?.evidence).toBe('replay');
    expect(result.events.map((event) => event.code)).toContain('DREAM_POLICY_SELECTED');
    expect(recall).toHaveBeenCalledOnce();
  });

  it('binds the archived plan to the selected recorded parent', async () => {
    const root = project();
    const stronger = {
      ...dreamRecords[0]!, id: 'prior-stronger', score: 0.95,
      createdAt: '2026-09-25T00:00:03.000Z',
      discovery: {
        ...dreamRecords[0]!.discovery!, primaryParentId: 'prior-low',
      },
    };
    const result = await proposeResearchImprovement({ fiche,
      features, dreamEnabled: true, dreamRecords: [...dreamRecords, stronger],
      hasProvider: () => true, recall: async () => [discovery],
      chat: async (prompt) => prompt.includes('Réponds STRICTEMENT en JSON')
        ? JSON.stringify({ approach: 'fresh', summary: 'Planifier le rappel', steps: [{ title: 'Mesurer', description: 'Mesurer la qualité.' }] })
        : 'Améliore le rappel avec une mesure reproductible.',
      archiveRoot: path.join(root, 'proposals'),
    });
    expect(result.status).toBe('planned');
    if (result.status !== 'planned') return;
    expect(result.record.dream?.parentId).toBe('prior-low');
    expect(result.record.plan.approach).toBe('build-on');
    expect(result.record.plan.basedOn).toBe('prior-low');
  });
});
