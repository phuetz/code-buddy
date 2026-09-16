/**
 * P5 — declarative programmatic tool calling policy per model.
 * RAG selection is mocked (deterministic); model configs use the real table
 * except the fixture models below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyTool } from '../../../src/codebuddy/client.js';

function makeTool(name: string): CodeBuddyTool {
  return { type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {}, required: [] } } };
}

const ragMock = vi.hoisted(() => ({
  getRelevantTools: vi.fn(),
}));

vi.mock('../../../src/codebuddy/tools.js', () => ({
  getRelevantTools: ragMock.getRelevantTools,
  getAllCodeBuddyTools: vi.fn(async () => []),
  getSkillAugmentedTools: vi.fn((tools: unknown) => tools),
  classifyQuery: vi.fn(() => ({ categories: ['general'], confidence: 0.5 })),
}));
vi.mock('../../../src/optimization/prompt-cache.js', () => ({ getPromptCacheManager: () => ({ cacheTools: vi.fn() }) }));

vi.mock('../../../src/config/model-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/model-tools.js')>();
  return {
    ...actual,
    getModelToolConfig: (model: string) => {
      if (model === 'fixture-ptc-prefer') return { model, codeExec: 'prefer', codeExecEvidence: 'docs/reports/fixture.md' };
      if (model === 'fixture-ptc-off') return { model, codeExec: 'off' };
      return actual.getModelToolConfig(model);
    },
  };
});

import { ToolSelectionStrategy } from '../../../src/agent/execution/tool-selection-strategy.js';
import { listDefaultModelToolConfigs } from '../../../src/config/model-tools.js';
import { resolveCodeExecPolicy } from '../../../src/config/code-exec-policy.js';
import { getRuntimeSettingsSnapshot } from '../../../src/services/runtime-settings-context.js';

const BASE = ['view_file', 'bash', 'search'];

async function alwaysIncludeFor(query: string, modelName: string, selected: string[] = []): Promise<{ always: string[]; tools: string[] }> {
  ragMock.getRelevantTools.mockReset();
  ragMock.getRelevantTools.mockImplementation(async (_q: string, opts: { alwaysInclude?: string[] }) => ({
    selectedTools: [...new Set([...(opts.alwaysInclude ?? []), ...selected])].map(makeTool),
    classification: { categories: [], confidence: 0 },
    scores: new Map(),
    originalTokens: 0,
    reducedTokens: 0,
  }));
  const strategy = new ToolSelectionStrategy({ enableCaching: false });
  const result = await strategy.selectToolsForQuery(query, { maxTools: 5, alwaysInclude: BASE, modelName });
  return {
    always: ragMock.getRelevantTools.mock.calls[0]![1].alwaysInclude as string[],
    tools: result.tools.map((t) => t.function.name),
  };
}

describe('code_exec policy (P5)', () => {
  const previous = process.env.CODEBUDDY_CODE_EXEC_POLICY;
  beforeEach(() => { delete process.env.CODEBUDDY_CODE_EXEC_POLICY; });
  afterEach(() => {
    if (previous === undefined) delete process.env.CODEBUDDY_CODE_EXEC_POLICY;
    else process.env.CODEBUDDY_CODE_EXEC_POLICY = previous;
  });

  it('prefer: a multi-file comparison without PTC keywords keeps code_exec', async () => {
    const { always, tools } = await alwaysIncludeFor('lis ces trois fichiers et compare leurs exports', 'fixture-ptc-prefer');
    expect(always).toContain('code_exec');
    expect(tools).toContain('code_exec');
  });

  it('unmarked real models keep the historical selection (snapshot of required tools)', async () => {
    const cases: Array<[string, string[]]> = [
      ['Use code_exec and tools.call to read two files', [...BASE, 'restore_context', 'code_exec']],
      ['Use programmatic tool calling to combine results', [...BASE, 'restore_context', 'code_exec']],
      ['Teste le programatic tool calling', [...BASE, 'restore_context', 'code_exec']],
      ['Utilise le programmatic tool calling pour lire deux fichiers', [...BASE, 'restore_context', 'code_exec']],
      ['Utilise la programmation des outils pour calculer un total', [...BASE, 'restore_context', 'code_exec']],
      ['lis ces trois fichiers et compare leurs exports', [...BASE, 'restore_context']],
      ['Utilise le skill qa-developer', [...BASE, 'restore_context', 'skills_list', 'skill_view']],
      ['Quelle est la météo à Lyon ?', [...BASE, 'restore_context', 'weather']],
    ];
    for (const model of ['gpt-5.5', 'qwen3:4b-instruct', 'claude-opus-5']) {
      expect(resolveCodeExecPolicy(model)).toEqual({ policy: 'offer', source: 'default' });
      for (const [query, expected] of cases) {
        const { always } = await alwaysIncludeFor(query, model);
        expect(always, `${model}: ${query}`).toEqual(expected);
      }
    }
  });

  it('off: explicit request does not expose code_exec, even if RAG ranked it', async () => {
    const { always, tools } = await alwaysIncludeFor('utilise code_exec pour lire deux fichiers', 'fixture-ptc-off', ['code_exec']);
    expect(always).not.toContain('code_exec');
    expect(tools).not.toContain('code_exec');
    const snapshot = getRuntimeSettingsSnapshot({ surface: 'http', model: 'fixture-ptc-off' });
    expect(snapshot.programmaticToolCalling).toMatchObject({ policy: 'off', source: 'model' });
    expect(snapshot.programmaticToolCalling.guidance).toMatch(/disabled by the model policy/);
  });

  it('operator override is explicit and reported as env', async () => {
    process.env.CODEBUDDY_CODE_EXEC_POLICY = 'prefer';
    expect(resolveCodeExecPolicy('gpt-5.5')).toEqual({ policy: 'prefer', source: 'env' });
    const { always } = await alwaysIncludeFor('read a file', 'gpt-5.5');
    expect(always).toContain('code_exec');
    process.env.CODEBUDDY_CODE_EXEC_POLICY = 'bogus';
    expect(resolveCodeExecPolicy('gpt-5.5').policy).toBe('offer');
  });

  it('no built-in model is prefer without a referenced recette report', () => {
    const offenders = listDefaultModelToolConfigs()
      .filter((c) => c.codeExec === 'prefer' && !(typeof c.codeExecEvidence === 'string' && c.codeExecEvidence.trim().length > 0))
      .map((c) => c.model);
    expect(offenders).toEqual([]);
    expect(listDefaultModelToolConfigs().filter((c) => c.codeExec === 'prefer')).toEqual([]);
  });
});
