import { describe, expect, it } from 'vitest';

import type { LessonMutatorPort } from '../../../src/agent/self-improvement/empirical-gate.js';
import { SelfImprovementEngine } from '../../../src/agent/self-improvement/engine.js';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';
import {
  LlmProposer,
  buildLessonDraftPrompt,
  type LessonDrafter,
} from '../../../src/agent/self-improvement/proposer.js';
import type { BenchmarkScenario } from '../../../src/agent/self-improvement/types.js';

// Hermétique : sans ces mocks, createLlmDrafter() résolvait le VRAI fournisseur de la machine
// (ChatGPT OAuth) et appelait un modèle en test unitaire — vert dans un clone au HOME vierge,
// rouge (et payant en temps) sur la machine de l'auteur (04/09/2026).
vi.mock('../../../src/commands/llm-provider-resolution.js', () => ({ resolveCommandProvider: () => undefined }));
vi.mock('../../../src/utils/provider-detector.js', () => ({ detectProviderFromEnv: () => null }));

function fakePort(): LessonMutatorPort & { items: Array<{ id: string; content: string; context?: string }> } {
  const items: Array<{ id: string; content: string; context?: string }> = [];
  let n = 0;
  return {
    items,
    search: (q) =>
      items.filter(
        (i) =>
          i.content.toLowerCase().includes(q.toLowerCase()) ||
          (i.context?.toLowerCase().includes(q.toLowerCase()) ?? false),
      ),
    add: (_c, content, context) => {
      const item = { id: `L${++n}`, content, context };
      items.push(item);
      return { id: item.id };
    },
    remove: (id) => {
      const i = items.findIndex((x) => x.id === id);
      if (i >= 0) items.splice(i, 1);
      return i >= 0;
    },
  };
}

const ONE: BenchmarkScenario[] = [
  { id: 'npm-test-path-filter', query: 'npm test', expectIncludes: ['path filter'], description: 'prefer a path filter' },
];

describe('LlmProposer (creative generation, deterministic empirical gate)', () => {
  it('builds a strict draft prompt grounded in the scenario and friction', () => {
    const prompt = buildLessonDraftPrompt(ONE[0]!, [
      { id: 'e1', source: 'run', kind: 'bash', detail: 'npm test timed out', context: 'tool: bash' },
    ]);
    expect(prompt).toContain('path filter'); // must-mention
    expect(prompt).toContain('npm test'); // retrievable-for query
    expect(prompt).toContain('npm test timed out'); // friction evidence
    expect(prompt).toContain('ONLY the lesson text');
  });

  it('grounds the draft in the collective AI knowledge base when knowledge is provided', () => {
    const withKnowledge = buildLessonDraftPrompt(ONE[0]!, [], [
      'Les inhibiteurs de checkpoint réactivent les lymphocytes T.',
      'L’attention multi-têtes améliore la modélisation du contexte long.',
    ]);
    expect(withKnowledge).toContain('collective AI knowledge base');
    expect(withKnowledge).toContain('attention multi-têtes');
    // Empty knowledge → no section (behaviour unchanged when the CKG is not fed).
    const without = buildLessonDraftPrompt(ONE[0]!, []);
    expect(without).not.toContain('collective AI knowledge base');
  });

  it('applies an LLM draft that empirically improves the benchmark', async () => {
    const port = fakePort();
    const drafter: LessonDrafter = async () => ({
      category: 'RULE',
      content: 'When running npm test, pass a path filter so the suite stays fast.',
    });
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(drafter),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle([
      { id: 'e1', source: 'run', kind: 'bash', detail: 'npm test timed out', context: 'tool: bash' },
    ]);
    expect(result.applied).toBe(true);
    expect(result.gate?.delta).toBe(1);
    expect(port.items).toHaveLength(1);
  });

  it('rejects a hallucinated/off-target LLM draft via the deterministic gate', async () => {
    const port = fakePort();
    const drafter: LessonDrafter = async () => ({
      category: 'RULE',
      content: 'Prefer tabs over spaces in all source files, always and forever everywhere.',
    });
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(drafter),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle();
    expect(result.applied).toBe(false);
    expect(result.gate?.rejectionReason).toBe('no-improvement');
    expect(port.items).toHaveLength(0); // rolled back — nothing kept
  });

  it('declines cleanly when the drafter returns null', async () => {
    const port = fakePort();
    const engine = new SelfImprovementEngine({
      scenarios: ONE,
      port,
      proposer: new LlmProposer(async () => null),
      archive: new EvolutionaryArchive({ workDir: process.cwd() }),
      autonomy: 'auto-apply',
    });
    const result = await engine.runCycle();
    expect(result.proposalId).toBeNull();
    expect(result.applied).toBe(false);
  });

  it('selects LlmProposer when CODEBUDDY_SELF_IMPROVE_PROPOSER=llm is set', async () => {
    const { createWorkspaceEngine } = await import('../../../src/agent/self-improvement/index.js');
    const { StaticProposer } = await import('../../../src/agent/self-improvement/proposer.js');

    const origEnv = process.env.CODEBUDDY_SELF_IMPROVE_PROPOSER;
    try {
      delete process.env.CODEBUDDY_SELF_IMPROVE_PROPOSER;
      const defaultEngine = createWorkspaceEngine({ workDir: process.cwd() });
      expect((defaultEngine as unknown as { proposer: unknown }).proposer instanceof StaticProposer).toBe(true);

      process.env.CODEBUDDY_SELF_IMPROVE_PROPOSER = 'llm';
      const llmEngine = createWorkspaceEngine({ workDir: process.cwd() });
      expect((llmEngine as unknown as { proposer: unknown }).proposer instanceof LlmProposer).toBe(true);
    } finally {
      if (origEnv !== undefined) {
        process.env.CODEBUDDY_SELF_IMPROVE_PROPOSER = origEnv;
      } else {
        delete process.env.CODEBUDDY_SELF_IMPROVE_PROPOSER;
      }
    }
  });

  it('createLlmDrafter handles unconfigured providers gracefully without throwing', async () => {
    const { createLlmDrafter } = await import('../../../src/agent/self-improvement/llm-drafter.js');
    const drafter = createLlmDrafter();
    const result = await drafter(ONE[0]!, []);
    // Without an active provider configured in unit tests, gracefully returns null
    expect(result).toBeNull();
  });
});
