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
    if (preserveSystemMessage && this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages = [this.messages[0]];
    } else {
      this.messages = [];
    }
  }

  /**
   * Get the system message if present
   */
  getSystemMessage(): CodeBuddyMessage | null {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      return this.messages[0];
    }
    return null;
  }

  /**
   * Set or update the system message
   */
  setSystemMessage(content: string): void {
    const systemMessage: CodeBuddyMessage = { role: 'system', content };
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
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
    const hasSystemMessage = this.messages[0]?.role === 'system';

    if (hasSystemMessage) {
      const systemMessage = this.messages[0];
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
