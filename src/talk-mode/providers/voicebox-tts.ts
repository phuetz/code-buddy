/** Voicebox provider for Talk Mode and `buddy speak --engine voicebox`. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listVoiceboxProfiles,
  probeVoicebox,
  synthesizeVoiceboxWav,
} from '../../voice/voicebox-tts.js';
import type {
  SynthesisOptions,
  SynthesisResult,
  TTSProviderConfig,
  Voice,
  VoiceboxTTSConfig,
} from '../types.js';
import type { ITTSProvider } from '../tts-manager.js';

interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
}

function wavInfo(audio: Buffer): WavInfo {
  if (
    audio.length < 44 ||
    audio.toString('ascii', 0, 4) !== 'RIFF' ||
    audio.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return { sampleRate: 24_000, channels: 1, bitsPerSample: 16, durationMs: 0 };
  }
  const channels = audio.readUInt16LE(22) || 1;
  const sampleRate = audio.readUInt32LE(24) || 24_000;
  const bitsPerSample = audio.readUInt16LE(34) || 16;
  const bytesPerSecond = sampleRate * channels * Math.max(1, bitsPerSample / 8);
  const dataBytes = Math.max(0, audio.length - 44);
  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationMs: bytesPerSecond > 0 ? Math.round(dataBytes / bytesPerSecond * 1000) : 0,
  };
}

export class VoiceboxTTSProvider implements ITTSProvider {
  readonly id = 'voicebox' as const;
  private config: VoiceboxTTSConfig = {};
  private initialized = false;

  async initialize(config: TTSProviderConfig): Promise<void> {
    this.config = (config.settings as VoiceboxTTSConfig | undefined) ?? {};
    this.initialized = true;
  }

  private env(profileOverride?: string, languageOverride?: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.config.baseURL ? { CODEBUDDY_VOICEBOX_URL: this.config.baseURL } : {}),
      ...(
        profileOverride || this.config.profile
          ? { CODEBUDDY_VOICEBOX_PROFILE: profileOverride ?? this.config.profile }
          : {}
      ),
      ...(this.config.engine ? { CODEBUDDY_VOICEBOX_ENGINE: this.config.engine } : {}),
      ...(
        languageOverride || this.config.language
          ? { CODEBUDDY_VOICEBOX_LANGUAGE: languageOverride ?? this.config.language }
          : {}
      ),
      ...(this.config.modelSize ? { CODEBUDDY_VOICEBOX_MODEL_SIZE: this.config.modelSize } : {}),
      ...(this.config.instruct ? { CODEBUDDY_VOICEBOX_INSTRUCT: this.config.instruct } : {}),
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.initialized) return false;
    const report = await probeVoicebox(this.env(), { timeoutMs: Math.min(5_000, this.config.timeoutMs ?? 5_000) });
    // Endpoint availability is enough to enumerate profiles. `synthesize`
    // separately requires one, producing a precise error when it is absent.
    return report.available;
  }

  async listVoices(): Promise<Voice[]> {
    if (!this.initialized) return [];
    try {
      const env = this.env();
      const configured = env.CODEBUDDY_VOICEBOX_PROFILE?.toLocaleLowerCase('fr');
      const profiles = await listVoiceboxProfiles(env, {
        timeoutMs: Math.min(5_000, this.config.timeoutMs ?? 5_000),
      });
      return profiles.map((profile) => ({
        id: `voicebox-${profile.id}`,
        name: profile.name,
        language: profile.language || 'multi',
        provider: 'voicebox' as const,
        providerId: profile.id,
        quality: 'high' as const,
        isDefault:
          profile.id === env.CODEBUDDY_VOICEBOX_PROFILE ||
          profile.name.toLocaleLowerCase('fr') === configured,
      }));
    } catch {
      return [];
    }
  }

  async synthesize(text: string, options: SynthesisOptions = {}): Promise<SynthesisResult> {
    if (!this.initialized) throw new Error('Voicebox provider is not initialized');
    const requested = options.voice?.startsWith('voicebox-')
      ? options.voice.slice('voicebox-'.length)
      : options.voice;
    const env = this.env(requested, options.language);
    if (!env.CODEBUDDY_VOICEBOX_PROFILE) {
      throw new Error('Voicebox profile is missing (CODEBUDDY_VOICEBOX_PROFILE)');
    }
    const dir = mkdtempSync(join(tmpdir(), 'voicebox-tts-'));
    const outPath = join(dir, 'speech.wav');
    try {
      const ok = await synthesizeVoiceboxWav(text, outPath, env, {
        timeoutMs: this.config.timeoutMs ?? 180_000,
      });
      if (!ok) throw new Error('Voicebox synthesis failed');
      const audio = readFileSync(outPath);
      const info = wavInfo(audio);
      return {
        audio,
        format: 'wav',
        durationMs: info.durationMs,
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitsPerSample: info.bitsPerSample,
        provider: 'voicebox',
        voice: requested ?? env.CODEBUDDY_VOICEBOX_PROFILE,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }
}

export const __test = { wavInfo };

export default VoiceboxTTSProvider;
