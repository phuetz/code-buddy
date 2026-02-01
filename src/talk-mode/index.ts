/**
 * Talk Mode Module
 *
 * Text-to-Speech (TTS) functionality with support for multiple providers.
 */

// Types
export type {
  TTSProvider,
  TTSProviderConfig,
  PiperConfig,
  CoquiConfig,
  ESpeakConfig,
  SystemTTSConfig,
  OpenAITTSConfig,
  OpenAIVoice,
  ElevenLabsConfig,
  EdgeTTSConfig,
  Voice,
  SynthesisOptions,
  SynthesisResult,
  SynthesisProgress,
  WordTiming,
  AudioFormat,
  PlaybackOptions,
  PlaybackState,
  SpeechItem,
  QueueConfig,
  TalkModeConfig,
  TalkModeEvents,
} from './types.js';

export {
  DEFAULT_QUEUE_CONFIG,
  DEFAULT_TALK_MODE_CONFIG,
} from './types.js';

// Manager
export type { ITTSProvider } from './tts-manager.js';

export {
  MockTTSProvider,
  TTSManager,
  getTTSManager,
  resetTTSManager,
} from './tts-manager.js';

// Providers
export {
  OpenAITTSProvider,
  ElevenLabsProvider,
  EdgeTTSProvider,
} from './providers/index.js';
