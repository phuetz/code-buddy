import { describe, expect, it } from 'vitest';

import {
  HEADLESS_LOCAL_COMPACT_MAX_TOOLS,
  HEADLESS_LOCAL_COMPACT_MAX_TOKENS,
  isHeadlessLocalPromptCompact,
  isHeadlessPromptCompact,
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

  it('can be switched on for a remote provider, which is the point', () => {
    // Le mode n'etait atteignable que face a un runtime local. Mesure sur une
    // question d'une phrase contre un fournisseur distant : 5 991 jetons
    // d'entree par defaut, et encore 4 660 apres avoir remplace tout le prompt
    // systeme et desactive tous les outils. C'est la surface d'agent qui coute.
    const distant = { CODEBUDDY_HEADLESS: 'true', CODEBUDDY_PROVIDER: 'openai' };
    expect(isHeadlessPromptCompact(distant)).toBe(false);
    for (const valeur of ['true', '1', 'on', 'TRUE', ' On ']) {
      expect(
        isHeadlessPromptCompact({ ...distant, CODEBUDDY_PROMPT_COMPACT: valeur }),
      ).toBe(true);
    }
  });

  it('never turns on outside headless mode, whatever is asked', () => {
    // Poser la variable ne doit pas raccourcir le prompt d'une session
    // interactive : ce n'est pas le meme besoin.
    expect(
      isHeadlessPromptCompact({ CODEBUDDY_PROMPT_COMPACT: 'true', CODEBUDDY_PROVIDER: 'openai' }),
    ).toBe(false);
    expect(
      isHeadlessPromptCompact({ CODEBUDDY_PROMPT_COMPACT: 'true', CODEBUDDY_PROVIDER: 'ollama' }),
    ).toBe(false);
  });

  it('keeps refusal winning over request', () => {
    // « false » doit rester le dernier mot, sinon une activation automatique
    // deviendrait inechappable.
    const local = { CODEBUDDY_HEADLESS: 'true', CODEBUDDY_PROVIDER: 'ollama' };
    expect(isHeadlessPromptCompact(local)).toBe(true);
    for (const valeur of ['false', '0', 'off']) {
      expect(isHeadlessPromptCompact({ ...local, CODEBUDDY_PROMPT_COMPACT: valeur })).toBe(false);
    }
  });

  it('keeps the old name working for existing callers', () => {
    const env = { CODEBUDDY_HEADLESS: 'true', CODEBUDDY_PROMPT_COMPACT: 'true', CODEBUDDY_PROVIDER: 'openai' };
    expect(isHeadlessLocalPromptCompact(env)).toBe(isHeadlessPromptCompact(env));
  });
});
