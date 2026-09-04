/**
 * Message History Manager
 *
 * Encapsulates message and chat history management.
 * This class handles:
 * - Chat history storage and retrieval
 * - LLM message management
 * - History trimming and cleanup
 * - Memory optimization for long sessions
 */

import type { ChatEntry } from '../types.js';
import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import { logger } from '../../utils/logger.js';
import { repairToolCallPairs } from '../../context/transcript-repair.js';

/**
 * Configuration for history size limits
 */
export interface HistoryConfig {
  /** Maximum number of chat history entries to keep */
  maxHistorySize: number;
  /** Maximum number of LLM messages to keep */
  maxMessagesSize: number;
  /** Number of recent entries to keep at full detail */
  recentEntriesToKeepFull: number;
  /** Maximum content length for older entries */
  maxContentLength: number;
  /** Maximum output length for older tool results */
  maxOutputLength: number;
}

/**
 * Statistics about history usage
 */
export interface HistoryStats {
  chatHistorySize: number;
  messagesSize: number;
  maxHistory: number;
  maxMessages: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: HistoryConfig = {
  maxHistorySize: 1000,
  maxMessagesSize: 1000,
  recentEntriesToKeepFull: 100,
  maxContentLength: 500,
  maxOutputLength: 200,
};

/**
 * Manager for message and chat history in agents.
 *
 * Responsibilities:
 * - Storing and retrieving chat history
 * - Managing LLM message arrays
 * - Trimming history to prevent memory leaks
 * - Cleaning up obsolete references for garbage collection
 */
export class MessageHistoryManager {
  private chatHistory: ChatEntry[] = [];
  private messages: CodeBuddyMessage[] = [];
  private readonly config: HistoryConfig;

  constructor(config: Partial<HistoryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // Chat History Operations
  // ============================================================================

  /**
   * Get a copy of the chat history
   */
  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  /**
   * Get the raw chat history array (for internal use)
   */
  getChatHistoryRef(): ChatEntry[] {
    return this.chatHistory;
  }

  /**
   * Add an entry to chat history
   */
  addChatEntry(entry: ChatEntry): void {
    this.chatHistory.push(entry);
    this.trimHistory();
  }

  /**
   * Add multiple entries to chat history
   */
  addChatEntries(entries: ChatEntry[]): void {
    this.chatHistory.push(...entries);
    this.trimHistory();
  }

  /**
   * Set the entire chat history (e.g., when loading a session)
   */
  setChatHistory(history: ChatEntry[]): void {
    this.chatHistory = history;
    this.trimHistory();
  }

  /**
   * Clear chat history
   */
  clearChatHistory(): void {
    this.chatHistory = [];
  }

  // ============================================================================
  // LLM Message Operations
  // ============================================================================

  /**
   * Get a copy of the messages array
   */
  getMessages(): CodeBuddyMessage[] {
    return [...this.messages];
  }

  /**
   * Get the raw messages array (for internal use)
   */
  getMessagesRef(): CodeBuddyMessage[] {
    return this.messages;
  }

  /**
   * Return the COMPLETE LLM message history exactly as stored — no
   * curation, no repair, no compression. Use this for debug, audit,
   * or when you need to inspect the raw turn-by-turn record.
   *
   * Equivalent to `getMessages()` (returns a defensive copy of the
   * array), but named explicitly to mark intent vs `getCuratedHistory()`.
   *
   * Pattern aligned with Gemini CLI's comprehensive vs curated history
   * distinction (see audit doc
   * the handover repo's `propositions/AUDIT-GEMINI-CLI-AGENTIC-LOOP-2026-05-04.md`,
   * recommendation #3).
   */
  getComprehensiveHistory(): CodeBuddyMessage[] {
    return [...this.messages];
  }

  /**
   * Return the LLM message history with transcript repair applied:
   * - Orphaned tool_result entries (no matching tool_call) are removed
   * - Lost tool_call entries (no result) get a synthetic
   *   `[result lost during compaction]` message injected
   *
   * Use this when you want to send the history to the LLM or to a
   * downstream system that expects valid tool_call ↔ tool_result
   * pairing — `getComprehensiveHistory()` would surface invalid pairs
   * that crash strict validators (Anthropic, Gemini native).
   *
   * Note: this method does NOT apply compression / sliding-window /
   * summarization. Compression is the responsibility of
   * `ContextManagerV2.prepareMessages()` because it requires
   * model-specific context-window knowledge that the facade doesn't
   * own. Compose them at the call site when you need both:
   *
   *   const compressed = contextManager.prepareMessages(
   *     historyManager.getCuratedHistory()
   *   );
   *
   * Or use `prepareTurnMessages()` in `context-pipeline.ts` which
   * already does the composition (compression then repair) for the
   * primary turn loop.
   *
   * Internal state is not mutated — `getComprehensiveHistory()` after
   * `getCuratedHistory()` returns the same content as before.
   */
  getCuratedHistory(): CodeBuddyMessage[] {
    return repairToolCallPairs(this.messages);
  }

  /**
   * Add a message to the messages array
   */
  addMessage(message: CodeBuddyMessage): void {
    this.messages.push(message);
    this.trimHistory();
  }

  /**
   * Add multiple messages
   */
  addMessages(messages: CodeBuddyMessage[]): void {
    this.messages.push(...messages);
    this.trimHistory();
  }

  /**
   * Set the entire messages array
   */
  setMessages(messages: CodeBuddyMessage[]): void {
    this.messages = messages;
    this.trimHistory();
  }

  /**
   * Clear messages while optionally preserving system message
   */
  clearMessages(preserveSystemMessage: boolean = true): void {
    const first = this.messages[0];
    if (preserveSystemMessage && first !== undefined && first.role === 'system') {
      this.messages = [first];
    } else {
      this.messages = [];
    }
  }

  /**
   * Get the system message if present
   */
  getSystemMessage(): CodeBuddyMessage | null {
    const first = this.messages[0];
    if (first !== undefined && first.role === 'system') {
      return first;
    }
    return null;
  }

  /**
   * Set or update the system message
   */
  setSystemMessage(content: string): void {
    const systemMessage: CodeBuddyMessage = { role: 'system', content };
    const first = this.messages[0];
    if (first !== undefined && first.role === 'system') {
      this.messages[0] = systemMessage;
    } else {
      this.messages.unshift(systemMessage);
    }
  }

  // ============================================================================
  // Clear All
  // ============================================================================

  /**
   * Clear both chat history and messages
   */
  clearAll(preserveSystemMessage: boolean = true): void {
    this.clearChatHistory();
    this.clearMessages(preserveSystemMessage);
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get current history statistics
   */
  getStats(): HistoryStats {
    return {
      chatHistorySize: this.chatHistory.length,
      messagesSize: this.messages.length,
      maxHistory: this.config.maxHistorySize,
      maxMessages: this.config.maxMessagesSize,
    };
  }

  // ============================================================================
  // Internal: History Management
  // ============================================================================

  /**
   * Trim history arrays to prevent memory leaks.
   *
   * Implements a sliding window approach:
   * - For chatHistory: keeps the most recent entries up to maxHistorySize
   * - For messages: preserves system message and keeps recent conversation messages
   */
  private trimHistory(): void {
    this.trimChatHistory();
    this.trimMessages();
    this.cleanupObsoleteReferences();
  }

  /**
   * Trim chat history using sliding window
   */
  private trimChatHistory(): void {
    if (this.chatHistory.length > this.config.maxHistorySize) {
      const trimCount = this.chatHistory.length - this.config.maxHistorySize;
      this.chatHistory = this.chatHistory.slice(trimCount);
      logger.debug(`Trimmed ${trimCount} old chat history entries`);
    }
  }

  /**
   * Trim LLM messages, preserving system message
   */
  private trimMessages(): void {
    const systemMessage = this.messages[0];

    if (systemMessage !== undefined && systemMessage.role === 'system') {
      const conversationMessages = this.messages.slice(1);
      if (conversationMessages.length > this.config.maxMessagesSize) {
        const trimCount = conversationMessages.length - this.config.maxMessagesSize;
        const recentMessages = conversationMessages.slice(-this.config.maxMessagesSize);
        this.messages = [systemMessage, ...recentMessages];
        logger.debug(`Trimmed ${trimCount} old LLM messages (system message preserved)`);
      }
      return;
    }

    if (this.messages.length > this.config.maxMessagesSize) {
      const trimCount = this.messages.length - this.config.maxMessagesSize;
      this.messages = this.messages.slice(trimCount);
      logger.debug(`Trimmed ${trimCount} old LLM messages`);
    }
  }

  /**
   * Clean up large objects in old chat history entries.
   * This helps garbage collection by removing references to
   * potentially large tool results from older entries.
   */
  private cleanupObsoleteReferences(): void {
    if (this.chatHistory.length <= this.config.recentEntriesToKeepFull) {
      return;
    }

    const olderEntries = this.chatHistory.slice(0, -this.config.recentEntriesToKeepFull);

    for (const entry of olderEntries) {
      // Truncate large content in older entries
      if (entry.content && entry.content.length > this.config.maxContentLength) {
        entry.content = entry.content.substring(0, this.config.maxContentLength) + '... [truncated]';
      }

      // Truncate tool result outputs
      if (entry.toolResult?.output && entry.toolResult.output.length > this.config.maxOutputLength) {
        entry.toolResult.output =
          entry.toolResult.output.substring(0, this.config.maxOutputLength) + '... [truncated]';
      }
    }
  }

  // ============================================================================
  // Disposal
  // ============================================================================

  /**
   * Clear all data for disposal
   */
  dispose(): void {
    this.chatHistory = [];
    this.messages = [];
  }
}
