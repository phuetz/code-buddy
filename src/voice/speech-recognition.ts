/**
 * Speech Recognition
 *
 * Converts speech audio to text using various providers.
 * Supports Whisper, Google, Azure, and other services.
 */

import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { promisify } from 'util';
import type {
  SpeechRecognitionConfig,
  TranscriptResult,
  TranscriptWord,
} from './types.js';
import { DEFAULT_SPEECH_RECOGNITION_CONFIG } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Speech recognizer interface
 */
export interface ISpeechRecognizer {
  /** Start listening */
  startListening(): Promise<void>;
  /** Stop listening */
  stopListening(): Promise<void>;
  /** Process audio chunk */
  processAudio(audio: Buffer): Promise<void>;
  /** Transcribe audio file */
  transcribe(audio: Buffer): Promise<TranscriptResult>;
  /** Check if listening */
  isListening(): boolean;
  /** Get configuration */
  getConfig(): SpeechRecognitionConfig;
}

/**
 * Speech recognizer implementation
 */
export class SpeechRecognizer extends EventEmitter implements ISpeechRecognizer {
  private config: SpeechRecognitionConfig;
  private listening = false;
  private audioBuffer: Buffer[] = [];
  private silenceStart: number | null = null;
  private recordingStart: number | null = null;

  constructor(config: Partial<SpeechRecognitionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SPEECH_RECOGNITION_CONFIG, ...config };
  }

  async startListening(): Promise<void> {
    if (this.listening) return;

    this.listening = true;
    this.audioBuffer = [];
    this.silenceStart = null;
    this.recordingStart = Date.now();

    this.emit('listening-started');
  }

  async stopListening(): Promise<void> {
    if (!this.listening) return;

    this.listening = false;

    // Transcribe collected audio
    if (this.audioBuffer.length > 0) {
      const audio = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];

      try {
        const result = await this.transcribe(audio);
        if (result.text.trim()) {
          this.emit('transcript', result);
        }
      } catch (error) {
        this.emit('error', error);
      }
    }

    this.emit('listening-stopped');
  }

  async processAudio(audio: Buffer): Promise<void> {
    if (!this.listening) return;

    this.audioBuffer.push(audio);

    // Check for max duration
    if (
      this.recordingStart &&
      Date.now() - this.recordingStart > this.config.maxDuration
    ) {
      await this.stopListening();
      return;
    }

    // Emit interim results for continuous mode
    if (this.config.continuous && this.config.interimResults) {
      // In a real implementation, we would send chunks to the API
      // and emit interim results as they come back
    }
  }

  async transcribe(audio: Buffer): Promise<TranscriptResult> {
    const startTime = Date.now();

    try {
      switch (this.config.provider) {
        case 'whisper':
          return await this.transcribeWithWhisper(audio);
        case 'google':
          return await this.transcribeWithGoogle(audio);
        case 'azure':
          return await this.transcribeWithAzure(audio);
        case 'deepgram':
          return await this.transcribeWithDeepgram(audio);
        case 'local':
        default:
          return await this.transcribeLocal(audio);
      }
    } finally {
      const processingTime = Date.now() - startTime;
      this.emit('processing-complete', { processingTime });
    }
  }

  /**
   * Transcribe using OpenAI Whisper API
   */
  private async transcribeWithWhisper(audio: Buffer): Promise<TranscriptResult> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key required for Whisper');
    }

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', this.config.language.split('-')[0]);

    if (this.config.vocabulary && this.config.vocabulary.length > 0) {
      formData.append('prompt', this.config.vocabulary.join(', '));
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`);
    }

    const data = (await response.json()) as { text: string };

    return {
      text: data.text,
      isFinal: true,
      confidence: 0.9, // Whisper doesn't provide confidence
      language: this.config.language,
    };
  }

  /**
   * Transcribe using Google Speech-to-Text
   */
  private async transcribeWithGoogle(audio: Buffer): Promise<TranscriptResult> {
    if (!this.config.apiKey) {
      throw new Error('Google API key required');
    }

    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${this.config.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: this.config.language,
            maxAlternatives: this.config.maxAlternatives,
            profanityFilter: this.config.profanityFilter,
            enableWordTimeOffsets: true,
            speechContexts: this.config.vocabulary
              ? [{ phrases: this.config.vocabulary }]
              : undefined,
          },
          audio: {
            content: audio.toString('base64'),
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google Speech API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        alternatives: Array<{
          transcript: string;
          confidence: number;
          words?: Array<{
            word: string;
            startTime: string;
            endTime: string;
          }>;
        }>;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return {
        text: '',
        isFinal: true,
        confidence: 0,
      };
    }

    const result = data.results[0].alternatives[0];
    const words: TranscriptWord[] = result.words?.map((w) => ({
      word: w.word,
      startTime: parseFloat(w.startTime.replace('s', '')),
      endTime: parseFloat(w.endTime.replace('s', '')),
      confidence: result.confidence,
    })) || [];

    return {
      text: result.transcript,
      isFinal: true,
      confidence: result.confidence,
      words,
      alternatives: data.results[0].alternatives.slice(1).map((a) => ({
        text: a.transcript,
        confidence: a.confidence,
      })),
    };
  }

  /**
   * Transcribe using Azure Speech Services
   */
  private async transcribeWithAzure(audio: Buffer): Promise<TranscriptResult> {
    if (!this.config.apiKey) {
      throw new Error('Azure Speech API key required');
    }

    const region = process.env.AZURE_SPEECH_REGION || process.env.AZURE_REGION;
    if (!region) {
      throw new Error('Azure Speech region required (set AZURE_SPEECH_REGION)');
    }

    const endpoint =
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(this.config.language)}&format=detailed`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.config.apiKey,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: new Uint8Array(audio),
    });

    if (!response.ok) {
      throw new Error(`Azure Speech API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      RecognitionStatus?: string;
      DisplayText?: string;
      NBest?: Array<{
        Display?: string;
        Confidence?: number;
        Words?: Array<{
          Word?: string;
          Offset?: number;
          Duration?: number;
          Confidence?: number;
        }>;
      }>;
    };

    const best = data.NBest?.[0];
    const text = best?.Display || data.DisplayText || '';
    const confidenceRaw = best?.Confidence ?? 0;
    const confidence = confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw;
    const words: TranscriptWord[] =
      best?.Words?.map((word) => {
        const offsetTicks = word.Offset ?? 0;
        const durationTicks = word.Duration ?? 0;
        const start = offsetTicks / 10_000_000;
        const end = (offsetTicks + durationTicks) / 10_000_000;
        const wordConfidenceRaw = word.Confidence ?? confidence;
        const wordConfidence = wordConfidenceRaw > 1 ? wordConfidenceRaw / 100 : wordConfidenceRaw;
        return {
          word: word.Word || '',
          startTime: start,
          endTime: end,
          confidence: wordConfidence,
        };
      }) || [];

    return {
      text,
      isFinal: true,
      confidence: text ? confidence : 0,
      words: words.length > 0 ? words : undefined,
      language: this.config.language,
    };
  }

  /**
   * Transcribe using Deepgram
   */
  private async transcribeWithDeepgram(audio: Buffer): Promise<TranscriptResult> {
    if (!this.config.apiKey) {
      throw new Error('Deepgram API key required');
    }

    const response = await fetch(
      'https://api.deepgram.com/v1/listen?' +
        new URLSearchParams({
          language: this.config.language.split('-')[0],
          punctuate: 'true',
          diarize: 'false',
          smart_format: 'true',
        }),
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          'Content-Type': 'audio/wav',
        },
        body: new Uint8Array(audio),
      }
    );

    if (!response.ok) {
      throw new Error(`Deepgram API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: {
        channels: Array<{
          alternatives: Array<{
            transcript: string;
            confidence: number;
            words?: Array<{
              word: string;
              start: number;
              end: number;
              confidence: number;
            }>;
          }>;
        }>;
      };
    };

    const channel = data.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];

    if (!alternative) {
      return {
        text: '',
        isFinal: true,
        confidence: 0,
      };
    }

    return {
      text: alternative.transcript,
      isFinal: true,
      confidence: alternative.confidence,
      words: alternative.words?.map((w) => ({
        word: w.word,
        startTime: w.start,
        endTime: w.end,
        confidence: w.confidence,
      })),
    };
  }

  /**
   * Select the appropriate Whisper model based on audio duration.
   * VoiceCommander dual-model pattern: fast model for short audio,
   * accurate model for longer recordings.
   */
  private selectModelForDuration(audioLengthBytes: number): string {
    const dual = this.config.dualModel;
    if (!dual?.enabled) {
      return this.config.whisperModel || 'base';
    }

    // Estimate duration: 16-bit mono 16kHz = 32000 bytes/sec
    const estimatedDurationSecs = audioLengthBytes / 32000;
    if (estimatedDurationSecs >= dual.durationThreshold) {
      return dual.accurateModel;
    }
    return dual.fastModel;
  }

  /**
   * Transcribe locally.
   *
   * Tries local `whisper` CLI first, then optionally falls back to
   * OpenAI Whisper when an API key is configured.
   * Uses dual-model strategy when enabled (VoiceCommander pattern).
   */
  private async transcribeLocal(audio: Buffer): Promise<TranscriptResult> {
    if (this.isLikelyWav(audio)) {
      const localResult = await this.transcribeWithLocalWhisperCli(audio);
      if (localResult) {
        return localResult;
      }
    }

    if (this.config.apiKey) {
      return this.transcribeWithWhisper(audio);
    }

    return {
      text: '',
      isFinal: true,
      confidence: 0,
    };
  }

  private isLikelyWav(audio: Buffer): boolean {
    if (audio.length < 12) {
      return false;
    }
    return (
      audio.toString('ascii', 0, 4) === 'RIFF' &&
      audio.toString('ascii', 8, 12) === 'WAVE'
    );
  }

  private async transcribeWithLocalWhisperCli(audio: Buffer): Promise<TranscriptResult | null> {
    const dir = await mkdtemp(join(tmpdir(), 'codebuddy-stt-'));
    const inputPath = join(dir, 'audio.wav');
    const language = this.config.language.split('-')[0];
    const selectedModel = this.selectModelForDuration(audio.length);

    try {
      await writeFile(inputPath, audio);
      await execFileAsync(
        'whisper',
        [
          inputPath,
          '--model',
          selectedModel,
          '--language',
          language,
          '--output_format',
          'json',
          '--output_dir',
          dir,
        ],
        {
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      const jsonPath = join(dir, `${basename(inputPath, '.wav')}.json`);
      const content = await readFile(jsonPath, 'utf8');
      const parsed = JSON.parse(content) as {
        text?: string;
        segments?: Array<{
          text?: string;
          start?: number;
          end?: number;
          avg_logprob?: number;
        }>;
      };

      const text = (parsed.text || '').trim();
      const words: TranscriptWord[] =
        parsed.segments?.map((segment) => ({
          word: (segment.text || '').trim(),
          startTime: segment.start ?? 0,
          endTime: segment.end ?? segment.start ?? 0,
          confidence:
            segment.avg_logprob !== undefined
              ? Math.max(0, Math.min(1, Math.exp(segment.avg_logprob)))
              : 0.75,
        })) || [];

      return {
        text,
        isFinal: true,
        confidence: text ? 0.75 : 0,
        words: words.length > 0 ? words : undefined,
        language: this.config.language,
      };
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  isListening(): boolean {
    return this.listening;
  }

  getConfig(): SpeechRecognitionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SpeechRecognitionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set API key
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
  }

  /**
   * Set language
   */
  setLanguage(language: string): void {
    this.config.language = language;
  }

  /**
   * Add vocabulary words
   */
  addVocabulary(words: string[]): void {
    if (!this.config.vocabulary) {
      this.config.vocabulary = [];
    }
    this.config.vocabulary.push(...words);
  }

  /**
   * Clear vocabulary
   */
  clearVocabulary(): void {
    this.config.vocabulary = [];
  }
}

/**
 * Factory function for creating speech recognizer
 */
export function createSpeechRecognizer(
  config?: Partial<SpeechRecognitionConfig>
): SpeechRecognizer {
  return new SpeechRecognizer(config);
}

export default SpeechRecognizer;
