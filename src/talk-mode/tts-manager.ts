/**
 * TTS Manager
 *
 * Manages Text-to-Speech providers, voice selection, and audio playback.
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  TTSProvider,
  TTSProviderConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  SpeechItem,
  TalkModeConfig,
  PlaybackState,
  SynthesisProgress,
  AudioFormat,
} from './types.js';
import { DEFAULT_TALK_MODE_CONFIG, DEFAULT_QUEUE_CONFIG } from './types.js';

// ============================================================================
// TTS Provider Interface
// ============================================================================

export interface ITTSProvider {
  /** Provider identifier */
  readonly id: TTSProvider;
  /** Check if provider is available */
  isAvailable(): Promise<boolean>;
  /** List available voices */
  listVoices(): Promise<Voice[]>;
  /** Synthesize speech */
  synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult>;
  /** Initialize provider */
  initialize(config: TTSProviderConfig): Promise<void>;
  /** Shutdown provider */
  shutdown(): Promise<void>;
}

// ============================================================================
// Mock TTS Provider (for testing)
// ============================================================================

export class MockTTSProvider implements ITTSProvider {
  readonly id: TTSProvider = 'mock';
  private initialized = false;
  private voices: Voice[] = [];
  private synthDelay = 100;

  async initialize(_config: TTSProviderConfig): Promise<void> {
    this.initialized = true;
    this.voices = [
      {
        id: 'mock-en-male',
        name: 'Mock English Male',
        language: 'en-US',
        gender: 'male',
        provider: 'mock',
        providerId: 'mock-en-male',
        quality: 'high',
        sampleRate: 22050,
        isDefault: true,
      },
      {
        id: 'mock-en-female',
        name: 'Mock English Female',
        language: 'en-US',
        gender: 'female',
        provider: 'mock',
        providerId: 'mock-en-female',
        quality: 'high',
        sampleRate: 22050,
      },
      {
        id: 'mock-fr-male',
        name: 'Mock French Male',
        language: 'fr-FR',
        gender: 'male',
        provider: 'mock',
        providerId: 'mock-fr-male',
        quality: 'medium',
        sampleRate: 22050,
      },
    ];
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized;
  }

  async listVoices(): Promise<Voice[]> {
    return this.voices;
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    // Simulate synthesis delay
    await new Promise(resolve => setTimeout(resolve, this.synthDelay));

    // Generate mock audio data
    const durationMs = text.length * 50; // ~50ms per character
    const sampleRate = 22050;
    const numSamples = Math.floor((durationMs / 1000) * sampleRate);
    const buffer = Buffer.alloc(numSamples * 2); // 16-bit samples

    // Fill with silence
    for (let i = 0; i < numSamples; i++) {
      buffer.writeInt16LE(0, i * 2);
    }

    // Generate word timings
    const words = text.split(/\s+/);
    const wordTimings = [];
    let currentMs = 0;
    for (const word of words) {
      const wordDuration = word.length * 50;
      wordTimings.push({
        word,
        startMs: currentMs,
        endMs: currentMs + wordDuration,
      });
      currentMs += wordDuration + 10; // 10ms gap between words
    }

    return {
      audio: buffer,
      format: options?.format || 'wav',
      durationMs,
      sampleRate,
      channels: 1,
      bitsPerSample: 16,
      wordTimings,
      provider: 'mock',
      voice: options?.voice || 'mock-en-male',
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  setSynthDelay(ms: number): void {
    this.synthDelay = ms;
  }
}

// ============================================================================
// TTS Manager
// ============================================================================

export class TTSManager extends EventEmitter {
  private config: TalkModeConfig;
  private providers: Map<TTSProvider, ITTSProvider> = new Map();
  private activeProvider: ITTSProvider | null = null;
  private voices: Map<string, Voice> = new Map();
  private queue: SpeechItem[] = [];
  private isPlaying = false;
  private currentItem: SpeechItem | null = null;
  private playbackState: PlaybackState = {
    status: 'stopped',
    positionMs: 0,
    durationMs: 0,
    volume: 1.0,
    rate: 1.0,
    muted: false,
  };
  private cache: Map<string, { result: SynthesisResult; timestamp: number }> = new Map();

  constructor(config: Partial<TalkModeConfig> = {}) {
    super();
    this.config = { ...DEFAULT_TALK_MODE_CONFIG, ...config };
  }

  // ============================================================================
  // Provider Management
  // ============================================================================

  /**
   * Register a TTS provider
   */
  registerProvider(provider: ITTSProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Initialize providers
   */
  async initialize(): Promise<void> {
    // Register mock provider by default
    if (!this.providers.has('mock')) {
      this.registerProvider(new MockTTSProvider());
    }

    // Initialize configured providers
    for (const providerConfig of this.config.providers) {
      const provider = this.providers.get(providerConfig.provider);
      if (provider && providerConfig.enabled) {
        await provider.initialize(providerConfig);
      }
    }

    // Initialize mock if no providers configured
    if (this.config.providers.length === 0) {
      const mockProvider = this.providers.get('mock');
      if (mockProvider) {
        await mockProvider.initialize({
          provider: 'mock',
          enabled: true,
          priority: 0,
        });
      }
    }

    // Select best available provider
    await this.selectBestProvider();

    // Load voices
    await this.loadVoices();
  }

  /**
   * Select the best available provider
   */
  private async selectBestProvider(): Promise<void> {
    const availableProviders: Array<{ provider: ITTSProvider; priority: number }> = [];

    for (const [id, provider] of this.providers) {
      if (await provider.isAvailable()) {
        const config = this.config.providers.find(p => p.provider === id);
        availableProviders.push({
          provider,
          priority: config?.priority ?? 0,
        });
      }
    }

    // Sort by priority (highest first)
    availableProviders.sort((a, b) => b.priority - a.priority);

    if (availableProviders.length > 0) {
      this.activeProvider = availableProviders[0].provider;
      this.emit('provider-change', this.activeProvider.id);
    }
  }

  /**
   * Get active provider
   */
  getActiveProvider(): ITTSProvider | null {
    return this.activeProvider;
  }

  /**
   * Set active provider
   */
  async setActiveProvider(providerId: TTSProvider): Promise<boolean> {
    const provider = this.providers.get(providerId);
    if (provider && await provider.isAvailable()) {
      this.activeProvider = provider;
      await this.loadVoices();
      this.emit('provider-change', providerId);
      return true;
    }
    return false;
  }

  /**
   * List available providers
   */
  async listProviders(): Promise<Array<{ id: TTSProvider; available: boolean }>> {
    const result = [];
    for (const [id, provider] of this.providers) {
      result.push({
        id,
        available: await provider.isAvailable(),
      });
    }
    return result;
  }

  // ============================================================================
  // Voice Management
  // ============================================================================

  /**
   * Load voices from active provider
   */
  private async loadVoices(): Promise<void> {
    if (!this.activeProvider) return;

    const voices = await this.activeProvider.listVoices();
    this.voices.clear();

    for (const voice of voices) {
      this.voices.set(voice.id, voice);
    }
  }

  /**
   * Get all available voices
   */
  getVoices(): Voice[] {
    return Array.from(this.voices.values());
  }

  /**
   * Get voices for a specific language
   */
  getVoicesForLanguage(language: string): Voice[] {
    return Array.from(this.voices.values()).filter(v =>
      v.language.toLowerCase().startsWith(language.toLowerCase())
    );
  }

  /**
   * Get a specific voice
   */
  getVoice(id: string): Voice | undefined {
    return this.voices.get(id);
  }

  /**
   * Get default voice
   */
  getDefaultVoice(): Voice | undefined {
    if (this.config.defaultVoice) {
      return this.voices.get(this.config.defaultVoice);
    }
    return Array.from(this.voices.values()).find(v => v.isDefault);
  }

  // ============================================================================
  // Synthesis
  // ============================================================================

  /**
   * Synthesize text to speech
   */
  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (!this.activeProvider) {
      throw new Error('No TTS provider available');
    }

    const fullOptions: SynthesisOptions = {
      ...this.config.defaultOptions,
      ...options,
    };

    // Check cache
    if (this.config.cacheEnabled) {
      const cacheKey = this.getCacheKey(text, fullOptions);
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
        return cached.result;
      }
    }

    // Synthesize
    const result = await this.activeProvider.synthesize(text, fullOptions);

    // Cache result
    if (this.config.cacheEnabled) {
      this.cacheResult(text, fullOptions, result);
    }

    return result;
  }

  /**
   * Get cache key for synthesis
   */
  private getCacheKey(text: string, options: SynthesisOptions): string {
    const data = JSON.stringify({ text, options });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Cache synthesis result
   */
  private cacheResult(text: string, options: SynthesisOptions, result: SynthesisResult): void {
    const key = this.getCacheKey(text, options);

    // Check cache size
    let totalSize = result.audio.length;
    for (const [, cached] of this.cache) {
      totalSize += cached.result.audio.length;
    }

    // Evict old entries if needed
    while (totalSize > this.config.cacheMaxBytes && this.cache.size > 0) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        const evicted = this.cache.get(oldestKey);
        totalSize -= evicted?.result.audio.length ?? 0;
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /**
   * Clear synthesis cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  /**
   * Speak text (add to queue)
   */
  async speak(text: string, options?: SynthesisOptions): Promise<SpeechItem> {
    const item: SpeechItem = {
      id: crypto.randomUUID(),
      text,
      options,
      priority: options?.rate ?? 0,
      createdAt: new Date(),
      status: 'pending',
    };

    this.addToQueue(item);

    // Pre-synthesize if enabled
    if (this.config.queueConfig.preSynthesize) {
      this.preSynthesize(item);
    }

    // Auto-play if enabled and not already playing
    if (this.config.queueConfig.autoPlay && !this.isPlaying) {
      this.playNext();
    }

    return item;
  }

  /**
   * Add item to queue
   */
  private addToQueue(item: SpeechItem): void {
    if (this.queue.length >= this.config.queueConfig.maxSize) {
      // Remove oldest low-priority item
      const sortedQueue = [...this.queue].sort((a, b) =>
        (a.priority ?? 0) - (b.priority ?? 0)
      );
      const toRemove = sortedQueue[0];
      this.queue = this.queue.filter(i => i.id !== toRemove.id);
    }

    this.queue.push(item);

    // Sort by priority
    this.queue.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    this.emit('queue-change', this.getQueue());
  }

  /**
   * Pre-synthesize an item
   */
  private async preSynthesize(item: SpeechItem): Promise<void> {
    if (item.status !== 'pending') return;

    try {
      item.status = 'synthesizing';
      this.emit('synthesis-start', item);

      const result = await this.synthesize(item.text, item.options);
      item.audio = result;
      item.status = 'ready';

      this.emit('synthesis-complete', item, result);
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : String(error);
      this.emit('synthesis-error', item, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get current queue
   */
  getQueue(): SpeechItem[] {
    return [...this.queue];
  }

  /**
   * Clear queue
   */
  clearQueue(): void {
    this.queue = [];
    this.emit('queue-change', []);
  }

  /**
   * Remove item from queue
   */
  removeFromQueue(id: string): boolean {
    const index = this.queue.findIndex(i => i.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.emit('queue-change', this.getQueue());
      return true;
    }
    return false;
  }

  // ============================================================================
  // Playback (Simulated - real implementation would use audio library)
  // ============================================================================

  /**
   * Play next item in queue
   */
  async playNext(): Promise<void> {
    if (this.isPlaying || this.queue.length === 0) return;

    const item = this.queue.shift();
    if (!item) return;

    this.currentItem = item;
    this.isPlaying = true;

    try {
      // Ensure synthesized
      if (!item.audio) {
        await this.preSynthesize(item);
      }

      if (item.status === 'failed' || !item.audio) {
        throw new Error(item.error || 'Synthesis failed');
      }

      // Simulate playback
      item.status = 'playing';
      this.emit('playback-start', item);

      this.playbackState = {
        status: 'playing',
        positionMs: 0,
        durationMs: item.audio.durationMs,
        volume: item.options?.volume ?? 1.0,
        rate: item.options?.rate ?? 1.0,
        muted: false,
      };

      // Simulate playback progress
      const duration = item.audio.durationMs;
      const tickMs = 100;
      const ticks = Math.ceil(duration / tickMs);

      for (let i = 0; i < ticks && this.isPlaying; i++) {
        await new Promise(resolve => setTimeout(resolve, tickMs));

        this.playbackState.positionMs = Math.min((i + 1) * tickMs, duration);
        this.emit('playback-progress', item, { ...this.playbackState });
      }

      item.status = 'completed';
      this.emit('playback-complete', item);

      // Gap before next item
      if (this.config.queueConfig.gapMs > 0 && this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.queueConfig.gapMs));
      }
    } catch (error) {
      this.emit('playback-error', item, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.currentItem = null;
      this.isPlaying = false;
      this.playbackState.status = 'stopped';

      // Auto-play next
      if (this.config.queueConfig.autoPlay && this.queue.length > 0) {
        this.playNext();
      }
    }

    this.emit('queue-change', this.getQueue());
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.isPlaying = false;
    this.playbackState.status = 'stopped';

    if (this.currentItem) {
      this.currentItem.status = 'pending';
      // Return to queue
      this.queue.unshift(this.currentItem);
      this.currentItem = null;
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.isPlaying) {
      this.isPlaying = false;
      this.playbackState.status = 'paused';
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this.playbackState.status === 'paused') {
      this.isPlaying = true;
      this.playbackState.status = 'playing';
    }
  }

  /**
   * Get current playback state
   */
  getPlaybackState(): PlaybackState {
    return { ...this.playbackState };
  }

  /**
   * Get currently playing item
   */
  getCurrentItem(): SpeechItem | null {
    return this.currentItem;
  }

  /**
   * Check if playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get configuration
   */
  getConfig(): TalkModeConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TalkModeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get stats
   */
  getStats(): {
    providers: number;
    voices: number;
    queueLength: number;
    cacheSize: number;
    cacheEntries: number;
    isPlaying: boolean;
  } {
    let cacheSize = 0;
    for (const [, cached] of this.cache) {
      cacheSize += cached.result.audio.length;
    }

    return {
      providers: this.providers.size,
      voices: this.voices.size,
      queueLength: this.queue.length,
      cacheSize,
      cacheEntries: this.cache.size,
      isPlaying: this.isPlaying,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    this.stop();
    this.clearQueue();
    this.clearCache();

    for (const provider of this.providers.values()) {
      await provider.shutdown();
    }

    this.providers.clear();
    this.voices.clear();
    this.activeProvider = null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ttsManagerInstance: TTSManager | null = null;

export function getTTSManager(config?: Partial<TalkModeConfig>): TTSManager {
  if (!ttsManagerInstance) {
    ttsManagerInstance = new TTSManager(config);
  }
  return ttsManagerInstance;
}

export function resetTTSManager(): void {
  if (ttsManagerInstance) {
    ttsManagerInstance.shutdown();
    ttsManagerInstance = null;
  }
}
