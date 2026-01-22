/**
 * Semantic Search for Conversation History
 *
 * Provides intelligent search through conversation history:
 * - Keyword matching with ranking
 * - Fuzzy search
 * - Context-aware results
 * - Time-based filtering
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sessionId: string;
  metadata?: {
    tools?: string[];
    files?: string[];
    tokens?: number;
  };
}

export interface SearchResult {
  message: ConversationMessage;
  score: number;
  highlights: string[];
  matchType: 'exact' | 'fuzzy' | 'semantic';
}

export interface SearchOptions {
  /** Maximum results to return */
  limit?: number;
  /** Minimum score threshold (0-1) */
  minScore?: number;
  /** Filter by role */
  role?: 'user' | 'assistant' | 'system';
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by date range */
  dateRange?: {
    from?: Date;
    to?: Date;
  };
  /** Include context (messages before/after) */
  contextSize?: number;
  /** Enable fuzzy matching */
  fuzzyMatch?: boolean;
  /** Search in specific fields */
  searchFields?: ('content' | 'tools' | 'files')[];
}

const DEFAULT_OPTIONS: Required<SearchOptions> = {
  limit: 20,
  minScore: 0.1,
  role: undefined as unknown as 'user',
  sessionId: undefined as unknown as string,
  dateRange: undefined as unknown as { from?: Date; to?: Date },
  contextSize: 0,
  fuzzyMatch: true,
  searchFields: ['content'],
};

/**
 * Maximum number of messages to keep in the search engine.
 * Older messages are automatically pruned to prevent memory leaks.
 */
const MAX_MESSAGES = 10000;

/**
 * Maximum word index entries per word.
 * Prevents the index from growing unboundedly.
 */
const MAX_INDEX_ENTRIES_PER_WORD = 5000;

/**
 * Semantic Search Engine
 */
export class SemanticSearchEngine {
  private messages: ConversationMessage[] = [];
  private indexPath: string;
  private wordIndex: Map<string, Set<string>> = new Map(); // word -> message IDs
  private stopWords: Set<string>;

  constructor(indexPath?: string) {
    this.indexPath = indexPath || path.join(os.homedir(), '.codebuddy', 'search-index.json');
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
      'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
      'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
    ]);
    this.loadIndex();
  }

  /**
   * Add message to index
   */
  addMessage(message: ConversationMessage): void {
    this.messages.push(message);
    this.indexMessage(message);

    // Auto-trim to prevent memory leaks
    this.trimIfNeeded();

    this.saveIndex();
  }

  /**
   * Add multiple messages
   */
  addMessages(messages: ConversationMessage[]): void {
    for (const message of messages) {
      this.messages.push(message);
      this.indexMessage(message);
    }

    // Auto-trim to prevent memory leaks
    this.trimIfNeeded();

    this.saveIndex();
  }

  /**
   * Trim messages if exceeding max limit.
   * Removes oldest messages and rebuilds index.
   */
  private trimIfNeeded(): void {
    if (this.messages.length > MAX_MESSAGES) {
      const trimCount = this.messages.length - MAX_MESSAGES;
      this.messages = this.messages.slice(trimCount);
      this.rebuildIndex();
    }

    // Also trim word index if any word has too many entries
    this.trimWordIndex();
  }

  /**
   * Trim word index entries to prevent unbounded growth.
   * Keeps only the most recent message IDs for each word.
   */
  private trimWordIndex(): void {
    for (const [word, messageIds] of this.wordIndex) {
      if (messageIds.size > MAX_INDEX_ENTRIES_PER_WORD) {
        // Convert to array, keep most recent, convert back to set
        const idsArray = Array.from(messageIds);
        const trimmedIds = new Set(idsArray.slice(-MAX_INDEX_ENTRIES_PER_WORD));
        this.wordIndex.set(word, trimmedIds);
      }
    }
  }

  /**
   * Get memory statistics for monitoring
   */
  getMemoryStats(): {
    messageCount: number;
    maxMessages: number;
    indexSize: number;
    indexMemoryEstimate: string;
  } {
    let totalIndexEntries = 0;
    for (const entries of this.wordIndex.values()) {
      totalIndexEntries += entries.size;
    }

    // Rough estimate: ~50 bytes per entry (word + set overhead + id strings)
    const estimatedBytes = totalIndexEntries * 50 + this.messages.length * 200;
    const estimatedMB = (estimatedBytes / (1024 * 1024)).toFixed(2);

    return {
      messageCount: this.messages.length,
      maxMessages: MAX_MESSAGES,
      indexSize: this.wordIndex.size,
      indexMemoryEstimate: `~${estimatedMB} MB`,
    };
  }

  /**
   * Search conversation history
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const queryTerms = this.tokenize(query);

    if (queryTerms.length === 0) {
      return [];
    }

    // Find candidate messages using index
    const candidates = this.findCandidates(queryTerms);

    // Score and filter candidates
    const results: SearchResult[] = [];

    for (const messageId of candidates) {
      const message = this.messages.find(m => m.id === messageId);
      if (!message) continue;

      // Apply filters
      if (opts.role && message.role !== opts.role) continue;
      if (opts.sessionId && message.sessionId !== opts.sessionId) continue;
      if (opts.dateRange) {
        if (opts.dateRange.from && message.timestamp < opts.dateRange.from) continue;
        if (opts.dateRange.to && message.timestamp > opts.dateRange.to) continue;
      }

      // Calculate score
      const { score, highlights, matchType } = this.scoreMessage(
        message,
        queryTerms,
        query,
        opts
      );

      if (score >= opts.minScore) {
        results.push({ message, score, highlights, matchType });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Limit results
    const limited = results.slice(0, opts.limit);

    // Add context if requested
    if (opts.contextSize > 0) {
      return this.addContext(limited, opts.contextSize);
    }

    return limited;
  }

  /**
   * Search by similarity to a message
   */
  findSimilar(messageId: string, limit: number = 5): SearchResult[] {
    const message = this.messages.find(m => m.id === messageId);
    if (!message) return [];

    // Use message content as query
    return this.search(message.content, {
      limit: limit + 1, // +1 because we'll exclude the original
      minScore: 0.3,
    }).filter(r => r.message.id !== messageId);
  }

  /**
   * Get recent messages
   */
  getRecent(limit: number = 20): ConversationMessage[] {
    return this.messages
      .slice()
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get messages by session
   */
  getBySession(sessionId: string): ConversationMessage[] {
    return this.messages
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalMessages: number;
    totalSessions: number;
    indexedWords: number;
    oldestMessage?: Date;
    newestMessage?: Date;
  } {
    const sessions = new Set(this.messages.map(m => m.sessionId));
    const sorted = this.messages.slice().sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    return {
      totalMessages: this.messages.length,
      totalSessions: sessions.size,
      indexedWords: this.wordIndex.size,
      oldestMessage: sorted[0]?.timestamp,
      newestMessage: sorted[sorted.length - 1]?.timestamp,
    };
  }

  /**
   * Clear index
   */
  clear(): void {
    this.messages = [];
    this.wordIndex.clear();
    this.saveIndex();
  }

  /**
   * Remove old messages
   */
  pruneOlderThan(days: number): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const original = this.messages.length;

    this.messages = this.messages.filter(m => m.timestamp >= cutoff);
    this.rebuildIndex();

    return original - this.messages.length;
  }

  /**
   * Format search results
   */
  formatResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No results found.';
    }

    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════════════',
      `              SEARCH RESULTS (${results.length})`,
      '═══════════════════════════════════════════════════════════',
      '',
    ];

    for (let i = 0; i < results.length; i++) {
      const { message, score, highlights, matchType } = results[i];
      const time = message.timestamp.toLocaleString();
      const preview = message.content.length > 100
        ? message.content.slice(0, 97) + '...'
        : message.content;

      lines.push(`${i + 1}. [${message.role}] ${time}`);
      lines.push(`   Score: ${(score * 100).toFixed(0)}% (${matchType})`);
      lines.push(`   ${preview.replace(/\n/g, ' ')}`);

      if (highlights.length > 0) {
        lines.push(`   Matches: ${highlights.slice(0, 3).join(', ')}`);
      }

      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Index a message
   */
  private indexMessage(message: ConversationMessage): void {
    const terms = this.tokenize(message.content);

    for (const term of terms) {
      if (!this.wordIndex.has(term)) {
        this.wordIndex.set(term, new Set());
      }
      this.wordIndex.get(term)!.add(message.id);
    }

    // Index metadata
    if (message.metadata?.tools) {
      for (const tool of message.metadata.tools) {
        const toolTerms = this.tokenize(tool);
        for (const term of toolTerms) {
          if (!this.wordIndex.has(term)) {
            this.wordIndex.set(term, new Set());
          }
          this.wordIndex.get(term)!.add(message.id);
        }
      }
    }
  }

  /**
   * Rebuild entire index
   */
  private rebuildIndex(): void {
    this.wordIndex.clear();
    for (const message of this.messages) {
      this.indexMessage(message);
    }
    this.saveIndex();
  }

  /**
   * Find candidate messages using index
   */
  private findCandidates(queryTerms: string[]): Set<string> {
    const candidates = new Set<string>();

    for (const term of queryTerms) {
      // Exact match
      const exact = this.wordIndex.get(term);
      if (exact) {
        for (const id of exact) {
          candidates.add(id);
        }
      }

      // Prefix match
      for (const [word, ids] of this.wordIndex) {
        if (word.startsWith(term) || term.startsWith(word)) {
          for (const id of ids) {
            candidates.add(id);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Score a message against query
   */
  private scoreMessage(
    message: ConversationMessage,
    queryTerms: string[],
    originalQuery: string,
    opts: Required<SearchOptions>
  ): { score: number; highlights: string[]; matchType: SearchResult['matchType'] } {
    const contentLower = message.content.toLowerCase();
    const highlights: string[] = [];
    let score = 0;
    let matchType: SearchResult['matchType'] = 'fuzzy';

    // Exact phrase match (highest score)
    if (contentLower.includes(originalQuery.toLowerCase())) {
      score += 0.5;
      matchType = 'exact';
      highlights.push(originalQuery);
    }

    // Term matching
    const contentTerms = this.tokenize(message.content);
    let termMatches = 0;

    for (const queryTerm of queryTerms) {
      for (const contentTerm of contentTerms) {
        if (contentTerm === queryTerm) {
          termMatches++;
          score += 0.2;
          if (!highlights.includes(queryTerm)) {
            highlights.push(queryTerm);
          }
        } else if (opts.fuzzyMatch && this.fuzzyMatch(contentTerm, queryTerm)) {
          termMatches++;
          score += 0.1;
          if (!highlights.includes(contentTerm)) {
            highlights.push(contentTerm);
          }
        }
      }
    }

    // Coverage bonus (what % of query terms were found)
    const coverage = termMatches / queryTerms.length;
    score += coverage * 0.2;

    // Recency bonus
    const age = Date.now() - message.timestamp.getTime();
    const daysOld = age / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 0.1 * (1 - daysOld / 30)); // Bonus decays over 30 days
    score += recencyBonus;

    // Role bonus (user messages slightly preferred)
    if (message.role === 'user') {
      score += 0.05;
    }

    // Normalize score
    score = Math.min(1, score);

    if (matchType === 'fuzzy' && score > 0.5) {
      matchType = 'semantic';
    }

    return { score, highlights, matchType };
  }

  /**
   * Fuzzy match two terms
   */
  private fuzzyMatch(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 2) return false;

    // Simple edit distance check
    let differences = 0;
    const maxLen = Math.max(a.length, b.length);

    for (let i = 0; i < maxLen; i++) {
      if (a[i] !== b[i]) differences++;
      if (differences > 2) return false;
    }

    return differences <= 2;
  }

  /**
   * Tokenize text into searchable terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 2 && !this.stopWords.has(word));
  }

  /**
   * Add context messages to results
   */
  private addContext(results: SearchResult[], contextSize: number): SearchResult[] {
    const enhanced: SearchResult[] = [];
    const addedIds = new Set<string>();

    for (const result of results) {
      // Find messages from same session around this one
      const sessionMessages = this.messages
        .filter(m => m.sessionId === result.message.sessionId)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const index = sessionMessages.findIndex(m => m.id === result.message.id);

      // Add context before
      for (let i = Math.max(0, index - contextSize); i < index; i++) {
        const msg = sessionMessages[i];
        if (!addedIds.has(msg.id)) {
          enhanced.push({
            message: msg,
            score: 0,
            highlights: [],
            matchType: 'exact',
          });
          addedIds.add(msg.id);
        }
      }

      // Add the result
      if (!addedIds.has(result.message.id)) {
        enhanced.push(result);
        addedIds.add(result.message.id);
      }

      // Add context after
      for (let i = index + 1; i <= Math.min(sessionMessages.length - 1, index + contextSize); i++) {
        const msg = sessionMessages[i];
        if (!addedIds.has(msg.id)) {
          enhanced.push({
            message: msg,
            score: 0,
            highlights: [],
            matchType: 'exact',
          });
          addedIds.add(msg.id);
        }
      }
    }

    return enhanced;
  }

  /**
   * Load index from file
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = fs.readJsonSync(this.indexPath);

        if (data.messages) {
          this.messages = data.messages.map((m: Record<string, unknown>) => ({
            ...m,
            timestamp: new Date(m.timestamp as string),
          }));
        }

        this.rebuildIndex();
      }
    } catch {
      this.messages = [];
    }
  }

  /**
   * Save index to file
   */
  private saveIndex(): void {
    try {
      fs.ensureDirSync(path.dirname(this.indexPath));
      fs.writeJsonSync(this.indexPath, { messages: this.messages }, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let searchEngine: SemanticSearchEngine | null = null;

/**
 * Get or create semantic search engine
 */
export function getSemanticSearchEngine(): SemanticSearchEngine {
  if (!searchEngine) {
    searchEngine = new SemanticSearchEngine();
  }
  return searchEngine;
}

/**
 * Quick search helper
 */
export function searchHistory(query: string, options?: SearchOptions): SearchResult[] {
  return getSemanticSearchEngine().search(query, options);
}

export default SemanticSearchEngine;
