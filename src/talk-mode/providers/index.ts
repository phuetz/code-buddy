/**
 * TTS Providers Module
 *
 * Exports all TTS provider implementations.
 */

export { OpenAITTSProvider } from './openai-tts.js';
export { ElevenLabsProvider } from './elevenlabs.js';
export { EdgeTTSProvider } from './edge-tts.js';

// Re-export types
export type {
  OpenAITTSConfig,
  OpenAIVoice,
  ElevenLabsConfig,
  EdgeTTSConfig,
} from '../types.js';
