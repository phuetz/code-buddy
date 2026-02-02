/**
 * Memory Lifecycle Hooks
 *
 * Inspired by OpenClaw's lifecycle hooks for memory management.
 * Automatically injects relevant memories before agent execution
 * and captures important information after conversations.
 *
 * Hooks:
 * - before_agent_execute: Inject relevant memories into context
 * - after_agent_response: Capture important information
 * - session_end: Summarize and store conversation
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { EnhancedMemory, MemoryEntry, ConversationSummary } from './enhanced-memory.js';
import { AutoCaptureManager, getAutoCaptureManager, MemoryRecallResult } from './auto-capture.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryHookContext {
  sessionId: string;
  projectId?: string;
  query: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface BeforeExecuteResult {
  injectedContext: string;
  recalledMemories: MemoryEntry[];
  tokenCount: number;
}

export interface AfterResponseResult {
  capturedCount: number;
  capturedMemories: string[];
}

export interface SessionEndResult {
  summaryId?: string;
  memoriesStored: number;
}

export interface MemoryLifecycleConfig {
  /** Enable memory injection before execution */
  enableRecall: boolean;
  /** Enable auto-capture after responses */
  enableCapture: boolean;
  /** Enable session summarization */
  enableSummarization: boolean;
  /** Maximum tokens for memory injection */
  maxRecallTokens: number;
  /** Minimum messages before summarization */
  minMessagesForSummary: number;
  /** Memory types to recall */
  recallTypes?: string[];
}

const DEFAULT_CONFIG: MemoryLifecycleConfig = {
  enableRecall: true,
  enableCapture: true,
  enableSummarization: true,
  maxRecallTokens: 800,
  minMessagesForSummary: 10,
};

// ============================================================================
// Memory Lifecycle Hooks Manager
// ============================================================================

/**
 * Memory Lifecycle Hooks Manager
 *
 * Manages automatic memory recall and capture during agent execution.
 */
export class MemoryLifecycleHooks extends EventEmitter {
  private config: MemoryLifecycleConfig;
  private memory: EnhancedMemory;
  private autoCapture: AutoCaptureManager;
  private sessionMessages: Map<string, Array<{ role: string; content: string; timestamp: Date }>> = new Map();

  constructor(memory: EnhancedMemory, config: Partial<MemoryLifecycleConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memory = memory;
    this.autoCapture = getAutoCaptureManager(memory);
  }

  // ============================================================================
  // Before Execution Hook
  // ============================================================================

  /**
   * Hook called before agent execution
   * Injects relevant memories into the context
   */
  async beforeExecute(context: MemoryHookContext): Promise<BeforeExecuteResult> {
    if (!this.config.enableRecall) {
      return { injectedContext: '', recalledMemories: [], tokenCount: 0 };
    }

    try {
      const result = await this.autoCapture.recall(context.query, {
        maxTokens: this.config.maxRecallTokens,
        projectId: context.projectId,
      });

      if (result.memories.length > 0) {
        logger.debug('Memory recall before execution', {
          sessionId: context.sessionId,
          memoriesRecalled: result.memories.length,
          tokenCount: result.tokenCount,
        });

        this.emit('before:execute', {
          sessionId: context.sessionId,
          memoriesRecalled: result.memories.length,
        });
      }

      return {
        injectedContext: result.injectedContext,
        recalledMemories: result.memories,
        tokenCount: result.tokenCount,
      };
    } catch (error) {
      logger.error('Memory recall failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { injectedContext: '', recalledMemories: [], tokenCount: 0 };
    }
  }

  // ============================================================================
  // After Response Hook
  // ============================================================================

  /**
   * Hook called after agent response
   * Captures important information from user messages
   */
  async afterResponse(
    context: MemoryHookContext,
    userMessage: string,
    assistantResponse: string
  ): Promise<AfterResponseResult> {
    // Track messages for session
    this.trackMessage(context.sessionId, 'user', userMessage);
    this.trackMessage(context.sessionId, 'assistant', assistantResponse);

    if (!this.config.enableCapture) {
      return { capturedCount: 0, capturedMemories: [] };
    }

    try {
      const results = await this.autoCapture.processMessage('user', userMessage, {
        sessionId: context.sessionId,
        projectId: context.projectId,
      });

      const capturedMemories = results
        .filter(r => r.captured && r.memoryId)
        .map(r => r.memoryId!);

      if (capturedMemories.length > 0) {
        logger.debug('Memory captured after response', {
          sessionId: context.sessionId,
          capturedCount: capturedMemories.length,
        });

        this.emit('after:response', {
          sessionId: context.sessionId,
          capturedCount: capturedMemories.length,
        });
      }

      return {
        capturedCount: capturedMemories.length,
        capturedMemories,
      };
    } catch (error) {
      logger.error('Memory capture failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { capturedCount: 0, capturedMemories: [] };
    }
  }

  // ============================================================================
  // Session End Hook
  // ============================================================================

  /**
   * Hook called when session ends
   * Summarizes conversation and stores key information
   */
  async sessionEnd(sessionId: string, projectId?: string): Promise<SessionEndResult> {
    const messages = this.sessionMessages.get(sessionId);

    if (!messages || messages.length < this.config.minMessagesForSummary) {
      this.sessionMessages.delete(sessionId);
      return { memoriesStored: 0 };
    }

    if (!this.config.enableSummarization) {
      this.sessionMessages.delete(sessionId);
      return { memoriesStored: 0 };
    }

    try {
      // Extract key information from conversation
      const keyInfo = this.extractKeyInformation(messages);

      let memoriesStored = 0;
      let summaryId: string | undefined;

      // Store summary if meaningful
      if (keyInfo.summary && keyInfo.summary.length > 50) {
        const summary: Omit<ConversationSummary, 'id'> = {
          sessionId,
          summary: keyInfo.summary,
          topics: keyInfo.topics,
          decisions: keyInfo.decisions,
          todos: keyInfo.todos,
          timestamp: new Date(),
          messageCount: messages.length,
        };

        const storedSummary = await this.memory.storeSummary(summary);
        summaryId = storedSummary.id;
        memoriesStored++;
      }

      // Store important decisions as separate memories
      for (const decision of keyInfo.decisions) {
        await this.memory.store({
          type: 'decision',
          content: decision,
          importance: 0.8,
          tags: ['session-decision', `session-${sessionId}`],
          metadata: { sessionId, projectId },
        });
        memoriesStored++;
      }

      // Store todos as reminders
      for (const todo of keyInfo.todos) {
        await this.memory.store({
          type: 'instruction',
          content: `TODO: ${todo}`,
          importance: 0.7,
          tags: ['todo', 'reminder', `session-${sessionId}`],
          metadata: { sessionId, projectId },
        });
        memoriesStored++;
      }

      // Cleanup
      this.sessionMessages.delete(sessionId);

      logger.info('Session end - memories stored', {
        sessionId,
        memoriesStored,
        hasSummary: !!summaryId,
      });

      this.emit('session:end', { sessionId, memoriesStored, summaryId });

      return { summaryId, memoriesStored };
    } catch (error) {
      logger.error('Session end processing failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.sessionMessages.delete(sessionId);
      return { memoriesStored: 0 };
    }
  }

  // ============================================================================
  // Message Tracking
  // ============================================================================

  /**
   * Track a message for session summarization
   */
  private trackMessage(sessionId: string, role: string, content: string): void {
    if (!this.sessionMessages.has(sessionId)) {
      this.sessionMessages.set(sessionId, []);
    }

    this.sessionMessages.get(sessionId)!.push({
      role,
      content,
      timestamp: new Date(),
    });

    // Limit message history per session
    const messages = this.sessionMessages.get(sessionId)!;
    if (messages.length > 100) {
      messages.splice(0, messages.length - 100);
    }
  }

  // ============================================================================
  // Information Extraction
  // ============================================================================

  /**
   * Extract key information from conversation messages
   */
  private extractKeyInformation(messages: Array<{ role: string; content: string }>): {
    summary: string;
    topics: string[];
    decisions: string[];
    todos: string[];
  } {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    const allContent = userMessages.join(' ');

    // Extract topics (simple keyword extraction)
    const topicPatterns = [
      /(?:working on|travaille sur|implementing|implémente|fixing|corrige)\s+(.+?)(?:\.|,|$)/gi,
      /(?:le|the|un|a)\s+(\w+(?:\s+\w+)?)\s+(?:module|component|file|fichier|function|fonction)/gi,
    ];

    const topics = new Set<string>();
    for (const pattern of topicPatterns) {
      const matches = allContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 2) {
          topics.add(match[1].trim().toLowerCase());
        }
      }
    }

    // Extract decisions
    const decisionPatterns = [
      /(?:decided to|décidé de|let's|on va|we will)\s+(.+?)(?:\.|!|$)/gi,
      /(?:final decision|décision finale)\s*:?\s*(.+?)(?:\.|$)/gi,
    ];

    const decisions: string[] = [];
    for (const pattern of decisionPatterns) {
      const matches = allContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 10) {
          decisions.push(match[1].trim());
        }
      }
    }

    // Extract todos
    const todoPatterns = [
      /(?:todo|à faire|need to|il faut|remember to|n'oublie pas de)\s*:?\s*(.+?)(?:\.|!|$)/gi,
      /(?:later|plus tard|ensuite),?\s*(.+?)(?:\.|$)/gi,
    ];

    const todos: string[] = [];
    for (const pattern of todoPatterns) {
      const matches = allContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 5) {
          todos.push(match[1].trim());
        }
      }
    }

    // Generate simple summary
    const summary = this.generateSimpleSummary(userMessages, Array.from(topics));

    return {
      summary,
      topics: Array.from(topics).slice(0, 10),
      decisions: decisions.slice(0, 5),
      todos: todos.slice(0, 10),
    };
  }

  /**
   * Generate a simple summary from messages
   */
  private generateSimpleSummary(userMessages: string[], topics: string[]): string {
    if (userMessages.length === 0) return '';

    const messageCount = userMessages.length;
    const topicsStr = topics.slice(0, 3).join(', ');

    // Get first and last meaningful messages
    const firstMsg = userMessages[0].slice(0, 100);
    const lastMsg = userMessages[userMessages.length - 1].slice(0, 100);

    let summary = `Session with ${messageCount} user messages.`;

    if (topicsStr) {
      summary += ` Topics: ${topicsStr}.`;
    }

    if (firstMsg !== lastMsg) {
      summary += ` Started with: "${firstMsg}..." Ended with: "${lastMsg}..."`;
    } else {
      summary += ` Main request: "${firstMsg}..."`;
    }

    return summary;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get lifecycle hooks statistics
   */
  getStats(): {
    activeSessions: number;
    totalMessagesTracked: number;
    autoCaptureStats: ReturnType<AutoCaptureManager['getStats']>;
  } {
    let totalMessages = 0;
    for (const messages of this.sessionMessages.values()) {
      totalMessages += messages.length;
    }

    return {
      activeSessions: this.sessionMessages.size,
      totalMessagesTracked: totalMessages,
      autoCaptureStats: this.autoCapture.getStats(),
    };
  }

  /**
   * Clear all session data
   */
  clearSessions(): void {
    this.sessionMessages.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let memoryHooksInstance: MemoryLifecycleHooks | null = null;

/**
 * Get memory lifecycle hooks instance
 */
export function getMemoryLifecycleHooks(memory?: EnhancedMemory): MemoryLifecycleHooks {
  if (!memoryHooksInstance && memory) {
    memoryHooksInstance = new MemoryLifecycleHooks(memory);
  }
  if (!memoryHooksInstance) {
    throw new Error('MemoryLifecycleHooks not initialized. Provide EnhancedMemory instance.');
  }
  return memoryHooksInstance;
}

/**
 * Reset memory lifecycle hooks
 */
export function resetMemoryLifecycleHooks(): void {
  memoryHooksInstance = null;
}

export default MemoryLifecycleHooks;
