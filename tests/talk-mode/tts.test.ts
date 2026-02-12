/**
 * Talk Mode Tests
 */

import {
  TTSManager,
  MockTTSProvider,
  getTTSManager,
  resetTTSManager,
  type Voice,
  type SpeechItem,
} from '../../src/talk-mode/index.js';

describe('Talk Mode', () => {
  let manager: TTSManager;

  beforeEach(async () => {
    await resetTTSManager();
    manager = new TTSManager({
      enabled: true,
      providers: [],
      defaultLanguage: 'en-US',
      queueConfig: {
        maxSize: 10,
        preSynthesize: false,
        preSynthesizeCount: 3,
        autoPlay: false,
        gapMs: 0,
      },
      cacheEnabled: false,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    await resetTTSManager();
  });

  describe('MockTTSProvider', () => {
    let provider: MockTTSProvider;

    beforeEach(async () => {
      provider = new MockTTSProvider();
      await provider.initialize({ provider: 'mock', enabled: true, priority: 0 });
    });

    afterEach(async () => {
      await provider.shutdown();
    });

    it('should be available after initialization', async () => {
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should list voices', async () => {
      const voices = await provider.listVoices();

      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].provider).toBe('mock');
    });

    it('should synthesize speech', async () => {
      const result = await provider.synthesize('Hello world');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.durationMs).toBeGreaterThan(0);
      expect(result.provider).toBe('mock');
    });

    it('should include word timings', async () => {
      const result = await provider.synthesize('Hello world');

      expect(result.wordTimings).toBeDefined();
      expect(result.wordTimings?.length).toBe(2);
      expect(result.wordTimings?.[0].word).toBe('Hello');
    });
  });

  describe('Provider Management', () => {
    it('should list available providers', async () => {
      const providers = await manager.listProviders();

      expect(providers.length).toBeGreaterThan(0);
      expect(providers.some(p => p.id === 'mock')).toBe(true);
    });

    it('should have an active provider', () => {
      const active = manager.getActiveProvider();
      expect(active).not.toBeNull();
    });

    it('should switch providers', async () => {
      // Register another mock provider with different ID for testing
      const success = await manager.setActiveProvider('mock');
      expect(success).toBe(true);
    });

    it('should fail to switch to unavailable provider', async () => {
      const success = await manager.setActiveProvider('piper');
      expect(success).toBe(false);
    });
  });

  describe('Voice Management', () => {
    it('should list voices', () => {
      const voices = manager.getVoices();

      expect(voices.length).toBeGreaterThan(0);
    });

    it('should get voices by language', () => {
      const enVoices = manager.getVoicesForLanguage('en');

      expect(enVoices.length).toBeGreaterThan(0);
      expect(enVoices.every(v => v.language.startsWith('en'))).toBe(true);
    });

    it('should get specific voice', () => {
      const voice = manager.getVoice('mock-en-male');

      expect(voice).toBeDefined();
      expect(voice?.name).toBe('Mock English Male');
    });

    it('should get default voice', () => {
      const defaultVoice = manager.getDefaultVoice();

      expect(defaultVoice).toBeDefined();
      expect(defaultVoice?.isDefault).toBe(true);
    });
  });

  describe('Synthesis', () => {
    it('should synthesize text', async () => {
      const result = await manager.synthesize('Hello world');

      expect(result.audio).toBeInstanceOf(Buffer);
      expect(result.format).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('should use voice from options', async () => {
      const result = await manager.synthesize('Hello', { voice: 'mock-en-female' });

      expect(result.voice).toBe('mock-en-female');
    });

    it('should throw without provider', async () => {
      await manager.shutdown();

      await expect(manager.synthesize('Hello')).rejects.toThrow('No TTS provider available');
    });
  });

  describe('Caching', () => {
    beforeEach(async () => {
      await manager.shutdown();
      manager = new TTSManager({
        cacheEnabled: true,
        cacheMaxBytes: 1024 * 1024,
        cacheTTLMs: 60000,
        queueConfig: {
          maxSize: 10,
          preSynthesize: false,
          preSynthesizeCount: 3,
          autoPlay: false,
          gapMs: 0,
        },
      });
      await manager.initialize();
    });

    it('should cache synthesis results', async () => {
      await manager.synthesize('Test text');
      const stats1 = manager.getStats();

      await manager.synthesize('Test text'); // Same text
      const stats2 = manager.getStats();

      expect(stats2.cacheEntries).toBeGreaterThanOrEqual(1);
    });

    it('should clear cache', async () => {
      await manager.synthesize('Test text');
      manager.clearCache();

      const stats = manager.getStats();
      expect(stats.cacheEntries).toBe(0);
    });
  });

  describe('Queue Management', () => {
    it('should add items to queue', async () => {
      await manager.speak('First message');
      await manager.speak('Second message');

      const queue = manager.getQueue();
      expect(queue.length).toBe(2);
    });

    it('should return speech item', async () => {
      const item = await manager.speak('Hello');

      expect(item.id).toBeDefined();
      expect(item.text).toBe('Hello');
      expect(item.status).toBe('pending');
    });

    it('should clear queue', async () => {
      await manager.speak('First');
      await manager.speak('Second');

      manager.clearQueue();

      expect(manager.getQueue().length).toBe(0);
    });

    it('should remove item from queue', async () => {
      const item = await manager.speak('Hello');

      expect(manager.removeFromQueue(item.id)).toBe(true);
      expect(manager.getQueue().length).toBe(0);
    });

    it('should respect queue max size', async () => {
      for (let i = 0; i < 15; i++) {
        await manager.speak(`Message ${i}`);
      }

      expect(manager.getQueue().length).toBeLessThanOrEqual(10);
    });
  });

  describe('Playback', () => {
    it('should play next item', async () => {
      await manager.speak('Hello');

      const events: string[] = [];
      manager.on('playback-start', () => events.push('start'));
      manager.on('playback-complete', () => events.push('complete'));

      await manager.playNext();

      expect(events).toContain('start');
      expect(events).toContain('complete');
      expect(manager.getQueue().length).toBe(0);
    });

    it('should track playback state', async () => {
      await manager.speak('Hello world');

      manager.on('playback-progress', (_, state) => {
        expect(state.status).toBe('playing');
        expect(state.positionMs).toBeDefined();
      });

      await manager.playNext();

      const finalState = manager.getPlaybackState();
      expect(finalState.status).toBe('stopped');
    });

    it('should stop playback', async () => {
      const item = await manager.speak('Long message to speak');

      // Start playback but stop immediately
      const playPromise = manager.playNext();
      manager.stop();

      await playPromise;

      expect(manager.isCurrentlyPlaying()).toBe(false);
    });

    it('should pause and resume', async () => {
      await manager.speak('Hello');

      const progressEvents: number[] = [];
      manager.on('playback-progress', (_, state) => {
        progressEvents.push(state.positionMs);
      });

      // Start playing
      const playPromise = manager.playNext();

      // Let it play a bit then pause
      await new Promise(resolve => setTimeout(resolve, 50));
      manager.pause();

      expect(manager.getPlaybackState().status).toBe('paused');

      manager.resume();
      expect(manager.getPlaybackState().status).toBe('playing');

      await playPromise;
    });
  });

  describe('Events', () => {
    it('should emit synthesis events', async () => {
      const events: string[] = [];

      manager.updateConfig({
        queueConfig: {
          ...manager.getConfig().queueConfig,
          preSynthesize: true,
        },
      });

      manager.on('synthesis-start', () => events.push('synthesis-start'));
      manager.on('synthesis-complete', () => events.push('synthesis-complete'));

      await manager.speak('Hello');

      // Wait for pre-synthesis
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(events).toContain('synthesis-start');
      expect(events).toContain('synthesis-complete');
    });

    it('should emit queue-change events', async () => {
      let queueChangeCount = 0;
      manager.on('queue-change', () => queueChangeCount++);

      await manager.speak('First');
      await manager.speak('Second');
      manager.clearQueue();

      expect(queueChangeCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Configuration', () => {
    it('should get configuration', () => {
      const config = manager.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.defaultLanguage).toBe('en-US');
    });

    it('should update configuration', () => {
      manager.updateConfig({ defaultLanguage: 'fr-FR' });

      expect(manager.getConfig().defaultLanguage).toBe('fr-FR');
    });
  });

  describe('Statistics', () => {
    it('should return stats', () => {
      const stats = manager.getStats();

      expect(stats.providers).toBeGreaterThan(0);
      expect(stats.voices).toBeGreaterThan(0);
      expect(stats.queueLength).toBe(0);
      expect(stats.isPlaying).toBe(false);
    });
  });
});

describe('Singleton', () => {
  beforeEach(async () => {
    await resetTTSManager();
  });

  afterEach(async () => {
    await resetTTSManager();
  });

  it('should return same instance', () => {
    const manager1 = getTTSManager();
    const manager2 = getTTSManager();

    expect(manager1).toBe(manager2);
  });

  it('should reset instance', async () => {
    const manager1 = getTTSManager();
    await resetTTSManager();
    const manager2 = getTTSManager();

    expect(manager1).not.toBe(manager2);
  });
});
