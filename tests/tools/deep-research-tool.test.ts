/**
 * `deep_research` tool adapter (src/tools/deep-research-tool.ts).
 *
 * Proves the adapter DELEGATES to the injected orchestrator per params
 * (deep / wide / STORM / CKG), returns the bounded report, applies the
 * conservative in-chat bounds, and NEVER throws. No network: the orchestrator
 * and provider resolution are injected fakes.
 *
 * Also asserts the RAG-selection metadata for `deep_research` is registered.
 */
import { describe, it, expect } from 'vitest';

import {
  DeepResearchTool,
  type DeepResearchOrchestratorLike,
} from '../../src/tools/deep-research-tool.js';
import type { DeepResearchLoopResult } from '../../src/agent/deep-research.js';
import type { StormResearchResult } from '../../src/agent/deep-research-storm.js';
import type { WideResearchResult } from '../../src/agent/wide-research.js';
import type { ResolvedCommandProvider } from '../../src/commands/llm-provider-resolution.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

// ---------------------------------------------------------------------------
// Fakes (no network)
// ---------------------------------------------------------------------------

function fakeDeepResult(report = 'Deep body citing [1].'): DeepResearchLoopResult {
  return {
    question: 'Q',
    plan: { question: 'Q', subQuestions: [{ subQuestion: 'SQ', queries: ['q1'] }] },
    sources: [{ id: 1, url: 'https://a.com', title: 'Alpha' }],
    report: `${report}\n\n## Références\n\n[1] Alpha — https://a.com`,
    durationMs: 1200,
    plannerLlmUsed: true,
    synthesisLlmUsed: true,
    duplicatesDropped: 2,
    rounds: 1,
    converged: true,
    roundInfos: [{ round: 1, gapQueries: [], newSources: 1, duplicatesDropped: 2 }],
  };
}

function fakeStormResult(): StormResearchResult {
  return {
    ...fakeDeepResult('STORM article.'),
    perspectives: [
      {
        perspective: { id: 'p1', label: 'Practitioner', angle: 'hands-on', focus: ['use'] },
        sourceCount: 1,
        subQuestions: 1,
        failed: false,
        plannerLlmUsed: true,
      },
    ],
    outline: { title: 'T', sections: [{ title: 'S1' }] },
    outlineLlmUsed: true,
    coWritten: true,
  };
}

function fakeWideResult(): WideResearchResult {
  return {
    topic: 'Q',
    subtopics: ['a', 'b'],
    workerResults: [],
    report: 'Wide synthesized body.',
    durationMs: 900,
    successCount: 2,
  };
}

interface RecordedCall {
  method: 'deepResearch' | 'stormResearch' | 'research';
  args: unknown[];
}

function makeRecordingOrchestrator(opts: {
  deep?: DeepResearchLoopResult;
  storm?: StormResearchResult;
  wide?: WideResearchResult;
  throwOn?: 'deepResearch' | 'stormResearch' | 'research';
}): { orchestrator: DeepResearchOrchestratorLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const guard = (method: RecordedCall['method']): void => {
    if (opts.throwOn === method) throw new Error(`boom in ${method}`);
  };
  const orchestrator: DeepResearchOrchestratorLike = {
    research: async (...args) => {
      calls.push({ method: 'research', args });
      guard('research');
      return opts.wide ?? fakeWideResult();
    },
    deepResearch: async (...args) => {
      calls.push({ method: 'deepResearch', args });
      guard('deepResearch');
      return opts.deep ?? fakeDeepResult();
    },
    stormResearch: async (...args) => {
      calls.push({ method: 'stormResearch', args });
      guard('stormResearch');
      return opts.storm ?? fakeStormResult();
    },
  };
  return { orchestrator, calls };
}

const PROVIDER: ResolvedCommandProvider = {
  apiKey: 'test-key',
  model: 'test-model',
  baseURL: 'https://example.test/v1',
  providerLabel: 'test',
};

function makeTool(
  orchestrator: DeepResearchOrchestratorLike,
  provider: ResolvedCommandProvider | null = PROVIDER,
): DeepResearchTool {
  return new DeepResearchTool({
    makeOrchestrator: () => orchestrator,
    resolveProvider: () => provider,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deep_research adapter — delegation', () => {
  it('deep mode (default) delegates to deepResearch with conservative bounds', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    const res = await makeTool(orchestrator).execute({ topic: '  what is X  ' });

    expect(res.success).toBe(true);
    expect(res.output).toContain('# Deep Research: what is X'); // trimmed topic
    expect(res.output).toContain('## Références');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('deepResearch');
    // args: (question, apiKey, providerConfig, deepOptions, undefined, ckg)
    expect(calls[0]!.args[0]).toBe('what is X');
    expect(calls[0]!.args[1]).toBe('test-key');
    expect(calls[0]!.args[2]).toEqual({ model: 'test-model', baseURL: 'https://example.test/v1' });
    const deepOptions = calls[0]!.args[3] as Record<string, number>;
    expect(deepOptions.maxSubQuestions).toBe(3);
    expect(deepOptions.maxSources).toBe(6); // conservative default cap
    expect(deepOptions.rounds).toBe(1);
    expect(calls[0]!.args[5]).toBeUndefined(); // no ckg
  });

  it('wide mode delegates to research()', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    const res = await makeTool(orchestrator).execute({ topic: 'X', mode: 'wide' });

    expect(res.success).toBe(true);
    expect(res.output).toContain('# Wide Research: X');
    expect(res.output).toContain('Wide synthesized body.');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('research');
  });

  it('perspectives >= 2 routes to STORM (stormResearch)', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    const res = await makeTool(orchestrator).execute({ topic: 'X', perspectives: 3 });

    expect(res.success).toBe(true);
    expect(res.output).toContain('STORM multi-perspective');
    expect(res.output).toContain('Perspectives: 1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('stormResearch');
    const stormOptions = calls[0]!.args[3] as Record<string, number>;
    expect(stormOptions.perspectives).toBe(3);
    expect(stormOptions.maxSources).toBe(6);
  });

  it('ckg:true passes an enabled CKG bridge arg to deepResearch', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    await makeTool(orchestrator).execute({ topic: 'X', ckg: true });
    expect(calls[0]!.args[5]).toEqual({ enabled: true });
  });

  it('clamps agent-supplied iterations and max_sources to the in-chat ceilings', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    await makeTool(orchestrator).execute({ topic: 'X', iterations: 99, max_sources: 999 });
    const deepOptions = calls[0]!.args[3] as Record<string, number>;
    expect(deepOptions.rounds).toBe(3); // clamped from 99 to the in-chat max of 3
    expect(deepOptions.maxSources).toBe(20); // clamped from 999 to 20
  });

  it('falls back to deepResearch when STORM asked but orchestrator has no stormResearch', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    // Strip stormResearch to simulate a minimal orchestrator.
    const noStorm: DeepResearchOrchestratorLike = {
      research: orchestrator.research,
      deepResearch: orchestrator.deepResearch,
    };
    const res = await makeTool(noStorm).execute({ topic: 'X', perspectives: 4 });
    expect(res.success).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['deepResearch']);
  });
});

describe('deep_research adapter — robustness (never throws)', () => {
  it('returns {success:false} (not a throw) when the orchestrator throws', async () => {
    const { orchestrator } = makeRecordingOrchestrator({ throwOn: 'deepResearch' });
    const res = await makeTool(orchestrator).execute({ topic: 'X' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Deep Research failed');
    expect(res.error).toContain('boom in deepResearch');
  });

  it('rejects an empty topic without touching the orchestrator', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    const res = await makeTool(orchestrator).execute({ topic: '   ' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('non-empty');
    expect(calls).toHaveLength(0);
  });

  it('fails cleanly when no provider is available', async () => {
    const { orchestrator, calls } = makeRecordingOrchestrator({});
    const res = await makeTool(orchestrator, null).execute({ topic: 'X' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No LLM provider');
    expect(calls).toHaveLength(0);
  });

  it('truncates an oversized report and appends a truncation note', async () => {
    const huge = 'A'.repeat(20_000);
    const { orchestrator } = makeRecordingOrchestrator({ deep: fakeDeepResult(huge) });
    const res = await makeTool(orchestrator).execute({ topic: 'X' });
    expect(res.success).toBe(true);
    expect(res.output!.length).toBeLessThan(20_000);
    expect(res.output).toContain('rapport tronqué');
  });
});

describe('deep_research adapter — ITool contract & metadata', () => {
  it('exposes a valid schema requiring topic', () => {
    const tool = new DeepResearchTool();
    expect(tool.name).toBe('deep_research');
    const schema = tool.getSchema();
    expect(schema.parameters.required).toContain('topic');
    expect(Object.keys(schema.parameters.properties)).toEqual(
      expect.arrayContaining(['topic', 'mode', 'iterations', 'perspectives', 'ckg', 'max_sources']),
    );
  });

  it('validate() rejects a missing topic', () => {
    const tool = new DeepResearchTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ topic: 'X' }).valid).toBe(true);
  });

  it('is registered in TOOL_METADATA so RAG selection can surface it', () => {
    const meta = TOOL_METADATA.find((m) => m.name === 'deep_research');
    expect(meta, 'deep_research must have RAG metadata').toBeDefined();
    expect(meta!.category).toBe('web');
    expect(meta!.keywords).toEqual(expect.arrayContaining(['research', 'deep research', 'sources', 'cite']));
  });
});
