/**
 * Inline Completion Provider
 *
 * Provides AI-powered code completions inline in the editor.
 */

import * as vscode from 'vscode';
import { GrokClient } from '../grok-client';

export class GrokCompletionProvider implements vscode.InlineCompletionItemProvider {
  private lastRequest: AbortController | null = null;
  private cache: Map<string, string> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs = 300;

  constructor(private readonly grokClient: GrokClient) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
    // Cancel previous request
    if (this.lastRequest) {
      this.lastRequest.abort();
    }
    this.lastRequest = new AbortController();

    // Get context around cursor
    const prefix = this.getPrefix(document, position);
    const suffix = this.getSuffix(document, position);
    const language = document.languageId;

    // Skip if minimal context
    if (prefix.trim().length < 3) {
      return null;
    }

    // Check cache
    const cacheKey = `${prefix.slice(-100)}|${suffix.slice(0, 50)}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return [new vscode.InlineCompletionItem(cached, new vscode.Range(position, position))];
    }

    // Debounce
    await this.debounce();

    if (token.isCancellationRequested) {
      return null;
    }

    try {
      const completion = await this.grokClient.getCompletion(prefix, suffix, language);

      if (token.isCancellationRequested || !completion) {
        return null;
      }

      // Cache result
      this.cache.set(cacheKey, completion);

      // Clear old cache entries
      if (this.cache.size > 100) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) {
          this.cache.delete(firstKey);
        }
      }

      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
    } catch (error) {
      console.error('Grok completion error:', error);
      return null;
    }
  }

  /**
   * Get text before cursor
   */
  private getPrefix(document: vscode.TextDocument, position: vscode.Position): string {
    const startLine = Math.max(0, position.line - 50);
    const range = new vscode.Range(startLine, 0, position.line, position.character);
    return document.getText(range);
  }

  /**
   * Get text after cursor
   */
  private getSuffix(document: vscode.TextDocument, position: vscode.Position): string {
    const endLine = Math.min(document.lineCount - 1, position.line + 20);
    const range = new vscode.Range(position.line, position.character, endLine, 1000);
    return document.getText(range);
  }

  /**
   * Debounce requests
   */
  private debounce(): Promise<void> {
    return new Promise(resolve => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(resolve, this.debounceMs);
    });
  }
}
