/**
 * Clipboard Manager
 *
 * Enhanced copy-paste support:
 * - Cross-platform clipboard access
 * - Copy code blocks
 * - Paste handling
 * - Clipboard history
 */

import { exec, execSync } from 'child_process';
import * as os from 'os';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ClipboardEntry {
  content: string;
  timestamp: Date;
  type: 'text' | 'code' | 'path' | 'url';
  metadata?: {
    language?: string;
    source?: string;
  };
}

export interface ClipboardConfig {
  /** Maximum history entries */
  maxHistory: number;
  /** Enable clipboard history */
  historyEnabled: boolean;
  /** Auto-detect content type */
  autoDetectType: boolean;
}

const DEFAULT_CONFIG: ClipboardConfig = {
  maxHistory: 50,
  historyEnabled: true,
  autoDetectType: true,
};

/**
 * Clipboard Manager
 */
export class ClipboardManager {
  private config: ClipboardConfig;
  private history: ClipboardEntry[] = [];
  private historyPath: string;
  private platform: NodeJS.Platform;

  constructor(config?: Partial<ClipboardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.historyPath = path.join(os.homedir(), '.codebuddy', 'clipboard-history.json');
    this.platform = os.platform();

    if (this.config.historyEnabled) {
      this.loadHistory();
    }
  }

  /**
   * Copy text to clipboard
   */
  async copy(text: string, metadata?: ClipboardEntry['metadata']): Promise<boolean> {
    try {
      await this.writeToClipboard(text);

      // Add to history
      if (this.config.historyEnabled) {
        const entry: ClipboardEntry = {
          content: text,
          timestamp: new Date(),
          type: this.config.autoDetectType ? this.detectType(text) : 'text',
          metadata,
        };

        this.addToHistory(entry);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Copy code block to clipboard
   */
  async copyCode(code: string, language?: string): Promise<boolean> {
    return this.copy(code, { language, source: 'code-block' });
  }

  /**
   * Copy file path to clipboard
   */
  async copyPath(filePath: string): Promise<boolean> {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(filePath);

    return this.copy(absolutePath, { source: 'file-path' });
  }

  /**
   * Paste from clipboard
   */
  async paste(): Promise<string | null> {
    try {
      const content = await this.readFromClipboard();
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Get clipboard content with type detection
   */
  async pasteWithType(): Promise<ClipboardEntry | null> {
    try {
      const content = await this.readFromClipboard();
      if (!content) return null;

      return {
        content,
        timestamp: new Date(),
        type: this.detectType(content),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get clipboard history
   */
  getHistory(): ClipboardEntry[] {
    return [...this.history];
  }

  /**
   * Get recent history
   */
  getRecentHistory(count: number = 10): ClipboardEntry[] {
    return this.history.slice(-count).reverse();
  }

  /**
   * Search history
   */
  searchHistory(query: string): ClipboardEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.history.filter(entry =>
      entry.content.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get history by type
   */
  getHistoryByType(type: ClipboardEntry['type']): ClipboardEntry[] {
    return this.history.filter(entry => entry.type === type);
  }

  /**
   * Copy from history
   */
  async copyFromHistory(index: number): Promise<boolean> {
    const recentHistory = this.getRecentHistory(this.config.maxHistory);
    if (index < 0 || index >= recentHistory.length) {
      return false;
    }

    const entry = recentHistory[index];
    return this.writeToClipboard(entry.content);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
    this.saveHistory();
  }

  /**
   * Remove from history
   */
  removeFromHistory(index: number): boolean {
    const recentHistory = this.getRecentHistory(this.config.maxHistory);
    if (index < 0 || index >= recentHistory.length) {
      return false;
    }

    const entryToRemove = recentHistory[index];
    const idx = this.history.findIndex(e =>
      e.content === entryToRemove.content &&
      e.timestamp.getTime() === entryToRemove.timestamp.getTime()
    );

    if (idx >= 0) {
      this.history.splice(idx, 1);
      this.saveHistory();
      return true;
    }

    return false;
  }

  /**
   * Check if clipboard is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.readFromClipboard();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format history for display
   */
  formatHistory(): string {
    const recent = this.getRecentHistory(10);

    if (recent.length === 0) {
      return 'Clipboard history is empty.';
    }

    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════════════',
      '              CLIPBOARD HISTORY',
      '═══════════════════════════════════════════════════════════',
      '',
    ];

    for (let i = 0; i < recent.length; i++) {
      const entry = recent[i];
      const time = entry.timestamp.toLocaleTimeString();
      const type = entry.type.toUpperCase().padEnd(4);
      const preview = entry.content.length > 50
        ? entry.content.slice(0, 47).replace(/\n/g, '↵') + '...'
        : entry.content.replace(/\n/g, '↵');

      lines.push(`  ${(i + 1).toString().padStart(2)}. [${type}] ${preview}`);
      lines.push(`      ${time}${entry.metadata?.language ? ` (${entry.metadata.language})` : ''}`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Write to system clipboard
   */
  private async writeToClipboard(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let command: string;
      let input = text;

      switch (this.platform) {
        case 'darwin':
          command = 'pbcopy';
          break;
        case 'win32':
          command = 'clip';
          break;
        default: // Linux
          // Try xclip first, then xsel
          command = 'xclip -selection clipboard 2>/dev/null || xsel --clipboard --input 2>/dev/null';
          break;
      }

      const child = exec(command, (error) => {
        if (error) reject(error);
        else resolve(true);
      });

      if (child.stdin) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  /**
   * Read from system clipboard
   */
  private async readFromClipboard(): Promise<string> {
    return new Promise((resolve, reject) => {
      let command: string;

      switch (this.platform) {
        case 'darwin':
          command = 'pbpaste';
          break;
        case 'win32':
          command = 'powershell -command "Get-Clipboard"';
          break;
        default: // Linux
          command = 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null';
          break;
      }

      exec(command, { encoding: 'utf-8' }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  /**
   * Detect content type
   */
  private detectType(content: string): ClipboardEntry['type'] {
    const trimmed = content.trim();

    // URL detection
    if (/^https?:\/\/[^\s]+$/.test(trimmed)) {
      return 'url';
    }

    // Path detection (Unix or Windows paths)
    if (/^(\/[^\s]+|[A-Za-z]:\\[^\s]+)$/.test(trimmed)) {
      return 'path';
    }

    // Code detection heuristics
    const codeIndicators = [
      /^(import|export|const|let|var|function|class|interface|type)\s/m,
      /^(def|class|import|from|if|for|while)\s/m,
      /^(package|import|public|private|class)\s/m,
      /\{[\s\S]*\}/,
      /=>|->|\|\||&&/,
      /;\s*$/m,
      /^\s*(\/\/|#|\/\*)/m,
    ];

    const isCode = codeIndicators.some(pattern => pattern.test(content));
    if (isCode) {
      return 'code';
    }

    return 'text';
  }

  /**
   * Add entry to history
   */
  private addToHistory(entry: ClipboardEntry): void {
    // Don't add duplicates of the last entry
    if (this.history.length > 0) {
      const last = this.history[this.history.length - 1];
      if (last.content === entry.content) {
        return;
      }
    }

    this.history.push(entry);

    // Trim history
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }

    this.saveHistory();
  }

  /**
   * Load history from file
   */
  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const data = fs.readJsonSync(this.historyPath);
        if (Array.isArray(data)) {
          this.history = data.map(e => ({
            ...e,
            timestamp: new Date(e.timestamp),
          }));
        }
      }
    } catch {
      this.history = [];
    }
  }

  /**
   * Save history to file
   */
  private saveHistory(): void {
    try {
      fs.ensureDirSync(path.dirname(this.historyPath));
      fs.writeJsonSync(this.historyPath, this.history, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let clipboardManager: ClipboardManager | null = null;

/**
 * Get or create clipboard manager
 */
export function getClipboardManager(): ClipboardManager {
  if (!clipboardManager) {
    clipboardManager = new ClipboardManager();
  }
  return clipboardManager;
}

/**
 * Quick copy helper
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return getClipboardManager().copy(text);
}

/**
 * Quick paste helper
 */
export async function pasteFromClipboard(): Promise<string | null> {
  return getClipboardManager().paste();
}

export default ClipboardManager;
