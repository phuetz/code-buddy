/**
 * TTS Providers Module
 *
 * Exports all TTS provider implementations.
 */

export { OpenAITTSProvider } from './openai-tts.js';
export { ElevenLabsProvider } from './elevenlabs.js';
export { EdgeTTSProvider } from './edge-tts.js';
export { AudioReaderTTSProvider } from './audioreader-tts.js';
export { PocketTTSProvider } from './pocket-tts.js';

// Re-export types
export type {
  OpenAITTSConfig,
  OpenAIVoice,
  ElevenLabsConfig,
  EdgeTTSConfig,
  AudioReaderTTSConfig,
  PocketTTSConfig,
} from '../types.js';
