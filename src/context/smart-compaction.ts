/**
 * Enterprise-grade Smart Context Compaction System
 *
 * Intelligently reduces conversation history while preserving essential context:
 * - Provider-specific message validation (Gemini/Anthropic/OpenAI have different rules)
 * - Channel-based history limits (DM vs group contexts)
 * - Token verification after compaction
 * - Multi-stage compaction strategies
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { preserveToolPairs } from './tool-pair-preserver.js';
import { wireCompactionProgress } from './progress-compaction-bridge.js';
import { isFailedToolResultContent } from './enhanced-compression.js';
import { estimateImageUrlTokens, textFromMessageContent } from './token-counter.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'grok' | 'ollama' | 'lmstudio';

export type ChannelType = 'dm' | 'group' | 'api' | 'cli';

export interface CompactionConfig {
  /** Maximum tokens allowed after compaction */
  maxTokens: number;
  /** Target token count (aim for this after compaction) */
  targetTokens?: number;
  /** Provider for validation rules */
  provider: Provider;
  /** Channel type for history limits */
  channelType: ChannelType;
  /** Custom instructions for summarization */
  customInstructions?: string;
  /** Minimum messages to keep */
  minMessages?: number;
  /** Whether to preserve system message */
  preserveSystem?: boolean;
  /** Whether to preserve tool calls */
  preserveToolCalls?: boolean;
}

export interface CompactionResult {
  success: boolean;
  originalTokens: number;
  compactedTokens: number;
  messagesRemoved: number;
  strategy: CompactionStrategy;
  error?: string;
}

export type CompactionStrategy =
  | 'none'           // No compaction needed
  | 'truncate'       // Remove oldest messages
  | 'summarize'      // Summarize older messages
  | 'hybrid'         // Combination of strategies
  | 'aggressive';    // Maximum compression

export interface ProviderRules {
  /** Maximum consecutive messages of same role */
  maxConsecutiveSameRole: number;
  /** Whether tool results must follow tool calls */
  toolResultMustFollowCall: boolean;
  /** Whether empty content is allowed */
  allowEmptyContent: boolean;
  /** Maximum message content length */
  maxContentLength: number;
  /** Required message patterns */
  patterns: {
    mustStartWith?: 'system' | 'user';
    mustEndWith?: 'user' | 'assistant';
  };
}

// ============================================================================
// Provider-Specific Rules
// ============================================================================

const PROVIDER_RULES: Record<Provider, ProviderRules> = {
  openai: {
    maxConsecutiveSameRole: 1,
    toolResultMustFollowCall: true,
    allowEmptyContent: true,
    maxContentLength: 128000,
    patterns: {},
  },
  anthropic: {
    maxConsecutiveSameRole: 1,
    toolResultMustFollowCall: true,
    allowEmptyContent: false,
    maxContentLength: 200000,
    patterns: {
      mustStartWith: 'user',
    },
  },
  gemini: {
    maxConsecutiveSameRole: 1,
    toolResultMustFollowCall: true,
    allowEmptyContent: false,
    maxContentLength: 1000000,
    patterns: {
      mustStartWith: 'user',
    },
  },
  grok: {
    maxConsecutiveSameRole: 1,
    toolResultMustFollowCall: true,
    allowEmptyContent: true,
    maxContentLength: 131072,
    patterns: {},
  },
  ollama: {
    maxConsecutiveSameRole: 10, // More lenient
    toolResultMustFollowCall: false,
    allowEmptyContent: true,
    maxContentLength: 32000,
    patterns: {},
  },
  lmstudio: {
    maxConsecutiveSameRole: 10,
    toolResultMustFollowCall: false,
    allowEmptyContent: true,
    maxContentLength: 32000,
    patterns: {},
  },
};

// ============================================================================
// Channel-Based History Limits
// ============================================================================

const CHANNEL_HISTORY_LIMITS: Record<ChannelType, { maxTurns: number; maxTokens: number }> = {
  dm: { maxTurns: 50, maxTokens: 32000 },
  group: { maxTurns: 20, maxTokens: 16000 },
  api: { maxTurns: 100, maxTokens: 64000 },
  cli: { maxTurns: 100, maxTokens: 64000 },
};

// ============================================================================
// Smart Compaction Engine
// ============================================================================

export class SmartCompactionEngine extends EventEmitter {
  private config: CompactionConfig;
  private rules: ProviderRules;
  private channelLimits: { maxTurns: number; maxTokens: number };

  constructor(config: CompactionConfig) {
    super();
    this.config = {
      minMessages: 4,
      preserveSystem: true,
      preserveToolCalls: true,
      ...config,
    };
    this.rules = PROVIDER_RULES[config.provider];
    this.channelLimits = CHANNEL_HISTORY_LIMITS[config.channelType];
  }

  /**
   * Main compaction entry point
   */
  async compact(messages: Message[]): Promise<{ messages: Message[]; result: CompactionResult }> {
    const startTime = Date.now();
    const originalTokens = this.estimateTokens(messages);

    this.emit('compaction:start', { messageCount: messages.length, tokens: originalTokens });

    // 1. Validate and sanitize messages
    let processed = this.sanitizeMessages(messages);

    // 2. Check if compaction is needed
    const targetTokens = this.config.targetTokens || this.config.maxTokens * 0.8;
    if (originalTokens <= targetTokens) {
      return {
        messages: processed,
        result: {
          success: true,
          originalTokens,
          compactedTokens: originalTokens,
          messagesRemoved: 0,
          strategy: 'none',
        },
      };
    }

    // 3. Determine compaction strategy
    const strategy = this.determineStrategy(originalTokens, targetTokens);
    this.emit('compaction:strategy', { strategy });

    // 4. Apply compaction
    let result: CompactionResult;

    switch (strategy) {
      case 'truncate':
        processed = this.truncateMessages(processed, targetTokens);
        break;
      case 'summarize':
        processed = await this.summarizeMessages(processed, targetTokens);
        break;
      case 'hybrid':
        processed = await this.hybridCompaction(processed, targetTokens);
        break;
      case 'aggressive':
        processed = await this.aggressiveCompaction(processed, targetTokens);
        break;
    }

    const compactedTokens = this.estimateTokens(processed);

    result = {
      success: compactedTokens <= this.config.maxTokens,
      originalTokens,
      compactedTokens,
      messagesRemoved: messages.length - processed.length,
      strategy,
    };

    if (!result.success) {
      result.error = `Compaction insufficient: ${compactedTokens} > ${this.config.maxTokens}`;
    }

    this.emit('compaction:complete', {
      ...result,
      durationMs: Date.now() - startTime,
    });

    return { messages: processed, result };
  }

  /**
   * Sanitize messages according to provider rules
   */
  sanitizeMessages(messages: Message[]): Message[] {
    let sanitized = [...messages];

    // 1. Remove empty content if not allowed
    if (!this.rules.allowEmptyContent) {
      sanitized = sanitized.filter(m => m.content !== null && m.content !== '');
    }

    // 2. Merge consecutive same-role messages
    sanitized = this.mergeConsecutiveMessages(sanitized);

    // 3. Ensure tool results follow tool calls
    if (this.rules.toolResultMustFollowCall) {
      sanitized = this.validateToolCallOrder(sanitized);
    }

    // 4. Truncate overly long messages
    sanitized = sanitized.map(m => ({
      ...m,
      content: m.content && m.content.length > this.rules.maxContentLength
        ? m.content.slice(0, this.rules.maxContentLength) + '... [truncated]'
        : m.content,
    }));

    // 5. Ensure correct start/end patterns
    sanitized = this.ensureMessagePatterns(sanitized);

    return sanitized;
  }

  /**
   * Merge consecutive messages from the same role
   */
  private mergeConsecutiveMessages(messages: Message[]): Message[] {
    const result: Message[] = [];

    for (const message of messages) {
      const last = result[result.length - 1];

      if (last && last.role === message.role && !message.tool_call_id && !last.tool_calls) {
        // Merge content
        last.content = `${last.content || ''}\n\n${message.content || ''}`.trim();
      } else {
        result.push({ ...message });
      }
    }

    return result;
  }

  /**
   * Validate tool call/result ordering
   */
  private validateToolCallOrder(messages: Message[]): Message[] {
    const result: Message[] = [];
    const pendingToolCalls = new Map<string, number>();

    for (const message of messages) {
      // Track tool calls
      if (message.tool_calls) {
        result.push(message);
        for (const tc of message.tool_calls) {
          pendingToolCalls.set(tc.id, result.length - 1);
        }
        continue;
      }

      // Validate tool results
      if (message.role === 'tool' && message.tool_call_id) {
        const callIndex = pendingToolCalls.get(message.tool_call_id);
        if (callIndex !== undefined) {
          result.push(message);
          pendingToolCalls.delete(message.tool_call_id);
        }
        // Skip orphaned tool results
        continue;
      }

      result.push(message);
    }

    return result;
  }

  /**
   * Ensure message patterns match provider requirements
   */
  private ensureMessagePatterns(messages: Message[]): Message[] {
    let result = [...messages];
    const { patterns } = this.rules;

    // Ensure correct starting message
    if (patterns.mustStartWith === 'user') {
      // Find system message
      const systemIndex = result.findIndex(m => m.role === 'system');
      let systemMessage: Message | null = null;
      if (systemIndex !== -1) {
        systemMessage = result[systemIndex] ?? null; // safe: findIndex returned an in-bounds index
        result.splice(systemIndex, 1);
      }

      // Ensure first non-system is user
      const firstMessage = result[0];
      if (firstMessage && firstMessage.role !== 'user') {
        // Insert placeholder user message
        result.unshift({
          role: 'user',
          content: '[Conversation continued]',
        });
      }

      // Re-add system message at the start if present
      if (systemMessage && this.config.preserveSystem) {
        result.unshift(systemMessage);
      }
    }

    return result;
  }

  /**
   * Determine the best compaction strategy
   */
  private determineStrategy(currentTokens: number, targetTokens: number): CompactionStrategy {
    const reduction = currentTokens - targetTokens;
    const reductionRatio = reduction / currentTokens;

    if (reductionRatio < 0.2) {
      return 'truncate';
    } else if (reductionRatio < 0.5) {
      return 'hybrid';
    } else if (reductionRatio < 0.7) {
      return 'summarize';
    } else {
      return 'aggressive';
    }
  }

  /**
   * Truncate oldest messages to fit token limit
   */
  private truncateMessages(messages: Message[], targetTokens: number): Message[] {
    const result: Message[] = [];
    let currentTokens = 0;

    // Always preserve system message
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage && this.config.preserveSystem) {
      result.push(systemMessage);
      currentTokens += this.estimateMessageTokens(systemMessage);
    }

    // Process messages from newest to oldest
    const nonSystem = messages.filter(m => m.role !== 'system').reverse();

    for (const message of nonSystem) {
      const messageTokens = this.estimateMessageTokens(message);
      if (currentTokens + messageTokens <= targetTokens) {
        result.unshift(message);
        currentTokens += messageTokens;
      } else if (result.length < (this.config.minMessages || 4)) {
        // Keep minimum messages even if over limit
        result.unshift(message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }

    // Ensure system message is at the start
    if (systemMessage && this.config.preserveSystem) {
      const sysIndex = result.findIndex(m => m.role === 'system');
      if (sysIndex > 0) {
        const [sys] = result.splice(sysIndex, 1);
        if (sys) {
          result.unshift(sys);
        }
      }
    }

    // Phase post-audit (Claude Code source comparison, 2026-05-04):
    // Truncating from newest can orphan a tool_result whose tool_use
    // parent was dropped just past the budget. Pair integrity matters
    // more than strict budget compliance — extend retention to cover
    // any missing parents via the pure helper. Skipped when
    // preserveToolCalls is explicitly false (rare; default true).
    if (this.config.preserveToolCalls !== false) {
      return preserveToolPairs(result, messages);
    }
    return result;
  }

  /**
   * Summarize older messages
   */
  private async summarizeMessages(messages: Message[], _targetTokens: number): Promise<Message[]> {
    // Keep recent messages
    const recentCount = Math.max(this.config.minMessages || 4, 10);
    const recent = messages.slice(-recentCount);
    const toSummarize = messages.slice(0, -recentCount);

    if (toSummarize.length === 0) {
      return messages;
    }

    // Create summary of older messages
    const summary = await this.createSummary(toSummarize);

    // Build result
    const result: Message[] = [];

    // Add system message
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage && this.config.preserveSystem) {
      result.push(systemMessage);
    }

    // Add summary as user message
    result.push({
      role: 'user',
      content: `[Previous conversation summary: ${summary}]`,
    });

    // Add assistant acknowledgment
    result.push({
      role: 'assistant',
      content: 'I understand the context from our previous conversation. How can I help you now?',
    });

    // Add recent messages (excluding system)
    result.push(...recent.filter(m => m.role !== 'system'));

    return result;
  }

  /**
   * Hybrid compaction: truncate + summarize
   */
  private async hybridCompaction(messages: Message[], targetTokens: number): Promise<Message[]> {
    // First, try truncation
    let result = this.truncateMessages(messages, targetTokens * 1.2);
    let tokens = this.estimateTokens(result);

    // If still over, summarize
    if (tokens > targetTokens) {
      result = await this.summarizeMessages(result, targetTokens);
    }

    return result;
  }

  /**
   * Aggressive compaction: maximum compression
   */
  private async aggressiveCompaction(messages: Message[], _targetTokens: number): Promise<Message[]> {
    const result: Message[] = [];

    // Keep only system message and recent 2 turns
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage && this.config.preserveSystem) {
      result.push(systemMessage);
    }

    // Create aggressive summary
    const summary = await this.createSummary(messages.filter(m => m.role !== 'system'));

    result.push({
      role: 'user',
      content: `[Conversation context: ${summary}]\n\nPlease continue from where we left off.`,
    });

    result.push({
      role: 'assistant',
      content: 'I have the context. What would you like me to do next?',
    });

    return result;
  }

  /**
   * Create a summary of messages using an LLM if available, fallback to basic logic
   */
  private async createSummary(messages: Message[]): Promise<string> {
    // Extract key points
    const points: string[] = [];

    for (const msg of messages) {
      const contentText = textFromMessageContent(msg.content);
      if (!contentText && !msg.tool_calls) continue;

      // Extract tool calls
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          points.push(`Used tool: ${tc.function.name}`);
        }
      }

      // Extract key content (first sentence or 100 chars)
      const content = contentText.trim();
      if (content.length > 0) {
        const firstSentence = content.match(/^[^.!?]*[.!?]/)?.[0] || content.slice(0, 100);
        if (msg.role === 'user') {
          points.push(`User asked about: ${firstSentence}`);
        } else if (msg.role === 'assistant') {
          points.push(`Assistant: ${firstSentence}`);
        }
      }
    }

    const basicSummary = [...new Set(points)].slice(-10).join('. ');

    // Manus AI error preservation: failed tool attempts must SURVIVE this
    // fallback compaction (error context-length retry path) so the agent
    // doesn't blindly retry a call it already knows is broken. Built the same
    // way as ContextManagerV2.createSummary — shared `isFailedToolResultContent`
    // predicate, attributed to the tool via tool_call_id, bounded to the last N
    // failures and truncated per entry — and appended AFTER the summary body so
    // it can't be crowded out (whether the body is extractive or LLM-rewritten).
    const failuresSection = this.buildFailedToolAttemptsSection(messages);

    // Try to use LLM for a better summary if we can dynamically load a simple client
    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (API_KEY) {
            const genAI = new GoogleGenerativeAI(API_KEY);
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            const prompt = `Summarize the following chat history densely in one short paragraph. Focus on the core problem, tools used, and final resolution. Do not include pleasantries. If a "Failed tool attempts (do not retry)" section is present, preserve it verbatim at the end.\n\nChat History:\n${basicSummary}`;
            const result = await model.generateContent(prompt);
            const llmSummary = result.response.text().trim();
            // Deterministically re-attach failures so preservation never depends
            // on the LLM honouring the instruction.
            return failuresSection ? `${llmSummary}\n${failuresSection}` : llmSummary;
        }
    } catch (_e) {
        logger.debug("LLM summarization failed, falling back to basic summary");
    }

    return failuresSection ? `${basicSummary}\n${failuresSection}` : basicSummary;
  }

  /**
   * Build the bounded "Failed tool attempts (do not retry):" section from the
   * failed `role:'tool'` results in the message window, attributing each to the
   * tool that produced it. Returns '' when there are no failures (no parasitic
   * empty section). Mirrors ContextManagerV2.createSummary for consistency.
   */
  private buildFailedToolAttemptsSection(messages: Message[]): string {
    const MAX_PRESERVED_TOOL_FAILURES = 5;
    const MAX_TOOL_FAILURE_CHARS = 200;

    // Map tool_call_id -> function name from assistant tool_calls (these
    // messages may have null content, so this pass is independent of the
    // content-gated extraction loop above).
    const toolNameById = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc && tc.type === 'function' && typeof tc.id === 'string') {
            toolNameById.set(tc.id, tc.function.name);
          }
        }
      }
    }

    const failedAttempts: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'tool') continue;
      const content = textFromMessageContent(msg.content);
      if (!content || !isFailedToolResultContent(content)) continue;
      const id = msg.tool_call_id;
      const name = (id ? toolNameById.get(id) : undefined) ?? 'tool';
      const snippet = content.replace(/\s+/g, ' ').trim().slice(0, MAX_TOOL_FAILURE_CHARS);
      failedAttempts.push(`- ${name}: ${snippet}`);
    }

    if (failedAttempts.length === 0) return '';
    return [
      'Failed tool attempts (do not retry):',
      ...failedAttempts.slice(-MAX_PRESERVED_TOOL_FAILURES),
    ].join('\n');
  }

  /**
   * Estimate tokens for messages
   */
  estimateTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
  }

  /**
   * Estimate tokens for a single message
   */
  private estimateMessageTokens(message: Message): number {
    let tokens = 4; // Base overhead per message

    const text = textFromMessageContent(message.content);
    if (text) {
      // Rough estimate: ~4 chars per token
      tokens += Math.ceil(text.length / 4);
    }
    tokens += estimateImageUrlTokens(message.content);

    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        tokens += 10; // Function call overhead
        tokens += Math.ceil(tc.function.arguments.length / 4);
      }
    }

    return tokens;
  }

  /**
   * Apply channel-specific limits
   */
  limitByChannel(messages: Message[]): Message[] {
    const { maxTurns } = this.channelLimits;

    // Count turns (user-assistant pairs)
    let turnCount = 0;
    let lastRole: string | null = null;

    const messagesToKeep: Message[] = [];
    const reversed = [...messages].reverse();

    for (const msg of reversed) {
      if (msg.role === 'system') {
        messagesToKeep.unshift(msg);
        continue;
      }

      if (msg.role !== lastRole && (msg.role === 'user' || msg.role === 'assistant')) {
        if (msg.role === 'user') {
          turnCount++;
        }
      }

      if (turnCount <= maxTurns) {
        messagesToKeep.unshift(msg);
      }

      lastRole = msg.role;
    }

    return messagesToKeep;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CompactionConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.provider) {
      this.rules = PROVIDER_RULES[config.provider];
    }
    if (config.channelType) {
      this.channelLimits = CHANNEL_HISTORY_LIMITS[config.channelType];
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Singleton & Convenience Functions
// ============================================================================

let compactionEngineInstance: SmartCompactionEngine | null = null;

/** Default config used when the singleton is constructed without one. */
const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxTokens: 128_000,
  provider: 'openai',
  channelType: 'cli',
  preserveSystem: true,
  preserveToolCalls: true,
};

export function getSmartCompactionEngine(config?: CompactionConfig): SmartCompactionEngine {
  if (!compactionEngineInstance) {
    compactionEngineInstance = new SmartCompactionEngine(config ?? DEFAULT_COMPACTION_CONFIG);
    // Surface compaction as a progress task in any renderer (CLI / Cowork).
    wireCompactionProgress(compactionEngineInstance);
  } else if (config) {
    compactionEngineInstance.updateConfig(config);
  }
  return compactionEngineInstance;
}

export function resetSmartCompactionEngine(): void {
  compactionEngineInstance = null;
}

/**
 * Convenience function for quick compaction
 */
export async function compactMessages(
  messages: Message[],
  config: CompactionConfig
): Promise<{ messages: Message[]; result: CompactionResult }> {
  const engine = new SmartCompactionEngine(config);
  return engine.compact(messages);
}

/**
 * Convenience function to check if compaction is needed
 */
export function needsCompaction(messages: Message[], maxTokens: number): boolean {
  const engine = new SmartCompactionEngine({
    maxTokens,
    provider: 'grok',
    channelType: 'cli',
  });
  return engine.estimateTokens(messages) > maxTokens;
}
