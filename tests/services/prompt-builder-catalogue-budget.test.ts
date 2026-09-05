import { afterEach, describe, expect, it, vi } from 'vitest';
import mistralModelsCatalogue from '../fixtures/mistral-v1-models.json';
import {
  primeLocalRuntimeModelConfig,
  resetLocalRuntimeContextProbeCache,
} from '../../src/config/local-runtime-context.js';
import { getModelToolConfig, resetRuntimeModelContextCache } from '../../src/config/model-tools.js';
import { PromptBuilder, type BuildOptions } from '../../src/services/prompt-builder.js';
import { logger } from '../../src/utils/logger.js';

const promptMock = vi.hoisted(() => ({
  getSystemPromptForMode: vi.fn(() => 'P'.repeat(200_000)),
  getPromptManager: vi.fn(() => ({ buildSystemPrompt: vi.fn(async () => 'unused') })),
  autoSelectPromptId: vi.fn(() => 'unused'),
  getChatOnlySystemPrompt: vi.fn(() => 'unused'),
}));

vi.mock('../../src/prompts/index.js', () => promptMock);

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function allBlocksOff(): BuildOptions {
  return {
    includeBootstrap: false,
    includePersona: false,
    includeKnowledge: false,
    includeProjectDocs: false,
    includeRules: false,
    includeSkills: false,
    includeIdentity: false,
    includeFleet: false,
    includeMemoryDirective: false,
    includeLessonsDirective: false,
    includeUserModelDirective: false,
    includeWritingRules: false,
    includeCodingStyle: false,
    includeWorkflowRules: false,
    includeExecutionDiscipline: false,
    includeVariation: false,
  };
}

afterEach(() => {
  resetLocalRuntimeContextProbeCache();
  resetRuntimeModelContextCache();
  delete process.env.CODEBUDDY_MAX_CONTEXT;
  vi.restoreAllMocks();
});

describe('PromptBuilder context budget after hosted catalogue discovery', () => {
  it('keeps Mistral Medium at the nominative 128k and preserves an oversized atomic block', async () => {
    delete process.env.CODEBUDDY_MAX_CONTEXT;
    const fetchImpl = vi.fn(async (url: string) => url.endsWith('/v1/models')
      ? response(mistralModelsCatalogue)
      : ({ ok: false, json: async () => ({}) } as Response)) as unknown as typeof fetch;

    await expect(primeLocalRuntimeModelConfig({
      model: 'mistral-medium-latest',
      baseURL: 'https://api.mistral.ai/v1',
      fetchImpl,
    })).resolves.toBeNull();
    expect(getModelToolConfig('mistral-medium-latest').contextWindow).toBe(128_000);

    const cacheSystemPrompt = vi.fn();
    const builder = new PromptBuilder(
      {
        yoloMode: false,
        memoryEnabled: false,
        morphEditorEnabled: false,
        cwd: process.cwd(),
      },
      { cacheSystemPrompt } as unknown as ConstructorParameters<typeof PromptBuilder>[1],
    );
    const warning = vi.spyOn(logger, 'warn');

    const systemPrompt = await builder.buildSystemPrompt(
      undefined,
      'mistral-medium-latest',
      null,
      allBlocksOff(),
    );

    // The synthetic base is one atomic block. Cutting it at 128K could split
    // a security/tool sentence, so the fail-safe retains the block verbatim.
    expect(systemPrompt).toHaveLength(200_000);
    expect(systemPrompt).not.toMatch(/\.\.\.$/);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('(budget: 32000 tokens, 32K hard cap); blocs retirés : aucun'),
    );
    expect(cacheSystemPrompt).toHaveBeenCalledWith(systemPrompt);
  });
});
