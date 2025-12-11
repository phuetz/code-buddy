/**
 * Input module - Voice input, text-to-speech, context mentions, and multimodal
 */

export * from "./context-mentions.js";
export * from "./text-to-speech.js";
export * from "./voice-control.js";
export {
  VoiceInputManager,
  getVoiceInputManager,
  resetVoiceInputManager,
  type VoiceInputConfig,
  type VoiceInputState,
} from "./voice-input-enhanced.js";
export * from "./multimodal-input.js";
// Note: voice-input.js has overlapping types - import directly if needed
