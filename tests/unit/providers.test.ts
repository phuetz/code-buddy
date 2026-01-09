import { BaseProvider } from '../../src/providers/base-provider';
import { GrokProvider } from '../../src/providers/grok-provider';
import { ClaudeProvider } from '../../src/providers/claude-provider';
import { OpenAIProvider } from '../../src/providers/openai-provider';
import { GeminiProvider } from '../../src/providers/gemini-provider';
import { ProviderConfig, CompletionOptions, LLMResponse, StreamChunk } from '../../src/providers/types';

// Mock implementations
class TestProvider extends BaseProvider {
  readonly type = 'grok'; // Reusing existing type for test
  readonly name = 'Test Provider';
  readonly defaultModel = 'test-model';

  async complete(options: CompletionOptions): Promise<LLMResponse> {
    return {
      id: 'test-id',
      content: 'test response',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      model: this.defaultModel,
      provider: this.type,
    };
  }

  async *stream(options: CompletionOptions): AsyncIterable<StreamChunk> {
    yield { type: 'content', content: 'test response' };
    yield { type: 'done' };
  }

  getPricing() {
    return { input: 1, output: 2 };
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    provider = new TestProvider();
  });

  it('should initialize correctly', async () => {
    await provider.initialize({ apiKey: 'test-key' });
    expect(provider.isReady()).toBe(true);
  });

  it('should support chat alias', async () => {
    await provider.initialize({ apiKey: 'test-key' });
    const response = await provider.chat({ messages: [] });
    expect(response.content).toBe('test response');
  });

  it('should check feature support', () => {
    expect(provider.supports('streaming')).toBe(true);
    expect(provider.supports('vision')).toBe(false); // Default
  });
});

describe('Provider Implementations', () => {
  const config: ProviderConfig = { apiKey: 'test-key' };

  describe('GrokProvider', () => {
    const provider = new GrokProvider();

    it('should identify as grok', () => {
      expect(provider.type).toBe('grok');
    });

    it('should support streaming and tools', () => {
      expect(provider.supports('streaming')).toBe(true);
      expect(provider.supports('tools')).toBe(true);
    });

    it('should support vision only if model indicates it', async () => {
      await provider.initialize({ ...config, model: 'grok-2-vision' });
      expect(provider.supports('vision')).toBe(true);
      
      const provider2 = new GrokProvider();
      await provider2.initialize({ ...config, model: 'grok-3' });
      expect(provider2.supports('vision')).toBe(false);
    });
  });

  describe('ClaudeProvider', () => {
    const provider = new ClaudeProvider();

    it('should identify as claude', () => {
      expect(provider.type).toBe('claude');
    });

    it('should support vision', () => {
      expect(provider.supports('vision')).toBe(true);
    });
  });

  describe('OpenAIProvider', () => {
    const provider = new OpenAIProvider();

    it('should identify as openai', () => {
      expect(provider.type).toBe('openai');
    });

    it('should support vision', () => {
      expect(provider.supports('vision')).toBe(true);
    });
  });

  describe('GeminiProvider', () => {
    const provider = new GeminiProvider();

    it('should identify as gemini', () => {
      expect(provider.type).toBe('gemini');
    });

    it('should support vision', () => {
      expect(provider.supports('vision')).toBe(true);
    });
  });
});
