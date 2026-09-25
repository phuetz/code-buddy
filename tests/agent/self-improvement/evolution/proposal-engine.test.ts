import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { proposeResearchImprovement } from '../../../../src/agent/self-improvement/evolution/proposal-engine.js';
import { registerEvolveCommands } from '../../../../src/commands/cli/evolve-command.js';
import type { FeatureArea } from '../../../../src/agent/self-improvement/evolution/feature-map.js';

const features: FeatureArea[] = [{
  id: 'context-rag', name: 'Context and RAG', description: 'Retrieve reliable context for agent turns',
  paths: ['src/context/'], catalogIds: ['tool:context_expand'],
}];
const discovery = {
  id: 'arxiv-0000', source: 'arxiv', text: 'A reliable method for contextual retrieval.',
  similarity: 0.75, confidence: 0.9,
};
const roots: string[] = [];
const originalCwd = process.cwd();

function project(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'evolve-propose-'));
  roots.push(root);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'marker.ts'), 'export const marker = 1;\n');
  execFileSync('git', ['init', '-q', root]);
  process.chdir(root);
  return root;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('evolve propose', () => {
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
    const result = await proposeResearchImprovement({
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
    const missing = await proposeResearchImprovement({ features, recall: async () => [], hasProvider: () => true });
    expect(missing.status).toBe('stopped');
    if (missing.status === 'stopped') expect(missing.reason).toBe('NO_RECALL');

    const weak = await proposeResearchImprovement({
      features, recall: async () => [{ ...discovery, similarity: 0.1 }], minSimilarity: 0.32,
      hasProvider: () => true,
    });
    expect(weak.status).toBe('stopped');
    if (weak.status === 'stopped') expect(weak.reason).toBe('BELOW_THRESHOLD');
    expect(weak.events.map((event) => event.code)).toContain('RECALL_FOUND');

    const failed = await proposeResearchImprovement({
      features, recall: async () => { throw new Error('ledger unavailable'); }, hasProvider: () => true,
    });
    expect(failed.status).toBe('stopped');
    if (failed.status === 'stopped') expect(failed.reason).toBe('RECALL_ERROR');
  });

  it('names an empty LLM response after selecting a research weakness', async () => {
    project();
    const result = await proposeResearchImprovement({
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

    const result = await proposeResearchImprovement({
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
    const result = await proposeResearchImprovement({
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
});
