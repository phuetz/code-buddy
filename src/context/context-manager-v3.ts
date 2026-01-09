import { CodeBuddyMessage } from '../codebuddy/client.js';
import { createTokenCounter, TokenCounter } from './token-counter.js';
import { ContextCompressor } from './compression.js';
import { ContextManagerConfig, ContextStats, ContextWarning } from './types.js';
import { logger } from '../utils/logger.js';

export class ContextManagerV3 {
  private config: ContextManagerConfig;
  private tokenCounter: TokenCounter;
  private compressor: ContextCompressor;
  private triggeredWarnings: Set<number> = new Set();

  static readonly DEFAULT_CONFIG: ContextManagerConfig = {
    maxContextTokens: 128000, // Modern default (GPT-4o, etc)
    responseReserveTokens: 4096,
    recentMessagesCount: 10,
    enableSummarization: true,
    compressionRatio: 2,
    model: 'gpt-4',
    autoCompactThreshold: 100000,
    warningThresholds: [80, 95],
    enableWarnings: true,
  };

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...ContextManagerV3.DEFAULT_CONFIG, ...config };
    this.tokenCounter = createTokenCounter(this.config.model);
    this.compressor = new ContextCompressor(this.tokenCounter);
  }

  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
    // Re-init token counter if model changed
    if (config.model) {
      this.tokenCounter.dispose();
      this.tokenCounter = createTokenCounter(config.model);
      this.compressor = new ContextCompressor(this.tokenCounter);
    }
  }

  getStats(messages: CodeBuddyMessage[]): ContextStats {
    const tokenMessages = messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : null,
      tool_calls: 'tool_calls' in msg ? msg.tool_calls : undefined,
    }));
    const totalTokens = this.tokenCounter.countMessageTokens(tokenMessages);
    const maxTokens = this.config.maxContextTokens;
    const usagePercent = (totalTokens / maxTokens) * 100;

    return {
      totalTokens,
      maxTokens,
      usagePercent,
      messageCount: messages.length,
      summarizedSessions: 0, // V3 calculates dynamically
      isNearLimit: usagePercent >= 80,
      isCritical: usagePercent >= 95
    };
  }

  shouldWarn(messages: CodeBuddyMessage[]): ContextWarning {
    if (!this.config.enableWarnings) return { warn: false };

    const stats = this.getStats(messages);
    const percent = Math.floor(stats.usagePercent);

    // Check thresholds
    for (const threshold of this.config.warningThresholds) {
      if (percent >= threshold && !this.triggeredWarnings.has(threshold)) {
        this.triggeredWarnings.add(threshold);
        return {
          warn: true,
          level: threshold >= 90 ? 'critical' : 'warning',
          message: `Context usage is at ${percent}% (${stats.totalTokens}/${stats.maxTokens} tokens).`,
          percentage: percent
        };
      }
    }

    // Reset warnings if usage drops
    for (const threshold of Array.from(this.triggeredWarnings)) {
      if (percent < threshold) {
        this.triggeredWarnings.delete(threshold);
      }
    }

    return { warn: false };
  }

  prepareMessages(messages: CodeBuddyMessage[]): CodeBuddyMessage[] {
    const stats = this.getStats(messages);
    const effectiveLimit = this.config.maxContextTokens - this.config.responseReserveTokens;

    if (stats.totalTokens <= effectiveLimit) {
      return messages;
    }

    logger.info(`Context limit exceeded (${stats.totalTokens} > ${effectiveLimit}). Compressing...`);

    const result = this.compressor.compress(messages, effectiveLimit, {
      preserveSystemPrompt: true,
      preserveRecentMessages: this.config.recentMessagesCount
    });

    if (result.compressed) {
      logger.info(`Context compressed: ${result.tokensReduced} tokens removed using ${result.strategy}.`);
    }

    return result.messages;
  }

  dispose(): void {
    this.tokenCounter.dispose();
  }
}

export function createContextManager(model: string, maxTokens?: number): ContextManagerV3 {
  const config = { model, ...(maxTokens ? { maxContextTokens: maxTokens } : {}) };
  return new ContextManagerV3(config);
}
