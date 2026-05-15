/**
 * OpenRouter Provider Plugin (Bundled)
 *
 * Wraps OpenRouter as a plugin-based LLM provider.
 * Gated by OPENROUTER_API_KEY environment variable.
 *
 * Native Engine v2026.3.14 — provider-bundled plugins.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider } from '../types.js';
import { requireProviderText } from './response-content.js';

export const OPENROUTER_PROVIDER_ID = 'bundled-openrouter';

export function createOpenRouterProvider(): PluginProvider | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  return {
    id: OPENROUTER_PROVIDER_ID,
    name: 'OpenRouter',
    type: 'llm',
    priority: 5,
    config: {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
    },

    async initialize() {
      logger.debug('OpenRouter bundled provider initialized');
    },

    async shutdown() {
      logger.debug('OpenRouter bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://codebuddy.dev',
          'X-Title': 'Code Buddy',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o',
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return requireProviderText('OpenRouter', data.choices?.[0]?.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
