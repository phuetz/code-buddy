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
  /** Whether to include slash commands in history */
  includeSlashCommands: boolean;
}

/** State for reverse search (Ctrl+R) */
export interface ReverseSearchState {
  /** Whether reverse search mode is active */
  active: boolean;
  /** Current search query */
  query: string;
  /** Current match index (0 = most recent match) */
  matchIndex: number;
  /** Cached matching entries */
  matches: HistoryEntry[];
  /** Original input before entering search mode */
  originalInput: string;
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
  private reverseSearchState: ReverseSearchState = {
    active: false,
    query: '',
    matchIndex: 0,
    matches: [],
    originalInput: '',
  };

  static readonly DEFAULT_CONFIG: HistoryManagerConfig = {
    maxEntries: 1000, // Increased default limit
    historyFile: path.join(os.homedir(), '.codebuddy', 'history.json'),
    excludePrefixes: [], // Include all commands by default
    includeSlashCommands: true, // Include slash commands
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

  // ============================================================================
  // Reverse Search (Ctrl+R) Methods
  // ============================================================================

  /**
   * Start reverse search mode
   * @param currentInput - Current input to save for restoration
   */
  startReverseSearch(currentInput: string): void {
    this.reverseSearchState = {
      active: true,
      query: '',
      matchIndex: 0,
      matches: [],
      originalInput: currentInput,
    };
  }

  /**
   * Check if reverse search is active
   */
  isReverseSearchActive(): boolean {
    return this.reverseSearchState.active;
  }

  /**
   * Get the current reverse search state
   */
  getReverseSearchState(): ReverseSearchState {
    return { ...this.reverseSearchState };
  }

  /**
   * Update the reverse search query and find matches
   * @param query - The search query
   * @returns The best matching entry or null
   */
  updateReverseSearch(query: string): HistoryEntry | null {
    this.reverseSearchState.query = query;

    if (!query) {
      this.reverseSearchState.matches = [];
      this.reverseSearchState.matchIndex = 0;
      return null;
    }

    // Find all matching entries (most recent first)
    const lowerQuery = query.toLowerCase();
    this.reverseSearchState.matches = this.history
      .filter(entry => entry.text.toLowerCase().includes(lowerQuery))
      .reverse();

    this.reverseSearchState.matchIndex = 0;

    return this.reverseSearchState.matches[0] || null;
  }

  /**
   * Navigate to the next match in reverse search (older)
   * @returns The next matching entry or null
   */
  reverseSearchNext(): HistoryEntry | null {
    const { matches, matchIndex } = this.reverseSearchState;

    if (matches.length === 0) return null;

    const newIndex = Math.min(matchIndex + 1, matches.length - 1);
    this.reverseSearchState.matchIndex = newIndex;

    return matches[newIndex] || null;
  }

  /**
   * Navigate to the previous match in reverse search (newer)
   * @returns The previous matching entry or null
   */
  reverseSearchPrev(): HistoryEntry | null {
    const { matches, matchIndex } = this.reverseSearchState;

    if (matches.length === 0) return null;

    const newIndex = Math.max(matchIndex - 1, 0);
    this.reverseSearchState.matchIndex = newIndex;

    return matches[newIndex] || null;
  }

  /**
   * Accept the current reverse search match
   * @returns The selected entry text or original input if no match
   */
  acceptReverseSearch(): string {
    const { matches, matchIndex, originalInput } = this.reverseSearchState;
    const result = matches[matchIndex]?.text || originalInput;
    this.cancelReverseSearch();
    return result;
  }

  /**
   * Cancel reverse search and restore original input
   * @returns The original input before search started
   */
  cancelReverseSearch(): string {
    const originalInput = this.reverseSearchState.originalInput;
    this.reverseSearchState = {
      active: false,
      query: '',
      matchIndex: 0,
      matches: [],
      originalInput: '',
    };
    return originalInput;
  }

  /**
   * Get formatted display for reverse search prompt
   * @returns Formatted string showing search state
   */
  formatReverseSearchPrompt(): string {
    const { query, matches, matchIndex } = this.reverseSearchState;
    const matchCount = matches.length;
    const currentMatch = matches[matchIndex];

    if (!query) {
      return '(reverse-i-search)`\': ';
    }

    if (matchCount === 0) {
      return `(reverse-i-search)\`${query}': [no match]`;
    }

    const position = matchCount > 1 ? ` [${matchIndex + 1}/${matchCount}]` : '';
    return `(reverse-i-search)\`${query}'${position}: ${currentMatch?.text || ''}`;
  }

  /**
   * Format history list for display
   * @param limit - Maximum entries to show
   * @param showTimestamp - Whether to show timestamps
   * @returns Formatted history string
   */
  formatHistoryList(limit: number = 20, showTimestamp: boolean = false): string {
    const entries = this.getRecent(limit);

    if (entries.length === 0) {
      return 'No command history.';
    }

    const lines: string[] = ['Command History:', ''];

    entries.forEach((entry, index) => {
      const num = String(entries.length - index).padStart(4, ' ');
      if (showTimestamp) {
        const date = new Date(entry.timestamp);
        const timeStr = date.toLocaleString();
        lines.push(`${num}  ${timeStr}  ${entry.text}`);
      } else {
        lines.push(`${num}  ${entry.text}`);
      }
    });

    lines.push('');
    lines.push(`Total: ${this.count} entries (showing ${entries.length})`);

    return lines.join('\n');
  }

  /**
   * Get the configured maximum entries
   */
  getMaxEntries(): number {
    return this.config.maxEntries;
  }

  /**
   * Set the maximum number of entries
   * @param max - New maximum (will trim history if needed)
   */
  setMaxEntries(max: number): void {
    this.config.maxEntries = max;
    if (this.history.length > max) {
      this.history = this.history.slice(-max);
      this.saveHistory();
    }
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
