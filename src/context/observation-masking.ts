/**
 * Observation Masking System
 *
 * Implements intelligent masking of irrelevant tool outputs to reduce context usage
 * and improve model performance. Based on JetBrains research showing -7% cost reduction
 * and +2.6% success rate improvement with hybrid masking approach.
 *
 * Research basis:
 * - JetBrains Context Management (2024): Hybrid masking for coding assistants
 * - Observation masking in LLM agents for software engineering
 *
 * Key features:
 * - Semantic relevance scoring for tool outputs
 * - Priority-based retention (errors > code > logs > metadata)
 * - Adaptive masking thresholds based on context budget
 * - Partial content extraction for large outputs
 */

import { EventEmitter } from 'events';

/**
 * Types of tool outputs
 */
export type OutputType =
  | 'code'
  | 'error'
  | 'log'
  | 'file_content'
  | 'search_result'
  | 'command_output'
  | 'metadata'
  | 'unknown';

/**
 * Configuration for observation masking
 */
export interface MaskingConfig {
  // Enable/disable masking
  enabled: boolean;
  // Maximum tokens to retain per observation
  maxTokensPerObservation: number;
  // Global token budget for all observations
  totalTokenBudget: number;
  // Minimum relevance score to retain (0-1)
  minRelevanceThreshold: number;
  // Priority weights by output type (higher = more important)
  typePriorities: Record<OutputType, number>;
  // Keywords that increase relevance
  importantKeywords: string[];
  // Patterns that indicate errors (always retain)
  errorPatterns: RegExp[];
  // Whether to keep partial content when masking
  keepPartialContent: boolean;
  // Number of lines to keep from start/end when truncating
  headTailLines: number;
}

/**
 * Enhanced with "Complexity Trap" paper insights (arXiv 2508.21433):
 * - Sliding window: Keep recent M observations in full
 * - Replace older observations with placeholders
 * - 50% cost reduction with matching LLM summarization performance
 */

const DEFAULT_CONFIG: MaskingConfig = {
  enabled: true,
  maxTokensPerObservation: 2000,
  totalTokenBudget: 8000,
  minRelevanceThreshold: 0.2,
  typePriorities: {
    error: 1.0,
    code: 0.9,
    file_content: 0.8,
    search_result: 0.7,
    command_output: 0.6,
    log: 0.4,
    metadata: 0.3,
    unknown: 0.5,
  },
  importantKeywords: [
    'error',
    'exception',
    'fail',
    'undefined',
    'null',
    'cannot',
    'unable',
    'warning',
    'critical',
    'fatal',
    'bug',
    'issue',
    'fix',
    'todo',
    'fixme',
    'hack',
  ],
  errorPatterns: [
    /error/i,
    /exception/i,
    /failed/i,
    /traceback/i,
    /stack trace/i,
    /at line \d+/i,
    /syntax error/i,
    /type error/i,
    /reference error/i,
    /not found/i,
    /permission denied/i,
  ],
  keepPartialContent: true,
  headTailLines: 10,
};

/**
 * Observation entry
 */
export interface Observation {
  id: string;
  toolName: string;
  input: string;
  output: string;
  timestamp: number;
  type: OutputType;
}

/**
 * Masked observation with metadata
 */
export interface MaskedObservation extends Observation {
  originalLength: number;
  maskedLength: number;
  relevanceScore: number;
  wasRetained: boolean;
  maskReason?: string;
}

/**
 * Masking statistics
 */
export interface MaskingStats {
  totalObservations: number;
  retainedObservations: number;
  maskedObservations: number;
  originalTokens: number;
  maskedTokens: number;
  tokensSaved: number;
  savingsPercentage: number;
}

/**
 * Observation Masking System
 */
export class ObservationMasker extends EventEmitter {
  private config: MaskingConfig;
  private currentQuery: string = '';
  private queryKeywords: string[] = [];

  constructor(config: Partial<MaskingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the current query context for relevance scoring
   */
  setQueryContext(query: string): void {
    this.currentQuery = query;
    this.queryKeywords = this.extractKeywords(query);
    this.emit('context:updated', { query, keywords: this.queryKeywords });
  }

  /**
   * Mask a single observation
   */
  maskObservation(obs: Observation): MaskedObservation {
    // Handle null/undefined observation or output
    const output = obs?.output ?? '';

    if (!this.config.enabled) {
      return {
        ...obs,
        output,
        originalLength: output.length,
        maskedLength: output.length,
        relevanceScore: 1,
        wasRetained: true,
      };
    }

    const originalLength = output.length;
    const _originalTokens = this.estimateTokens(output); // Reserved for metrics

    // Create observation with guaranteed output
    const safeObs = { ...obs, output };

    // Calculate relevance score
    const relevanceScore = this.calculateRelevance(safeObs);

    // Check if observation should be fully retained
    if (this.shouldRetainFully(safeObs, relevanceScore)) {
      // Still might need to truncate if too long
      const truncatedOutput = this.truncateIfNeeded(output, this.config.maxTokensPerObservation);

      return {
        ...obs,
        output: truncatedOutput,
        originalLength,
        maskedLength: truncatedOutput.length,
        relevanceScore,
        wasRetained: true,
      };
    }

    // Check if should be completely masked
    if (relevanceScore < this.config.minRelevanceThreshold) {
      const maskedOutput = this.generateMaskSummary(safeObs, 'low_relevance');

      return {
        ...safeObs,
        output: maskedOutput,
        originalLength,
        maskedLength: maskedOutput.length,
        relevanceScore,
        wasRetained: false,
        maskReason: 'Low relevance score',
      };
    }

    // Partial masking - keep important parts
    const partialOutput = this.extractImportantContent(safeObs, relevanceScore);

    return {
      ...safeObs,
      output: partialOutput,
      originalLength,
      maskedLength: partialOutput.length,
      relevanceScore,
      wasRetained: true,
      maskReason: 'Partial extraction',
    };
  }

  /**
   * Mask multiple observations with budget constraints
   */
  maskObservations(observations: Observation[]): {
    masked: MaskedObservation[];
    stats: MaskingStats;
  } {
    // Handle null/undefined observations array
    const safeObservations = (observations || []).map(obs => ({
      ...obs,
      output: obs?.output ?? '',
    }));

    if (!this.config.enabled || safeObservations.length === 0) {
      return {
        masked: safeObservations.map(obs => ({
          ...obs,
          originalLength: obs.output.length,
          maskedLength: obs.output.length,
          relevanceScore: 1,
          wasRetained: true,
        })),
        stats: this.createEmptyStats(safeObservations),
      };
    }

    // First pass: score all observations
    const scored = safeObservations.map(obs => ({
      obs,
      relevance: this.calculateRelevance(obs),
      tokens: this.estimateTokens(obs.output),
    }));

    // Sort by relevance * priority (most important first)
    scored.sort((a, b) => {
      const scoreA = a.relevance * this.config.typePriorities[a.obs.type];
      const scoreB = b.relevance * this.config.typePriorities[b.obs.type];
      return scoreB - scoreA;
    });

    // Second pass: apply budget constraints
    let usedTokens = 0;
    const masked: MaskedObservation[] = [];

    for (const { obs, relevance, tokens } of scored) {
      const remainingBudget = this.config.totalTokenBudget - usedTokens;

      if (remainingBudget <= 0) {
        // Completely mask - out of budget
        const summary = this.generateMaskSummary(obs, 'budget_exceeded');
        masked.push({
          ...obs,
          output: summary,
          originalLength: obs.output.length,
          maskedLength: summary.length,
          relevanceScore: relevance,
          wasRetained: false,
          maskReason: 'Token budget exceeded',
        });
        continue;
      }

      // Calculate how much of this observation we can keep
      const allowedTokens = Math.min(remainingBudget, this.config.maxTokensPerObservation);

      if (tokens <= allowedTokens) {
        // Keep full observation
        masked.push({
          ...obs,
          originalLength: obs.output.length,
          maskedLength: obs.output.length,
          relevanceScore: relevance,
          wasRetained: true,
        });
        usedTokens += tokens;
      } else if (allowedTokens >= 100) {
        // Partial retention
        const truncated = this.truncateIfNeeded(obs.output, allowedTokens);
        masked.push({
          ...obs,
          output: truncated,
          originalLength: obs.output.length,
          maskedLength: truncated.length,
          relevanceScore: relevance,
          wasRetained: true,
          maskReason: 'Truncated to fit budget',
        });
        usedTokens += this.estimateTokens(truncated);
      } else {
        // Not enough budget for meaningful content
        const summary = this.generateMaskSummary(obs, 'insufficient_budget');
        masked.push({
          ...obs,
          output: summary,
          originalLength: obs.output.length,
          maskedLength: summary.length,
          relevanceScore: relevance,
          wasRetained: false,
          maskReason: 'Insufficient budget for content',
        });
      }
    }

    // Restore original order
    masked.sort((a, b) => {
      const idxA = observations.findIndex(o => o.id === a.id);
      const idxB = observations.findIndex(o => o.id === b.id);
      return idxA - idxB;
    });

    // Calculate statistics
    const stats = this.calculateStats(observations, masked);

    this.emit('mask:complete', { stats });
    return { masked, stats };
  }

  /**
   * Calculate relevance score for an observation
   */
  private calculateRelevance(obs: Observation): number {
    let score = 0;
    const content = (obs.output ?? '').toLowerCase();
    const input = (obs.input ?? '').toLowerCase();

    // Base score from type priority
    score += this.config.typePriorities[obs.type] * 0.3;

    // Query keyword matches
    if (this.queryKeywords.length > 0) {
      let keywordMatches = 0;
      for (const keyword of this.queryKeywords) {
        if (content.includes(keyword) || input.includes(keyword)) {
          keywordMatches++;
        }
      }
      score += (keywordMatches / this.queryKeywords.length) * 0.4;
    } else {
      score += 0.2; // Default if no query context
    }

    // Important keyword matches
    let importantMatches = 0;
    for (const keyword of this.config.importantKeywords) {
      if (content.includes(keyword)) {
        importantMatches++;
      }
    }
    score += Math.min(importantMatches * 0.05, 0.2);

    // Error pattern matches (high priority)
    for (const pattern of this.config.errorPatterns) {
      if (pattern.test(content)) {
        score += 0.3;
        break;
      }
    }

    // Recency bonus (more recent = more relevant)
    // Normalized to 0-0.1 range
    const age = Date.now() - obs.timestamp;
    const recencyScore = Math.max(0, 1 - age / (5 * 60 * 1000)); // 5 minute window
    score += recencyScore * 0.1;

    // Clamp to 0-1
    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Check if observation should be fully retained
   */
  private shouldRetainFully(obs: Observation, relevance: number): boolean {
    // Always retain errors
    if (obs.type === 'error') return true;

    // High relevance
    if (relevance > 0.8) return true;

    // Contains error patterns
    for (const pattern of this.config.errorPatterns) {
      if (pattern.test(obs.output)) return true;
    }

    return false;
  }

  /**
   * Extract important content from observation
   */
  private extractImportantContent(obs: Observation, relevance: number): string {
    const lines = obs.output.split('\n');

    if (lines.length <= this.config.headTailLines * 2) {
      return obs.output;
    }

    // Score each line
    const scoredLines = lines.map((line, idx) => ({
      line,
      idx,
      score: this.scoreLineRelevance(line, obs.type),
    }));

    // Always keep head and tail
    const head = lines.slice(0, this.config.headTailLines);
    const tail = lines.slice(-this.config.headTailLines);

    // Find most important middle lines
    const middleLines = scoredLines.slice(
      this.config.headTailLines,
      -this.config.headTailLines
    );
    middleLines.sort((a, b) => b.score - a.score);

    // How many middle lines to keep based on relevance
    const middleCount = Math.floor(relevance * 10);
    const importantMiddle = middleLines
      .slice(0, middleCount)
      .sort((a, b) => a.idx - b.idx)
      .map(l => l.line);

    // Combine
    const result: string[] = [
      ...head,
    ];

    if (importantMiddle.length > 0) {
      result.push(`... (${middleLines.length - importantMiddle.length} lines masked) ...`);
      result.push(...importantMiddle);
    } else if (middleLines.length > 0) {
      result.push(`... (${middleLines.length} lines masked) ...`);
    }

    result.push(...tail);

    return result.join('\n');
  }

  /**
   * Score line relevance
   */
  private scoreLineRelevance(line: string, type: OutputType): number {
    let score = 0;
    const lower = line.toLowerCase().trim();

    // Empty lines are low priority
    if (lower.length === 0) return 0;

    // Error indicators
    for (const pattern of this.config.errorPatterns) {
      if (pattern.test(lower)) {
        score += 2;
        break;
      }
    }

    // Important keywords
    for (const keyword of this.config.importantKeywords) {
      if (lower.includes(keyword)) {
        score += 0.5;
      }
    }

    // Query keyword matches
    for (const keyword of this.queryKeywords) {
      if (lower.includes(keyword)) {
        score += 1;
      }
    }

    // Code indicators
    if (type === 'code' || type === 'file_content') {
      if (/^(function|class|const|let|var|import|export|def|async)\s/.test(lower)) {
        score += 1;
      }
    }

    // Numbers and data (often important)
    if (/\d+(\.\d+)?%?/.test(lower)) {
      score += 0.3;
    }

    return score;
  }

  /**
   * Generate a summary for masked content
   */
  private generateMaskSummary(obs: Observation, reason: string): string {
    const lines = obs.output.split('\n').length;
    const tokens = this.estimateTokens(obs.output);

    return `[MASKED: ${obs.toolName} output - ${lines} lines, ~${tokens} tokens, reason: ${reason}]`;
  }

  /**
   * Truncate content to fit token budget
   */
  private truncateIfNeeded(content: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(content);

    if (currentTokens <= maxTokens) {
      return content;
    }

    if (!this.config.keepPartialContent) {
      return `[Content truncated: ${currentTokens} tokens exceeded ${maxTokens} limit]`;
    }

    // Keep head and tail
    const lines = content.split('\n');
    const targetLines = Math.floor(maxTokens / 4); // Rough estimate

    if (lines.length <= targetLines) {
      // Truncate by characters
      const maxChars = maxTokens * 4;
      return content.slice(0, maxChars) + '\n... [truncated]';
    }

    const headLines = Math.floor(targetLines * 0.6);
    const tailLines = Math.floor(targetLines * 0.4);

    const head = lines.slice(0, headLines);
    const tail = lines.slice(-tailLines);
    const maskedCount = lines.length - headLines - tailLines;

    return [
      ...head,
      `\n... [${maskedCount} lines truncated] ...\n`,
      ...tail,
    ].join('\n');
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !this.isStopWord(word));
  }

  /**
   * Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
      'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
      'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
      'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
      'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
    ]);
    return stopWords.has(word);
  }

  /**
   * Estimate token count
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate masking statistics
   */
  private calculateStats(
    original: Observation[],
    masked: MaskedObservation[]
  ): MaskingStats {
    const originalTokens = original.reduce(
      (sum, o) => sum + this.estimateTokens(o.output),
      0
    );
    const maskedTokens = masked.reduce(
      (sum, m) => sum + this.estimateTokens(m.output),
      0
    );
    const retainedCount = masked.filter(m => m.wasRetained).length;

    return {
      totalObservations: original.length,
      retainedObservations: retainedCount,
      maskedObservations: original.length - retainedCount,
      originalTokens,
      maskedTokens,
      tokensSaved: originalTokens - maskedTokens,
      savingsPercentage: originalTokens > 0
        ? ((originalTokens - maskedTokens) / originalTokens) * 100
        : 0,
    };
  }

  /**
   * Create empty stats
   */
  private createEmptyStats(observations: Observation[]): MaskingStats {
    const tokens = observations.reduce(
      (sum, o) => sum + this.estimateTokens(o.output),
      0
    );
    return {
      totalObservations: observations.length,
      retainedObservations: observations.length,
      maskedObservations: 0,
      originalTokens: tokens,
      maskedTokens: tokens,
      tokensSaved: 0,
      savingsPercentage: 0,
    };
  }

  /**
   * Detect output type from tool name and content
   */
  detectOutputType(toolName: string, content: string): OutputType {
    const toolLower = toolName.toLowerCase();
    const contentLower = content.toLowerCase();

    // Error detection
    for (const pattern of this.config.errorPatterns) {
      if (pattern.test(contentLower)) {
        return 'error';
      }
    }

    // Tool-based detection
    if (toolLower.includes('read') || toolLower.includes('file')) {
      return 'file_content';
    }
    if (toolLower.includes('search') || toolLower.includes('grep') || toolLower.includes('find')) {
      return 'search_result';
    }
    if (toolLower.includes('bash') || toolLower.includes('exec') || toolLower.includes('run')) {
      return 'command_output';
    }
    if (toolLower.includes('list') || toolLower.includes('info') || toolLower.includes('status')) {
      return 'metadata';
    }

    // Content-based detection
    if (/^(function|class|const|let|var|import|export|def |async )/m.test(content)) {
      return 'code';
    }
    if (/^\[\d{4}-\d{2}-\d{2}|^\d{4}\/\d{2}\/\d{2}|^(INFO|DEBUG|WARN|ERROR)/m.test(content)) {
      return 'log';
    }

    return 'unknown';
  }

  /**
   * Sliding window masking (Complexity Trap paper approach)
   *
   * Keeps the most recent M observations in full, replaces older ones with placeholders.
   * This achieves ~50% cost reduction while matching LLM summarization performance.
   *
   * @param observations All observations in chronological order
   * @param windowSize Number of recent observations to keep in full (default: 5)
   * @returns Masked observations with statistics
   */
  applySlidingWindowMask(
    observations: Observation[],
    windowSize: number = 5
  ): { masked: MaskedObservation[]; stats: MaskingStats } {
    if (!this.config.enabled || observations.length === 0) {
      return {
        masked: observations.map(obs => ({
          ...obs,
          originalLength: obs.output.length,
          maskedLength: obs.output.length,
          relevanceScore: 1,
          wasRetained: true,
        })),
        stats: this.createEmptyStats(observations),
      };
    }

    // Sort by timestamp (most recent last)
    const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);

    const masked: MaskedObservation[] = [];
    const windowStart = Math.max(0, sorted.length - windowSize);

    for (let i = 0; i < sorted.length; i++) {
      const obs = sorted[i];
      const isInWindow = i >= windowStart;

      if (isInWindow) {
        // Keep recent observations in full (within token limits)
        const truncated = this.truncateIfNeeded(obs.output, this.config.maxTokensPerObservation);
        masked.push({
          ...obs,
          output: truncated,
          originalLength: obs.output.length,
          maskedLength: truncated.length,
          relevanceScore: 1.0,
          wasRetained: true,
        });
      } else {
        // Replace older observations with placeholder
        // But ALWAYS keep errors and high-priority items
        const relevance = this.calculateRelevance(obs);

        if (obs.type === 'error' || relevance > 0.9) {
          // Keep important older observations
          const truncated = this.truncateIfNeeded(obs.output, this.config.maxTokensPerObservation / 2);
          masked.push({
            ...obs,
            output: truncated,
            originalLength: obs.output.length,
            maskedLength: truncated.length,
            relevanceScore: relevance,
            wasRetained: true,
            maskReason: 'Retained (high importance)',
          });
        } else {
          // Replace with placeholder
          const placeholder = this.generatePlaceholder(obs);
          masked.push({
            ...obs,
            output: placeholder,
            originalLength: obs.output.length,
            maskedLength: placeholder.length,
            relevanceScore: relevance,
            wasRetained: false,
            maskReason: 'Sliding window - outside recent window',
          });
        }
      }
    }

    // Restore original order
    masked.sort((a, b) => {
      const idxA = observations.findIndex(o => o.id === a.id);
      const idxB = observations.findIndex(o => o.id === b.id);
      return idxA - idxB;
    });

    const stats = this.calculateStats(observations, masked);
    this.emit('slidingWindow:complete', { windowSize, stats });

    return { masked, stats };
  }

  /**
   * Generate a concise placeholder for masked observations
   * (Complexity Trap paper: placeholders perform as well as LLM summaries)
   */
  private generatePlaceholder(obs: Observation): string {
    const lines = obs.output.split('\n').length;
    const tokens = this.estimateTokens(obs.output);

    // Extract key info for the placeholder
    let summary = '';

    // For file content, show the file info
    if (obs.type === 'file_content' && obs.input) {
      summary = ` - ${obs.input}`;
    }

    // For search results, show match count
    if (obs.type === 'search_result') {
      const matchCount = (obs.output.match(/\n/g) || []).length;
      summary = ` - ${matchCount} matches`;
    }

    // For command output, show first line if meaningful
    if (obs.type === 'command_output') {
      const firstLine = obs.output.split('\n')[0]?.trim();
      if (firstLine && firstLine.length < 50) {
        summary = `: ${firstLine}`;
      }
    }

    return `[${obs.toolName}${summary} | ${lines} lines, ~${tokens} tokens]`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MaskingConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config:updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): MaskingConfig {
    return { ...this.config };
  }

  /**
   * Dispose resources and cleanup
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

/**
 * Create an ObservationMasker instance
 */
export function createObservationMasker(
  config: Partial<MaskingConfig> = {}
): ObservationMasker {
  return new ObservationMasker(config);
}

// Singleton instance
let observationMaskerInstance: ObservationMasker | null = null;

export function getObservationMasker(
  config: Partial<MaskingConfig> = {}
): ObservationMasker {
  if (!observationMaskerInstance) {
    observationMaskerInstance = createObservationMasker(config);
  }
  return observationMaskerInstance;
}

export function resetObservationMasker(): void {
  if (observationMaskerInstance) {
    observationMaskerInstance.dispose();
  }
  observationMaskerInstance = null;
}
