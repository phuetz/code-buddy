/** Focused recovery UX for an interactive launch with no usable provider. */

export const FIRST_RUN_LOGIN_PROMPT =
  '\nNo AI provider configured. Sign in with ChatGPT now (OAuth, no API key, $0 marginal cost with your plan)? [Y/n] ';

export const NO_PROVIDER_GUIDANCE = [
  '❌ No AI provider configured.',
  '   1. Recommended — ChatGPT OAuth (no API key, $0 marginal cost with your plan):',
  '      buddy login',
  '   2. Local & free — start Ollama and install a coding model:',
  '      ollama pull qwen2.5-coder:7b',
  '      export OLLAMA_HOST=http://localhost:11434',
  '   3. More providers — run the full wizard or configure an API key:',
  '      buddy onboard',
  '      GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY',
  '   After option 1 or 2, run  buddy try  for the one-minute coding demo.',
  '   Check anytime:  buddy doctor   (add --fix to auto-configure a running Ollama).',
].join('\n');

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
