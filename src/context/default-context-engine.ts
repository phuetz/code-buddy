/**
 * DefaultContextEngine — Extracts existing ContextManagerV2 logic into the ContextEngine interface
 *
 * This is the built-in engine that delegates to ContextManagerV2's compression strategies.
 * When no plugin registers a custom engine, this is used as the fallback.
 */

import type { CodeBuddyMessage } from '../codebuddy/client.js';
import type { ContextEngine, ContextMeta, AssembleResult } from './context-engine.js';
import type { ContextManagerV2 } from './context-manager-v2.js';
import { logger } from '../utils/logger.js';

/**
 * Default context engine that wraps ContextManagerV2's existing pipeline
 */
export class DefaultContextEngine implements ContextEngine {
  readonly id = 'default';
  readonly ownsCompaction = false;
  private manager: ContextManagerV2 | null = null;

  /**
   * Bind the context manager instance (called during registration)
   */
  setManager(manager: ContextManagerV2): void {
    this.manager = manager;
  }

  async bootstrap(_config: Record<string, unknown>): Promise<void> {
    logger.debug('DefaultContextEngine bootstrapped');
  }

  ingest(messages: CodeBuddyMessage[], _meta: ContextMeta): CodeBuddyMessage[] {
    // Default: pass through unchanged — ContextManagerV2 handles ingestion internally
    return messages;
  }

  assemble(messages: CodeBuddyMessage[], budget: number): AssembleResult {
    if (!this.manager) {
      return { messages, tokenCount: 0 };
    }

    // Delegate to the existing prepareMessages pipeline
    const prepared = this.manager.prepareMessagesRaw(messages);
    const tokenCount = this.manager.countTokens(prepared);

    return { messages: prepared, tokenCount };
  }

  compact(messages: CodeBuddyMessage[], _targetTokens: number): CodeBuddyMessage[] {
    if (!this.manager) {
      return messages;
    }
    // Force compression via prepareMessages (which triggers compact when needed)
    return this.manager.prepareMessagesRaw(messages, { reason: 'plugin' });
  }

  afterTurn(_messages: CodeBuddyMessage[], _response: CodeBuddyMessage): void {
    // Default: no-op — agent-executor handles post-turn logic (ICM storage, etc.)
  }

  prepareSubagentSpawn(messages: CodeBuddyMessage[], role: string): CodeBuddyMessage[] {
    // Default: provide recent context subset based on role
    const systemMsgs = messages.filter(m => m.role === 'system');
    const conversationMsgs = messages.filter(m => m.role !== 'system');

    // Explorer gets less context, worker gets more
    const contextSize = role === 'explorer' ? 10 : 20;
    const recentMsgs = conversationMsgs.slice(-contextSize);

    return [...systemMsgs, ...recentMsgs];
  }

  onSubagentEnded(_agentId: string, _messages: CodeBuddyMessage[], _result?: string): void {
    // Default: no-op — host agent handles sub-agent result merging
  }
}
