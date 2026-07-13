/**
 * Phase d.22 — verify that `ToolSelectionStrategy.selectToolsForQuery()`
 * honors `maxTools` + `alwaysInclude` overrides passed via the options
 * argument. The agent-executor now passes a tighter set when the active
 * model has `promptProfile: 'lite'` (Ollama qwen / llama / deepseek).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CodeBuddyTool } from '../../../src/codebuddy/client.js';

function makeTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  };
}

function makeSelection(toolNames: string[]) {
  return {
    selectedTools: toolNames.map(makeTool),
    classification: { categories: [], confidence: 0 },
    scores: new Map<string, number>(),
    originalTokens: 0,
    reducedTokens: 0,
  };
}

const ragMock = vi.hoisted(() => ({
  getRelevantToolsMock: vi.fn(async (_query: string, _opts: {
    maxTools?: number;
    minScore?: number;
    useRAG?: boolean;
    alwaysInclude?: string[];
    useAdaptiveThreshold?: boolean;
    modelName?: string;
  }) => ({
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
    ragMock.getRelevantToolsMock.mockReset();
    ragMock.getRelevantToolsMock.mockImplementation(async () => makeSelection([]));
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

  it('passes minimum-score and adaptive-threshold configuration to RAG', async () => {
    const strategy = new ToolSelectionStrategy({
      enableCaching: false,
      minScore: 0.83,
      useAdaptiveThreshold: false,
    });
    await strategy.selectToolsForQuery('hello world');

    expect(ragMock.getRelevantToolsMock.mock.calls[0]?.[1]).toMatchObject({
      minScore: 0.83,
      useAdaptiveThreshold: false,
    });
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
    expect(alwaysInclude).not.toContain('memory_propose');
    expect(alwaysInclude).not.toContain('lessons_add');
    expect(alwaysInclude).not.toContain('lessons_search');
  });

  it('default config STILL force-includes memory tools (rich/standard profiles)', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    await strategy.selectToolsForQuery('hello');

    const alwaysInclude = ragMock.getRelevantToolsMock.mock.calls[0]![1]?.alwaysInclude;
    expect(alwaysInclude).toContain('remember');
    expect(alwaysInclude).toContain('memory_propose');
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
    expect(callArgs[1]?.alwaysInclude).toContain('memory_propose');
  });

  it('filters model-facing schemas using the active model tool config', async () => {
    ragMock.getRelevantToolsMock.mockResolvedValueOnce(
      makeSelection(['view_file', 'browser', 'screenshot', 'computer_control']),
    );

    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('inspect the browser screenshot', {
      modelName: 'qwen3:8b',
      alwaysInclude: ['view_file', 'browser', 'screenshot', 'computer_control'],
    });

    expect(result.tools.map(tool => tool.function.name)).toEqual(['view_file']);
    expect(result.selection?.selectedTools.map(tool => tool.function.name)).toEqual(['view_file']);
  });

  it('drops all model-facing schemas for chat-only model configs', async () => {
    ragMock.getRelevantToolsMock.mockResolvedValueOnce(
      makeSelection(['view_file', 'bash']),
    );

    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('run a command', {
      modelName: 'qwen2.5-coder:7b',
    });

    expect(result.tools).toEqual([]);
    expect(result.selection?.selectedTools).toEqual([]);
  });

  it('keeps forced chat-only schemas for lab probes while still applying capability filters', async () => {
    const previous = process.env.GROK_FORCE_TOOLS;
    process.env.GROK_FORCE_TOOLS = 'true';
    try {
      ragMock.getRelevantToolsMock.mockResolvedValueOnce(
        makeSelection(['view_file', 'bash', 'browser', 'screenshot']),
      );

      const strategy = new ToolSelectionStrategy({ enableCaching: false });
      const result = await strategy.selectToolsForQuery('force a local probe', {
        modelName: 'qwen2.5-coder:7b',
      });

      expect(result.tools.map(tool => tool.function.name)).toEqual(['view_file', 'bash']);
    } finally {
      if (previous === undefined) delete process.env.GROK_FORCE_TOOLS;
      else process.env.GROK_FORCE_TOOLS = previous;
    }
  });

  it('does not reuse cached model-facing schemas across model configs', async () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: true });
    strategy.cacheTools([makeTool('view_file'), makeTool('browser')], 'gpt-4o');
    ragMock.getRelevantToolsMock.mockResolvedValueOnce(
      makeSelection(['view_file', 'browser']),
    );

    const result = await strategy.selectToolsForQuery('browse locally', {
      modelName: 'qwen3:8b',
    });

    expect(result.fromCache).toBe(false);
    expect(ragMock.getRelevantToolsMock).toHaveBeenCalledTimes(1);
    expect(result.tools.map(tool => tool.function.name)).toEqual(['view_file']);
  });

  it('enables web search for internet automation and current docs queries', () => {
    const strategy = new ToolSelectionStrategy({ enableCaching: false });

    expect(strategy.shouldUseSearchFor('automatiser tout ce qui est acces internet')).toBe(true);
    expect(strategy.shouldUseSearchFor('etudie Stagehand Browserbase')).toBe(true);
    expect(strategy.shouldUseSearchFor('lire la documentation Mem0 node')).toBe(true);
    expect(strategy.shouldUseSearchFor('https://github.com/browserbase/stagehand')).toBe(true);
  });
});

describe('tool selection cache scoping (multi-round, not cross-turn)', () => {
  it('serves the cache for the SAME query but re-selects for a new query', async () => {
    const { ToolSelectionStrategy } = await import('../../../src/agent/execution/tool-selection-strategy.js');
    const strategy = new ToolSelectionStrategy({ useRAG: false, enableCaching: true });

    const first = await strategy.selectToolsForQuery('lance pwd en bash');
    expect(first.fromCache).toBe(false);
    strategy.cacheTools([makeTool('bash'), makeTool('view_file')], 'gpt-5.5');

    // Rounds 2..N of the SAME turn (same query) → cache hit.
    const sameTurn = await strategy.selectToolsForQuery('lance pwd en bash', { modelName: 'gpt-5.5' });
    expect(sameTurn.fromCache).toBe(true);

    // A NEW user query must never inherit the previous turn's selection.
    const newTurn = await strategy.selectToolsForQuery('synthétise un épisode avec text_to_speech', { modelName: 'gpt-5.5' });
    expect(newTurn.fromCache).toBe(false);
  });
});
