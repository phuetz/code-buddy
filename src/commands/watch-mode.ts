/**
 * Watch Mode - IDE Comment Triggers (Aider inspired)
 *
 * Watches files for special comments and triggers AI actions:
 * - AI! = Make changes to the code
 * - AI? = Answer a question about the code
 *
 * Example:
 * ```python
 * # AI! Add validation for email format
 * def create_user(email: str):
 *     pass
 * ```
 */

import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import { watch, type FSWatcher } from 'fs';

export interface AIComment {
  type: 'action' | 'question';
  content: string;
  filePath: string;
  lineNumber: number;
  context: string; // Surrounding code
}

export interface WatchConfig {
  /** Directories to watch */
  paths: string[];
  /** File patterns to include */
  include?: string[];
  /** File patterns to exclude */
  exclude?: string[];
  /** Debounce delay in ms */
  debounce?: number;
  /** Process existing comments on start */
  processExisting?: boolean;
}

/**
 * Comment patterns for different languages
 */
const COMMENT_PATTERNS = [
  // Hash comments (Python, Ruby, Shell, YAML)
  { regex: /#\s*AI!\s*(.+)$/gm, type: 'action' as const },
  { regex: /#\s*AI\?\s*(.+)$/gm, type: 'question' as const },

  // Double slash comments (JavaScript, TypeScript, C, C++, Java, Go, Rust)
  { regex: /\/\/\s*AI!\s*(.+)$/gm, type: 'action' as const },
  { regex: /\/\/\s*AI\?\s*(.+)$/gm, type: 'question' as const },

  // Double dash comments (SQL, Lua, Haskell)
  { regex: /--\s*AI!\s*(.+)$/gm, type: 'action' as const },
  { regex: /--\s*AI\?\s*(.+)$/gm, type: 'question' as const },

  // HTML/XML comments
  { regex: /<!--\s*AI!\s*(.+?)\s*-->/gm, type: 'action' as const },
  { regex: /<!--\s*AI\?\s*(.+?)\s*-->/gm, type: 'question' as const },
];

/**
 * Extract AI comments from file content
 */
export function extractAIComments(content: string, filePath: string): AIComment[] {
  const comments: AIComment[] = [];
  const lines = content.split('\n');

  for (const pattern of COMMENT_PATTERNS) {
    let match;
    pattern.regex.lastIndex = 0; // Reset regex state

    while ((match = pattern.regex.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;

      // Get surrounding context (5 lines before and after)
      const startLine = Math.max(0, lineNumber - 6);
      const endLine = Math.min(lines.length, lineNumber + 5);
      const context = lines.slice(startLine, endLine).join('\n');

      comments.push({
        type: pattern.type,
        content: match[1].trim(),
        filePath,
        lineNumber,
        context,
      });
    }
  }

  return comments;
}

/**
 * Remove processed AI comment from file
 */
export async function removeAIComment(
  filePath: string,
  lineNumber: number
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // Find and remove the comment
  const line = lines[lineNumber - 1];
  if (line) {
    // Remove AI! or AI? part, keep the rest of the line if any
    const cleanedLine = line
      .replace(/#\s*AI[!?]\s*.+$/, '')
      .replace(/\/\/\s*AI[!?]\s*.+$/, '')
      .replace(/--\s*AI[!?]\s*.+$/, '')
      .replace(/<!--\s*AI[!?].+?-->/, '');

    if (cleanedLine.trim()) {
      lines[lineNumber - 1] = cleanedLine;
    } else {
      lines.splice(lineNumber - 1, 1);
    }
  }

  await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Watch Mode Manager
 */
export class WatchModeManager extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private config: WatchConfig;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private processedComments: Set<string> = new Set();

  constructor(config: WatchConfig) {
    super();
    this.config = {
      debounce: 500,
      processExisting: false,
      ...config,
    };
  }

  /**
   * Start watching for AI comments
   */
  async start(): Promise<void> {
    const watchPaths = this.config.paths.length > 0
      ? this.config.paths
      : [process.cwd()];

    for (const watchPath of watchPaths) {
      try {
        const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
          if (eventType === 'change' && filename) {
            const filePath = path.join(watchPath, filename);
            // Filter out ignored patterns
            if (this.shouldWatch(filePath)) {
              this.handleFileChange(filePath);
            }
          }
        });
        this.watchers.push(watcher);
      } catch (error) {
        this.emit('error', { path: watchPath, error });
      }
    }

    this.emit('started', { paths: watchPaths });
  }

  /**
   * Check if file should be watched
   */
  private shouldWatch(filePath: string): boolean {
    const ignored = [
      'node_modules', '.git', 'dist', 'build', '.min.'
    ];
    return !ignored.some(pattern => filePath.includes(pattern));
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.emit('stopped');
  }

  /**
   * Handle file change
   */
  private handleFileChange(filePath: string): void {
    // Debounce changes
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);
      await this.processFile(filePath);
    }, this.config.debounce);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process file for AI comments
   */
  private async processFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const comments = extractAIComments(content, filePath);

      for (const comment of comments) {
        // Create unique key for this comment
        const key = `${comment.filePath}:${comment.lineNumber}:${comment.content}`;

        // Skip if already processed
        if (this.processedComments.has(key)) {
          continue;
        }

        this.processedComments.add(key);
        this.emit('comment', comment);
      }
    } catch (error) {
      this.emit('error', { filePath, error });
    }
  }

  /**
   * Mark comment as processed and optionally remove it
   */
  async completeComment(comment: AIComment, removeComment: boolean = true): Promise<void> {
    if (removeComment) {
      await removeAIComment(comment.filePath, comment.lineNumber);
    }
  }
}

/**
 * Format AI comment for display
 */
export function formatAIComment(comment: AIComment): string {
  const icon = comment.type === 'action' ? '!' : '?';
  const typeLabel = comment.type === 'action' ? 'ACTION' : 'QUESTION';

  return `AI${icon} ${typeLabel} at ${comment.filePath}:${comment.lineNumber}
${comment.content}

Context:
\`\`\`
${comment.context}
\`\`\``;
}

/**
 * Create watch mode with default config
 */
export function createWatchMode(paths: string[] = [process.cwd()]): WatchModeManager {
  return new WatchModeManager({ paths });
}
