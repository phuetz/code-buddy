/**
 * Tests for MODELLABEL1: Effective vs Requested Model in Headless Mode
 * 
 * Issue: When a requested model is not served, the fallback model is used but the JSON output
 * still shows the requested model instead of the effective model.
 * 
 * Fix: JSON output should show the effective model in 'model' field and include 'requestedModel'
 * field when they differ.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodeBuddyClient, CHATGPT_OAUTH_SENTINEL } from '../../src/codebuddy/client.js';

// Mock the providers
vi.mock('../../src/codebuddy/providers/provider-openai-compat.js', () => ({
  OpenAICompatProvider: class {
    constructor() {}
    chat = vi.fn().mockImplementation((_messages, _tools, _opts) => {
      // Return a mock response with the effective model
      return {
        model: 'effective-model', // Different from requested
        choices: [{
          message: {
            role: 'assistant',
            content: 'Hello',
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };
    });
    chatStream = vi.fn();
    setModel = vi.fn();
  },
}));

vi.mock('../../src/codebuddy/providers/provider-chatgpt-responses.js', () => ({
  ChatGptResponsesProvider: class {
    constructor() {}
    chat = vi.fn();
    chatStream = vi.fn().mockImplementation(async function* () {
      yield { id: 'x', choices: [{ index: 0, delta: { content: 'OK' } }] };
    });
    setModel = vi.fn();
    // Le vrai provider mémorise le modèle réellement envoyé au backend Codex
    // après remap (gpt-6-astra → gpt-5.6-sol, mesuré le 04/09/2026).
    getEffectiveModel = vi.fn(() => 'gpt-5.6-sol');
  },
}));

vi.mock('../../src/codebuddy/providers/provider-gemini-native.js', () => ({
  GeminiNativeProvider: class {
    constructor() {}
    chat = vi.fn();
    chatStream = vi.fn();
    setModel = vi.fn();
  },
}));

vi.mock('../../src/codebuddy/providers/provider-gemini-cli.js', () => ({
  GeminiCliProvider: class {
    constructor() {}
    chat = vi.fn();
    chatStream = vi.fn();
    setModel = vi.fn();
  },
}));

vi.mock('../../src/codebuddy/providers/provider-agy-cli.js', () => ({
  AgyCliProvider: class {
    constructor() {}
    chat = vi.fn();
    chatStream = vi.fn();
    setModel = vi.fn();
  },
}));

vi.mock('../../src/utils/base-url.js', () => ({
  normalizeBaseURL: vi.fn((url) => url),
  DEFAULT_BASE_URL: 'https://api.openai.com/v1',
}));

vi.mock('../../src/utils/model-utils.js', () => ({
  validateModel: vi.fn(() => ({ isValid: true, isSupported: true })),
  getModelInfo: vi.fn(() => ({ isSupported: true })),
}));

vi.mock('../../src/config/model-tools.js', () => ({
  getModelToolConfig: vi.fn(() => ({ contextWindow: 32768, maxOutputTokens: 4096 })),
}));

vi.mock('../../src/providers/provider-fallback.js', () => ({
  resolveRuntimeCredentialPoolProviders: vi.fn(() => []),
  resolveRuntimeFallbackProviders: vi.fn(() => []),
}));

vi.mock('openai', () => ({
  default: class {},
}));

vi.mock('openai/resources/chat', () => ({
  ChatCompletionChunk: class {},
}));

describe('MODELLABEL1 - Model Fallback Tracking', () => {
  let client: CodeBuddyClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the client tracking
    client = new CodeBuddyClient('test-api-key', 'requested-model');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should track requested and effective models', async () => {
    // Call chat with a specific model
    await client.chat(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { model: 'requested-model' }
    );

    // Check that the client tracked both models
    const requestedModel = client.getLastRequestedModel();
    const effectiveModel = client.getLastEffectiveModel();

    // The effective model comes from the mock provider response
    expect(requestedModel).toBe('requested-model');
    expect(effectiveModel).toBe('effective-model');
  });

  it('should return effective model when available', async () => {
    const response = await client.chat(
      [{ role: 'user', content: 'Hello' }],
      undefined,
      { model: 'requested-model' }
    );

    // The response should contain the effective model from the provider
    expect(response.model).toBe('effective-model');
  });

  // Note: The fallback test for when response doesn't have model is covered by the
  // logic in client.ts line 644: this.lastEffectiveModel = response.model ?? requestedModel;
  // When response.model is undefined, it falls back to requestedModel.

  it('should use currentModel as requested when no explicit model provided', async () => {
    const clientNoRequested = new CodeBuddyClient('test-api-key', 'current-model');
    
    await clientNoRequested.chat(
      [{ role: 'user', content: 'Hello' }]
    );

    const requestedModel = clientNoRequested.getLastRequestedModel();
    const effectiveModel = clientNoRequested.getLastEffectiveModel();

    // When no model is explicitly requested in opts, requestedModel should be currentModel
    // and effectiveModel should come from the response
    expect(requestedModel).toBe('current-model');
    expect(effectiveModel).toBe('effective-model');
  });
});

describe('MODELLABEL1 - Integration Test', () => {
  it('should demonstrate the model fallback issue and fix', async () => {
    // This test demonstrates the issue: when a model is not served,
    // the JSON output should show the effective model, not the requested one.
    
    const client = new CodeBuddyClient('test-api-key', 'gpt-6-astra');
    
    // Simulate the scenario where gpt-6-astra is requested but effective model is gpt-5.6-sol
    const response = await client.chat(
      [{ role: 'user', content: 'Test' }],
      undefined,
      { model: 'gpt-6-astra' }
    );

    const requested = client.getLastRequestedModel();
    const effective = client.getLastEffectiveModel();

    // Before the fix: output would show model: 'gpt-6-astra'
    // After the fix: output should show model: 'effective-model' and requestedModel: 'gpt-6-astra'
    expect(requested).toBe('gpt-6-astra');
    expect(effective).toBe('effective-model');
    expect(requested !== effective).toBe(true);
    
    // This proves that the tracking is working correctly
    // The JSON output in processPromptHeadless should use effective as 'model'
    // and include 'requestedModel' when they differ
  });
});


describe('MODELLABEL1 - modèle effectif du provider ChatGPT en streaming (chemin headless)', () => {
  it('rapporte le modèle réellement servi, pas celui demandé, après un chatStream', async () => {
    const client = new CodeBuddyClient(CHATGPT_OAUTH_SENTINEL, 'https://chatgpt.com/backend-api/codex', 'gpt-6-astra');
    const chunks: unknown[] = [];
    for await (const chunk of client.chatStream([{ role: 'user', content: 'OK' }], [], { model: 'gpt-6-astra' })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(client.getLastRequestedModel()).toBe('gpt-6-astra');
    expect(client.getLastEffectiveModel()).toBe('gpt-5.6-sol');
  });
});
