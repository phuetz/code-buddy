/**
 * Audit Logger for Code Generation Operations
 *
 * Traces all validation decisions, tool executions, and security events
 * for code generation operations. Provides a persistent audit trail
 * that can be reviewed for compliance and debugging.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export type AuditAction =
  | 'code_validation'
  | 'command_validation'
  | 'file_write'
  | 'file_edit'
  | 'file_delete'
  | 'patch_apply'
  | 'bash_execute'
  | 'confirmation_requested'
  | 'confirmation_granted'
  | 'confirmation_denied'
  | 'checkpoint_created'
  | 'checkpoint_restored'
  | 'sandbox_execute'
  | 'pattern_matched'
  | 'tool_execution';

export type AuditDecision = 'allow' | 'block' | 'warn' | 'confirm';

export interface AuditEntry {
  /** Unique entry ID */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Action performed */
  action: AuditAction;
  /** Decision made */
  decision: AuditDecision;
  /** Tool or subsystem that produced this entry */
  source: string;
  /** Target file or command */
  target?: string;
  /** Details about findings or validation results */
  details?: string;
  /** Associated findings count (for validators) */
  findingsCount?: number;
  /** Session ID for correlation */
  sessionId?: string;
  /** Duration in ms */
  durationMs?: number;
}

class AuditLoggerImpl {
  private entries: AuditEntry[] = [];
  private logFile: string | null = null;
  private maxEntries: number = 10000;
  private sessionId: string = '';
  private enabled: boolean = true;

  /**
   * Initialize the audit logger with a log file path.
   */
  init(options: {
    logDir?: string;
    maxEntries?: number;
    sessionId?: string;
    enabled?: boolean;
  } = {}): void {
    if (options.logDir) {
      try {
        if (!fs.existsSync(options.logDir)) {
          fs.mkdirSync(options.logDir, { recursive: true });
        }
        const date = new Date().toISOString().slice(0, 10);
        this.logFile = path.join(options.logDir, `audit-${date}.jsonl`);
      } catch (error) {
        logger.debug('Failed to initialize audit log file', { error });
      }
    }
    if (options.maxEntries) this.maxEntries = options.maxEntries;
    if (options.sessionId) this.sessionId = options.sessionId;
    if (options.enabled !== undefined) this.enabled = options.enabled;
  }

  /**
   * Log an audit entry.
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'sessionId'>): void {
    if (!this.enabled) return;

    const full: AuditEntry = {
      ...entry,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    };

    // In-memory buffer
    this.entries.push(full);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-Math.floor(this.maxEntries * 0.8));
    }

    // Append to file
    if (this.logFile) {
      try {
        fs.appendFileSync(this.logFile, JSON.stringify(full) + '\n');
      } catch {
        // Silently fail file writes — don't block operations
      }
    }

    // Also emit to structured logger
    logger.debug('audit', {
      action: full.action,
      decision: full.decision,
      source: full.source,
      target: full.target,
    });
  }

  /**
   * Log a code validation result.
   */
  logCodeValidation(params: {
    target: string;
    safe: boolean;
    findingsCount: number;
    details?: string;
    durationMs?: number;
  }): void {
    this.log({
      action: 'code_validation',
      decision: params.safe ? 'allow' : 'warn',
      source: 'code-validator',
      target: params.target,
      details: params.details,
      findingsCount: params.findingsCount,
      durationMs: params.durationMs,
    });
  }

  /**
   * Log a command validation result.
   */
  logCommandValidation(params: {
    command: string;
    valid: boolean;
    reason?: string;
    source?: string;
  }): void {
    this.log({
      action: 'command_validation',
      decision: params.valid ? 'allow' : 'block',
      source: params.source || 'command-validator',
      target: params.command.slice(0, 200),
      details: params.reason,
    });
  }

  /**
   * Log a file operation.
   */
  logFileOperation(params: {
    action: 'file_write' | 'file_edit' | 'file_delete' | 'patch_apply';
    target: string;
    decision: AuditDecision;
    source: string;
    details?: string;
  }): void {
    this.log(params);
  }

  /**
   * Log a confirmation event.
   */
  logConfirmation(params: {
    operation: string;
    target: string;
    granted: boolean;
  }): void {
    this.log({
      action: params.granted ? 'confirmation_granted' : 'confirmation_denied',
      decision: params.granted ? 'allow' : 'block',
      source: 'confirmation-service',
      target: params.target,
      details: params.operation,
    });
  }

  /**
   * Log a pattern match.
   */
  logPatternMatch(params: {
    patternName: string;
    severity: string;
    target: string;
    source: string;
  }): void {
    this.log({
      action: 'pattern_matched',
      decision: 'warn',
      source: params.source,
      target: params.target,
      details: `${params.severity}: ${params.patternName}`,
    });
  }

  /**
   * Get recent audit entries.
   */
  getEntries(limit: number = 100): AuditEntry[] {
    return this.entries.slice(-limit);
  }

  /**
   * Get entries filtered by action type.
   */
  getEntriesByAction(action: AuditAction, limit: number = 50): AuditEntry[] {
    return this.entries.filter(e => e.action === action).slice(-limit);
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    total: number;
    byAction: Record<string, number>;
    byDecision: Record<string, number>;
    blocked: number;
    warnings: number;
  } {
    const byAction: Record<string, number> = {};
    const byDecision: Record<string, number> = {};
    let blocked = 0;
    let warnings = 0;

    for (const entry of this.entries) {
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      byDecision[entry.decision] = (byDecision[entry.decision] || 0) + 1;
      if (entry.decision === 'block') blocked++;
      if (entry.decision === 'warn') warnings++;
    }

    return {
      total: this.entries.length,
      byAction,
      byDecision,
      blocked,
      warnings,
    };
  }

  /**
   * Format summary as human-readable text.
   */
  formatSummary(): string {
    const s = this.getSummary();
    const lines = [
      `Audit Log Summary: ${s.total} entries`,
      `  Blocked: ${s.blocked} | Warnings: ${s.warnings}`,
      '',
      'By action:',
    ];
    for (const [action, count] of Object.entries(s.byAction)) {
      lines.push(`  ${action}: ${count}`);
    }
    return lines.join('\n');
  }

  /**
   * Clear in-memory entries.
   */
  clear(): void {
    this.entries = [];
  }

  private generateId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Singleton audit logger instance */
export const auditLogger = new AuditLoggerImpl();
