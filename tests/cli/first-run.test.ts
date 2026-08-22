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
    const grokKey = NO_PROVIDER_GUIDANCE.indexOf('GROK_API_KEY');

    expect(login).toBeGreaterThanOrEqual(0);
    expect(login).toBeLessThan(ollama);
    expect(ollama).toBeLessThan(grokKey);
    expect(NO_PROVIDER_GUIDANCE).toContain('buddy try');
    expect(NO_PROVIDER_GUIDANCE).toContain('$0 marginal cost');
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
