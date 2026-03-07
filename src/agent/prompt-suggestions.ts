/**
 * Prompt Suggestion Engine
 *
 * Generates follow-up prompt suggestions based on conversation context.
 * Suggestions help users continue productive conversations by offering
 * relevant next steps.
 *
 * @module agent/prompt-suggestions
 */

import { logger } from '../utils/logger.js';

type SuggestionMessage = {
  role: 'system' | 'user';
  content: string;
};

type SuggestionClient = {
  chat: (
    messages: SuggestionMessage[],
    tools?: unknown[]
  ) => Promise<{
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  }>;
};

/**
 * Engine for generating follow-up prompt suggestions based on
 * conversation context and the last assistant response.
 */
export class PromptSuggestionEngine {
  private enabled: boolean;
  private cachedSuggestions: string[];
  private client: SuggestionClient | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
    this.cachedSuggestions = [];
  }

  /**
   * Check if suggestions are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable suggestion generation
   */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) {
      this.cachedSuggestions = [];
    }
    logger.info(`Prompt suggestions ${value ? 'enabled' : 'disabled'}`);
  }

  /**
   * Generate 2-3 follow-up suggestions based on context and last response.
   *
   * @param context - The conversation context or user's last message
   * @param lastResponse - The assistant's last response
   * @returns Array of suggestion strings
   */
  async generateSuggestions(context: string, lastResponse: string): Promise<string[]> {
    if (!this.enabled) {
      this.cachedSuggestions = [];
      return [];
    }

    if (!context && !lastResponse) {
      this.cachedSuggestions = [];
      return [];
    }

    const suggestions =
      (await this.generateSuggestionsWithAI(context, lastResponse)) ||
      this.generateHeuristicSuggestions(context, lastResponse);

    this.cachedSuggestions = suggestions;
    logger.debug(`Generated ${suggestions.length} prompt suggestions`);

    return suggestions;
  }

  /**
   * Get the cached suggestions from the last generateSuggestions call
   */
  getSuggestions(): string[] {
    return [...this.cachedSuggestions];
  }

  /**
   * Clear cached suggestions
   */
  clearSuggestions(): void {
    this.cachedSuggestions = [];
  }

  /**
   * Build the prompt for suggestion generation
   */
  private buildSuggestionPrompt(context: string, lastResponse: string): string {
    return [
      'Based on the following conversation, suggest 2-3 short follow-up questions or actions the user might want to take next.',
      '',
      'User context:',
      context,
      '',
      'Assistant response:',
      lastResponse,
      '',
      'Provide 2-3 brief, actionable follow-up suggestions (one per line, no numbering):',
    ].join('\n');
  }

  /**
   * Generate suggestions with the configured LLM if an API key is available.
   */
  private async generateSuggestionsWithAI(
    context: string,
    lastResponse: string
  ): Promise<string[] | null> {
    const client = await this.getClient();
    if (!client) {
      return null;
    }

    try {
      const response = await client.chat([
        {
          role: 'system',
          content: 'You generate concise follow-up prompt suggestions. Return 2 or 3 short suggestions, one per line, with no numbering.',
        },
        {
          role: 'user',
          content: this.buildSuggestionPrompt(context, lastResponse),
        },
      ], []);

      const content = response.choices?.[0]?.message?.content || '';
      const suggestions = this.parseSuggestions(content);
      return suggestions.length >= 2 ? suggestions : null;
    } catch (error) {
      logger.debug('Falling back to heuristic prompt suggestions', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getClient(): Promise<SuggestionClient | null> {
    if (this.client) {
      return this.client;
    }

    const apiKey = process.env.GROK_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }

    const { CodeBuddyClient } = await import('../codebuddy/client.js');
    this.client = new CodeBuddyClient(apiKey, process.env.GROK_MODEL || 'grok-code-fast-1') as SuggestionClient;
    return this.client;
  }

  /**
   * Local heuristic fallback when no LLM is configured.
   */
  private generateHeuristicSuggestions(context: string, lastResponse: string): string[] {
    const combined = `${context} ${lastResponse}`.toLowerCase();
    const suggestions: string[] = [];

    if (combined.includes('test')) {
      suggestions.push('Run the test suite to verify changes');
    }
    if (combined.includes('error') || combined.includes('bug') || combined.includes('fix')) {
      suggestions.push('Show me the full error stack trace');
    }
    if (combined.includes('file') || combined.includes('code')) {
      suggestions.push('Review the related files for potential issues');
    }
    if (combined.includes('refactor')) {
      suggestions.push('Extract this into a separate function');
    }
    if (combined.includes('deploy') || combined.includes('build')) {
      suggestions.push('Check the build output for warnings');
    }

    // Always return at least 2 suggestions
    if (suggestions.length < 2) {
      suggestions.push('Tell me more about this');
      suggestions.push('What are the next steps?');
    }

    return suggestions.slice(0, 3);
  }

  private parseSuggestions(content: string): string[] {
    const cleaned = content
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);

    const unique: string[] = [];
    for (const suggestion of cleaned) {
      if (!unique.includes(suggestion)) {
        unique.push(suggestion);
      }
      if (unique.length >= 3) {
        break;
      }
    }

    return unique;
  }
}
