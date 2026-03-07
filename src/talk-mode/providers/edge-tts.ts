/**
 * Edge TTS Provider
 *
 * Uses Microsoft Edge's TTS service for free, high-quality text-to-speech.
 * Supports 300+ voices in many languages.
 */

import { spawn } from 'child_process';
import type {
  TTSProviderConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  EdgeTTSConfig,
} from '../types.js';
import type { ITTSProvider } from '../tts-manager.js';

/**
 * Edge TTS voice info
 */
interface EdgeVoice {
  Name: string;
  ShortName: string;
  Gender: string;
  Locale: string;
  SuggestedCodec: string;
  FriendlyName: string;
  Status: string;
  VoiceTag?: {
    ContentCategories: string[];
    VoicePersonalities: string[];
  };
}

interface EdgeTTSCommand {
  command: string;
  argsPrefix: string[];
}

/**
 * Edge TTS Provider (uses the edge-tts CLI or python -m edge_tts)
 */
export class EdgeTTSProvider implements ITTSProvider {
  readonly id = 'edge' as const;
  private config: EdgeTTSConfig = {};
  private initialized = false;
  private cachedVoices: Voice[] = [];
  private edgeTTSCommand: EdgeTTSCommand | null = null;

  async initialize(config: TTSProviderConfig): Promise<void> {
    const settings = config.settings as EdgeTTSConfig | undefined;
    this.config = settings || {};

    // Check if edge-tts is available either as a CLI or via python -m edge_tts.
    this.edgeTTSCommand = await this.detectEdgeTTSCommand();

    if (!this.edgeTTSCommand) {
      console.warn('edge-tts executable not found. Install with: pip install edge-tts');
    }

    // Fetch voice list
    await this.fetchVoices();
    this.initialized = true;
  }

  async isAvailable(): Promise<boolean> {
    return this.initialized && this.edgeTTSCommand !== null;
  }

  async listVoices(): Promise<Voice[]> {
    if (this.cachedVoices.length === 0) {
      await this.fetchVoices();
    }
    return this.cachedVoices;
  }

  /**
   * Detect an available edge-tts command launcher
   */
  private async detectEdgeTTSCommand(): Promise<EdgeTTSCommand | null> {
    const candidates: EdgeTTSCommand[] = [
      { command: 'edge-tts', argsPrefix: [] },
      { command: 'python', argsPrefix: ['-m', 'edge_tts'] },
      { command: 'python3', argsPrefix: ['-m', 'edge_tts'] },
      { command: 'py', argsPrefix: ['-m', 'edge_tts'] },
    ];

    for (const candidate of candidates) {
      const available = await this.checkCommand(candidate.command, [
        ...candidate.argsPrefix,
        '--version',
      ]);
      if (available) {
        return candidate;
      }
    }

    return null;
  }

  private async checkCommand(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const proc = spawn(command, args, {
        shell: true,
        stdio: 'pipe',
      });

      proc.on('close', (code) => {
        if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(code === 0); }
      });

      proc.on('error', () => {
        if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(false); }
      });

      // Timeout after 5 seconds
      timer = setTimeout(() => {
        if (!settled) { settled = true; proc.kill(); resolve(false); }
      }, 5000);
    });
  }

  /**
   * Fetch available voices
   */
  private async fetchVoices(): Promise<void> {
    if (this.edgeTTSCommand) {
      try {
        const voicesJson = await this.runEdgeTTSCommand(['--list-voices', '--json']);
        const voices = JSON.parse(voicesJson) as EdgeVoice[];

        this.cachedVoices = voices.map((voice, index) => ({
          id: `edge-${voice.ShortName}`,
          name: voice.FriendlyName.replace(' Online (Natural)', '').replace(' - Neural', ''),
          description: voice.VoiceTag?.VoicePersonalities?.join(', '),
          language: voice.Locale,
          gender: voice.Gender.toLowerCase() as 'male' | 'female',
          provider: 'edge' as const,
          providerId: voice.ShortName,
          quality: 'high',
          sampleRate: 24000,
          isDefault: voice.ShortName === 'en-US-JennyNeural' || index === 0,
        }));

        return;
      } catch {
        // Fall through to default voices
      }
    }

    // Use default popular voices if we can't fetch the list
    this.cachedVoices = this.getDefaultVoices();
  }

  /**
   * Get default voice list
   */
  private getDefaultVoices(): Voice[] {
    const defaultVoices = [
      // English - US
      { short: 'en-US-JennyNeural', name: 'Jenny', gender: 'female', locale: 'en-US', default: true },
      { short: 'en-US-GuyNeural', name: 'Guy', gender: 'male', locale: 'en-US' },
      { short: 'en-US-AriaNeural', name: 'Aria', gender: 'female', locale: 'en-US' },
      { short: 'en-US-DavisNeural', name: 'Davis', gender: 'male', locale: 'en-US' },
      { short: 'en-US-AmberNeural', name: 'Amber', gender: 'female', locale: 'en-US' },
      { short: 'en-US-TonyNeural', name: 'Tony', gender: 'male', locale: 'en-US' },
      // English - UK
      { short: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'female', locale: 'en-GB' },
      { short: 'en-GB-RyanNeural', name: 'Ryan', gender: 'male', locale: 'en-GB' },
      // French
      { short: 'fr-FR-DeniseNeural', name: 'Denise', gender: 'female', locale: 'fr-FR' },
      { short: 'fr-FR-HenriNeural', name: 'Henri', gender: 'male', locale: 'fr-FR' },
      // German
      { short: 'de-DE-KatjaNeural', name: 'Katja', gender: 'female', locale: 'de-DE' },
      { short: 'de-DE-ConradNeural', name: 'Conrad', gender: 'male', locale: 'de-DE' },
      // Spanish
      { short: 'es-ES-ElviraNeural', name: 'Elvira', gender: 'female', locale: 'es-ES' },
      { short: 'es-ES-AlvaroNeural', name: 'Alvaro', gender: 'male', locale: 'es-ES' },
      // Italian
      { short: 'it-IT-ElsaNeural', name: 'Elsa', gender: 'female', locale: 'it-IT' },
      { short: 'it-IT-DiegoNeural', name: 'Diego', gender: 'male', locale: 'it-IT' },
      // Portuguese - Brazil
      { short: 'pt-BR-FranciscaNeural', name: 'Francisca', gender: 'female', locale: 'pt-BR' },
      { short: 'pt-BR-AntonioNeural', name: 'Antonio', gender: 'male', locale: 'pt-BR' },
      // Japanese
      { short: 'ja-JP-NanamiNeural', name: 'Nanami', gender: 'female', locale: 'ja-JP' },
      { short: 'ja-JP-KeitaNeural', name: 'Keita', gender: 'male', locale: 'ja-JP' },
      // Chinese
      { short: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao', gender: 'female', locale: 'zh-CN' },
      { short: 'zh-CN-YunxiNeural', name: 'Yunxi', gender: 'male', locale: 'zh-CN' },
      // Korean
      { short: 'ko-KR-SunHiNeural', name: 'Sun-Hi', gender: 'female', locale: 'ko-KR' },
      { short: 'ko-KR-InJoonNeural', name: 'InJoon', gender: 'male', locale: 'ko-KR' },
    ];

    return defaultVoices.map(v => ({
      id: `edge-${v.short}`,
      name: `Edge ${v.name}`,
      language: v.locale,
      gender: v.gender as 'male' | 'female',
      provider: 'edge' as const,
      providerId: v.short,
      quality: 'high',
      sampleRate: 24000,
      isDefault: v.default ?? false,
    }));
  }

  async synthesize(text: string, options?: SynthesisOptions): Promise<SynthesisResult> {
    const voice = this.extractVoice(options?.voice) || this.config.voice || 'en-US-JennyNeural';

    // Build rate/volume/pitch adjustments
    const rate = options?.rate ?? 1.0;
    const volume = options?.volume ?? 1.0;
    const pitch = options?.pitch ?? 1.0;

    const rateStr = this.config.rate ?? `${Math.round((rate - 1) * 100)}%`;
    const volumeStr = this.config.volume ?? `${Math.round((volume - 1) * 100)}%`;
    const pitchStr = this.config.pitch ?? `${Math.round((pitch - 1) * 50)}Hz`;

    if (this.edgeTTSCommand) {
      const args = [
        '--voice', voice,
        '--text', text,
        '--write-media', '-', // Output to stdout
        '--rate', rateStr,
        '--volume', volumeStr,
        '--pitch', pitchStr,
      ];

      const audioBuffer = await this.runEdgeTTSCommandBuffer(args);

      const words = text.split(/\s+/).length;
      const durationMs = Math.round((words / 150) * 60 * 1000 / rate);

      return {
        audio: audioBuffer,
        format: 'mp3',
        durationMs,
        sampleRate: 24000,
        channels: 1,
        bitsPerSample: 16,
        provider: 'edge',
        voice: `edge-${voice}`,
      };
    }

    throw new Error(
      `edge-tts executable not found. Install with: pip install edge-tts. Requested voice: ${voice}, text length: ${text.length}, rate: ${rate}, volume: ${volume}, pitch: ${pitch}`
    );
  }

  /**
   * Run edge-tts command and return output as string
   */
  private runEdgeTTSCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.edgeTTSCommand) {
        reject(new Error('edge-tts executable not found. Install with: pip install edge-tts'));
        return;
      }

      const proc = spawn(this.edgeTTSCommand.command, [...this.edgeTTSCommand.argsPrefix, ...args], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`edge-tts exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Run edge-tts command and return output as buffer
   */
  private runEdgeTTSCommandBuffer(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.edgeTTSCommand) {
        reject(new Error('edge-tts executable not found. Install with: pip install edge-tts'));
        return;
      }

      const proc = spawn(this.edgeTTSCommand.command, [...this.edgeTTSCommand.argsPrefix, ...args], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const chunks: Buffer[] = [];
      let stderr = '';

      proc.stdout.on('data', (data) => {
        chunks.push(Buffer.from(data));
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`edge-tts exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.cachedVoices = [];
    this.edgeTTSCommand = null;
  }

  /**
   * Extract voice short name from options
   */
  private extractVoice(voice?: string): string | undefined {
    if (!voice) return undefined;

    if (voice.startsWith('edge-')) {
      return voice.slice(5);
    }

    // Check if it's a known voice
    const known = this.cachedVoices.find(v =>
      v.id === voice || v.providerId === voice || v.name.toLowerCase().includes(voice.toLowerCase())
    );

    return known?.providerId;
  }
}

export default EdgeTTSProvider;
