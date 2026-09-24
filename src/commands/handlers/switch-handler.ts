/**
 * Switch Handler
 *
 * Implements /switch slash command for mid-conversation model switching.
 * - /switch <model-name>  — switch model for next messages
 * - /switch auto          — return to auto-routing
 * - /switch               — show current model and available models
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

/**
 * Provider for model routing state.
 * Set by the conversation-loop dispatcher from the live agent.
 */
export interface SwitchModelProvider {
  /** Get list of available model names */
  getAvailableModels(): string[];
  /** Get the currently active model */
  getCurrentModel(): string;
  /** Set the switched model (null to clear override) */
  setSwitchedModel(model: string | null): void;
  /** Get the current switched model override */
  getSwitchedModel(): string | null;
}

/** Singleton provider reference */
let providerRef: SwitchModelProvider | null = null;

/**
 * Set the model provider reference for /switch.
 */
export function setSwitchModelProvider(provider: SwitchModelProvider | null): void {
  providerRef = provider;
}

/**
 * /switch — Mid-conversation model switching.
 *
 * Usage:
 *   /switch                 — Show current model and available models
 *   /switch <model-name>    — Switch to a specific model
 *   /switch auto            — Return to auto-routing / default
 */
export async function handleSwitch(args: string[]): Promise<CommandHandlerResult> {
  try {
    return await runSwitch(args);
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Model switch failed: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

async function runSwitch(args: string[]): Promise<CommandHandlerResult> {
  const modelName = args[0]?.trim();

  // No provider set — try to get models from config
  if (!providerRef) {
    try {
      const { getConfigManager } = await import('../../config/toml-config.js');
      const config = getConfigManager().getConfig();
      const models = Object.keys(config.models);

      if (!modelName) {
        return {
          handled: true,
...failureFlag([
              'Model Switching',
              '='.repeat(40),
              '',
              `Current Model: ${config.active_model}`,
              `Override: none`,
              '',
              'Available Models:',
              ...models.map(m => `  - ${m}${m === config.active_model ? ' (active)' : ''}`),
              '',
              'Usage:',
              '  /switch <model>  — switch model for this session',
              '  /switch auto     — return to default model',
            ].join('\n')),
          entry: {
            type: 'assistant',
            content: [
              'Model Switching',
              '='.repeat(40),
              '',
              `Current Model: ${config.active_model}`,
              `Override: none`,
              '',
              'Available Models:',
              ...models.map(m => `  - ${m}${m === config.active_model ? ' (active)' : ''}`),
              '',
              'Usage:',
              '  /switch <model>  — switch model for this session',
              '  /switch auto     — return to default model',
            ].join('\n'),
            timestamp: new Date(),
          },
        };
      }

      // No provider but we can still show info
      return {
        handled: true,
...failureFlag('Model switching requires an active agent session. Start a conversation first.'),
        entry: {
          type: 'assistant',
          content: 'Model switching requires an active agent session. Start a conversation first.',
          timestamp: new Date(),
        },
      };
    } catch {
      return {
        handled: true,
...failureFlag('Model switching is not available. No agent or config loaded.'),
        entry: {
          type: 'assistant',
          content: 'Model switching is not available. No agent or config loaded.',
          timestamp: new Date(),
        },
      };
    }
  }

  // Show current state
  if (!modelName) {
    const current = providerRef.getCurrentModel();
    const switched = providerRef.getSwitchedModel();
    const available = providerRef.getAvailableModels();

    const lines = [
      'Model Switching',
      '='.repeat(40),
      '',
      `Current Model: ${current}`,
      `Override: ${switched ?? 'none (using default/auto)'}`,
      '',
      'Available Models:',
    ];

    for (const m of available) {
      const markers: string[] = [];
      if (m === current) markers.push('active');
      if (m === switched) markers.push('switched');
      const suffix = markers.length > 0 ? ` (${markers.join(', ')})` : '';
      lines.push(`  - ${m}${suffix}`);
    }

    lines.push('');
    lines.push('Usage:');
    lines.push('  /switch <model>  — switch model for this session');
    lines.push('  /switch auto     — return to default/auto-routing');

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

  // Handle /switch auto
  if (modelName.toLowerCase() === 'auto') {
    providerRef.setSwitchedModel(null);
    return {
      handled: true,
...failureFlag([
          'Model override cleared. Returning to default/auto-routing.',
          '',
          `Active model: ${providerRef.getCurrentModel()}`,
        ].join('\n')),
      entry: {
        type: 'assistant',
        content: [
          'Model override cleared. Returning to default/auto-routing.',
          '',
          `Active model: ${providerRef.getCurrentModel()}`,
        ].join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Validate model exists
  const available = providerRef.getAvailableModels();
  const exactMatch = available.find(m => m.toLowerCase() === modelName.toLowerCase());

  if (!exactMatch) {
    // Try prefix match
    const prefixMatches = available.filter(m => m.toLowerCase().startsWith(modelName.toLowerCase()));

    const sole = prefixMatches[0];
    if (prefixMatches.length === 1 && sole !== undefined) {
      providerRef.setSwitchedModel(sole);
      return {
        handled: true,
...failureFlag(`Model switched to: ${sole}\n\nSubsequent messages will use this model. Use /switch auto to revert.`),
        entry: {
          type: 'assistant',
          content: `Model switched to: ${sole}\n\nSubsequent messages will use this model. Use /switch auto to revert.`,
          timestamp: new Date(),
        },
      };
    }

    if (prefixMatches.length > 1) {
      return {
        handled: true,
...failureFlag([
            `Ambiguous model name "${modelName}". Did you mean:`,
            ...prefixMatches.map(m => `  - ${m}`),
          ].join('\n')),
        entry: {
          type: 'assistant',
          content: [
            `Ambiguous model name "${modelName}". Did you mean:`,
            ...prefixMatches.map(m => `  - ${m}`),
          ].join('\n'),
          timestamp: new Date(),
        },
      };
    }

    // Allow setting unknown models (might be custom providers)
    providerRef.setSwitchedModel(modelName);
    return {
      handled: true,
...failureFlag([
          `Model switched to: ${modelName}`,
          '',
          'Note: This model is not in the configured list. It will work if your provider supports it.',
          'Use /switch auto to revert.',
        ].join('\n')),
      entry: {
        type: 'assistant',
        content: [
          `Model switched to: ${modelName}`,
          '',
          'Note: This model is not in the configured list. It will work if your provider supports it.',
          'Use /switch auto to revert.',
        ].join('\n'),
        timestamp: new Date(),
      },
    };
  }

  providerRef.setSwitchedModel(exactMatch);
  return {
    handled: true,
...failureFlag(`Model switched to: ${exactMatch}\n\nSubsequent messages will use this model. Use /switch auto to revert.`),
    entry: {
      type: 'assistant',
      content: `Model switched to: ${exactMatch}\n\nSubsequent messages will use this model. Use /switch auto to revert.`,
      timestamp: new Date(),
    },
  };
}
