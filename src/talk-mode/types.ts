/**
 * Talk Mode Types
 *
 * Type definitions for Text-to-Speech (TTS) functionality.
 */

// ============================================================================
// Provider Types
// ============================================================================

export type TTSProvider = 'piper' | 'coqui' | 'espeak' | 'system' | 'mock' | 'openai' | 'elevenlabs' | 'edge';

export interface TTSProviderConfig {
  /** Provider identifier */
  provider: TTSProvider;
  /** Provider-specific settings */
  settings?: Record<string, unknown>;
  /** Path to binary/executable */
  binaryPath?: string;
  /** Model or voice path */
  modelPath?: string;
  /** Enable provider */
  enabled: boolean;
  /** Priority (higher = preferred) */
  priority: number;
}

export interface PiperConfig {
  /** Path to piper binary */
  binaryPath: string;
  /** Path to voice model (.onnx) */
  modelPath: string;
  /** Path to model config (.json) */
  configPath?: string;
  /** Speaker ID for multi-speaker models */
  speakerId?: number;
  /** Output format */
  outputFormat?: 'wav' | 'raw';
  /** Sample rate */
  sampleRate?: number;
  /** Noise scale */
  noiseScale?: number;
  /** Length scale (speed) */
  lengthScale?: number;
  /** Noise width */
  noiseWidth?: number;
}

export interface CoquiConfig {
  /** Path to tts binary or use API */
  mode: 'local' | 'api';
  /** Path to TTS binary */
  binaryPath?: string;
  /** Model name for API */
  modelName?: string;
  /** API URL */
  apiUrl?: string;
  /** API key */
  apiKey?: string;
  /** Speaker name/ID */
  speaker?: string;
  /** Language code */
  language?: string;
}

export interface ESpeakConfig {
  /** Voice name */
  voice?: string;
  /** Speed (words per minute) */
  speed?: number;
  /** Pitch (0-99) */
  pitch?: number;
  /** Volume (0-200) */
  volume?: number;
  /** Word gap */
  wordGap?: number;
  /** Capital emphasis */
  capitalEmphasis?: number;
}

export interface SystemTTSConfig {
  /** Voice identifier (platform-specific) */
  voice?: string;
  /** Rate multiplier */
  rate?: number;
  /** Pitch multiplier */
  pitch?: number;
  /** Volume (0-1) */
  volume?: number;
}

export interface OpenAITTSConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Voice name (alloy, echo, fable, onyx, nova, shimmer) */
  voice?: OpenAIVoice;
  /** Model (tts-1 or tts-1-hd) */
  model?: 'tts-1' | 'tts-1-hd';
  /** Speed (0.25 to 4.0) */
  speed?: number;
  /** Response format */
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
}

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

export interface ElevenLabsConfig {
  /** ElevenLabs API key */
  apiKey: string;
  /** Voice ID */
  voiceId?: string;
  /** Model ID */
  modelId?: string;
  /** Stability (0-1) */
  stability?: number;
  /** Similarity boost (0-1) */
  similarityBoost?: number;
  /** Style (0-1, only for some models) */
  style?: number;
  /** Use speaker boost */
  useSpeakerBoost?: boolean;
}

export interface EdgeTTSConfig {
  /** Voice name (e.g., 'en-US-JennyNeural') */
  voice?: string;
  /** Rate adjustment (e.g., '+10%', '-20%') */
  rate?: string;
  /** Volume adjustment (e.g., '+50%', '-10%') */
  volume?: string;
  /** Pitch adjustment (e.g., '+5Hz', '-10Hz') */
  pitch?: string;
}

// ============================================================================
// Voice Types
// ============================================================================

export interface Voice {
  /** Unique voice identifier */
  id: string;
  /** Display name */
  name: string;
  /** Voice description */
  description?: string;
  /** Language code (e.g., 'en-US', 'fr-FR') */
  language: string;
  /** Gender */
  gender?: 'male' | 'female' | 'neutral';
  /** Provider this voice belongs to */
  provider: TTSProvider;
  /** Provider-specific voice ID */
  providerId: string;
  /** Quality tier */
  quality?: 'low' | 'medium' | 'high';
  /** Sample rate */
  sampleRate?: number;
  /** Is this a default voice */
  isDefault?: boolean;
}

// ============================================================================
// Synthesis Types
// ============================================================================

export interface SynthesisOptions {
  /** Voice to use */
  voice?: string;
  /** Language code */
  language?: string;
  /** Speaking rate (0.5 - 2.0) */
  rate?: number;
  /** Pitch adjustment (0.5 - 2.0) */
  pitch?: number;
  /** Volume (0 - 1) */
  volume?: number;
  /** Output format */
  format?: AudioFormat;
  /** SSML input */
  ssml?: boolean;
  /** Enable sentence boundary detection */
  sentenceBoundaries?: boolean;
  /** Stream output */
  stream?: boolean;
}

export type AudioFormat = 'wav' | 'mp3' | 'ogg' | 'raw' | 'pcm';

export interface SynthesisResult {
  /** Audio data */
  audio: Buffer;
  /** Audio format */
  format: AudioFormat;
  /** Duration in milliseconds */
  durationMs: number;
  /** Sample rate */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Bytes per sample */
  bitsPerSample: number;
  /** Word timings (if available) */
  wordTimings?: WordTiming[];
  /** Provider used */
  provider: TTSProvider;
  /** Voice used */
  voice: string;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface SynthesisProgress {
  /** Current position in text */
  position: number;
  /** Total text length */
  total: number;
  /** Percentage complete */
  percent: number;
  /** Current word/sentence being processed */
  current?: string;
}

// ============================================================================
// Playback Types
// ============================================================================

export interface PlaybackOptions {
  /** Volume (0-1) */
  volume?: number;
  /** Playback rate */
  rate?: number;
  /** Start position in ms */
  startMs?: number;
  /** End position in ms */
  endMs?: number;
  /** Loop playback */
  loop?: boolean;
  /** Fade in duration ms */
  fadeInMs?: number;
  /** Fade out duration ms */
  fadeOutMs?: number;
}

export interface PlaybackState {
  /** Current playback status */
  status: 'playing' | 'paused' | 'stopped' | 'buffering';
  /** Current position in ms */
  positionMs: number;
  /** Total duration in ms */
  durationMs: number;
  /** Current volume */
  volume: number;
  /** Current rate */
  rate: number;
  /** Is muted */
  muted: boolean;
}

// ============================================================================
// Queue Types
// ============================================================================

export interface SpeechItem {
  /** Unique item ID */
  id: string;
  /** Text to speak */
  text: string;
  /** Synthesis options */
  options?: SynthesisOptions;
  /** Priority (higher = sooner) */
  priority?: number;
  /** Created timestamp */
  createdAt: Date;
  /** Status */
  status: 'pending' | 'synthesizing' | 'ready' | 'playing' | 'completed' | 'failed';
  /** Error if failed */
  error?: string;
  /** Pre-synthesized audio */
  audio?: SynthesisResult;
}

export interface QueueConfig {
  /** Maximum queue size */
  maxSize: number;
  /** Enable pre-synthesis */
  preSynthesize: boolean;
  /** Number of items to pre-synthesize */
  preSynthesizeCount: number;
  /** Auto-play when items are added */
  autoPlay: boolean;
  /** Pause between items in ms */
  gapMs: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxSize: 100,
  preSynthesize: true,
  preSynthesizeCount: 3,
  autoPlay: true,
  gapMs: 300,
};

// ============================================================================
// Configuration
// ============================================================================

export interface TalkModeConfig {
  /** Enable talk mode */
  enabled: boolean;
  /** Provider configurations */
  providers: TTSProviderConfig[];
  /** Default voice */
  defaultVoice?: string;
  /** Default language */
  defaultLanguage: string;
  /** Default synthesis options */
  defaultOptions: Partial<SynthesisOptions>;
  /** Queue configuration */
  queueConfig: QueueConfig;
  /** Audio output device */
  audioDevice?: string;
  /** Cache synthesized audio */
  cacheEnabled: boolean;
  /** Cache max size in bytes */
  cacheMaxBytes: number;
  /** Cache TTL in ms */
  cacheTTLMs: number;
}

export const DEFAULT_TALK_MODE_CONFIG: TalkModeConfig = {
  enabled: true,
  providers: [],
  defaultLanguage: 'en-US',
  defaultOptions: {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    format: 'wav',
  },
  queueConfig: DEFAULT_QUEUE_CONFIG,
  cacheEnabled: true,
  cacheMaxBytes: 100 * 1024 * 1024, // 100MB
  cacheTTLMs: 60 * 60 * 1000, // 1 hour
};

// ============================================================================
// Events
// ============================================================================

export interface TalkModeEvents {
  'synthesis-start': (item: SpeechItem) => void;
  'synthesis-progress': (item: SpeechItem, progress: SynthesisProgress) => void;
  'synthesis-complete': (item: SpeechItem, result: SynthesisResult) => void;
  'synthesis-error': (item: SpeechItem, error: Error) => void;
  'playback-start': (item: SpeechItem) => void;
  'playback-progress': (item: SpeechItem, state: PlaybackState) => void;
  'playback-complete': (item: SpeechItem) => void;
  'playback-error': (item: SpeechItem, error: Error) => void;
  'queue-change': (queue: SpeechItem[]) => void;
  'voice-change': (voice: Voice) => void;
  'provider-change': (provider: TTSProvider) => void;
}
