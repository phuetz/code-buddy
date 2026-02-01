/**
 * Voice Module
 *
 * Provides voice interaction capabilities including wake word detection,
 * speech recognition, and voice activity detection.
 */

// Types
export type {
  WakeWordConfig,
  WakeWordDetection,
  SpeechProvider,
  SpeechRecognitionConfig,
  TranscriptResult,
  TranscriptWord,
  VADConfig,
  VADEvent,
  VoiceSessionState,
  VoiceSessionConfig,
  VoiceSessionEvents,
  AudioDevice,
  AudioChunk,
  AudioStreamConfig,
} from './types.js';

export {
  DEFAULT_WAKE_WORD_CONFIG,
  DEFAULT_SPEECH_RECOGNITION_CONFIG,
  DEFAULT_VAD_CONFIG,
  DEFAULT_VOICE_SESSION_CONFIG,
  DEFAULT_AUDIO_STREAM_CONFIG,
} from './types.js';

// Wake Word
export type { IWakeWordDetector } from './wake-word.js';
export { WakeWordDetector, createWakeWordDetector } from './wake-word.js';

// Speech Recognition
export type { ISpeechRecognizer } from './speech-recognition.js';
export { SpeechRecognizer, createSpeechRecognizer } from './speech-recognition.js';

// Voice Activity Detection
export type { IVADDetector } from './voice-activity.js';
export {
  VoiceActivityDetector,
  createVADDetector,
} from './voice-activity.js';
