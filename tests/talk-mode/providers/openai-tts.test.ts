/**
 * OpenAI TTS Provider Tests
 */

import { OpenAITTSProvider } from '../../../src/talk-mode/providers/openai-tts.js';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('OpenAITTSProvider', () => {
  let provider: OpenAITTSProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAITTSProvider();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  describe('initialize', () => {
    it('should initialize with API key from config', async () => {
      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
        settings: { apiKey: 'sk-test-key' },
      });

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should initialize with API key from environment', async () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-env-key';

      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
      });

      expect(await provider.isAvailable()).toBe(true);

      process.env.OPENAI_API_KEY = originalEnv;
    });

    it('should throw error without API key', async () => {
      const originalEnv = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      await expect(
        provider.initialize({
          provider: 'openai',
          enabled: true,
          priority: 1,
        })
      ).rejects.toThrow('OpenAI API key is required');

      process.env.OPENAI_API_KEY = originalEnv;
    });
  });

  describe('listVoices', () => {
    beforeEach(async () => {
      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
        settings: { apiKey: 'sk-test-key' },
      });
    });

    it('should return available voices', async () => {
      const voices = await provider.listVoices();

      expect(voices).toHaveLength(6); // alloy, echo, fable, onyx, nova, shimmer
      expect(voices.map((v) => v.providerId)).toEqual([
        'alloy',
        'echo',
        'fable',
        'onyx',
        'nova',
        'shimmer',
      ]);
    });

    it('should have default voice marked', async () => {
      const voices = await provider.listVoices();
      const defaultVoice = voices.find((v) => v.isDefault);

      expect(defaultVoice).toBeDefined();
      expect(defaultVoice?.providerId).toBe('alloy');
    });

    it('should include voice metadata', async () => {
      const voices = await provider.listVoices();
      const nova = voices.find((v) => v.providerId === 'nova');

      expect(nova).toBeDefined();
      expect(nova?.gender).toBe('female');
      expect(nova?.provider).toBe('openai');
      expect(nova?.quality).toBe('high');
    });
  });

  describe('synthesize', () => {
    beforeEach(async () => {
      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
        settings: { apiKey: 'sk-test-key' },
      });
    });

    it('should synthesize text to audio', async () => {
      const audioData = Buffer.from('fake-audio-data');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(audioData.buffer),
      });

      const result = await provider.synthesize('Hello, world!');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.provider).toBe('openai');
      expect(result.format).toBe('mp3');
    });

    it('should use specified voice', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test', { voice: 'openai-nova' });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.voice).toBe('nova');
    });

    it('should respect rate option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test', { rate: 1.5 });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.speed).toBe(1.5);
    });

    it('should clamp speed to valid range', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test', { rate: 10 }); // Too high

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.speed).toBe(4.0); // Clamped to max
    });

    it('should handle API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(provider.synthesize('Test')).rejects.toThrow('OpenAI TTS error');
    });

    it('should use tts-1 model by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test');

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.model).toBe('tts-1');
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
        settings: { apiKey: 'sk-test-key' },
      });

      await provider.shutdown();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('voice extraction', () => {
    beforeEach(async () => {
      await provider.initialize({
        provider: 'openai',
        enabled: true,
        priority: 1,
        settings: { apiKey: 'sk-test-key' },
      });
    });

    it('should extract voice from prefixed ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test', { voice: 'openai-shimmer' });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.voice).toBe('shimmer');
    });

    it('should accept plain voice name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from('audio').buffer),
      });

      await provider.synthesize('Test', { voice: 'echo' });

      const lastCall = mockFetch.mock.calls[0];
      const body = JSON.parse(lastCall[1].body);
      expect(body.voice).toBe('echo');
    });
  });
});
