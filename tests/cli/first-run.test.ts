import { describe, expect, it, vi } from 'vitest';
import {
  FIRST_RUN_LOGIN_PROMPT,
  NO_PROVIDER_GUIDANCE,
  acceptsRecommendedLogin,
  recoverFirstRunWithChatGpt,
} from '../../src/cli/first-run.js';

describe('first-run provider recovery', () => {
  it('puts buddy login first, Ollama second, and API keys last', () => {
    const login = NO_PROVIDER_GUIDANCE.indexOf('buddy login');
    const ollama = NO_PROVIDER_GUIDANCE.indexOf('Ollama');
    const apiKey = NO_PROVIDER_GUIDANCE.indexOf('CODEBUDDY_API_KEY');

    expect(login).toBeGreaterThanOrEqual(0);
    expect(login).toBeLessThan(ollama);
    expect(ollama).toBeLessThan(apiKey);
    expect(NO_PROVIDER_GUIDANCE).toContain('buddy try');
    expect(NO_PROVIDER_GUIDANCE).toContain('$0 marginal cost');
    expect(NO_PROVIDER_GUIDANCE).toContain('ollama pull qwen3:8b');
    // 2.4 zero-config: a running Ollama is detected, nothing to export.
    expect(NO_PROVIDER_GUIDANCE).toContain('detected automatically, nothing to export');
    expect(NO_PROVIDER_GUIDANCE).not.toContain('export CODEBUDDY_PROVIDER');
    expect(NO_PROVIDER_GUIDANCE).not.toContain('ollama pull qwen2.5');
  });

  it('defaults the interactive recommendation to yes', () => {
    expect(acceptsRecommendedLogin('')).toBe(true);
    expect(acceptsRecommendedLogin('yes')).toBe(true);
    expect(acceptsRecommendedLogin('n')).toBe(false);
    expect(FIRST_RUN_LOGIN_PROMPT).toContain('ChatGPT');
  });

  it('logs in and reloads provider state in the same first-run process', async () => {
    const login = vi.fn(async () => {});
    const reloadProvider = vi.fn(async () => ({ apiKey: 'oauth-chatgpt' }));

    const recovered = await recoverFirstRunWithChatGpt({
      interactive: true,
      ask: async () => '',
      login,
      reloadProvider,
    });

    expect(recovered).toEqual({ apiKey: 'oauth-chatgpt' });
    expect(login).toHaveBeenCalledOnce();
    expect(reloadProvider).toHaveBeenCalledOnce();
  });

  it('does not launch OAuth when the user declines or the terminal is non-interactive', async () => {
    const login = vi.fn(async () => {});
    const reloadProvider = vi.fn(async () => ({ apiKey: 'oauth-chatgpt' }));

    expect(await recoverFirstRunWithChatGpt({
      interactive: true,
      ask: async () => 'n',
      login,
      reloadProvider,
    })).toBeNull();
    expect(await recoverFirstRunWithChatGpt({
      interactive: false,
      ask: async () => 'yes',
      login,
      reloadProvider,
    })).toBeNull();
    expect(login).not.toHaveBeenCalled();
    expect(reloadProvider).not.toHaveBeenCalled();
  });
});
