/**
 * `CODEBUDDY_TOOLS_FIXED` — fixed ordered tool core.
 *
 * Proof obligations:
 * - default OFF is byte-identical to the historical per-query RAG selection;
 * - `true` serves the SAME ordered core for different questions;
 * - `append` keeps that core as a stable prefix and appends per-query tools;
 * - a tool hidden by the surface/CLI filter is NEVER resurrected by the core;
 * - the exact order comes from the data module, not from iteration order.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CodeBuddyTool } from '../../../src/codebuddy/client.js';

function makeTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

const ragMock = vi.hoisted(() => ({
  getRelevantToolsMock: vi.fn(async () => ({
    selectedTools: [] as unknown[],
    classification: { categories: [], confidence: 0 },
    scores: new Map<string, number>(),
    originalTokens: 0,
    reducedTokens: 0,
  })),
  getAllCodeBuddyToolsMock: vi.fn(async () => [] as unknown[]),
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

import {
  ToolSelectionStrategy,
  resolveFixedToolsMode,
  selectFixedCoreTools,
} from '../../../src/agent/execution/tool-selection-strategy.js';
import { FIXED_TOOL_CORE } from '../../../src/tools/fixed-tool-core.js';

const ORIGINAL_FLAG = process.env.CODEBUDDY_TOOLS_FIXED;

beforeEach(() => {
  delete process.env.CODEBUDDY_TOOLS_FIXED;
  ragMock.getRelevantToolsMock.mockReset();
  ragMock.getAllCodeBuddyToolsMock.mockReset();
  ragMock.getAllCodeBuddyToolsMock.mockResolvedValue([]);
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.CODEBUDDY_TOOLS_FIXED;
  else process.env.CODEBUDDY_TOOLS_FIXED = ORIGINAL_FLAG;
});

describe('resolveFixedToolsMode', () => {
  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['false', 'off'],
    ['0', 'off'],
    ['off', 'off'],
    ['true', 'core'],
    ['1', 'core'],
    ['on', 'core'],
    ['yes', 'core'],
    ['core', 'core'],
    ['append', 'append'],
    ['APPEND', 'append'],
    ['  append  ', 'append'],
  ])('maps %s to %s', (raw, expected) => {
    expect(resolveFixedToolsMode(raw as string | undefined)).toBe(expected);
  });
});

describe('selectFixedCoreTools', () => {
  it('preserves the data-module order, not the registry order', () => {
    const shuffled = [...FIXED_TOOL_CORE].reverse().map(makeTool);
    const selected = selectFixedCoreTools(shuffled).map((t) => t.function.name);
    expect(selected).toEqual([...FIXED_TOOL_CORE]);
  });

  it('drops unknown or surface-filtered names and never adds them', () => {
    const available = [makeTool('view_file'), makeTool('bash')];
    const selected = selectFixedCoreTools(available).map((t) => t.function.name);
    expect(selected).toEqual(['view_file', 'bash']);
  });
});

describe('ToolSelectionStrategy fixed core', () => {
  it('default A varies per query; the fixed core is invariant', async () => {
    // Per-query RAG selection is the historical behaviour: different questions
    // yield different tool lists. The fixed flag is what makes it invariant.
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [makeTool('view_file'), makeTool('bash'), makeTool('search')],
    );
    ragMock.getRelevantToolsMock
      .mockResolvedValueOnce({
        selectedTools: [makeTool('view_file')],
        classification: { categories: [], confidence: 0 }, scores: new Map(),
        originalTokens: 0, reducedTokens: 0,
      })
      .mockResolvedValueOnce({
        selectedTools: [makeTool('bash')],
        classification: { categories: [], confidence: 0 }, scores: new Map(),
        originalTokens: 0, reducedTokens: 0,
      });

    const underA = new ToolSelectionStrategy({ enableCaching: false });
    const a1 = (await underA.selectToolsForQuery('lis un fichier')).tools.map((t) => t.function.name);
    const a2 = (await underA.selectToolsForQuery('lance bash')).tools.map((t) => t.function.name);
    expect(JSON.stringify(a1)).not.toBe(JSON.stringify(a2));

    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    const fixed = new ToolSelectionStrategy({ enableCaching: false });
    const f1 = (await fixed.selectToolsForQuery('lis un fichier')).tools.map((t) => t.function.name);
    const f2 = (await fixed.selectToolsForQuery('lance bash')).tools.map((t) => t.function.name);
    expect(f1).toEqual(f2);
  });

  it('OFF is byte-identical: the historical RAG path runs and is returned', async () => {
    ragMock.getRelevantToolsMock.mockResolvedValueOnce({
      selectedTools: [makeTool('view_file'), makeTool('browser')],
      classification: { categories: ['file_read'], confidence: 0.7 },
      scores: new Map([['view_file', 3]]),
      originalTokens: 100,
      reducedTokens: 20,
    });
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('lis un fichier');

    expect(ragMock.getRelevantToolsMock).toHaveBeenCalledTimes(1);
    expect(result.tools.map((t) => t.function.name)).toEqual(['view_file', 'browser']);
    expect(result.fromCache).toBe(false);
  });

  it('true serves the ordered core and never calls RAG selection', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [...FIXED_TOOL_CORE].reverse().map(makeTool).concat([makeTool('browser'), makeTool('browser')]),
    );
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('lis un fichier');

    expect(ragMock.getRelevantToolsMock).not.toHaveBeenCalled();
    expect(result.tools.map((t) => t.function.name)).toEqual([...FIXED_TOOL_CORE]);
  });

  it('serves the SAME core for five different questions', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [...FIXED_TOOL_CORE].map(makeTool).concat([makeTool('browser'), makeTool('a2ui')]),
    );
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const queries = [
      'lis le fichier src/index.ts',
      'cherche clearCache dans le dépôt',
      'édite le fichier README.md pour corriger une faute',
      'explique en deux phrases ce qu’est un cache de prompt',
      'ouvre mon navigateur et va sur example.com',
    ];
    const fingerprints = new Set<string>();
    for (const query of queries) {
      const result = await strategy.selectToolsForQuery(query, { enableCaching: false });
      fingerprints.add(JSON.stringify(result.tools.map((t) => t.function.name)));
    }
    expect(fingerprints.size).toBe(1);
    expect([...fingerprints][0]).toBe(JSON.stringify([...FIXED_TOOL_CORE]));
  });

  it('append keeps the core as a stable prefix and appends per-query tools', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'append';
    const all = [...FIXED_TOOL_CORE].map(makeTool).concat([makeTool('browser'), makeTool('a2ui')]);
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(all);
    ragMock.getRelevantToolsMock.mockResolvedValueOnce({
      selectedTools: [makeTool('a2ui')],
      classification: { categories: ['file_read'], confidence: 0.5 },
      scores: new Map(),
      originalTokens: 0,
      reducedTokens: 0,
    });
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('ouvre mon navigateur');
    const names = result.tools.map((t) => t.function.name);

    expect(names.slice(0, FIXED_TOOL_CORE.length)).toEqual([...FIXED_TOOL_CORE]);
    expect(names[names.length - 1]).toBe('a2ui');
    // Per-query tools never reorder or duplicate the core.
    expect(new Set(names).size).toBe(names.length);
  });

  it('never resurrects a surface/CLI-filtered tool through the core', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    // `applyToolFilter`/surface profile already removed `bash` before this
    // point; the fixed core must not bring it back.
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [makeTool('view_file'), makeTool('list_directory'), makeTool('search')],
    );
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('lance une commande bash');
    const names = result.tools.map((t) => t.function.name);

    expect(names).toEqual(['view_file', 'list_directory', 'search']);
    expect(names).not.toContain('bash');
  });

  it('still applies the hard allowedToolNames boundary in fixed mode', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [makeTool('view_file'), makeTool('bash'), makeTool('search')],
    );
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('lis', {
      allowedToolNames: ['view_file'],
    });
    expect(result.tools.map((t) => t.function.name)).toEqual(['view_file']);
  });

  it('still applies the model capability filter in fixed mode', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue([makeTool('view_file'), makeTool('bash')]);
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('lis', { modelName: 'qwen2.5-coder:7b' });
    expect(result.tools).toEqual([]);
  });

  it('still honors the caller alwaysInclude (fleet/lite) after the core', async () => {
    process.env.CODEBUDDY_TOOLS_FIXED = 'true';
    ragMock.getAllCodeBuddyToolsMock.mockResolvedValue(
      [makeTool('view_file'), makeTool('peer_delegate')],
    );
    const strategy = new ToolSelectionStrategy({ enableCaching: false });
    const result = await strategy.selectToolsForQuery('statut flotte', {
      alwaysInclude: ['peer_delegate'],
    });
    expect(result.tools.map((t) => t.function.name)).toEqual(['view_file', 'peer_delegate']);
  });
});
