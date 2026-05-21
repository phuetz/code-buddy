/**
 * Phase d.22 — verify that `ToolSelectionStrategy.selectToolsForQuery()`
 * honors `maxTools` + `alwaysInclude` overrides passed via the options
 * argument. The agent-executor now passes a tighter set when the active
 * model has `promptProfile: 'lite'` (Ollama qwen / llama / deepseek).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const ragMock = vi.hoisted(() => ({
  getRelevantToolsMock: vi.fn(async (_query: string, _opts: { maxTools?: number; useRAG?: boolean; alwaysInclude?: string[] }) => ({
    selectedTools: [],
    classification: { categories: [], confidence: 0 },
    scores: new Map<string, number>(),
    originalTokens: 0,
    reducedTokens: 0,
  })),
  getAllCodeBuddyToolsMock: vi.fn(async () => []),
  getSkillAugmentedToolsMock: vi.fn((tools: unknown) => tools),
  classifyQueryMock: vi.fn(() => ({ categories: ['general'], confidence: 0.5 })),
}));

vi.mock('../../../src/codebuddy/tools.js', () => ({
  getRelevantTools: ragMock.getRelevantToolsMock,
  getAllCodeBuddyTools: ragMock.getAllCodeBuddyToolsMock,
  getSkillAugmentedTools: ragMock.getSkillAugmentedToolsMock,
  classifyQuery: ragMock.classifyQueryMock,
}));

vi.mock('../../../src/optimization/prompt-cache.js', () => ({
  getPromptCacheManager: () => ({ cacheTools: vi.fn() }),
}));

vi.mock('../../../src/tools/tool-selector.js', () => ({
  getToolSelector: () => ({
    getMetrics: () => ({}),
    getMostMissedTools: () => [],
    getCacheStats: () => ({ classificationCache: { size: 0 }, selectionCache: { size: 0 } }),
    resetMetrics: () => {},
    clearAllCaches: () => {},
  }),
  recordToolRequest: vi.fn(),
  formatToolSelectionMetrics: () => '',
}));

import { ToolSelectionStrategy } from '../../../src/agent/execution/tool-selection-strategy.js';

describe('ToolSelectionStrategy lite-profile overrides', () => {
  beforeEach(() => {
    ragMock.getRelevantToolsMock.mockClear();
  });

  it('passes the caller-supplied maxTools=5 to RAG when promptProfile=lite', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hello world', {
      maxTools: 5,
      alwaysInclude: ['view_file', 'bash', 'search'],
    });

    expect(ragMock.getRelevantToolsMock).toHaveBeenCalledTimes(1);
    const callArgs = ragMock.getRelevantToolsMock.mock.calls[0]!;
    expect(callArgs[1]).toMatchObject({
      maxTools: 5,
      alwaysInclude: ['view_file', 'bash', 'search'],
    });
  });

  it('keeps the default 15-tool budget when no override is passed', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hello world');

    const callArgs = ragMock.getRelevantToolsMock.mock.calls[0]!;
    expect(callArgs[1]?.maxTools).toBe(15);
  });

  it('drops memory-tool inclusions from alwaysInclude on lite override', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hi', {
      maxTools: 5,
      alwaysInclude: ['view_file', 'bash', 'search'],
    });

    const alwaysInclude = ragMock.getRelevantToolsMock.mock.calls[0]![1]?.alwaysInclude;
    // No memory/lessons tools — the LLM on a lite model can't call them
    // and would hallucinate JSON instead.
    expect(alwaysInclude).not.toContain('remember');
    expect(alwaysInclude).not.toContain('lessons_add');
    expect(alwaysInclude).not.toContain('lessons_search');
  });

  it('default config STILL force-includes memory tools (rich/standard profiles)', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hello');

    const alwaysInclude = ragMock.getRelevantToolsMock.mock.calls[0]![1]?.alwaysInclude;
    expect(alwaysInclude).toContain('remember');
    expect(alwaysInclude).toContain('lessons_add');
    expect(alwaysInclude).toContain('lessons_search');
  });

  it('options object can override maxTools without overriding alwaysInclude', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hi', { maxTools: 7 });

    const callArgs = ragMock.getRelevantToolsMock.mock.calls[0]!;
    expect(callArgs[1]?.maxTools).toBe(7);
    // alwaysInclude falls back to the strategy's default (with memory tools)
    expect(callArgs[1]?.alwaysInclude).toContain('remember');
  });

  it('enables web search for internet automation and current docs queries', () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });

    expect(strategy.shouldUseSearchFor('automatiser tout ce qui est acces internet')).toBe(true);
    expect(strategy.shouldUseSearchFor('etudie Stagehand Browserbase')).toBe(true);
    expect(strategy.shouldUseSearchFor('lire la documentation Mem0 node')).toBe(true);
    expect(strategy.shouldUseSearchFor('https://github.com/browserbase/stagehand')).toBe(true);
  });
});
