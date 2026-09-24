/**
 * Fast Mode Handler
 *
 * Toggles between the main model and a fast model for reduced latency.
 * Advanced enterprise architecture for unified /fast toggle with service_tier support.
 *
 * Usage:
 *   /fast           — Toggle fast mode on/off
 *   /fast on        — Enable fast mode
 *   /fast off       — Disable fast mode
 *   /fast status    — Show current fast mode configuration
 *   /fast model <m> — Set the fast model to use
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

// ============================================================================
// Fast Mode State (session-scoped)
// ============================================================================

let fastModeEnabled = false;
let fastModel = 'grok-4-fast';
let previousModel: string | null = null;

// Default fast models per provider prefix
const FAST_MODEL_DEFAULTS: Record<string, string> = {
  'grok': 'grok-4-fast',
  'claude': 'claude-haiku-4-5',
  'gpt': 'gpt-4.1-mini',
  'gemini': 'gemini-3.1-flash-lite',
  'o4': 'o4-mini',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the current fast mode state.
 */
export function getFastModeState(): {
  enabled: boolean;
  fastModel: string;
  previousModel: string | null;
} {
  return { enabled: fastModeEnabled, fastModel, previousModel };
}

/**
 * Check if fast mode is currently active.
 */
export function isFastModeEnabled(): boolean {
  return fastModeEnabled;
}

/**
 * Get the model to use based on fast mode state.
 * Returns the fast model if enabled, null otherwise (use default).
 */
export function getFastModeModel(): string | null {
  return fastModeEnabled ? fastModel : null;
}

/**
 * Get the service tier for the current mode.
 * Returns 'flex' when fast mode is active for supported providers.
 */
export function getFastModeServiceTier(): 'auto' | 'default' | 'flex' | undefined {
  return fastModeEnabled ? 'flex' : undefined;
}

/**
 * Enable fast mode, optionally saving the current model.
 */
export function enableFastMode(currentModel?: string): void {
  if (currentModel && !previousModel) {
    previousModel = currentModel;
  }
  fastModeEnabled = true;

  // Auto-select fast model based on current model's provider
  if (currentModel) {
    for (const [prefix, model] of Object.entries(FAST_MODEL_DEFAULTS)) {
      if (currentModel.startsWith(prefix)) {
        fastModel = model;
        break;
      }
    }
  }
}

/**
 * Disable fast mode, restoring the previous model.
 */
export function disableFastMode(): string | null {
  fastModeEnabled = false;
  const restored = previousModel;
  previousModel = null;
  return restored;
}

/**
 * Set a custom fast model.
 */
export function setFastModel(model: string): void {
  fastModel = model;
}

// ============================================================================
// Command Handler
// ============================================================================

export async function handleFastMode(args: string[]): Promise<CommandHandlerResult> {
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand || subcommand === 'toggle') {
    // Toggle
    if (fastModeEnabled) {
      const restored = disableFastMode();
      return {
        handled: true,
...failureFlag(`Fast mode **disabled**.${restored ? ` Restored model: ${restored}` : ''}`),
        entry: {
          type: 'assistant',
          content: `Fast mode **disabled**.${restored ? ` Restored model: ${restored}` : ''}`,
          timestamp: new Date(),
        },
      };
    } else {
      enableFastMode();
      return {
        handled: true,
...failureFlag(`Fast mode **enabled**. Using model: \`${fastModel}\`\nService tier: \`flex\` (low-latency)`),
        entry: {
          type: 'assistant',
          content: `Fast mode **enabled**. Using model: \`${fastModel}\`\nService tier: \`flex\` (low-latency)`,
          timestamp: new Date(),
        },
      };
    }
  }

  if (subcommand === 'on') {
    enableFastMode();
    return {
      handled: true,
...failureFlag(`Fast mode **enabled**. Model: \`${fastModel}\`, service_tier: \`flex\``),
      entry: {
        type: 'assistant',
        content: `Fast mode **enabled**. Model: \`${fastModel}\`, service_tier: \`flex\``,
        timestamp: new Date(),
      },
    };
  }

  if (subcommand === 'off') {
    const restored = disableFastMode();
    return {
      handled: true,
...failureFlag(`Fast mode **disabled**.${restored ? ` Restored model: ${restored}` : ''}`),
      entry: {
        type: 'assistant',
        content: `Fast mode **disabled**.${restored ? ` Restored model: ${restored}` : ''}`,
        timestamp: new Date(),
      },
    };
  }

  if (subcommand === 'status') {
    const lines = [
      `**Fast Mode**: ${fastModeEnabled ? 'ON' : 'OFF'}`,
      `**Fast Model**: \`${fastModel}\``,
      `**Service Tier**: \`${fastModeEnabled ? 'flex' : 'default'}\``,
      previousModel ? `**Previous Model**: \`${previousModel}\`` : '',
      '',
      '**Available fast models:**',
      ...Object.entries(FAST_MODEL_DEFAULTS).map(([prefix, model]) => `  ${prefix}: \`${model}\``),
    ].filter(Boolean);

    return {
      handled: true,
...failureFlag(lines.join('\n')),
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  if (subcommand === 'model' && args[1]) {
    setFastModel(args[1]);
    return {
      handled: true,
...failureFlag(`Fast model set to: \`${args[1]}\``),
      entry: {
        type: 'assistant',
        content: `Fast model set to: \`${args[1]}\``,
        timestamp: new Date(),
      },
    };
  }

  return {
    handled: true,
...failureFlag([
        '**Fast Mode** — Toggle between main and fast model',
        '',
        '`/fast`          Toggle fast mode on/off',
        '`/fast on`       Enable fast mode',
        '`/fast off`      Disable fast mode',
        '`/fast status`   Show configuration',
        '`/fast model <m>` Set fast model',
      ].join('\n')),
    entry: {
      type: 'assistant',
      content: [
        '**Fast Mode** — Toggle between main and fast model',
        '',
        '`/fast`          Toggle fast mode on/off',
        '`/fast on`       Enable fast mode',
        '`/fast off`      Disable fast mode',
        '`/fast status`   Show configuration',
        '`/fast model <m>` Set fast model',
      ].join('\n'),
      timestamp: new Date(),
    },
  };
}
