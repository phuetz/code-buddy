/**
 * Voice-to-Code Pipeline
 *
 * Provides a pipeline that captures audio, transcribes it via the existing
 * SpeechRecognizer, detects whether the transcription is a command or code
 * dictation, and routes accordingly.
 *
 * If the STT modules are not available at runtime (missing native dependencies),
 * this module degrades gracefully with a clear setup message.
 */

import { EventEmitter } from 'events';

export interface VoiceCodeConfig {
  /** STT provider to use */
  sttProvider: 'picovoice' | 'whisper' | 'browser';
  /** Language for recognition */
  language: string;
  /** Auto-send transcribed text as a prompt */
  autoExecute: boolean;
  /** Live microphone/audio source feeding PCM/WAV chunks into the recognizer */
  audioSource?: VoiceAudioSource;
}

export interface VoiceAudioSource {
  start(onAudio: (audio: Buffer) => void): Promise<void>;
  stop(): Promise<void>;
}

const DEFAULT_VOICE_CODE_CONFIG: VoiceCodeConfig = {
  sttProvider: 'whisper',
  language: 'en-US',
  autoExecute: false,
};

/**
 * Command patterns — phrases that indicate a user command vs. code dictation.
 */
const COMMAND_PATTERNS = [
  /^(run|execute|start)\s+(tests?|build|lint|check)/i,
  /^(fix|debug|resolve)\s+(the\s+)?(error|bug|issue|problem)/i,
  /^(open|read|show|display)\s+(file|folder|directory)/i,
  /^(search|find|grep)\s+(for\s+)?/i,
  /^(commit|push|pull|merge|branch|checkout)/i,
  /^(install|add|remove|delete|update)\s+/i,
  /^(undo|redo|revert|restore)/i,
  /^(explain|refactor|review|test)\s+/i,
  /^(stop|cancel|quit|exit)/i,
  /^(help|status|config)/i,
];

/**
 * Detect if a transcription is a command or code dictation.
 */
export function detectIntent(text: string): 'command' | 'dictation' {
  const trimmed = text.trim();
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(trimmed)) {
      return 'command';
    }
  }
  return 'dictation';
}

/**
 * Voice-to-Code Pipeline
 *
 * Events:
 *   'transcription' — raw transcribed text
 *   'command' — parsed command intent
 *   'dictation' — code dictation text
 *   'error' — pipeline error
 *   'status' — status change ('started' | 'stopped')
 */
export class VoiceToCodePipeline extends EventEmitter {
  private config: VoiceCodeConfig;
  private active = false;
  private recognizer: unknown = null;

  constructor(config?: Partial<VoiceCodeConfig>) {
    super();
    this.config = { ...DEFAULT_VOICE_CODE_CONFIG, ...config };
  }

  /**
   * Start the voice-to-code pipeline.
   *
   * Attempts to load the SpeechRecognizer from the voice module.
   * If native dependencies are not available, emits an error with setup instructions.
   */
  async start(config?: Partial<VoiceCodeConfig>): Promise<void> {
    if (this.active) return;

    if (config) {
      this.config = { ...this.config, ...config };
    }

    try {
      // Try to load the speech recognizer dynamically
      const { SpeechRecognizer } = await import('./speech-recognition.js');
      const recognizer = new SpeechRecognizer({
        provider: this.config.sttProvider === 'picovoice' ? 'local' : 'whisper',
        language: this.config.language,
        continuous: true,
        interimResults: false,
      });

      if (!this.config.audioSource) {
        throw new Error(getLiveCaptureUnavailableMessage());
      }

      // Listen for transcription events
      recognizer.on('transcript', (result: { text: string; isFinal: boolean }) => {
        if (!result.isFinal) return;

        const text = result.text.trim();
        if (!text) return;

        this.emit('transcription', text);

        const intent = detectIntent(text);
        if (intent === 'command') {
          this.emit('command', text);
        } else {
          this.emit('dictation', text);
        }
      });

      recognizer.on('error', (err: Error) => {
        this.emit('error', err);
      });

      await recognizer.startListening();
      try {
        await this.config.audioSource.start((audio) => {
          void recognizer.processAudio(audio).catch((err: Error) => {
            this.emit('error', err);
          });
        });
      } catch (err) {
        await recognizer.stopListening();
        throw err;
      }

      this.recognizer = recognizer;
      this.active = true;
      this.emit('status', 'started');
    } catch (err) {
      const setupMessage = err instanceof Error && err.message === getLiveCaptureUnavailableMessage()
        ? err.message
        : getSetupInstructions(this.config.sttProvider);
      const error = new Error(setupMessage);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the voice-to-code pipeline.
   */
  async stop(): Promise<void> {
    if (!this.active) return;

    try {
      if (this.config.audioSource) {
        await this.config.audioSource.stop();
      }

      if (this.recognizer && typeof (this.recognizer as { stopListening?: () => Promise<void> }).stopListening === 'function') {
        await (this.recognizer as { stopListening: () => Promise<void> }).stopListening();
      }
    } catch {
      // Ignore stop errors
    }

    this.recognizer = null;
    this.active = false;
    this.emit('status', 'stopped');
  }

  /**
   * Check if the pipeline is currently active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): VoiceCodeConfig {
    return { ...this.config };
  }
}

function getLiveCaptureUnavailableMessage(): string {
  return [
    'Voice-to-code live microphone capture is not wired in this CLI runtime.',
    'A real VoiceAudioSource must be provided before the pipeline can start.',
    'Use one-shot voice input/transcription paths until a live microphone source is connected.',
  ].join('\n');
}

/**
 * Get setup instructions for a specific STT provider.
 */
function getSetupInstructions(provider: string): string {
  const instructions: Record<string, string> = {
    whisper: [
      'Voice-to-code requires Whisper for speech recognition.',
      '',
      'Setup instructions:',
      '  1. Install whisper.cpp or OpenAI Whisper:',
      '     pip install openai-whisper',
      '     # or build whisper.cpp from https://github.com/ggerganov/whisper.cpp',
      '',
      '  2. Set WHISPER_MODEL_PATH to your model file (optional):',
      '     export WHISPER_MODEL_PATH=/path/to/ggml-base.bin',
      '',
      '  3. Ensure a microphone is connected and accessible.',
    ].join('\n'),
    picovoice: [
      'Voice-to-code requires Picovoice for speech recognition.',
      '',
      'Setup instructions:',
      '  1. Get a Picovoice access key from https://picovoice.ai/',
      '  2. Set the PICOVOICE_ACCESS_KEY environment variable:',
      '     export PICOVOICE_ACCESS_KEY=your-key-here',
      '',
      '  3. Install the Picovoice SDK:',
      '     npm install @picovoice/picovoice-node',
      '',
      '  4. Ensure a microphone is connected and accessible.',
    ].join('\n'),
    browser: [
      'Browser-based speech recognition is only available in web environments.',
      'For CLI use, try the whisper provider instead:',
      '  /voice-code on --provider whisper',
    ].join('\n'),
  };

  return instructions[provider] || instructions.whisper;
}

/**
 * Create a new VoiceToCodePipeline instance.
 */
export function createVoiceToCodePipeline(config?: Partial<VoiceCodeConfig>): VoiceToCodePipeline {
  return new VoiceToCodePipeline(config);
}
