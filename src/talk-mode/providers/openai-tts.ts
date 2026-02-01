/**
 * OpenAI TTS Provider
 *
 * Uses OpenAI's TTS API for high-quality text-to-speech synthesis.
 * Supports multiple voices and two models (tts-1 and tts-1-hd).
 */

import type {
  TTSProviderConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  OpenAITTSConfig,
  OpenAIVoice,
} from '../types.js';
import type { ITTSProvider } from '../tts-manager.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/speech';

/**
 * OpenAI voice definitions
 */
const OPENAI_VOICES: Record<OpenAIVoice, { name: string; gender: 'male' | 'female' }> = {
  alloy: { name: 'Alloy', gender: 'neutral' as 'male' },
  echo: { name: 'Echo', gender: 'male' },
  fable: { name: 'Fable', gender: 'male' },
  onyx: { name: 'Onyx', gender: 'male' },
  nova: { name: 'Nova', gender: 'female' },
  shimmer: { name: 'Shimmer', gender: 'female' },
};

/**
 * OpenAI TTS Provider
 */
export class OpenAITTSProvider implements ITTSProvider {
  readonly id = 'openai' as const;
  private config: OpenAITTSConfig | null = null;
  private initialized = false;

  async initialize(config: TTSProviderConfig): Promise<void> {
    const settings = config.settings as OpenAITTSConfig | undefined;

    if (!settings?.apiKey) {
      // Try environment variable
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI API key is required');
      }
      this.config = {
        apiKey,
        ...settings,
      };
    } else {
      this.config = settings;
    }

    // Validate API key by listing models (optional, can be skipped for speed)
    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && !!this.config?.apiKey;
  }

  async listVoices(): Promise<Voice[]> {
    return Object.entries(OPENAI_VOICES).map(([id, info]) => ({
      id: `openai-${id}`,
      name: `OpenAI ${info.name}`,
      description: `OpenAI TTS voice - ${info.name}`,
      language: 'en-US', // OpenAI voices are multilingual
      gender: info.gender,
      provider: 'openai' as const,
      providerId: id,
      quality: 'high',
      sampleRate: 24000,
      isDefault: id === 'alloy',
    }));
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const voice = this.extractVoice(options?.voice) || this.config.voice || 'alloy';
    const model = this.config.model || 'tts-1';
    const speed = options?.rate ?? this.config.speed ?? 1.0;
    const responseFormat = this.config.responseFormat || 'mp3';

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        speed: Math.max(0.25, Math.min(4.0, speed)),
        response_format: responseFormat,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} ${error}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Estimate duration based on text length and speed
    // Average speaking rate is ~150 words per minute
    const words = text.split(/\s+/).length;
    const durationMs = Math.round((words / 150) * 60 * 1000 / speed);

    return {
      audio: audioBuffer,
      format: responseFormat === 'pcm' ? 'pcm' : (responseFormat as 'mp3' | 'wav' | 'ogg'),
      durationMs,
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      provider: 'openai',
      voice: `openai-${voice}`,
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.config = null;
  }

  /**
   * Extract OpenAI voice ID from options
   */
  private extractVoice(voice?: string): OpenAIVoice | undefined {
    if (!voice) return undefined;

    // Handle "openai-alloy" format
    if (voice.startsWith('openai-')) {
      voice = voice.slice(7);
    }

    if (voice in OPENAI_VOICES) {
      return voice as OpenAIVoice;
    }

    return undefined;
  }
}

export default OpenAITTSProvider;
