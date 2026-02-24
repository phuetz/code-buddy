/**
 * Importance Scorer for Context Compression
 *
 * A standalone, reusable module that scores messages by content type
 * for smarter context compression decisions. Extracts and generalizes
 * the scoring logic from EnhancedContextCompressor into a configurable utility.
 */

import { CodeBuddyMessage } from '../codebuddy/client.js';
import type { ContentType } from './types.js';

/**
 * Importance score result for a single message.
 */
export interface ImportanceScore {
  /** Index of the message in the original array. */
  messageIndex: number;
  /** Detected content type of the message. */
  contentType: ContentType;
  /** Importance score from 0 to 1. Higher means keep longer. */
  score: number;
  /** Human-readable reasons explaining the score. */
  factors: string[];
}

/**
 * Configuration for the importance scoring algorithm.
 */
export interface ImportanceScoringConfig {
  /** Base weights per content type. */
  weights: Partial<Record<ContentType, number>>;
  /** Multiplier for recency boost (0-0.3). Recent messages get up to this much added. */
  recencyBoost: number;
  /** Character threshold above which length penalty applies. */
  lengthPenalty: number;
  /** Amount subtracted from score for messages exceeding lengthPenalty chars. */
  lengthPenaltyAmount: number;
}

/**
 * Default base weights for each content type.
 * Higher values mean the content type is more important to preserve.
 */
export const DEFAULT_IMPORTANCE_WEIGHTS: Record<string, number> = {
  system: 1.0,
  error: 0.95,
  decision: 0.90,
  code: 0.70,
  command: 0.50,
  file_content: 0.40,
  tool_result: 0.35,
  explanation: 0.30,
  conversation: 0.25,
};

/**
 * Default scoring configuration.
 */
export const DEFAULT_SCORING_CONFIG: ImportanceScoringConfig = {
  weights: DEFAULT_IMPORTANCE_WEIGHTS,
  recencyBoost: 0.3,
  lengthPenalty: 5000,
  lengthPenaltyAmount: 0.1,
};

/**
 * Patterns for detecting content types in message text.
 * Mirrors the patterns from EnhancedContextCompressor for consistency.
 */
const CONTENT_PATTERNS: Record<string, RegExp[]> = {
  code: [
    /```[\s\S]*?```/,
    /^\s{4,}[^\s]/m,
    /^(function|const|let|var|class|import|export|def|async|public|private)\s/m,
    /[{};]\s*$/m,
  ],
  error: [
    /error/i,
    /exception/i,
    /failed/i,
    /traceback/i,
    /stack trace/i,
    /at\s+[\w.]+\s*\(/i,
    /^\s*at\s+/m,
  ],
  decision: [
    /\b(yes|no|confirm|approve|deny|accept|reject)\b/i,
    /\b(decided|decision|chose|selected)\b/i,
    /\b(will|won't|should|shouldn't)\s+(do|use|implement)/i,
  ],
  file_content: [
    /^(file|path|filename):\s*/im,
    /^---\s*$/m,
    /^\+\+\+\s/m,
    /^@@\s/m,
  ],
  command: [
    /^\$\s+/m,
    /^>\s+/m,
    /\b(npm|yarn|git|docker|kubectl|curl|wget)\s/,
    /^(cd|ls|mkdir|rm|cp|mv|cat|echo)\s/m,
  ],
};

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Importance Scorer
 *
 * Scores messages by content type, recency, role, and length for use
 * in context compression decisions. Fully configurable via ImportanceScoringConfig.
 */
export class ImportanceScorer {
  private config: ImportanceScoringConfig;

  constructor(config?: Partial<ImportanceScoringConfig>) {
    this.config = {
      ...DEFAULT_SCORING_CONFIG,
      ...config,
      weights: { ...DEFAULT_SCORING_CONFIG.weights, ...config?.weights },
    };
  }

  /**
   * Score all messages in an array.
   *
   * @param messages - The messages to score.
   * @returns An array of ImportanceScore objects, one per message.
   */
  scoreMessages(messages: CodeBuddyMessage[]): ImportanceScore[] {
    return messages.map((msg, index) =>
      this.scoreMessage(msg, index, messages.length)
    );
  }

  /**
   * Return message indices sorted by ascending importance score.
   * The first index in the result is the least important (compress first).
   *
   * @param messages - The messages to prioritize.
   * @returns Indices sorted from lowest to highest importance.
   */
  prioritizeForCompression(messages: CodeBuddyMessage[]): number[] {
    const scores = this.scoreMessages(messages);
    return scores
      .slice()
      .sort((a, b) => a.score - b.score)
      .map(s => s.messageIndex);
  }

  /**
   * Score a single message.
   *
   * Formula:
   *   baseScore = weights[contentType] ?? 0.5
   *   recencyFactor = (index / (totalMessages - 1)) * recencyBoost
   *   roleBonus: user +0.1, system +0.2
   *   lengthPenalty: content.length > threshold ? -lengthPenaltyAmount : 0
   *   finalScore = clamp(baseScore + recencyFactor + roleBonus + lengthPenalty, 0, 1)
   *
   * @param msg - The message to score.
   * @param index - Position in the message array (0-based).
   * @param totalMessages - Total number of messages.
   * @returns The importance score for this message.
   */
  scoreMessage(
    msg: CodeBuddyMessage,
    index: number,
    totalMessages: number
  ): ImportanceScore {
    const contentType = this.detectContentType(msg);
    const factors: string[] = [];

    // Base score from content type weight
    const baseScore = (this.config.weights[contentType] as number) ?? 0.5;
    factors.push(`base(${contentType}): ${baseScore.toFixed(2)}`);

    // Recency factor
    let recencyFactor = 0;
    if (totalMessages > 1) {
      recencyFactor = (index / (totalMessages - 1)) * this.config.recencyBoost;
    } else {
      recencyFactor = this.config.recencyBoost;
    }
    factors.push(`recency: +${recencyFactor.toFixed(3)}`);

    // Role bonus
    let roleBonus = 0;
    if (msg.role === 'user') {
      roleBonus = 0.1;
      factors.push('role(user): +0.1');
    } else if (msg.role === 'system') {
      roleBonus = 0.2;
      factors.push('role(system): +0.2');
    }

    // Length penalty
    const content = typeof msg.content === 'string' ? msg.content : '';
    let lengthPen = 0;
    if (content.length > this.config.lengthPenalty) {
      lengthPen = -this.config.lengthPenaltyAmount;
      factors.push(`length(${content.length}): ${lengthPen.toFixed(2)}`);
    }

    const finalScore = clamp(
      baseScore + recencyFactor + roleBonus + lengthPen,
      0,
      1
    );

    return {
      messageIndex: index,
      contentType,
      score: finalScore,
      factors,
    };
  }

  /**
   * Detect the content type of a message.
   * Uses the same pattern-matching logic as EnhancedContextCompressor.
   */
  detectContentType(msg: CodeBuddyMessage): ContentType {
    if (msg.role === 'system') return 'system';
    if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const isFailure =
        /"success"\s*:\s*false/.test(content) ||
        /\berror\b.*:/i.test(content) ||
        content.startsWith('Error:') ||
        content.startsWith('Failed:') ||
        /\[ERROR\]|\bfailed\b.*\b(tool|command|execution)\b/i.test(content);
      if (isFailure) return 'error';
      return 'tool_result';
    }

    const content = typeof msg.content === 'string' ? msg.content : '';

    for (const [type, patterns] of Object.entries(CONTENT_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          return type as ContentType;
        }
      }
    }

    return 'conversation';
  }

  /**
   * Get the current scoring configuration.
   */
  getConfig(): ImportanceScoringConfig {
    return {
      ...this.config,
      weights: { ...this.config.weights },
    };
  }
}

/**
 * Factory function to create an ImportanceScorer with optional config overrides.
 */
export function createImportanceScorer(
  config?: Partial<ImportanceScoringConfig>
): ImportanceScorer {
  return new ImportanceScorer(config);
}
