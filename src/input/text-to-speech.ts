import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface TTSConfig {
  enabled: boolean;
  provider: 'edge-tts' | 'espeak' | 'say' | 'piper';
  voice?: string;
  rate?: string;
  volume?: string;
  pitch?: string;
  autoSpeak?: boolean;
}

export interface TTSState {
  isSpeaking: boolean;
  queue: string[];
  currentText?: string;
}

/**
 * Text-to-Speech Manager
 * Supports multiple TTS backends with Edge TTS as default
 */
export class TextToSpeechManager extends EventEmitter {
  private config: TTSConfig;
  private state: TTSState;
  private speakingProcess: ChildProcess | null = null;
  private tempDir: string;

  // Default voices for different languages
  private static readonly EDGE_VOICES: Record<string, string> = {
    'fr': 'fr-FR-DeniseNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'fr-CA': 'fr-CA-SylvieNeural',
    'en': 'en-US-JennyNeural',
    'en-US': 'en-US-JennyNeural',
    'en-GB': 'en-GB-SoniaNeural',
    'de': 'de-DE-KatjaNeural',
    'es': 'es-ES-ElviraNeural',
    'it': 'it-IT-ElsaNeural',
    'pt': 'pt-BR-FranciscaNeural',
    'ja': 'ja-JP-NanamiNeural',
    'zh': 'zh-CN-XiaoxiaoNeural',
    'ko': 'ko-KR-SunHiNeural',
    'ru': 'ru-RU-SvetlanaNeural',
    'ar': 'ar-SA-ZariyahNeural',
  };

  constructor(config: Partial<TTSConfig> = {}) {
    super();

    this.config = {
      enabled: config.enabled ?? true,
      provider: config.provider || 'edge-tts',
      voice: config.voice,
      rate: config.rate || '+0%',
      volume: config.volume || '+0%',
      pitch: config.pitch || '+0Hz',
      autoSpeak: config.autoSpeak ?? false,
    };

    this.state = {
      isSpeaking: false,
      queue: [],
    };

    this.tempDir = path.join(os.tmpdir(), 'grok-tts');
    this.ensureTempDir();
    this.loadConfig();
  }

  private ensureTempDir(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  private loadConfig(): void {
    const configPath = path.join(os.homedir(), '.grok', 'tts-config.json');

    if (fs.existsSync(configPath)) {
      try {
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        this.config = { ...this.config, ...saved };
      } catch {
        // Use defaults
      }
    }
  }

  saveConfig(): void {
    const configDir = path.join(os.homedir(), '.grok');
    const configPath = path.join(configDir, 'tts-config.json');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
  }

  /**
   * Check if TTS is available
   */
  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    return new Promise((resolve) => {
      const command = this.config.provider === 'edge-tts' ? 'edge-tts' :
                      this.config.provider === 'espeak' ? 'espeak' :
                      this.config.provider === 'say' ? 'say' :
                      this.config.provider === 'piper' ? 'piper' : 'edge-tts';

      const check = spawn('which', [command]);

      check.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            reason: `${command} not found. Install with: pip3 install ${command === 'edge-tts' ? 'edge-tts' : command}`,
          });
        }
      });

      check.on('error', () => {
        resolve({ available: false, reason: `Cannot check for ${command}` });
      });
    });
  }

  /**
   * Get voice for language
   */
  getVoiceForLanguage(lang: string): string {
    if (this.config.voice) {
      return this.config.voice;
    }
    return TextToSpeechManager.EDGE_VOICES[lang] ||
           TextToSpeechManager.EDGE_VOICES[lang.split('-')[0]] ||
           TextToSpeechManager.EDGE_VOICES['en'];
  }

  /**
   * Speak text
   * Note: This method catches all errors internally to avoid unhandled rejections.
   * Errors are emitted via 'error' event instead.
   */
  async speak(text: string, language: string = 'fr'): Promise<void> {
    // Check enabled state immediately
    if (!this.config.enabled) {
      return;
    }

    // Add to queue if already speaking
    if (this.state.isSpeaking) {
      this.state.queue.push(text);
      return;
    }

    try {
      const availability = await this.isAvailable();
      if (!availability.available) {
        this.emit('error', new Error(availability.reason));
        return;
      }

      // Double-check enabled state after async availability check
      // (user might have disabled TTS while we were checking)
      if (!this.config.enabled) {
        return;
      }

      this.state.isSpeaking = true;
      this.state.currentText = text;
      this.emit('speaking-started', text);

      switch (this.config.provider) {
        case 'edge-tts':
          await this.speakWithEdgeTTS(text, language);
          break;
        case 'espeak':
          await this.speakWithEspeak(text, language);
          break;
        case 'say':
          await this.speakWithSay(text);
          break;
        case 'piper':
          await this.speakWithPiper(text);
          break;
        default:
          await this.speakWithEdgeTTS(text, language);
      }
    } catch (error) {
      // Emit error event but don't throw - prevents unhandled rejections
      this.emit('error', error);
    } finally {
      this.state.isSpeaking = false;
      this.state.currentText = undefined;
      this.emit('speaking-stopped');

      // Process queue only if still enabled
      if (this.config.enabled && this.state.queue.length > 0) {
        const next = this.state.queue.shift()!;
        // Use setImmediate to avoid deep recursion
        setImmediate(() => {
          this.speak(next, language).catch(() => {
            // Silently ignore - error already emitted
          });
        });
      } else if (!this.config.enabled) {
        // Clear queue if disabled
        this.state.queue = [];
      }
    }
  }

  /**
   * Speak with Edge TTS (Microsoft voices)
   */
  private async speakWithEdgeTTS(text: string, language: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const voice = this.getVoiceForLanguage(language);
      const audioFile = path.join(this.tempDir, `tts_${Date.now()}.mp3`);

      // Generate audio with edge-tts
      const edgeTTS = spawn('edge-tts', [
        '--voice', voice,
        '--rate', this.config.rate || '+0%',
        '--volume', this.config.volume || '+0%',
        '--pitch', this.config.pitch || '+0Hz',
        '--text', text,
        '--write-media', audioFile,
      ]);

      edgeTTS.on('close', (code) => {
        if (code === 0 && fs.existsSync(audioFile)) {
          // Play the audio file
          this.playAudio(audioFile)
            .then(() => {
              // Cleanup
              try { fs.unlinkSync(audioFile); } catch { /* ignore cleanup error */ }
              resolve();
            })
            .catch(reject);
        } else {
          reject(new Error(`edge-tts failed with code ${code}`));
        }
      });

      edgeTTS.on('error', reject);
      this.speakingProcess = edgeTTS;
    });
  }

  /**
   * Speak with espeak
   */
  private async speakWithEspeak(text: string, language: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const lang = language.split('-')[0];
      const espeak = spawn('espeak', ['-v', lang, text]);

      espeak.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`espeak failed with code ${code}`));
        }
      });

      espeak.on('error', reject);
      this.speakingProcess = espeak;
    });
  }

  /**
   * Speak with macOS say
   */
  private async speakWithSay(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const say = spawn('say', [text]);

      say.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`say failed with code ${code}`));
        }
      });

      say.on('error', reject);
      this.speakingProcess = say;
    });
  }

  /**
   * Speak with Piper TTS
   */
  private async speakWithPiper(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audioFile = path.join(this.tempDir, `tts_${Date.now()}.wav`);

      // Piper reads from stdin and outputs to file
      const piper = spawn('piper', ['--output_file', audioFile]);

      piper.stdin?.write(text);
      piper.stdin?.end();

      piper.on('close', (code) => {
        if (code === 0 && fs.existsSync(audioFile)) {
          this.playAudio(audioFile)
            .then(() => {
              try { fs.unlinkSync(audioFile); } catch { /* ignore cleanup error */ }
              resolve();
            })
            .catch(reject);
        } else {
          reject(new Error(`piper failed with code ${code}`));
        }
      });

      piper.on('error', reject);
      this.speakingProcess = piper;
    });
  }

  /**
   * Play audio file using available player
   */
  private async playAudio(audioFile: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try different audio players
      const players = [
        ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioFile]],
        ['mpv', ['--no-video', audioFile]],
        ['aplay', [audioFile]],
        ['paplay', [audioFile]],
        ['play', [audioFile]], // sox
      ];

      const tryPlayer = (index: number) => {
        if (index >= players.length) {
          reject(new Error('No audio player found. Install ffmpeg, mpv, or sox.'));
          return;
        }

        const [cmd, args] = players[index];
        const player = spawn(cmd as string, args as string[]);

        player.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            // Try next player
            tryPlayer(index + 1);
          }
        });

        player.on('error', () => {
          // Try next player
          tryPlayer(index + 1);
        });

        this.speakingProcess = player;
      };

      tryPlayer(0);
    });
  }

  /**
   * Stop speaking
   */
  stop(): void {
    if (this.speakingProcess) {
      this.speakingProcess.kill('SIGKILL');
      this.speakingProcess = null;
    }
    this.state.isSpeaking = false;
    this.state.queue = [];
    this.emit('speaking-stopped');
  }

  /**
   * Enable TTS
   */
  enable(): void {
    this.config.enabled = true;
    this.saveConfig();
  }

  /**
   * Disable TTS
   */
  disable(): void {
    this.config.enabled = false;
    this.stop();
    this.saveConfig();
  }

  /**
   * Set auto-speak mode
   */
  setAutoSpeak(enabled: boolean): void {
    this.config.autoSpeak = enabled;
    this.saveConfig();
  }

  /**
   * Get config
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Get state
   */
  getState(): TTSState {
    return { ...this.state };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveConfig();
  }

  /**
   * List available Edge TTS voices
   */
  async listVoices(): Promise<string[]> {
    return new Promise((resolve) => {
      const edgeTTS = spawn('edge-tts', ['--list-voices']);
      let output = '';

      edgeTTS.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      edgeTTS.on('close', () => {
        const voices = output
          .split('\n')
          .filter(line => line.includes('Name:'))
          .map(line => line.replace('Name:', '').trim());
        resolve(voices);
      });

      edgeTTS.on('error', () => {
        resolve([]);
      });
    });
  }

  /**
   * Format status
   */
  formatStatus(): string {
    const status = this.config.enabled ? '✅ Enabled' : '❌ Disabled';
    const speaking = this.state.isSpeaking ? '🔊 Speaking' : '⚪ Idle';

    return `🔊 Text-to-Speech Status
══════════════════════════════════════════════════

Status: ${status}
Provider: ${this.config.provider}
Voice: ${this.config.voice || 'auto (based on language)'}
Auto-speak: ${this.config.autoSpeak ? 'Yes' : 'No'}

Speaking: ${speaking}
Queue: ${this.state.queue.length} message(s)

💡 Commands: /speak <text> | /tts on|off|auto`;
  }
}

// Singleton instance
let ttsManagerInstance: TextToSpeechManager | null = null;

export function getTTSManager(): TextToSpeechManager {
  if (!ttsManagerInstance) {
    ttsManagerInstance = new TextToSpeechManager();
  }
  return ttsManagerInstance;
}

export function resetTTSManager(): void {
  if (ttsManagerInstance) {
    ttsManagerInstance.stop();
  }
  ttsManagerInstance = null;
}
