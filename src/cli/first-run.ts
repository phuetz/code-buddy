/** Focused recovery UX for an interactive launch with no usable provider. */

import { buildNoProviderGuidance } from './zero-config.js';

export const FIRST_RUN_LOGIN_PROMPT =
  '\nNo AI provider configured. Sign in with ChatGPT now (OAuth, no API key, $0 marginal cost with your plan)? [Y/n] ';

/**
 * Generic guidance (Ollama state unknown). The launch path prints the variant
 * tailored to what the zero-config probe saw: `buildNoProviderGuidance(decision)`.
 */
export const NO_PROVIDER_GUIDANCE = buildNoProviderGuidance();

export function acceptsRecommendedLogin(answer: string): boolean {
  const normalized = answer.trim();
  return normalized === '' || /^y(?:es)?$/i.test(normalized);
}

export interface FirstRunLoginOptions<T> {
  interactive: boolean;
  ask: (question: string) => Promise<string>;
  login: () => Promise<void>;
  reloadProvider: () => Promise<T | null>;
  onLoginError?: (error: unknown) => void;
}

/**
 * Offer the shortest recommended setup path and return the freshly resolved
 * provider state. Declining or a failed OAuth flow leaves normal diagnostics
 * to the caller.
 */
export async function recoverFirstRunWithChatGpt<T>(
  options: FirstRunLoginOptions<T>,
): Promise<T | null> {
  if (!options.interactive) return null;
  const answer = await options.ask(FIRST_RUN_LOGIN_PROMPT);
  if (!acceptsRecommendedLogin(answer)) return null;

  try {
    await options.login();
    return await options.reloadProvider();
  } catch (error) {
    options.onLoginError?.(error);
    return null;
  }
}
