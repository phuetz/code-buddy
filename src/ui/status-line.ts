/**
 * Custom Status Line
 *
 * Configurable status bar with template rendering, script execution,
 * auto-refresh, and model/git/token display.
 */

import { logger } from '../utils/logger.js';
import { execSync } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export interface StatusLineConfig {
  enabled: boolean;
  script?: string;
  template?: string;
  refreshInterval: number;
  position: 'top' | 'bottom';
}

export interface StatusLineData {
  model?: string;
  gitBranch?: string;
  tokenUsage?: { used: number; max: number };
  uncommittedChanges?: number;
  sessionId?: string;
  customContent?: string;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CONFIG: StatusLineConfig = {
  enabled: false,
  refreshInterval: 5000,
  position: 'bottom',
};

const DEFAULT_TEMPLATE = '{{model}} | {{gitBranch}} | Context: {{tokenUsage}} | Changes: {{uncommittedChanges}}';

// ============================================================================
// Status Line Manager
// ============================================================================

export class StatusLineManager {
  private config: StatusLineConfig;
  private currentData: StatusLineData = {};
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<StatusLineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update status data
   */
  updateData(data: Partial<StatusLineData>): void {
    this.currentData = { ...this.currentData, ...data };
  }

  /**
   * Render the status line
   */
  render(): string {
    if (!this.config.enabled) {
      return '';
    }

    // If there's custom content from a script, use it
    if (this.currentData.customContent) {
      return this.currentData.customContent;
    }

    const template = this.config.template || DEFAULT_TEMPLATE;
    return this.renderTemplate(template, this.currentData);
  }

  /**
   * Render template with placeholders
   */
  private renderTemplate(template: string, data: StatusLineData): string {
    let result = template;

    result = result.replace(/\{\{model\}\}/g, data.model || 'unknown');
    result = result.replace(/\{\{gitBranch\}\}/g, this.formatGitBranch(data.gitBranch || ''));
    result = result.replace(/\{\{tokenUsage\}\}/g, data.tokenUsage ? this.formatTokenUsage(data.tokenUsage) : '0/0');
    result = result.replace(/\{\{uncommittedChanges\}\}/g, String(data.uncommittedChanges ?? 0));
    result = result.replace(/\{\{sessionId\}\}/g, data.sessionId || '');

    return result;
  }

  /**
   * Execute script for dynamic content
   */
  async executeScript(): Promise<string> {
    if (!this.config.script) {
      return '';
    }

    try {
      const output = execSync(this.config.script, {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return output.trim();
    } catch (e) {
      logger.warn(`Status line script error: ${(e as Error).message}`);
      return '';
    }
  }

  /**
   * Start auto-refresh
   */
  startRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      // In a real implementation, this would trigger a re-render
      logger.debug('Status line refresh tick');
    }, this.config.refreshInterval);
  }

  /**
   * Stop auto-refresh
   */
  stopRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Check if auto-refreshing
   */
  isRefreshing(): boolean {
    return this.refreshTimer !== null;
  }

  /**
   * Format a token count with K/M abbreviation
   */
  private formatTokenCount(count: number): string {
    if (count >= 1_000_000) {
      const val = count / 1_000_000;
      return val % 1 === 0 ? `${val}M` : `${val.toFixed(1)}M`;
    }
    if (count >= 1_000) {
      const val = count / 1_000;
      return val % 1 === 0 ? `${val}K` : `${val.toFixed(1)}K`;
    }
    return String(count);
  }

  /**
   * Format token usage as percentage with abbreviated counts
   */
  private formatTokenUsage(usage: { used: number; max: number }): string {
    const pct = usage.max > 0 ? Math.round((usage.used / usage.max) * 100) : 0;
    const usedStr = this.formatTokenCount(usage.used);
    const maxStr = this.formatTokenCount(usage.max);
    return `${pct}% (${usedStr}/${maxStr})`;
  }

  /**
   * Format git branch
   */
  private formatGitBranch(branch: string): string {
    if (!branch) return 'no branch';
    return branch;
  }

  /**
   * Enable status line
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable status line
   */
  disable(): void {
    this.config.enabled = false;
    this.stopRefresh();
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current data
   */
  getData(): StatusLineData {
    return { ...this.currentData };
  }

  /**
   * Get config
   */
  getConfig(): StatusLineConfig {
    return { ...this.config };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stopRefresh();
    this.currentData = {};
  }
}
