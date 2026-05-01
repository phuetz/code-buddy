/**
 * Advisor Tool — second opinion from a stronger reviewer model
 *
 * The tool takes no parameters. It reads the current conversation history
 * via an injected provider, instantiates a dedicated CodeBuddyClient for
 * the advisor model (default claude-opus-4-7), and forwards the history
 * with a reviewer system prompt.
 *
 * Wiring: codebuddy-agent.ts registers the conversation provider via
 * setAdvisorContextProvider(). The provider returns { messages } where
 * messages is the current history at call time.
 */

import type { ToolResult } from '../types/index.js';
import type { CodeBuddyMessage } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Provider injection
// ============================================================================

export interface AdvisorContext {
  /** Snapshot of the current conversation history */
  messages: CodeBuddyMessage[];
}

let _advisorContextProvider: (() => AdvisorContext | null) | null = null;

/**
 * Register the conversation context provider. Called once from codebuddy-agent.ts
 * during construction. The provider must return a fresh snapshot on each call.
 */
export function setAdvisorContextProvider(provider: () => AdvisorContext | null): void {
  _advisorContextProvider = provider;
}

/**
 * Reset the provider (for testing).
 */
export function resetAdvisorContextProvider(): void {
  _advisorContextProvider = null;
}

// ============================================================================
// Config types
// ============================================================================

export interface AdvisorConfig {
  /** Whether the advisor tool is enabled (default: true) */
  enabled?: boolean;
  /** Model to use for the advisor call (default: claude-opus-4-7) */
  model?: string;
  /** Environment variable name for the API key (default: ANTHROPIC_API_KEY) */
  api_key_env?: string;
  /** Custom base URL (optional — overrides provider default) */
  base_url?: string;
}

const DEFAULT_ADVISOR_CONFIG: Required<Omit<AdvisorConfig, 'base_url'>> & { base_url?: string } = {
  enabled: true,
  model: 'claude-opus-4-7',
  api_key_env: 'ANTHROPIC_API_KEY',
};

// ============================================================================
// System prompt
// ============================================================================

const ADVISOR_SYSTEM_PROMPT = `You are an expert software engineering reviewer providing a second opinion to another AI assistant mid-task.

You will receive the assistant's complete conversation history with the user, including every tool call and result.

Your job:
- Identify what's correct about the assistant's approach
- Flag what's risky, missed, or wrong
- Give a clear, prioritized recommendation for the next step

Be direct and specific. Cite concrete file paths, line numbers, function names, or claims when they are relevant. Lead with the most important point. Keep your response under 400 words unless the situation requires more.

Do not restate the task or summarize the history back. The assistant has it. Get to the analysis.`;

// ============================================================================
// Tool implementation
// ============================================================================

/**
 * Execute the advisor tool. No parameters — reads conversation history
 * from the registered provider and forwards to the advisor model.
 */
export async function executeAdvisor(
  config: AdvisorConfig = {},
): Promise<ToolResult> {
  const cfg = { ...DEFAULT_ADVISOR_CONFIG, ...config };

  if (cfg.enabled === false) {
    return {
      success: false,
      error: 'Advisor tool is disabled. Set [advisor].enabled = true in your TOML config.',
    };
  }

  if (!_advisorContextProvider) {
    return {
      success: false,
      error:
        'Advisor context provider not registered. ' +
        'This is a configuration error — the agent must call setAdvisorContextProvider() during initialization.',
    };
  }

  const ctx = _advisorContextProvider();
  if (!ctx || !ctx.messages || ctx.messages.length === 0) {
    return {
      success: false,
      error: 'No conversation history available to forward to the advisor.',
    };
  }

  const apiKey = process.env[cfg.api_key_env];
  if (!apiKey) {
    return {
      success: false,
      error: `Advisor API key not set. Define ${cfg.api_key_env} in your environment.`,
    };
  }

  // Lazy import to avoid circular deps at module load time
  const { CodeBuddyClient } = await import('../codebuddy/client.js');

  let client: InstanceType<typeof CodeBuddyClient>;
  try {
    client = new CodeBuddyClient(apiKey, cfg.model, cfg.base_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Failed to instantiate advisor client (model=${cfg.model}): ${msg}`,
    };
  }

  // Build the advisor call: system prompt + verbatim history + final user prompt asking for review
  const advisorMessages: CodeBuddyMessage[] = [
    { role: 'system', content: ADVISOR_SYSTEM_PROMPT },
    ...ctx.messages.filter(m => m.role !== 'system'),
    {
      role: 'user',
      content:
        "Please review the assistant's approach so far. " +
        "What's correct, what's risky or wrong, and what's the most important next step? " +
        "Respond directly to the assistant — they will read this verbatim.",
    },
  ];

  try {
    const response = await client.chat(advisorMessages, undefined, {});

    const content = response.choices[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        error: 'Advisor returned an empty response.',
      };
    }

    logger.info('Advisor consulted', {
      model: cfg.model,
      historyLength: ctx.messages.length,
      responseTokens: response.usage?.completion_tokens,
    });

    return {
      success: true,
      output: content.trim(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('Advisor call failed', { error: msg });
    return {
      success: false,
      error: `Advisor call failed: ${msg}`,
    };
  }
}
