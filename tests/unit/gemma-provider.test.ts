import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const googleMocks = vi.hoisted(() => ({
  modelCalls: [] as string[],
  sendMessage: vi.fn(async () => ({ response: { text: () => 'chat response' } })),
  generateContent: vi.fn(async () => ({ response: { text: () => 'complete response' } })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    constructor(_apiKey: string) {}

    getGenerativeModel({ model }: { model: string }) {
      googleMocks.modelCalls.push(model);
      return {
        startChat: () => ({ sendMessage: googleMocks.sendMessage }),
        generateContent: googleMocks.generateContent,
      };
    }
  },
}));

import { GemmaProviderPlugin } from '../../src/plugins/bundled/gemma-provider.js';

describe('GemmaProviderPlugin model selection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = 'google-key';
    delete process.env.GEMMA_MODEL;
    delete process.env.GROK_MODEL;
    googleMocks.modelCalls.length = 0;
    googleMocks.sendMessage.mockClear();
    googleMocks.generateContent.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('does not use legacy GROK_MODEL as the Gemma model default', async () => {
    process.env.GROK_MODEL = 'grok-code-fast-1';
    const provider = new GemmaProviderPlugin();

    await provider.complete('hello');

    expect(googleMocks.modelCalls).toEqual(['gemma-4-9b-it']);
  });

  it('uses GEMMA_MODEL for explicit Gemma model selection', async () => {
    process.env.GEMMA_MODEL = 'gemma-4-27b-it';
    const provider = new GemmaProviderPlugin();

    await provider.chat([{ role: 'user', content: 'hello' }]);

    expect(googleMocks.modelCalls).toEqual(['gemma-4-27b-it']);
  });
});
