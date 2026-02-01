/**
 * Voice Types
 *
 * Type definitions for voice interaction features including
 * wake word detection, speech recognition, and voice activity detection.
 */

// ============================================================================
// Wake Word Types
// ============================================================================

/**
 * Wake word detection result
 */
export interface WakeWordDetection {
  /** Detected wake word */
  wakeWord: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Detection timestamp */
  timestamp: Date;
  /** Audio frame index */
  frameIndex?: number;
}

/**
 * Wake word configuration
 */
export interface WakeWordConfig {
  /** Wake words to listen for */
  wakeWords: string[];
  /** Sensitivity (0-1, higher = more sensitive) */
  sensitivity: number;
  /** Minimum confidence threshold */
  minConfidence: number;
  /** Audio sample rate */
  sampleRate: number;
  /** Frame size in samples */
  frameSize: number;
  /** Model path (for custom models) */
  modelPath?: string;
  /** Use built-in wake words only */
  builtInOnly?: boolean;
}

/**
 * Default wake word configuration
 */
export const DEFAULT_WAKE_WORD_CONFIG: WakeWordConfig = {
  wakeWords: ['hey buddy', 'ok code'],
  sensitivity: 0.5,
  minConfidence: 0.7,
  sampleRate: 16000,
  frameSize: 512,
  builtInOnly: false,
};

// ============================================================================
// Speech Recognition Types
// ============================================================================

/**
 * Speech recognition provider
 */
export type SpeechProvider = 'whisper' | 'google' | 'azure' | 'deepgram' | 'local';

/**
 * Speech recognition configuration
 */
export interface SpeechRecognitionConfig {
  /** Provider to use */
  provider: SpeechProvider;
  /** API key (for cloud providers) */
  apiKey?: string;
  /** Language code */
  language: string;
  /** Enable interim results */
  interimResults: boolean;
  /** Continuous recognition */
  continuous: boolean;
  /** Maximum alternatives */
  maxAlternatives: number;
  /** Profanity filter */
  profanityFilter: boolean;
  /** Custom vocabulary */
  vocabulary?: string[];
  /** Whisper model size (for local Whisper) */
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  /** Timeout for silence detection (ms) */
  silenceTimeout: number;
  /** Maximum recording duration (ms) */
  maxDuration: number;
}

/**
 * Default speech recognition configuration
 */
export const DEFAULT_SPEECH_RECOGNITION_CONFIG: SpeechRecognitionConfig = {
  provider: 'whisper',
  language: 'en-US',
  interimResults: true,
  continuous: false,
  maxAlternatives: 1,
  profanityFilter: false,
  whisperModel: 'base',
  silenceTimeout: 2000,
  maxDuration: 60000,
};

/**
 * Transcript result
 */
export interface TranscriptResult {
  /** Transcribed text */
  text: string;
  /** Is this the final result */
  isFinal: boolean;
  /** Confidence score (0-1) */
  confidence: number;
  /** Alternative transcriptions */
  alternatives?: Array<{
    text: string;
    confidence: number;
  }>;
  /** Word-level timestamps */
  words?: TranscriptWord[];
  /** Language detected */
  language?: string;
  /** Processing duration (ms) */
  processingTime?: number;
}

/**
 * Word with timing information
 */
export interface TranscriptWord {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

// ============================================================================
// Voice Activity Detection Types
// ============================================================================

/**
 * VAD (Voice Activity Detection) configuration
 */
export interface VADConfig {
  /** Enable VAD */
  enabled: boolean;
  /** Speech start threshold (0-1) */
  speechStartThreshold: number;
  /** Speech end threshold (0-1) */
  speechEndThreshold: number;
  /** Pre-speech padding (ms) */
  preSpeechPadding: number;
  /** Post-speech padding (ms) */
  postSpeechPadding: number;
  /** Minimum speech duration (ms) */
  minSpeechDuration: number;
  /** Maximum silence duration (ms) */
  maxSilenceDuration: number;
  /** Audio sample rate */
  sampleRate: number;
  /** Frame duration (ms) */
  frameDuration: number;
}

/**
 * Default VAD configuration
 */
export const DEFAULT_VAD_CONFIG: VADConfig = {
  enabled: true,
  speechStartThreshold: 0.5,
  speechEndThreshold: 0.35,
  preSpeechPadding: 300,
  postSpeechPadding: 800,
  minSpeechDuration: 250,
  maxSilenceDuration: 1500,
  sampleRate: 16000,
  frameDuration: 30,
};

/**
 * VAD event
 */
export interface VADEvent {
  /** Event type */
  type: 'speech-start' | 'speech-end' | 'silence';
  /** Event timestamp */
  timestamp: Date;
  /** Audio position (ms) */
  positionMs: number;
  /** Voice probability */
  probability: number;
}

// ============================================================================
// Voice Session Types
// ============================================================================

/**
 * Voice session state
 */
export type VoiceSessionState =
  | 'idle'
  | 'listening-wake-word'
  | 'listening-speech'
  | 'processing'
  | 'speaking'
  | 'error';

/**
 * Voice session configuration
 */
export interface VoiceSessionConfig {
  /** Wake word configuration */
  wakeWord: Partial<WakeWordConfig>;
  /** Speech recognition configuration */
  speech: Partial<SpeechRecognitionConfig>;
  /** VAD configuration */
  vad: Partial<VADConfig>;
  /** Enable push-to-talk mode */
  pushToTalk: boolean;
  /** Push-to-talk key */
  pushToTalkKey?: string;
  /** Auto-listen after response */
  autoListen: boolean;
  /** Beep on activation */
  beepOnActivation: boolean;
  /** Visual feedback */
  visualFeedback: boolean;
}

/**
 * Default voice session configuration
 */
export const DEFAULT_VOICE_SESSION_CONFIG: VoiceSessionConfig = {
  wakeWord: {},
  speech: {},
  vad: {},
  pushToTalk: false,
  autoListen: true,
  beepOnActivation: true,
  visualFeedback: true,
};

/**
 * Voice session events
 */
export interface VoiceSessionEvents {
  'state-change': (state: VoiceSessionState) => void;
  'wake-word': (detection: WakeWordDetection) => void;
  'transcript': (result: TranscriptResult) => void;
  'command': (text: string) => void;
  'vad': (event: VADEvent) => void;
  'error': (error: Error) => void;
  'audio-level': (level: number) => void;
}

// ============================================================================
// Audio Types
// ============================================================================

/**
 * Audio input device
 */
export interface AudioDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
  isDefault: boolean;
  sampleRate?: number;
  channels?: number;
}

/**
 * Audio chunk
 */
export interface AudioChunk {
  /** Raw audio data */
  data: Buffer;
  /** Sample rate */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Bits per sample */
  bitsPerSample: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Audio stream configuration
 */
export interface AudioStreamConfig {
  /** Sample rate */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Bits per sample */
  bitsPerSample: number;
  /** Frame size in samples */
  frameSize: number;
  /** Device ID */
  deviceId?: string;
}

/**
 * Default audio stream configuration
 */
export const DEFAULT_AUDIO_STREAM_CONFIG: AudioStreamConfig = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  frameSize: 512,
};
