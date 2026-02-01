/**
 * ElevenLabs TTS Provider
 *
 * Uses ElevenLabs' API for ultra-realistic text-to-speech synthesis.
 * Supports voice cloning and advanced voice settings.
 */

import type {
  TTSProviderConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  ElevenLabsConfig,
} from '../types.js';
import type { ITTSProvider } from '../tts-manager.js';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

/**
 * ElevenLabs voice from API
 */
interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: {
    accent?: string;
    description?: string;
    age?: string;
    gender?: string;
    use_case?: string;
  };
  preview_url?: string;
}

/**
 * ElevenLabs TTS Provider
 */
export class ElevenLabsProvider implements ITTSProvider {
  readonly id = 'elevenlabs' as const;
  private config: ElevenLabsConfig | null = null;
  private initialized = false;
  private cachedVoices: Voice[] = [];

  async initialize(config: TTSProviderConfig): Promise<void> {
    const settings = config.settings as ElevenLabsConfig | undefined;

    if (!settings?.apiKey) {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error('ElevenLabs API key is required');
      }
      this.config = {
        apiKey,
        ...settings,
      };
    } else {
      this.config = settings;
    }

    // Fetch available voices
    await this.fetchVoices();
    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && !!this.config?.apiKey;
  }

  async listVoices(): Promise<Voice[]> {
    if (this.cachedVoices.length === 0) {
      await this.fetchVoices();
    }
    return this.cachedVoices;
  }

  /**
   * Fetch voices from ElevenLabs API
   */
  private async fetchVoices(): Promise<void> {
    if (!this.config) return;

    try {
      const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch voices: ${response.status}`);
      }

      const data = (await response.json()) as { voices: ElevenLabsVoice[] };

      this.cachedVoices = data.voices.map((voice, index) => ({
        id: `elevenlabs-${voice.voice_id}`,
        name: voice.name,
        description: voice.labels?.description || voice.category,
        language: this.detectLanguage(voice),
        gender: this.parseGender(voice.labels?.gender),
        provider: 'elevenlabs' as const,
        providerId: voice.voice_id,
        quality: 'high',
        sampleRate: 44100,
        isDefault: index === 0,
      }));
    } catch (error) {
      // Use default voices if fetch fails
      this.cachedVoices = [
        {
          id: 'elevenlabs-21m00Tcm4TlvDq8ikWAM',
          name: 'Rachel',
          language: 'en-US',
          gender: 'female',
          provider: 'elevenlabs',
          providerId: '21m00Tcm4TlvDq8ikWAM',
          quality: 'high',
          sampleRate: 44100,
          isDefault: true,
        },
        {
          id: 'elevenlabs-AZnzlk1XvdvUeBnXmlld',
          name: 'Domi',
          language: 'en-US',
          gender: 'female',
          provider: 'elevenlabs',
          providerId: 'AZnzlk1XvdvUeBnXmlld',
          quality: 'high',
          sampleRate: 44100,
        },
        {
          id: 'elevenlabs-EXAVITQu4vr4xnSDxMaL',
          name: 'Bella',
          language: 'en-US',
          gender: 'female',
          provider: 'elevenlabs',
          providerId: 'EXAVITQu4vr4xnSDxMaL',
          quality: 'high',
          sampleRate: 44100,
        },
        {
          id: 'elevenlabs-ErXwobaYiN019PkySvjV',
          name: 'Antoni',
          language: 'en-US',
          gender: 'male',
          provider: 'elevenlabs',
          providerId: 'ErXwobaYiN019PkySvjV',
          quality: 'high',
          sampleRate: 44100,
        },
        {
          id: 'elevenlabs-MF3mGyEYCl7XYWbV9V6O',
          name: 'Elli',
          language: 'en-US',
          gender: 'female',
          provider: 'elevenlabs',
          providerId: 'MF3mGyEYCl7XYWbV9V6O',
          quality: 'high',
          sampleRate: 44100,
        },
      ];
    }
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const voiceId = this.extractVoiceId(options?.voice) || this.config.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const modelId = this.config.modelId || 'eleven_monolingual_v1';

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: this.config.stability ?? 0.5,
            similarity_boost: this.config.similarityBoost ?? 0.75,
            style: this.config.style ?? 0,
            use_speaker_boost: this.config.useSpeakerBoost ?? true,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs TTS error: ${response.status} ${error}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Estimate duration
    const words = text.split(/\s+/).length;
    const durationMs = Math.round((words / 150) * 60 * 1000);

    return {
      audio: audioBuffer,
      format: 'mp3',
      durationMs,
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      provider: 'elevenlabs',
      voice: `elevenlabs-${voiceId}`,
    };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.config = null;
    this.cachedVoices = [];
  }

  /**
   * Clone a voice from audio samples
   */
  async cloneVoice(
    name: string,
    description: string,
    samples: Buffer[],
    labels?: Record<string, string>
  ): Promise<Voice> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);

    samples.forEach((sample, index) => {
      formData.append('files', new Blob([new Uint8Array(sample)]), `sample_${index}.mp3`);
    });

    if (labels) {
      formData.append('labels', JSON.stringify(labels));
    }

    const response = await fetch(`${ELEVENLABS_API_URL}/voices/add`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.config.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to clone voice: ${response.status} ${error}`);
    }

    const data = (await response.json()) as { voice_id: string };

    const voice: Voice = {
      id: `elevenlabs-${data.voice_id}`,
      name,
      description,
      language: 'en-US',
      provider: 'elevenlabs',
      providerId: data.voice_id,
      quality: 'high',
      sampleRate: 44100,
    };

    this.cachedVoices.push(voice);
    return voice;
  }

  /**
   * Delete a cloned voice
   */
  async deleteVoice(voiceId: string): Promise<boolean> {
    if (!this.config) {
      throw new Error('Provider not initialized');
    }

    const id = this.extractVoiceId(voiceId) || voiceId;

    const response = await fetch(`${ELEVENLABS_API_URL}/voices/${id}`, {
      method: 'DELETE',
      headers: {
        'xi-api-key': this.config.apiKey,
      },
    });

    if (response.ok) {
      this.cachedVoices = this.cachedVoices.filter(v => v.providerId !== id);
      return true;
    }

    return false;
  }

  /**
   * Extract ElevenLabs voice ID from options
   */
  private extractVoiceId(voice?: string): string | undefined {
    if (!voice) return undefined;

    if (voice.startsWith('elevenlabs-')) {
      return voice.slice(11);
    }

    // Check if it's a known voice
    const known = this.cachedVoices.find(v =>
      v.id === voice || v.providerId === voice || v.name.toLowerCase() === voice.toLowerCase()
    );

    return known?.providerId;
  }

  /**
   * Detect language from voice labels
   */
  private detectLanguage(voice: ElevenLabsVoice): string {
    const accent = voice.labels?.accent?.toLowerCase() || '';

    if (accent.includes('american') || accent.includes('us')) return 'en-US';
    if (accent.includes('british') || accent.includes('uk')) return 'en-GB';
    if (accent.includes('australian')) return 'en-AU';
    if (accent.includes('indian')) return 'en-IN';
    if (accent.includes('french')) return 'fr-FR';
    if (accent.includes('german')) return 'de-DE';
    if (accent.includes('spanish')) return 'es-ES';
    if (accent.includes('italian')) return 'it-IT';
    if (accent.includes('portuguese')) return 'pt-BR';
    if (accent.includes('polish')) return 'pl-PL';

    return 'en-US'; // Default
  }

  /**
   * Parse gender from label
   */
  private parseGender(gender?: string): 'male' | 'female' | 'neutral' | undefined {
    if (!gender) return undefined;

    const lower = gender.toLowerCase();
    if (lower.includes('male') && !lower.includes('female')) return 'male';
    if (lower.includes('female')) return 'female';

    return 'neutral';
  }
}

export default ElevenLabsProvider;
