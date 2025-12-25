/**
 * History Manager for CLI commands
 *
 * Inspired by mistral-vibe's history_manager.py that provides:
 * - Command history navigation with up/down arrows
 * - Prefix filtering for quick command recall
 * - Persistent storage in JSON format
 * - Duplicate prevention
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface HistoryManagerConfig {
  /** Maximum number of history entries to store */
  maxEntries: number;
  /** Path to history file */
  historyFile: string;
  /** Prefixes to exclude from history (e.g., '/') */
  excludePrefixes: string[];
}

export interface HistoryEntry {
  /** The command text */
  text: string;
  /** Timestamp when command was added */
  timestamp: number;
}

/**
 * Manages command history with prefix filtering and navigation
 */
export class HistoryManager {
  private config: HistoryManagerConfig;
  private history: HistoryEntry[] = [];
  private navigationIndex: number = -1;
  private temporaryInput: string = '';
  private currentPrefix: string = '';

  static readonly DEFAULT_CONFIG: HistoryManagerConfig = {
    maxEntries: 100,
    historyFile: path.join(os.homedir(), '.codebuddy', 'history.json'),
    excludePrefixes: ['/'], // Don't save slash commands by default
  };

  constructor(config: Partial<HistoryManagerConfig> = {}) {
    this.config = { ...HistoryManager.DEFAULT_CONFIG, ...config };
    this.loadHistory();
  }

  /**
   * Load history from file
   */
  private loadHistory(): void {
    try {
      if (fs.existsSync(this.config.historyFile)) {
        const data = fs.readFileSync(this.config.historyFile, 'utf-8');
        const parsed = JSON.parse(data);

        // Handle both old format (string[]) and new format (HistoryEntry[])
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && typeof parsed[0] === 'string') {
            // Old format - convert to new format
            this.history = parsed.map((text: string) => ({
              text,
              timestamp: Date.now(),
            }));
          } else {
            this.history = parsed as HistoryEntry[];
          }
        }

        // Trim to max entries
        if (this.history.length > this.config.maxEntries) {
          this.history = this.history.slice(-this.config.maxEntries);
        }
      }
    } catch (error) {
      // Graceful degradation - start with empty history
      console.warn('Failed to load history:', error);
      this.history = [];
    }
  }

  /**
   * Save history to file
   */
  private saveHistory(): void {
    try {
      const dir = path.dirname(this.config.historyFile);
      fs.ensureDirSync(dir);
      fs.writeFileSync(
        this.config.historyFile,
        JSON.stringify(this.history, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.warn('Failed to save history:', error);
    }
  }

  /**
   * Add a new entry to history
   * @param text - The command text to add
   * @returns true if added, false if excluded or duplicate
   */
  add(text: string): boolean {
    // Trim whitespace
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Check excluded prefixes (like slash commands)
    for (const prefix of this.config.excludePrefixes) {
      if (trimmed.startsWith(prefix)) {
        return false;
      }
    }

    // Prevent consecutive duplicates
    if (this.history.length > 0) {
      const lastEntry = this.history[this.history.length - 1];
      if (lastEntry.text === trimmed) {
        return false;
      }
    }

    // Add new entry
    this.history.push({
      text: trimmed,
      timestamp: Date.now(),
    });

    // Enforce max entries limit
    if (this.history.length > this.config.maxEntries) {
      this.history = this.history.slice(-this.config.maxEntries);
    }

    // Save to file
    this.saveHistory();

    return true;
  }

  /**
   * Get the previous entry in history (navigate up)
   * @param currentInput - The current input text (saved for restoration)
   * @param prefix - Optional prefix to filter by
   * @returns The previous matching history entry, or currentInput if at start
   */
  getPrevious(currentInput: string, prefix?: string): string {
    // Save current input if starting navigation
    if (this.navigationIndex === -1) {
      this.temporaryInput = currentInput;
      this.currentPrefix = prefix || '';
    }

    // Filter history by prefix if provided
    const filtered = this.getFilteredHistory(this.currentPrefix);
    if (filtered.length === 0) {
      return currentInput;
    }

    // Navigate backward
    if (this.navigationIndex < filtered.length - 1) {
      this.navigationIndex++;
    }

    return filtered[filtered.length - 1 - this.navigationIndex]?.text || currentInput;
  }

  /**
   * Get the next entry in history (navigate down)
   * @param prefix - Optional prefix to filter by
   * @returns The next matching history entry, or the temporary input
   */
  getNext(prefix?: string): string {
    // Can't navigate forward past the start
    if (this.navigationIndex <= 0) {
      this.resetNavigation();
      return this.temporaryInput;
    }

    const filtered = this.getFilteredHistory(prefix || this.currentPrefix);
    this.navigationIndex--;

    if (this.navigationIndex < 0) {
      return this.temporaryInput;
    }

    return filtered[filtered.length - 1 - this.navigationIndex]?.text || this.temporaryInput;
  }

  /**
   * Get history filtered by prefix
   */
  private getFilteredHistory(prefix: string): HistoryEntry[] {
    if (!prefix) {
      return this.history;
    }
    return this.history.filter(entry =>
      entry.text.toLowerCase().startsWith(prefix.toLowerCase())
    );
  }

  /**
   * Reset navigation state
   */
  resetNavigation(): void {
    this.navigationIndex = -1;
    this.temporaryInput = '';
    this.currentPrefix = '';
  }

  /**
   * Search history for entries containing a query
   * @param query - The search query
   * @param limit - Maximum number of results
   * @returns Matching history entries (most recent first)
   */
  search(query: string, limit: number = 10): HistoryEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.history
      .filter(entry => entry.text.toLowerCase().includes(lowerQuery))
      .slice(-limit)
      .reverse();
  }

  /**
   * Get all history entries
   */
  getAll(): HistoryEntry[] {
    return [...this.history];
  }

  /**
   * Get recent history entries
   */
  getRecent(limit: number = 10): HistoryEntry[] {
    return this.history.slice(-limit).reverse();
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.history = [];
    this.resetNavigation();
    this.saveHistory();
  }

  /**
   * Get current navigation index (for debugging)
   */
  getNavigationIndex(): number {
    return this.navigationIndex;
  }

  /**
   * Get history count
   */
  get count(): number {
    return this.history.length;
  }

  /**
   * Get auto-completion suggestions based on input prefix
   * @param prefix - The current input to complete
   * @param limit - Maximum number of suggestions
   * @returns Array of matching history entries, scored by relevance
   */
  getSuggestions(prefix: string, limit: number = 5): string[] {
    if (!prefix || prefix.length < 2) {
      return [];
    }

    const lowerPrefix = prefix.toLowerCase();
    const scored: Array<{ text: string; score: number }> = [];

    for (const entry of this.history) {
      const lowerText = entry.text.toLowerCase();

      // Exact prefix match gets highest score
      if (lowerText.startsWith(lowerPrefix)) {
        scored.push({
          text: entry.text,
          score: 100 + (1000 - entry.text.length), // Prefer shorter matches
        });
      }
      // Word boundary match gets medium score
      else if (lowerText.includes(' ' + lowerPrefix) || lowerText.includes('\n' + lowerPrefix)) {
        scored.push({
          text: entry.text,
          score: 50,
        });
      }
      // Contains match gets lower score
      else if (lowerText.includes(lowerPrefix)) {
        scored.push({
          text: entry.text,
          score: 25,
        });
      }
    }

    // Sort by score descending, then by recency
    scored.sort((a, b) => b.score - a.score);

    // Remove duplicates and return top matches
    const seen = new Set<string>();
    const results: string[] = [];

    for (const item of scored) {
      if (!seen.has(item.text)) {
        seen.add(item.text);
        results.push(item.text);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Get the best single completion for inline suggestion
   * @param prefix - The current input
   * @returns The best matching completion or null
   */
  getInlineCompletion(prefix: string): string | null {
    if (!prefix || prefix.length < 3) {
      return null;
    }

    const lowerPrefix = prefix.toLowerCase();

    // Look for exact prefix matches, preferring recent entries
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i];
      if (entry.text.toLowerCase().startsWith(lowerPrefix) && entry.text.length > prefix.length) {
        return entry.text;
      }
    }

    return null;
  }

  /**
   * Get frequently used commands
   * @param limit - Maximum number of results
   * @returns Most frequently used commands
   */
  getFrequent(limit: number = 10): Array<{ text: string; count: number }> {
    const counts = new Map<string, number>();

    for (const entry of this.history) {
      const count = counts.get(entry.text) || 0;
      counts.set(entry.text, count + 1);
    }

    return Array.from(counts.entries())
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}

// Singleton instance
let historyManager: HistoryManager | null = null;

/**
 * Get the global history manager instance
 */
export function getHistoryManager(): HistoryManager {
  if (!historyManager) {
    historyManager = new HistoryManager();
  }
  return historyManager;
}

/**
 * Create a new history manager with custom config
 */
export function createHistoryManager(config: Partial<HistoryManagerConfig>): HistoryManager {
  return new HistoryManager(config);
}
