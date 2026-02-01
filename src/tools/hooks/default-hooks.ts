/**
 * Default Tool Hooks Registration
 *
 * Registers built-in hooks for tool execution:
 * - Result sanitization based on LLM provider
 * - Logging and metrics
 */

import {
  getToolHooksManager,
  type ToolHookContext,
  type ToolHookResult,
  type LLMProvider,
  sanitizeResult,
  type ToolResultInput,
} from './index.js';
import { logger } from '../../utils/logger.js';

// Track current provider for sanitization
let currentProvider: LLMProvider = 'grok';

/**
 * Set the current LLM provider for result sanitization
 */
export function setCurrentProvider(provider: LLMProvider): void {
  currentProvider = provider;
  logger.debug(`Tool hooks: provider set to ${provider}`);
}

/**
 * Get the current LLM provider
 */
export function getCurrentProvider(): LLMProvider {
  return currentProvider;
}

/**
 * Register default hooks for tool execution
 */
export function registerDefaultHooks(): void {
  const hooksManager = getToolHooksManager();

  // Check if hooks are already registered
  const registeredHooks = hooksManager.getRegisteredHooks();
  if (registeredHooks.some(h => h.id === 'result-sanitizer')) {
    logger.debug('Default hooks already registered');
    return;
  }

  // Result sanitization hook (after tool execution)
  hooksManager.registerAfterHook(
    'result-sanitizer',
    async (context: ToolHookContext, result: ToolHookResult): Promise<ToolHookResult> => {
      // Skip sanitization for errors (keep original error message)
      if (!result.success && result.error && !result.output) {
        return result;
      }

      // Create input for sanitizer
      const input: ToolResultInput = {
        toolCallId: context.toolCallId,
        toolName: context.toolName,
        success: result.success,
        output: result.output,
        error: result.error,
      };

      // Sanitize result based on current provider
      const sanitized = sanitizeResult(currentProvider, input);

      return {
        success: sanitized.success,
        output: sanitized.output,
        error: sanitized.error,
        executionTimeMs: result.executionTimeMs,
        modified: sanitized.sanitization.appliedSanitizers.length > 0,
        providerData: {
          sanitization: sanitized.sanitization,
        },
      };
    },
    {
      name: 'Result Sanitizer',
      priority: 50, // Medium priority - run after other hooks
    }
  );

  // Logging hook (after tool execution)
  hooksManager.registerAfterHook(
    'execution-logger',
    async (context: ToolHookContext, result: ToolHookResult): Promise<void> => {
      const logData = {
        tool: context.toolName,
        success: result.success,
        executionTimeMs: result.executionTimeMs,
        outputLength: result.output?.length || 0,
      };

      if (result.success) {
        logger.debug('Tool executed successfully', logData);
      } else {
        logger.debug('Tool execution failed', {
          ...logData,
          error: result.error?.substring(0, 200),
        });
      }
    },
    {
      name: 'Execution Logger',
      priority: 10, // Low priority - run last
    }
  );

  // Error tracking hook
  hooksManager.registerErrorHook(
    'error-tracker',
    async (context: ToolHookContext, error: Error): Promise<void> => {
      logger.warn('Tool error', {
        tool: context.toolName,
        toolCallId: context.toolCallId,
        error: error.message,
      });
    },
    {
      name: 'Error Tracker',
      priority: 100,
    }
  );

  // Timeout tracking hook
  hooksManager.registerTimeoutHook(
    'timeout-tracker',
    async (context: ToolHookContext, error: Error): Promise<void> => {
      logger.warn('Tool timeout', {
        tool: context.toolName,
        toolCallId: context.toolCallId,
        error: error.message,
      });
    },
    {
      name: 'Timeout Tracker',
      priority: 100,
    }
  );

  // Denied tracking hook
  hooksManager.registerDeniedHook(
    'denied-tracker',
    async (context: ToolHookContext, error: Error): Promise<void> => {
      logger.info('Tool denied', {
        tool: context.toolName,
        toolCallId: context.toolCallId,
        reason: error.message,
      });
    },
    {
      name: 'Denied Tracker',
      priority: 100,
    }
  );

  logger.debug('Default tool hooks registered');
}

/**
 * Unregister default hooks
 */
export function unregisterDefaultHooks(): void {
  const hooksManager = getToolHooksManager();

  hooksManager.unregisterHook('after_tool_call', 'result-sanitizer');
  hooksManager.unregisterHook('after_tool_call', 'execution-logger');
  hooksManager.unregisterHook('tool_error', 'error-tracker');
  hooksManager.unregisterHook('tool_timeout', 'timeout-tracker');
  hooksManager.unregisterHook('tool_denied', 'denied-tracker');

  logger.debug('Default tool hooks unregistered');
}
