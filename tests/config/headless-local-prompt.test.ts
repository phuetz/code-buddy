import { describe, expect, it } from 'vitest';

import {
  HEADLESS_LOCAL_COMPACT_MAX_TOOLS,
  HEADLESS_LOCAL_COMPACT_MAX_TOKENS,
  isHeadlessLocalPromptCompact,
  isLocalLlmProvider,
} from '../../src/config/headless-local-prompt.js';

describe('headless local compact prompt', () => {
  it('detects Ollama / LM Studio / vLLM and ignores cloud providers', () => {
    expect(isLocalLlmProvider({ CODEBUDDY_PROVIDER: 'ollama' })).toBe(true);
    expect(isLocalLlmProvider({ CODEBUDDY_PROVIDER: 'lmstudio' })).toBe(true);
    expect(isLocalLlmProvider({ CODEBUDDY_PROVIDER: 'vllm' })).toBe(true);
    expect(isLocalLlmProvider({ OLLAMA_HOST: 'http://127.0.0.1:11435' })).toBe(true);
    expect(isLocalLlmProvider({ CODEBUDDY_PROVIDER: 'openai' })).toBe(false);
    expect(isLocalLlmProvider({})).toBe(false);
  });

  it('is on for -p local and off with CODEBUDDY_PROMPT_COMPACT=false', () => {
    expect(isHeadlessLocalPromptCompact({
      CODEBUDDY_HEADLESS: 'true',
      CODEBUDDY_PROVIDER: 'ollama',
    })).toBe(true);
    expect(isHeadlessLocalPromptCompact({
      CODEBUDDY_HEADLESS: 'true',
      CODEBUDDY_PROVIDER: 'ollama',
      CODEBUDDY_PROMPT_COMPACT: 'false',
    })).toBe(false);
    expect(isHeadlessLocalPromptCompact({
      CODEBUDDY_PROVIDER: 'ollama',
    })).toBe(false);
    expect(HEADLESS_LOCAL_COMPACT_MAX_TOOLS).toBe(8);
    expect(HEADLESS_LOCAL_COMPACT_MAX_TOKENS).toBe(1500);
  });
});
