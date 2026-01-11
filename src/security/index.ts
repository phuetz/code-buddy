/**
 * Security Module
 *
 * Unified security layer for Grok CLI:
 * - Approval modes (read-only, auto, full-access)
 * - Sandbox execution for commands
 * - Data redaction for sensitive information
 * - Permission configuration
 * - Command validation and sanitization
 */

// Export specific items from approval-modes to avoid conflicts
export {
  ApprovalModeManager,
  getApprovalModeManager,
  resetApprovalModeManager
} from './approval-modes.js';

export type {
  ApprovalMode,
  OperationType,
  OperationRequest,
  ApprovalResult,
  ApprovalModeConfig
} from './approval-modes.js';

export * from './sandbox.js';

// Credential management
export {
  CredentialManager,
  getCredentialManager,
  getApiKey,
  setApiKey
} from './credential-manager.js';

export type {
  CredentialConfig,
  StoredCredentials
} from './credential-manager.js';

// Export security-modes with renamed ApprovalResult to avoid conflict
export { getSecurityModeManager, SecurityModeManager } from './security-modes.js';
export type { SecurityMode } from './security-modes.js';

export * from './permission-config.js';
export * from './data-redaction.js';

import { EventEmitter } from 'events';
import { getApprovalModeManager, ApprovalMode, ApprovalResult, OperationRequest } from './approval-modes.js';
import { getSandboxManager, SandboxResult } from './sandbox.js';
import { getSecurityModeManager, SecurityMode } from './security-modes.js';
import { RedactionResult, getDataRedactionEngine } from './data-redaction.js';

// ============================================================================
// Types
// ============================================================================

export interface SecurityConfig {
  /** Enable security features */
  enabled: boolean;
  /** Approval mode */
  approvalMode: ApprovalMode;
  /** Security mode */
  securityMode: SecurityMode;
  /** Enable sandbox */
  sandboxEnabled: boolean;
  /** Enable redaction */
  redactionEnabled: boolean;
  /** Log security events */
  logEvents: boolean;
}

export interface SecurityEvent {
  timestamp: number;
  type: 'approval' | 'sandbox' | 'redaction' | 'validation' | 'blocked';
  action: string;
  result: 'allowed' | 'blocked' | 'confirmed' | 'redacted';
  details?: Record<string, unknown>;
}

export interface SecurityStats {
  totalOperations: number;
  autoApproved: number;
  userConfirmed: number;
  blocked: number;
  redacted: number;
  sandboxed: number;
}

export interface SecuritySummary {
  config: SecurityConfig;
  stats: SecurityStats;
  recentEvents: SecurityEvent[];
  approvalModeStatus: string;
  securityModeStatus: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SecurityConfig = {
  enabled: true,
  approvalMode: 'auto',
  securityMode: 'suggest',
  sandboxEnabled: true,
  redactionEnabled: true,
  logEvents: true,
};

// ============================================================================
// Security Manager Class
// ============================================================================

export class SecurityManager extends EventEmitter {
  private config: SecurityConfig;
  private events: SecurityEvent[] = [];
  private stats: SecurityStats;
  private maxEvents: number = 100;

  constructor(config: Partial<SecurityConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalOperations: 0,
      autoApproved: 0,
      userConfirmed: 0,
      blocked: 0,
      redacted: 0,
      sandboxed: 0,
    };
  }

  /**
   * Initialize security systems
   */
  initialize(): void {
    const approvalManager = getApprovalModeManager();
    approvalManager.setMode(this.config.approvalMode);

    const securityManager = getSecurityModeManager();
    securityManager.setMode(this.config.securityMode);

    this.emit('initialized');
  }

  /**
   * Check if an operation should be approved
   */
  checkApproval(request: OperationRequest): ApprovalResult {
    if (!this.config.enabled) {
      return { approved: true, requiresConfirmation: false, autoApproved: true };
    }

    const approvalManager = getApprovalModeManager();
    const result = approvalManager.checkApproval(request);

    this.stats.totalOperations++;

    if (result.autoApproved) {
      this.stats.autoApproved++;
      this.recordEvent('approval', request.tool, 'allowed', { auto: true });
    } else if (result.approved) {
      this.stats.userConfirmed++;
      this.recordEvent('approval', request.tool, 'confirmed');
    } else if (!result.approved) {
      this.stats.blocked++;
      this.recordEvent('approval', request.tool, 'blocked', { reason: result.reason });
    }

    return result;
  }

  /**
   * Execute command in sandbox
   */
  async sandboxExecute(command: string): Promise<SandboxResult> {
    if (!this.config.sandboxEnabled) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        sandboxed: false,
      };
    }

    const sandboxManager = getSandboxManager();
    const result = await sandboxManager.execute(command);

    if (result.sandboxed) {
      this.stats.sandboxed++;
      this.recordEvent('sandbox', 'execute', 'allowed', { command });
    }

    return result;
  }

  /**
   * Redact sensitive data
   */
  redact(text: string): RedactionResult {
    if (!this.config.redactionEnabled) {
      return {
        original: text,
        redacted: text,
        redactions: [],
        stats: {
          totalRedactions: 0,
          byCategory: {} as Record<string, number>,
          bySeverity: {} as Record<string, number>,
        },
      };
    }

    const engine = getDataRedactionEngine();
    const result = engine.redact(text);

    if (result.redactions.length > 0) {
      this.stats.redacted++;
      this.recordEvent('redaction', 'auto', 'redacted', {
        count: result.redactions.length,
      });
    }

    return result;
  }

  /**
   * Validate a command for dangerous patterns
   */
  validateCommand(command: string): { safe: boolean; warnings: string[] } {
    const dangerousPatterns = [
      { pattern: /rm\s+(-rf?|--recursive)\s+\/(?!\s|$)/i, warning: 'Destructive rm on root' },
      { pattern: /dd\s+if=.*of=\/dev\//i, warning: 'Direct device write with dd' },
      { pattern: /mkfs\s+/i, warning: 'Filesystem format command' },
      { pattern: /chmod\s+(-R\s+)?777\s+\//i, warning: 'Dangerous chmod on root' },
      { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/i, warning: 'Fork bomb detected' },
      { pattern: />\s*\/dev\/sd[a-z]/i, warning: 'Direct write to disk device' },
      { pattern: /curl.*\|\s*(bash|sh)/i, warning: 'Piping curl to shell' },
      { pattern: /wget.*\|\s*(bash|sh)/i, warning: 'Piping wget to shell' },
      { pattern: /eval\s+\$\(/i, warning: 'Dangerous eval usage' },
    ];

    const warnings: string[] = [];

    for (const { pattern, warning } of dangerousPatterns) {
      if (pattern.test(command)) {
        warnings.push(warning);
      }
    }

    const safe = warnings.length === 0;

    if (!safe) {
      this.recordEvent('validation', command.substring(0, 50), 'blocked', { warnings });
    }

    return { safe, warnings };
  }

  /**
   * Get security summary
   */
  getSummary(): SecuritySummary {
    const approvalManager = getApprovalModeManager();
    const _securityManager = getSecurityModeManager(); // For future security mode info

    return {
      config: { ...this.config },
      stats: { ...this.stats },
      recentEvents: this.events.slice(-10),
      approvalModeStatus: `${this.config.approvalMode} (${approvalManager.getModeConfig().description})`,
      securityModeStatus: `${this.config.securityMode}`,
    };
  }

  /**
   * Get statistics
   */
  getStats(): SecurityStats {
    return { ...this.stats };
  }

  /**
   * Get recent events
   */
  getEvents(limit?: number): SecurityEvent[] {
    return limit ? this.events.slice(-limit) : [...this.events];
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalOperations: 0,
      autoApproved: 0,
      userConfirmed: 0,
      blocked: 0,
      redacted: 0,
      sandboxed: 0,
    };
    this.events = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.approvalMode) {
      const approvalManager = getApprovalModeManager();
      approvalManager.setMode(config.approvalMode);
    }

    if (config.securityMode) {
      const securityManager = getSecurityModeManager();
      securityManager.setMode(config.securityMode);
    }

    this.emit('config:updated', this.config);
  }

  /**
   * Format security dashboard
   */
  formatDashboard(): string {
    const summary = this.getSummary();
    const { stats, config } = summary;

    const lines: string[] = [
      '🛡️ Security Dashboard',
      '',
      `Mode: ${config.approvalMode.toUpperCase()}`,
      `Security: ${config.securityMode.toUpperCase()}`,
      '',
      '📊 Statistics',
      `  Total Operations: ${stats.totalOperations}`,
      `  Auto-Approved: ${stats.autoApproved}`,
      `  User Confirmed: ${stats.userConfirmed}`,
      `  Blocked: ${stats.blocked}`,
      `  Redacted: ${stats.redacted}`,
      `  Sandboxed: ${stats.sandboxed}`,
      '',
      '⚙️ Features',
      `  Sandbox: ${config.sandboxEnabled ? '✓ Enabled' : '✗ Disabled'}`,
      `  Redaction: ${config.redactionEnabled ? '✓ Enabled' : '✗ Disabled'}`,
      `  Logging: ${config.logEvents ? '✓ Enabled' : '✗ Disabled'}`,
    ];

    if (summary.recentEvents.length > 0) {
      lines.push('', '📜 Recent Events');
      for (const event of summary.recentEvents.slice(-5)) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        lines.push(`  [${time}] ${event.type}: ${event.action} → ${event.result}`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private recordEvent(
    type: SecurityEvent['type'],
    action: string,
    result: SecurityEvent['result'],
    details?: Record<string, unknown>
  ): void {
    if (!this.config.logEvents) return;

    const event: SecurityEvent = {
      timestamp: Date.now(),
      type,
      action,
      result,
      details,
    };

    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    this.emit('event', event);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let managerInstance: SecurityManager | null = null;

export function getSecurityManager(config?: Partial<SecurityConfig>): SecurityManager {
  if (!managerInstance) {
    managerInstance = new SecurityManager(config);
  }
  return managerInstance;
}

export function initializeSecurityManager(config?: Partial<SecurityConfig>): SecurityManager {
  const manager = getSecurityManager(config);
  manager.initialize();
  return manager;
}

export function resetSecurityManager(): void {
  if (managerInstance) {
    managerInstance.removeAllListeners();
  }
  managerInstance = null;
}
