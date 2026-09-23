import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyHeadlessCompactRequest,
  capCompactToolList,
  HEADLESS_LOCAL_COMPACT_MAX_TOOLS,
  HEADLESS_LOCAL_COMPACT_MAX_TOKENS,
  isHeadlessLocalPromptCompact,
  isHeadlessPromptCompact,
  isLocalLlmProvider,
} from '../../src/config/headless-local-prompt.js';
import { logger } from '../../src/utils/logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('does not let --compact override an explicit refusal, and warns', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    for (const valeur of ['false', '0', 'off', 'FALSE', ' Off ']) {
      warn.mockClear();
      const env = { CODEBUDDY_PROMPT_COMPACT: valeur };
      const decision = applyHeadlessCompactRequest(env, true);
      expect(decision.refused).toBe(true);
      expect(env.CODEBUDDY_PROMPT_COMPACT).toBe(valeur);
      expect(isHeadlessPromptCompact({
        ...env,
        CODEBUDDY_HEADLESS: 'true',
        CODEBUDDY_PROVIDER: 'openai',
      })).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(`CODEBUDDY_PROMPT_COMPACT=${valeur}`),
      );
    }
    warn.mockClear();
    const libre: NodeJS.ProcessEnv = {};
    expect(applyHeadlessCompactRequest(libre, true)).toEqual({ refused: false });
    expect(libre.CODEBUDDY_PROMPT_COMPACT).toBe('true');
    expect(warn).not.toHaveBeenCalled();
  });

  it('caps the schemas actually sent at 8, with restore_context inside the ceiling', () => {
    const schema = (name: string) => ({ function: { name } });
    // Mesure lot 9, question « Réponds uniquement : OK » : 5 garantis
    // (cœur compact + restore_context) puis 5 reliquats RAG. Le plafond
    // annoncé est 8. Les deux en trop sont les deux derniers reliquats,
    // pas une injection de surface.
    const measured = [
      'view_file', 'bash', 'search', 'tool_search', 'restore_context',
      'video_trailer_plan', 'comfy_recipe', 'x_search', 'peer_tool_invoke', 'web_test',
    ].map(schema);
    expect(capCompactToolList(measured).map((tool) => tool.function.name)).toEqual([
      'view_file', 'bash', 'search', 'tool_search', 'restore_context',
      'video_trailer_plan', 'comfy_recipe', 'x_search',
    ]);

    // Outils de surface prependés par l'exécuteur : ils remplissent les
    // places restantes, ils ne font pas sauter le plafond, et
    // restore_context n'est pas le premier sacrifié.
    const withSurface = [
      'list_peers', 'route_peer', 'peer_delegate', 'peer_tool_invoke',
      'view_file', 'bash', 'search', 'tool_search', 'restore_context',
      'video_trailer_plan',
    ].map(schema);
    expect(capCompactToolList(withSurface).map((tool) => tool.function.name)).toEqual([
      'view_file', 'bash', 'search', 'tool_search', 'restore_context',
      'list_peers', 'route_peer', 'peer_delegate',
    ]);

    const already = ['bash', 'view_file'].map(schema);
    expect(capCompactToolList(already).map((tool) => tool.function.name)).toEqual([
      'bash', 'view_file',
    ]);
  });
});
