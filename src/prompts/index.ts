/**
 * Prompts module - exports all system prompts for Grok CLI
 */

export {
  getBaseSystemPrompt,
  getSystemPromptForMode,
  getChatOnlySystemPrompt,
  getChatOnlySystemPromptEN,
  YOLO_MODE_ADDITIONS,
  SAFE_MODE_ADDITIONS,
  CODE_MODE_ADDITIONS,
  RESEARCH_MODE_ADDITIONS,
} from "./system-base.js";

// New: External Markdown prompts system (inspired by mistral-vibe)
export {
  PromptManager,
  getPromptManager,
  resetPromptManager,
  isWellAlignedModel,
  needsExtraSecurity,
  autoSelectPromptId,
  type PromptConfig,
  type PromptSection,
} from "./prompt-manager.js";
