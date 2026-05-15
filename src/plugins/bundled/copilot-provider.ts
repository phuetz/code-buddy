/**
 * GitHub Copilot Provider Plugin (Bundled)
 *
 * Wraps GitHub Copilot as a plugin-based LLM provider.
 * Gated by GITHUB_COPILOT_TOKEN environment variable.
 *
 * Native Engine v2026.3.14 — provider-bundled plugins.
 */

import { logger } from '../../utils/logger.js';
import type { PluginProvider } from '../types.js';
import { requireProviderText } from './response-content.js';

export const COPILOT_PROVIDER_ID = 'bundled-copilot';

export function createCopilotProvider(): PluginProvider | null {
  const token = process.env.GITHUB_COPILOT_TOKEN;
  if (!token) return null;

  return {
    id: COPILOT_PROVIDER_ID,
    name: 'GitHub Copilot',
    type: 'llm',
    priority: 3,
    config: {
      apiKeyEnv: 'GITHUB_COPILOT_TOKEN',
    },

    async initialize() {
      logger.debug('GitHub Copilot bundled provider initialized');
    },

    async shutdown() {
      logger.debug('GitHub Copilot bundled provider shutdown');
    },

    async chat(messages: Array<{ role: string; content: string }>) {
      const response = await fetch('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Editor-Version': 'codebuddy/1.0',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages,
          max_tokens: 4096,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Copilot API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return requireProviderText('GitHub Copilot', data.choices?.[0]?.message?.content);
    },

    async complete(prompt: string) {
      return this.chat!([{ role: 'user', content: prompt }]);
    },
  };
}
