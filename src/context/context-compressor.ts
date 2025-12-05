/**
 * Context Compressor
 *
 * Intelligently compresses context to reduce token usage while preserving
 * important information. Based on research from:
 * - JetBrains Research: "Cutting Through the Noise: Smarter Context Management"
 * - "Lost in the Middle" effect mitigation
 *
 * Techniques:
 * 1. Observation masking - Hide irrelevant tool outputs
 * 2. Progressive summarization - Summarize older context
 * 3. Deduplication - Remove repeated information
 * 4. Priority-based retention - Keep important context at start/end
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export interface ContextEntry {
  id: string;
  type: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  tokens?: number;
  importance?: number; // 0-1, higher = more important
  compressed?: boolean;
  originalTokens?: number;
  metadata?: {
    toolName?: string;
    success?: boolean;
    hasError?: boolean;
    isCodeOutput?: boolean;
    fileCount?: number;
  };
}

export interface CompressionConfig {
  maxTokens: number;           // Target max tokens
  preserveRecent: number;      // Keep N recent entries uncompressed
  preserveImportant: number;   // Keep N important entries uncompressed
  summaryRatio: number;        // Target compression ratio (0.1 = 10% of original)
  enableDeduplication: boolean;
  enableObservationMasking: boolean;
  maskThreshold: number;       // Mask tool outputs longer than this
}

export interface CompressionResult {
  entries: ContextEntry[];
  originalTokens: number;
  compressedTokens: number;
  savings: number;             // Percentage saved
  maskedCount: number;
  summarizedCount: number;
  deduplicatedCount: number;
}

export interface CompressionStats {
  totalCompressions: number;
  totalTokensSaved: number;
  averageSavings: number;
  compressionHistory: { timestamp: number; savings: number }[];
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: CompressionConfig = {
  maxTokens: 100000,
  preserveRecent: 10,
  preserveImportant: 5,
  summaryRatio: 0.2,
  enableDeduplication: true,
  enableObservationMasking: true,
  maskThreshold: 2000, // Mask outputs > 2000 tokens
};

// ============================================================================
// Patterns for intelligent compression
// ============================================================================

// Tool outputs that can be safely summarized
const SUMMARIZABLE_TOOLS = [
  'search', 'find_symbols', 'find_references', 'list_files',
  'read_file', 'bash', 'git_status', 'git_log', 'git_diff',
];

// Patterns indicating important content to preserve
const IMPORTANT_PATTERNS = [
  /error|exception|failed|critical/i,
  /TODO|FIXME|HACK|XXX/i,
  /function\s+\w+|class\s+\w+|interface\s+\w+/,
  /import\s+{|export\s+{|require\(/,
  /\d+\s+tests?\s+(passed|failed)/i,
];

// Patterns for content that can be heavily compressed
const COMPRESSIBLE_PATTERNS = [
  /^\s*\d+\s*│/gm,           // Line numbers in file output
  /^\s*at\s+[\w.]+\s*\(/gm,  // Stack traces
  /^\s*\/\/.*/gm,            // Comments
  /^\s*\n/gm,                // Empty lines
];

// ============================================================================
// Context Compressor Class
// ============================================================================

export class ContextCompressor extends EventEmitter {
  private config: CompressionConfig;
  private stats: CompressionStats;

  constructor(config: Partial<CompressionConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalCompressions: 0,
      totalTokensSaved: 0,
      averageSavings: 0,
      compressionHistory: [],
    };
  }

  /**
   * Compress context entries to fit within token budget
   */
  compress(entries: ContextEntry[]): CompressionResult {
    const startTime = Date.now();
    const originalTokens = this.countTotalTokens(entries);

    // If already within budget, return as-is
    if (originalTokens <= this.config.maxTokens) {
      return {
        entries,
        originalTokens,
        compressedTokens: originalTokens,
        savings: 0,
        maskedCount: 0,
        summarizedCount: 0,
        deduplicatedCount: 0,
      };
    }

    let result = [...entries];
    let maskedCount = 0;
    let summarizedCount = 0;
    let deduplicatedCount = 0;

    // Step 1: Deduplicate similar entries
    if (this.config.enableDeduplication) {
      const deduped = this.deduplicateEntries(result);
      deduplicatedCount = result.length - deduped.length;
      result = deduped;
    }

    // Step 2: Mask long tool outputs
    if (this.config.enableObservationMasking) {
      const masked = this.maskLongOutputs(result);
      maskedCount = masked.maskedCount;
      result = masked.entries;
    }

    // Step 3: Calculate importance scores
    result = this.calculateImportance(result);

    // Step 4: Progressive summarization of old entries
    const currentTokens = this.countTotalTokens(result);
    if (currentTokens > this.config.maxTokens) {
      const summarized = this.summarizeOldEntries(result);
      summarizedCount = summarized.summarizedCount;
      result = summarized.entries;
    }

    // Step 5: If still over budget, truncate least important
    const finalTokens = this.countTotalTokens(result);
    if (finalTokens > this.config.maxTokens) {
      result = this.truncateLeastImportant(result);
    }

    const compressedTokens = this.countTotalTokens(result);
    const savings = ((originalTokens - compressedTokens) / originalTokens) * 100;

    // Update stats
    this.stats.totalCompressions++;
    this.stats.totalTokensSaved += (originalTokens - compressedTokens);
    this.stats.averageSavings = this.stats.totalTokensSaved / this.stats.totalCompressions;
    this.stats.compressionHistory.push({ timestamp: Date.now(), savings });

    // Keep only last 100 compression records
    if (this.stats.compressionHistory.length > 100) {
      this.stats.compressionHistory = this.stats.compressionHistory.slice(-100);
    }

    this.emit('compressed', {
      originalTokens,
      compressedTokens,
      savings,
      duration: Date.now() - startTime,
    });

    return {
      entries: result,
      originalTokens,
      compressedTokens,
      savings,
      maskedCount,
      summarizedCount,
      deduplicatedCount,
    };
  }

  /**
   * Compress a single tool result
   */
  compressToolResult(content: string, toolName: string): string {
    const tokens = this.estimateTokens(content);

    // If under threshold, return as-is
    if (tokens <= this.config.maskThreshold) {
      return content;
    }

    // Apply tool-specific compression
    if (SUMMARIZABLE_TOOLS.includes(toolName)) {
      return this.summarizeToolOutput(content, toolName);
    }

    // For other tools, truncate with summary
    return this.truncateWithSummary(content);
  }

  /**
   * Get compression statistics
   */
  getStats(): CompressionStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalCompressions: 0,
      totalTokensSaved: 0,
      averageSavings: 0,
      compressionHistory: [],
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private countTotalTokens(entries: ContextEntry[]): number {
    return entries.reduce((sum, e) => sum + (e.tokens || this.estimateTokens(e.content)), 0);
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private deduplicateEntries(entries: ContextEntry[]): ContextEntry[] {
    const seen = new Map<string, number>();
    const result: ContextEntry[] = [];

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const hash = this.hashContent(entry.content);

      if (!seen.has(hash)) {
        seen.set(hash, i);
        result.unshift(entry);
      } else {
        // Keep a reference to the duplicate
        const duplicateNote = `[Duplicate of entry at position ${seen.get(hash)}]`;
        result.unshift({
          ...entry,
          content: duplicateNote,
          tokens: this.estimateTokens(duplicateNote),
          compressed: true,
          originalTokens: entry.tokens || this.estimateTokens(entry.content),
        });
      }
    }

    return result;
  }

  private hashContent(content: string): string {
    // Simple hash for deduplication
    let hash = 0;
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < Math.min(normalized.length, 500); i++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }
    return hash.toString(16);
  }

  private maskLongOutputs(entries: ContextEntry[]): { entries: ContextEntry[]; maskedCount: number } {
    let maskedCount = 0;
    const recentCount = this.config.preserveRecent;

    const result = entries.map((entry, index) => {
      // Don't mask recent entries
      if (index >= entries.length - recentCount) {
        return entry;
      }

      // Only mask tool results
      if (entry.type !== 'tool_result') {
        return entry;
      }

      const tokens = entry.tokens || this.estimateTokens(entry.content);
      if (tokens > this.config.maskThreshold) {
        maskedCount++;
        const summary = this.createOutputSummary(entry);
        return {
          ...entry,
          content: summary,
          tokens: this.estimateTokens(summary),
          compressed: true,
          originalTokens: tokens,
        };
      }

      return entry;
    });

    return { entries: result, maskedCount };
  }

  private createOutputSummary(entry: ContextEntry): string {
    const content = entry.content;
    const lines = content.split('\n');
    const toolName = entry.metadata?.toolName || 'tool';

    // Extract key information
    const hasError = entry.metadata?.hasError || /error|exception|failed/i.test(content);
    const lineCount = lines.length;
    const fileCount = entry.metadata?.fileCount || (content.match(/\b[\w/]+\.(ts|js|py|go|rs|java)\b/g) || []).length;

    // Create summary
    let summary = `[Compressed ${toolName} output: ${lineCount} lines`;

    if (fileCount > 0) {
      summary += `, ${fileCount} files mentioned`;
    }

    if (hasError) {
      // Extract first error line
      const errorLine = lines.find(l => /error|exception|failed/i.test(l));
      if (errorLine) {
        summary += `\nFirst error: ${errorLine.substring(0, 200)}`;
      }
    }

    // Keep first and last few lines for context
    const previewLines = 3;
    if (lineCount > previewLines * 2) {
      summary += '\n--- Preview ---\n';
      summary += lines.slice(0, previewLines).join('\n');
      summary += '\n...\n';
      summary += lines.slice(-previewLines).join('\n');
    }

    summary += ']';
    return summary;
  }

  private calculateImportance(entries: ContextEntry[]): ContextEntry[] {
    return entries.map((entry, index) => {
      let importance = 0.5; // Base importance

      // Recency boost (last entries are more important)
      const recencyBoost = index / entries.length * 0.3;
      importance += recencyBoost;

      // Type-based importance
      if (entry.type === 'user') importance += 0.2;
      if (entry.type === 'assistant') importance += 0.1;
      if (entry.type === 'system') importance += 0.15;

      // Content-based importance
      for (const pattern of IMPORTANT_PATTERNS) {
        if (pattern.test(entry.content)) {
          importance += 0.1;
        }
      }

      // Error content is important
      if (entry.metadata?.hasError) importance += 0.2;

      // Normalize to 0-1
      importance = Math.min(1, Math.max(0, importance));

      return { ...entry, importance };
    });
  }

  private summarizeOldEntries(entries: ContextEntry[]): { entries: ContextEntry[]; summarizedCount: number } {
    const preserveRecent = this.config.preserveRecent;
    const preserveImportant = this.config.preserveImportant;
    let summarizedCount = 0;

    // Sort by importance to find most important entries
    const importantIndices = new Set(
      entries
        .map((e, i) => ({ index: i, importance: e.importance || 0 }))
        .sort((a, b) => b.importance - a.importance)
        .slice(0, preserveImportant)
        .map(e => e.index)
    );

    const result = entries.map((entry, index) => {
      // Preserve recent entries
      if (index >= entries.length - preserveRecent) {
        return entry;
      }

      // Preserve important entries
      if (importantIndices.has(index)) {
        return entry;
      }

      // Already compressed
      if (entry.compressed) {
        return entry;
      }

      const tokens = entry.tokens || this.estimateTokens(entry.content);
      const targetTokens = Math.ceil(tokens * this.config.summaryRatio);

      if (tokens > 100) { // Only summarize entries with significant content
        summarizedCount++;
        const summary = this.summarizeContent(entry.content, targetTokens);
        return {
          ...entry,
          content: summary,
          tokens: this.estimateTokens(summary),
          compressed: true,
          originalTokens: tokens,
        };
      }

      return entry;
    });

    return { entries: result, summarizedCount };
  }

  private summarizeContent(content: string, targetTokens: number): string {
    const lines = content.split('\n');
    const targetChars = targetTokens * 4;

    // Remove compressible patterns
    let compressed = content;
    for (const pattern of COMPRESSIBLE_PATTERNS) {
      compressed = compressed.replace(pattern, '');
    }

    // If still too long, keep first and last portions
    if (compressed.length > targetChars) {
      const halfTarget = Math.floor(targetChars / 2);
      compressed = compressed.substring(0, halfTarget) +
        '\n[... content summarized ...]\n' +
        compressed.substring(compressed.length - halfTarget);
    }

    return `[Summarized: ${lines.length} lines → ${compressed.split('\n').length} lines]\n${compressed}`;
  }

  private truncateLeastImportant(entries: ContextEntry[]): ContextEntry[] {
    const preserveRecent = this.config.preserveRecent;
    let currentTokens = this.countTotalTokens(entries);

    // Sort by importance (ascending) to find least important
    const indexed = entries.map((e, i) => ({ entry: e, index: i, importance: e.importance || 0 }));
    const sortedByImportance = [...indexed].sort((a, b) => a.importance - b.importance);

    const toRemove = new Set<number>();

    for (const item of sortedByImportance) {
      if (currentTokens <= this.config.maxTokens) break;

      // Don't remove recent entries
      if (item.index >= entries.length - preserveRecent) continue;

      toRemove.add(item.index);
      currentTokens -= (item.entry.tokens || this.estimateTokens(item.entry.content));
    }

    return entries.filter((_, i) => !toRemove.has(i));
  }

  private summarizeToolOutput(content: string, toolName: string): string {
    const lines = content.split('\n').filter(l => l.trim());

    switch (toolName) {
      case 'search':
      case 'find_symbols':
      case 'find_references': {
        // Keep summary line and first few results
        const resultCount = lines.length;
        const preview = lines.slice(0, 10).join('\n');
        return `[${toolName}: ${resultCount} results]\n${preview}${resultCount > 10 ? '\n... and ' + (resultCount - 10) + ' more' : ''}`;
      }

      case 'read_file': {
        // Keep first and last portions
        if (lines.length > 30) {
          return `[File: ${lines.length} lines]\n` +
            lines.slice(0, 15).join('\n') +
            '\n[... middle content omitted ...]\n' +
            lines.slice(-10).join('\n');
        }
        return content;
      }

      case 'bash':
      case 'git_status':
      case 'git_log':
      case 'git_diff': {
        // Extract key information
        const errorLines = lines.filter(l => /error|warning|failed/i.test(l));
        const summaryLines = lines.filter(l => /^\s*\d+\s+(file|insertion|deletion|change)/i.test(l));

        let summary = `[${toolName}: ${lines.length} lines]`;
        if (errorLines.length > 0) {
          summary += '\nErrors:\n' + errorLines.slice(0, 5).join('\n');
        }
        if (summaryLines.length > 0) {
          summary += '\nSummary:\n' + summaryLines.join('\n');
        }
        if (lines.length > 20) {
          summary += '\nPreview:\n' + lines.slice(0, 10).join('\n') + '\n...';
        } else {
          summary += '\n' + content;
        }
        return summary;
      }

      default:
        return this.truncateWithSummary(content);
    }
  }

  private truncateWithSummary(content: string): string {
    const lines = content.split('\n');
    const maxLines = 30;

    if (lines.length <= maxLines) {
      return content;
    }

    const half = Math.floor(maxLines / 2);
    return `[Truncated: ${lines.length} lines]\n` +
      lines.slice(0, half).join('\n') +
      '\n[... ' + (lines.length - maxLines) + ' lines omitted ...]\n' +
      lines.slice(-half).join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let compressorInstance: ContextCompressor | null = null;

export function getContextCompressor(config?: Partial<CompressionConfig>): ContextCompressor {
  if (!compressorInstance) {
    compressorInstance = new ContextCompressor(config);
  }
  return compressorInstance;
}

export function resetContextCompressor(): void {
  compressorInstance = null;
}
