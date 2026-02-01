/**
 * Approval Flow
 *
 * Manages the approval workflow for bash commands:
 * 1. Check against stored patterns
 * 2. Prompt user if no match
 * 3. Optionally save approval as pattern
 *
 * Integrates with ConfirmationService for UI interaction.
 */

import { EventEmitter } from 'events';
import type {
  ApprovalPattern,
  ApprovalPromptOptions,
  ApprovalPromptResult,
  AllowlistCheckResult,
} from './types.js';
import { getAllowlistStore, AllowlistStore } from './allowlist-store.js';
import { suggestPattern } from './pattern-matcher.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';

// ============================================================================
// Approval Flow Manager
// ============================================================================

/**
 * Manages the approval flow for bash commands
 */
export class ApprovalFlowManager extends EventEmitter {
  private store: AllowlistStore;
  private confirmationService: ConfirmationService;
  private initialized: boolean = false;

  constructor(
    store?: AllowlistStore,
    confirmationService?: ConfirmationService
  ) {
    super();
    this.store = store || getAllowlistStore();
    this.confirmationService = confirmationService || ConfirmationService.getInstance();
  }

  /**
   * Initialize the approval flow
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.store.isInitialized()) {
      await this.store.initialize();
    }

    this.initialized = true;
  }

  /**
   * Check a command and get approval
   * @param command Command to check
   * @param options Prompt options
   * @returns Whether the command is approved
   */
  async checkAndApprove(
    command: string,
    options?: Partial<ApprovalPromptOptions>
  ): Promise<{ approved: boolean; reason: string; pattern?: ApprovalPattern }> {
    await this.initialize();

    // First check stored patterns
    const checkResult = this.store.checkCommand(command);

    if (checkResult.matched) {
      const approved = checkResult.decision === 'allow';
      this.emit(approved ? 'check:allowed' : 'check:denied', {
        command,
        pattern: checkResult.pattern,
      });

      return {
        approved,
        reason: checkResult.pattern?.description ||
          (approved ? 'Allowed by pattern' : 'Denied by pattern'),
        pattern: checkResult.pattern,
      };
    }

    // No pattern match - need to prompt
    if (checkResult.decision === 'prompt') {
      const promptResult = await this.promptUser(command, options);

      if (promptResult.timedOut) {
        return {
          approved: false,
          reason: 'Approval timed out',
        };
      }

      const approved = promptResult.decision === 'allow-once' ||
        promptResult.decision === 'allow-always';

      // Save pattern if "always" was selected
      let savedPattern: ApprovalPattern | undefined;
      if (promptResult.decision === 'allow-always' || promptResult.decision === 'deny-always') {
        savedPattern = this.store.recordApproval(
          command,
          promptResult.decision.includes('allow') ? 'allow' : 'deny',
          {
            pattern: promptResult.pattern,
            patternType: promptResult.patternType,
            description: promptResult.description,
          }
        );
      }

      return {
        approved,
        reason: approved ? 'User approved' : 'User denied',
        pattern: savedPattern,
      };
    }

    // Fallback is deny (shouldn't happen normally)
    return {
      approved: false,
      reason: 'No pattern and no prompt allowed',
    };
  }

  /**
   * Quick check without prompting
   * @param command Command to check
   * @returns Check result
   */
  quickCheck(command: string): AllowlistCheckResult {
    if (!this.store.isInitialized()) {
      // Store not initialized - return prompt
      return {
        matched: false,
        decision: 'prompt',
        reason: 'Allowlist not initialized',
      };
    }

    const result = this.store.checkCommand(command);

    return {
      matched: result.matched,
      pattern: result.pattern,
      decision: result.decision,
      reason: result.pattern?.description || 'No matching pattern',
    };
  }

  /**
   * Prompt the user for approval
   */
  private async promptUser(
    command: string,
    options?: Partial<ApprovalPromptOptions>
  ): Promise<ApprovalPromptResult> {
    const config = this.store.getConfig();

    // Generate suggested pattern
    const suggestion = suggestPattern(command);

    // Use confirmation service to show prompt
    // Note: This is a simplified integration. In a real implementation,
    // you would extend the confirmation service UI to show pattern options.

    const promptOptions: ApprovalPromptOptions = {
      command,
      cwd: process.cwd(),
      timeout: options?.timeout || config.defaults.timeout,
      showAlwaysAllow: options?.showAlwaysAllow ?? config.defaults.showAlwaysAllow,
      showAlwaysDeny: options?.showAlwaysDeny ?? config.defaults.showAlwaysDeny,
    };

    this.emit('check:prompted', { command });

    // Request confirmation through the existing service
    const result = await this.confirmationService.requestConfirmation(
      {
        operation: 'Execute bash command',
        filename: command,
        showVSCodeOpen: false,
        content: this.formatPromptContent(command, suggestion),
      },
      'bash'
    );

    // Map confirmation result to approval result
    if (!result.confirmed) {
      return {
        decision: 'deny-once',
        timedOut: false,
      };
    }

    // If "don't ask again" was selected, treat as "always allow"
    if (result.dontAskAgain) {
      return {
        decision: 'allow-always',
        pattern: suggestion.pattern,
        patternType: suggestion.type,
        description: `Allowed: ${command}`,
      };
    }

    return {
      decision: 'allow-once',
    };
  }

  /**
   * Format content for the approval prompt
   */
  private formatPromptContent(
    command: string,
    suggestion: { pattern: string; type: string }
  ): string {
    return [
      `Command: ${command}`,
      `Working directory: ${process.cwd()}`,
      '',
      `Suggested pattern: ${suggestion.pattern}`,
      `Pattern type: ${suggestion.type}`,
      '',
      'Select "Don\'t ask again" to always allow similar commands.',
    ].join('\n');
  }

  // ============================================================================
  // Pattern Management (delegate to store)
  // ============================================================================

  /**
   * Add a pattern
   */
  addPattern(
    ...args: Parameters<AllowlistStore['addPattern']>
  ): ReturnType<AllowlistStore['addPattern']> {
    return this.store.addPattern(...args);
  }

  /**
   * Remove a pattern
   */
  removePattern(id: string): boolean {
    return this.store.removePattern(id);
  }

  /**
   * Get all patterns
   */
  getAllPatterns(): ApprovalPattern[] {
    return this.store.getAllPatterns();
  }

  /**
   * Get store instance
   */
  getStore(): AllowlistStore {
    return this.store;
  }

  // ============================================================================
  // Statistics and Info
  // ============================================================================

  /**
   * Get statistics
   */
  getStats() {
    return this.store.getStats();
  }

  /**
   * Format status for display
   */
  formatStatus(): string {
    const stats = this.store.getStats();
    const patterns = this.store.getAllPatterns();
    const enabledPatterns = patterns.filter(p => p.enabled);
    const allowPatterns = enabledPatterns.filter(p => p.decision === 'allow');
    const denyPatterns = enabledPatterns.filter(p => p.decision === 'deny');

    return [
      '📋 Bash Allowlist Status',
      '═'.repeat(50),
      '',
      '📊 Statistics',
      `  Total checks: ${stats.totalChecks}`,
      `  Allowed: ${stats.allowed}`,
      `  Denied: ${stats.denied}`,
      `  Prompted: ${stats.prompted}`,
      '',
      '📝 Patterns',
      `  Total: ${patterns.length}`,
      `  Enabled: ${enabledPatterns.length}`,
      `  Allow patterns: ${allowPatterns.length}`,
      `  Deny patterns: ${denyPatterns.length}`,
      '',
      '🔧 Commands',
      '  /allowlist list - List all patterns',
      '  /allowlist add <pattern> - Add allow pattern',
      '  /allowlist deny <pattern> - Add deny pattern',
      '  /allowlist remove <id> - Remove pattern',
    ].join('\n');
  }

  /**
   * List patterns formatted for display
   */
  formatPatternList(options?: {
    decision?: 'allow' | 'deny';
    enabled?: boolean;
  }): string {
    let patterns = this.store.getAllPatterns();

    if (options?.decision) {
      patterns = patterns.filter(p => p.decision === options.decision);
    }

    if (options?.enabled !== undefined) {
      patterns = patterns.filter(p => p.enabled === options.enabled);
    }

    if (patterns.length === 0) {
      return 'No patterns found.';
    }

    const lines: string[] = [];
    const bySource = new Map<string, ApprovalPattern[]>();

    // Group by source
    for (const p of patterns) {
      const source = p.source || 'unknown';
      if (!bySource.has(source)) {
        bySource.set(source, []);
      }
      bySource.get(source)!.push(p);
    }

    for (const [source, sourcePatterns] of bySource) {
      lines.push(`\n📁 ${source.toUpperCase()} PATTERNS`);
      lines.push('─'.repeat(40));

      for (const p of sourcePatterns) {
        const status = p.enabled ? '✓' : '✗';
        const decision = p.decision === 'allow' ? '✅' : '❌';
        lines.push(`${status} ${decision} [${p.type}] ${p.pattern}`);
        if (p.description) {
          lines.push(`     ${p.description}`);
        }
        lines.push(`     Used: ${p.useCount} times | ID: ${p.id.slice(0, 8)}`);
      }
    }

    return lines.join('\n');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let flowManagerInstance: ApprovalFlowManager | null = null;

/**
 * Get or create the ApprovalFlowManager singleton
 */
export function getApprovalFlowManager(): ApprovalFlowManager {
  if (!flowManagerInstance) {
    flowManagerInstance = new ApprovalFlowManager();
  }
  return flowManagerInstance;
}

/**
 * Reset the ApprovalFlowManager singleton
 */
export function resetApprovalFlowManager(): void {
  if (flowManagerInstance) {
    flowManagerInstance.removeAllListeners();
  }
  flowManagerInstance = null;
}
