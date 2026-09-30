import { describe, it, expect } from 'vitest';
import { getModelToolConfig } from '../../src/config/model-tools.js';
import { getModelPricing } from '../../src/config/model-pricing.js';
import { MODEL_PRICE_DATA } from '../../src/config/model-price-data.js';
import { RUNTIME_PROVIDER_CATALOG } from '../../src/providers/provider-catalog.js';
import { modelUsesResponsesLite, resolveChatGptReasoningEffort, selectChatGptOAuthModel } from '../../src/providers/chatgpt-models.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('GPT-6.1 Sol Integration', () => {
  it('resolves in model-tools and has correct capabilities', () => {
    const config = getModelToolConfig('gpt-6.1-sol');
    expect(config.contextWindow).toBe(1_050_000);
    expect(config.maxOutputTokens).toBe(128_000);
    expect(config.supportsReasoning).toBe(true);
    expect(config.supportsToolCalls).toBe(true);
    expect(config.patchFormat).toBe('unified');
  });

  it('has correct pricing', () => {
    const pricing = getModelPricing('gpt-6.1-sol');
    expect(pricing.inputPerMillion).toBe(2);
    expect(pricing.outputPerMillion).toBe(10);
    expect(MODEL_PRICE_DATA['gpt-6.1-sol']).toMatchObject({
      cachedInputPerMillion: 0.1,
      verified: true,
      scope: expect.stringContaining('272K'),
    });
  });

  it('is available through the ChatGPT OAuth catalog without changing its default', () => {
    const chatgpt = RUNTIME_PROVIDER_CATALOG.find((p) => p.id === 'chatgpt');
    expect(chatgpt).toBeDefined();
    expect(chatgpt!.models).toContain('gpt-6.1-sol');
    // Ensure default model has NOT changed
    expect(chatgpt!.defaultModel).toBe('gpt-6-sol');

    // The OpenAI transport uses Chat Completions; this model needs Responses for tools.
    const openai = RUNTIME_PROVIDER_CATALOG.find((p) => p.id === 'openai');
    expect(openai?.models).not.toContain('gpt-6.1-sol');
  });

  it('does not leak the model string outside catalogs and tests', () => {
    const src = fileURLToPath(new URL('../../src/', import.meta.url));
    const allowed = new Set(['model-tools.ts', 'model-price-data.ts', 'provider-catalog.ts', 'chatgpt-models.ts']);
    const unexpected: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && !allowed.has(entry.name) && readFileSync(path, 'utf8').toLowerCase().includes('gpt-6.1')) unexpected.push(path);
      }
    };
    visit(src);
    expect(unexpected).toEqual([]);
  });

  it('uses the OAuth Responses transport and supported effort levels without a live catalog', () => {
    expect(selectChatGptOAuthModel('gpt-6.1-sol', null)).toBe('gpt-6.1-sol');
    expect(modelUsesResponsesLite('gpt-6.1-sol', null)).toBe(true);
    expect(resolveChatGptReasoningEffort(undefined, 'gpt-6.1-sol', null)).toBe('medium');
    expect(resolveChatGptReasoningEffort('max', 'gpt-6.1-sol', null)).toBe('max');
    expect(resolveChatGptReasoningEffort('minimal', 'gpt-6.1-sol', null)).toBe('low');
    expect(resolveChatGptReasoningEffort('ultra', 'gpt-6.1-sol', null)).toBe('max');
  });
});
