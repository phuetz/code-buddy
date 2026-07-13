import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RemoteApprovalService } from '../security/remote-approval.js';
import { checkDeclarativePermission } from '../security/declarative-rules.js';
import { auditLogger } from '../security/audit-logger.js';
import { getPermissionModeManager } from '../security/permission-modes.js';
import { PolicyEngine, Capability } from '../security/policy-engine.js';
import { commandExists } from './command-exists.js';
import { logger } from './logger.js';

export interface ConfirmationOptions {
  operation: string;
  filename: string;
  /** Canonical tool identity for generic (non-file/non-shell) action gates. */
  toolName?: string;
  /** Original JSON arguments used by declarative rules for a generic tool. */
  toolArgs?: Record<string, unknown>;
  showVSCodeOpen?: boolean;
  content?: string; // Content to show in confirmation dialog
  /** Unified diff preview of changes (shown to user before approval) */
  diffPreview?: string;
  /** Number of lines changed (triggers enhanced confirmation if > threshold) */
  linesChanged?: number;
  /**
   * Require a fresh human decision even when the current permission mode,
   * environment or session flags would normally auto-approve. Deterministic
   * policy denials still win. Use for one-shot, externally visible effects.
   */
  forcePrompt?: boolean;
  /** Risk supplied by the action-policy evaluator (avoids untyped side channels). */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  /**
   * Exact session grant key (typically canonical argv + cwd + sandbox profile).
   * When present, "don't ask again" never widens to every Bash/file operation.
   */
  approvalKey?: string;
  /** Structured policy detail retained for compatibility with PolicyEngine. */
  detail?: Record<string, unknown>;
}

export interface ConfirmationResult {
  confirmed: boolean;
  dontAskAgain?: boolean;
  feedback?: string;
}

export type ConfirmationOperationType = 'file' | 'bash' | 'tool';

/**
 * Execute a command safely using spawn with separate arguments
 * This prevents command injection attacks
 */
function spawnAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
    });

    proc.on('error', (error) => {
      reject(error);
    });

    // Don't wait for VS Code to close
    proc.unref();

    // Give it a moment to start
    setTimeout(() => resolve(), 100);
  });
}

/**
 * Validate and sanitize a filename for safe use
 */
function sanitizeFilename(filename: string): string {
  // Resolve to absolute path to prevent path traversal
  const resolved = path.resolve(filename);

  // Check for null bytes
  if (resolved.includes('\0')) {
    throw new Error('Invalid filename: contains null bytes');
  }

  return resolved;
}

export class ConfirmationService extends EventEmitter {
  private static instance: ConfirmationService;
  private pendingConfirmation: Promise<ConfirmationResult> | null = null;
  private resolveConfirmation: ((result: ConfirmationResult) => void) | null = null;

  // Session flags for different operation types
  private sessionFlags = {
    fileOperations: false,
    bashCommands: false,
    allOperations: false,
  };
  private scopedSessionApprovals = new Set<string>();
  private readonly approvalContext = new AsyncLocalStorage<string>();

  // Dry-run mode - preview changes without applying
  private dryRunMode: boolean = false;
  private dryRunLog: Array<{ operation: string; content: string; timestamp: Date }> = [];

  // Remote approval service (for non-interactive fallback)
  private remoteApproval: RemoteApprovalService | null = null;
  private interactiveBridge: ((options: ConfirmationOptions) => Promise<ConfirmationResult>) | null = null;

  static getInstance(): ConfirmationService {
    if (!ConfirmationService.instance) {
      ConfirmationService.instance = new ConfirmationService();
    }
    return ConfirmationService.instance;
  }

  constructor() {
    super();
  }

  /**
   * Set remote approval service for non-interactive fallback
   */
  setRemoteApprovalService(service: RemoteApprovalService): void {
    this.remoteApproval = service;
  }

  /**
   * Register an interactive GUI bridge (e.g. Cowork's permission dialog).
   * When set, non-TTY confirmation requests are routed to it INSTEAD of the
   * fail-closed "requires an interactive terminal" path — the desktop app IS
   * the interactive surface. The bridge returns a full ConfirmationResult so
   * a user denial can carry a reason (surfaced to the agent as feedback).
   */
  setInteractiveBridge(
    bridge: ((options: ConfirmationOptions) => Promise<ConfirmationResult>) | null
  ): void {
    this.interactiveBridge = bridge;
  }

  /** Isolate exact grants between concurrent desktop/voice/CLI sessions. */
  withApprovalContextAsync<T>(contextId: string, fn: () => Promise<T>): Promise<T> {
    return this.approvalContext.run(contextId, fn);
  }

  private scopedApprovalKey(key: string): string {
    return `${this.approvalContext.getStore() ?? 'global'}:${key}`;
  }

  /**
   * Enable or disable dry-run mode
   */
  setDryRunMode(enabled: boolean): void {
    this.dryRunMode = enabled;
    if (enabled) {
      this.dryRunLog = [];
    }
  }

  /**
   * Check if dry-run mode is enabled
   */
  isDryRunMode(): boolean {
    return this.dryRunMode;
  }

  /**
   * Get dry-run log
   */
  getDryRunLog(): Array<{ operation: string; content: string; timestamp: Date }> {
    return [...this.dryRunLog];
  }

  /**
   * Clear dry-run log
   */
  clearDryRunLog(): void {
    this.dryRunLog = [];
  }

  /**
   * Format dry-run log for display
   */
  formatDryRunLog(): string {
    if (this.dryRunLog.length === 0) {
      return '🔍 Dry-run log is empty. No operations would have been executed.';
    }

    const lines = ['🔍 Dry-run Summary:', '═'.repeat(50)];

    for (const [i, entry] of this.dryRunLog.entries()) {
      lines.push(`\n${i + 1}. ${entry.operation}`);
      lines.push(`   Time: ${entry.timestamp.toLocaleTimeString()}`);
      if (entry.content) {
        const preview = entry.content.length > 200
          ? entry.content.slice(0, 200) + '...'
          : entry.content;
        lines.push(`   Content: ${preview}`);
      }
    }

    lines.push('\n' + '═'.repeat(50));
    lines.push(`Total operations that would execute: ${this.dryRunLog.length}`);

    return lines.join('\n');
  }

  /** Threshold for large change confirmation (lines) */
  private largeChangeThreshold: number = 100;

  /**
   * Set the threshold for large change enhanced confirmation.
   */
  setLargeChangeThreshold(lines: number): void {
    // Guard against pathological values: <1 over-triggers every edit; a very large
    // value silently disables the large-change re-confirmation gate. Clamp to a sane range.
    if (!Number.isFinite(lines) || lines < 1 || lines > 10000) {
      logger.warn(
        `setLargeChangeThreshold: ignoring out-of-range value ${lines} (allowed 1-10000); keeping ${this.largeChangeThreshold}`,
      );
      return;
    }
    this.largeChangeThreshold = lines;
  }

  /**
   * Ventilated audit (jarvis-OS gate concept): record WHICH check in the
   * confirmation chain produced this decision, and whether it is a
   * DETERMINISTIC refusal that no interactive prompt can override (policy deny,
   * declarative deny, a permission-mode block) versus a negotiable one. Pure
   * side-effect — returns the result unchanged, never throws (audit logging is
   * itself fail-safe). This is what lets you always answer "why was this
   * allowed/blocked?" from the audit trail alone.
   */
  private auditGate(
    provenance: string,
    deterministic: boolean,
    options: ConfirmationOptions,
    result: ConfirmationResult,
  ): ConfirmationResult {
    try {
      auditLogger.log({
        action: result.confirmed ? 'confirmation_granted' : 'confirmation_denied',
        decision: result.confirmed ? 'allow' : 'block',
        source: `gate:${provenance}`,
        target: options.filename,
        details: JSON.stringify({
          provenance,
          deterministic,
          operation: options.operation,
          ...(result.feedback ? { feedback: result.feedback } : {}),
        }),
      });
    } catch {
      /* audit is best-effort — never let it affect the gate decision */
    }
    return result;
  }

  async requestConfirmation(
    options: ConfirmationOptions,
    operationType: ConfirmationOperationType = 'file'
  ): Promise<ConfirmationResult> {
    // In dry-run mode, log the operation but don't execute
    if (this.dryRunMode) {
      this.dryRunLog.push({
        operation: `[${operationType.toUpperCase()}] ${options.operation}: ${options.filename}`,
        content: options.content || '',
        timestamp: new Date(),
      });

      // Emit event for UI to show what would happen
      setImmediate(() => {
        this.emit('dry-run-logged', {
          ...options,
          operationType,
          logIndex: this.dryRunLog.length,
        });
      });

      // In dry-run mode, return as if rejected (operation won't execute)
      return {
        confirmed: false,
        feedback: `[DRY-RUN] Operation logged but not executed: ${options.operation}`,
      };
    }

    // Policy Engine Check
    const capability: Capability = process.env.CODEBUDDY_SELF_IMPROVEMENT === 'true' || options.operation === 'self_improvement'
      ? 'self_improvement'
      : operationType === 'bash'
        ? 'shell:safe'
        : operationType === 'tool'
          ? 'net:listed'
          : 'fs:write:scoped';
    let risk: 'low' | 'medium' | 'high' = 'medium';
    const rawRisk = (options.riskLevel || process.env.CODEBUDDY_RISK_LEVEL || '').toLowerCase();
    if (rawRisk === 'low') {
      risk = 'low';
    } else if (rawRisk === 'high' || rawRisk === 'critical') {
      risk = 'high';
    }

    const detail: Record<string, unknown> = {
      path: options.filename,
      command: operationType === 'bash' ? options.filename : undefined,
      ...options.detail,
    };

    const policyResult = PolicyEngine.getInstance().evaluate({
      capability,
      risk,
      detail,
    });

    if (policyResult.decision === 'deny') {
      return this.auditGate('policy-engine', true, options, {
        confirmed: false,
        feedback: policyResult.reason,
      });
    }

    const isSelfImprovement = capability === 'self_improvement';
    const forcePrompt = options.forcePrompt === true;

    // SECURITY (CC18 hardening): an explicit permission-mode denial — e.g. `plan`
    // mode blocking writes, or a declarative deny rule surfaced through the mode —
    // must NEVER be overridden by the AUTO_CONFIRM / PolicyEngine-`allow` convenience
    // short-circuits below. Without this, `CODEBUDDY_AUTO_CONFIRM=true` (or the fact
    // that `shell:safe` always evaluates to `allow`) would silently bypass a
    // restrictive mode. We only short-circuit to BLOCKED here; the permissive path
    // (mode allows) falls through unchanged, so normal UX is preserved.
    const modeToolName = operationType === 'bash'
      ? 'bash'
      : operationType === 'tool'
        ? options.toolName ?? options.operation
        : 'edit';
    const permissionAction = operationType === 'bash' ? options.filename : options.operation;
    const earlyModeDecision = getPermissionModeManager().checkPermission(permissionAction, modeToolName);
    if (!isSelfImprovement && !earlyModeDecision.allowed) {
      return this.auditGate('permission-mode', true, options, {
        confirmed: false,
        feedback: earlyModeDecision.reason,
      });
    }

    const toolName = operationType === 'bash'
      ? 'Bash'
      : operationType === 'tool'
        ? options.toolName ?? options.operation
        : 'Edit';
    // Denials are evaluated before every convenience allow. Previously the
    // PolicyEngine's broad `shell:safe` allow returned before project deny
    // rules were even consulted.
    const toolArgs = operationType === 'bash'
      ? { command: options.filename }
      : operationType === 'tool'
        ? options.toolArgs ?? {}
        : { file_path: options.filename };
    const declarativeRoot = typeof options.detail?.cwd === 'string'
      ? options.detail.cwd
      : process.cwd();
    const declarativeDecision = checkDeclarativePermission(toolName, toolArgs, declarativeRoot);
    if (declarativeDecision === 'deny') {
      return this.auditGate('declarative-rule', true, options, {
        confirmed: false,
        feedback: 'Blocked by declarative permission rule',
      });
    }

    if (!isSelfImprovement && !forcePrompt && process.env.CODEBUDDY_AUTO_CONFIRM === 'true') {
      return this.auditGate('auto-confirm-env', false, options, { confirmed: true });
    }

    if (!isSelfImprovement && !forcePrompt && policyResult.decision === 'allow') {
      return this.auditGate('policy-engine', false, options, { confirmed: true });
    }

    // CC18: Check permission mode before other negotiable checks.
    const permMgr = getPermissionModeManager();
    const modeDecision = permMgr.checkPermission(permissionAction, toolName.toLowerCase());
    if (!modeDecision.allowed) {
      return this.auditGate('permission-mode', true, options, {
        confirmed: false,
        feedback: modeDecision.reason,
      });
    }
    if (!isSelfImprovement && !forcePrompt && !modeDecision.prompted) {
      // Mode says auto-approve (e.g., acceptEdits for edits, dontAsk for non-destructive)
      return this.auditGate('permission-mode', false, options, { confirmed: true });
    }

    if (!isSelfImprovement && !forcePrompt && declarativeDecision === 'allow') {
      return this.auditGate('declarative-rule', false, options, { confirmed: true });
    }

    // Check session flags — but require re-confirmation for large changes
    const isLargeChange = (options.linesChanged ?? 0) > this.largeChangeThreshold;
    if (
      !isSelfImprovement &&
      !forcePrompt &&
      options.approvalKey &&
      this.scopedSessionApprovals.has(this.scopedApprovalKey(options.approvalKey))
    ) {
      return this.auditGate('scoped-session-grant', false, options, { confirmed: true });
    }
    if (
      !isSelfImprovement &&
      !forcePrompt &&
      !options.approvalKey &&
      !isLargeChange && (
        this.sessionFlags.allOperations ||
        (operationType === 'file' && this.sessionFlags.fileOperations) ||
        (operationType === 'bash' && this.sessionFlags.bashCommands)
      )
    ) {
      return this.auditGate('session-flag', false, options, { confirmed: true });
    }

    // Self-improvement is intentionally not covered by CODEBUDDY_AUTO_CONFIRM.
    // In non-interactive contexts, fail closed with a visible reason instead of
    // waiting on a prompt that cannot be answered.
    if (isSelfImprovement) {
      if (!process.stdin.isTTY && !this.remoteApproval?.hasChannels()) {
        return this.auditGate('self-improvement-no-channel', true, options, {
          confirmed: false,
          feedback:
            'Self-improvement requires explicit approval, but no interactive terminal or '
            + 'remote approval channel is available.',
        });
      }
    }

    // Enrich content with diff preview if available
    if (options.diffPreview && !options.content?.includes(options.diffPreview)) {
      const preview = options.diffPreview.length > 2000
        ? options.diffPreview.slice(0, 2000) + '\n... (diff truncated)'
        : options.diffPreview;
      const magnitude = isLargeChange ? `\n⚠ LARGE CHANGE: ${options.linesChanged} lines affected` : '';
      options.content = (options.content ? options.content + '\n\n' : '') +
        `Diff preview:${magnitude}\n${preview}`;
    }

    // Interactive GUI bridge (Cowork permission dialog): the desktop app is
    // the interactive surface, so it takes precedence over the TTY check.
    if (this.interactiveBridge) {
      const bridged = await this.interactiveBridge(options);
      if (!forcePrompt && bridged.dontAskAgain && bridged.confirmed) {
        if (options.approvalKey) {
          this.scopedSessionApprovals.add(this.scopedApprovalKey(options.approvalKey));
        } else if (operationType === 'file') {
          this.sessionFlags.fileOperations = true;
        } else if (operationType === 'bash') {
          this.sessionFlags.bashCommands = true;
        }
      }
      return this.auditGate('interactive-bridge', false, options, bridged);
    }

    // Remote approval fallback: when not in interactive terminal, try channels
    if (!process.stdin.isTTY && this.remoteApproval?.hasChannels()) {
      const approved = await this.remoteApproval.requestApproval({
        toolName: options.operation,
        summary: `${options.operation}: ${options.filename}`,
      });
      return this.auditGate('remote-approval', false, options, { confirmed: approved });
    }

    // If VS Code should be opened, try to open it
    if (options.showVSCodeOpen) {
      try {
        await this.openInVSCode(options.filename);
      } catch {
        // If VS Code opening fails, continue without it
        options.showVSCodeOpen = false;
      }
    }

    if (!process.stdin.isTTY) {
      return this.auditGate('no-interactive-terminal', true, options, {
        confirmed: false,
        feedback: 'Approval requires an interactive terminal or configured remote approval channel',
      });
    }

    // Create a promise that will be resolved by the UI component
    this.pendingConfirmation = new Promise<ConfirmationResult>((resolve) => {
      this.resolveConfirmation = resolve;
    });

    // Emit custom event that the UI can listen to (using setImmediate to ensure the UI updates)
    setImmediate(() => {
      this.emit('confirmation-requested', options);
    });

    const result = await this.pendingConfirmation;

    if (!forcePrompt && result.dontAskAgain) {
      if (options.approvalKey) {
        this.scopedSessionApprovals.add(this.scopedApprovalKey(options.approvalKey));
      // Set the legacy broad flag only for callers that did not provide an
      // exact scope. New execution paths must always provide approvalKey.
      } else if (operationType === 'file') {
        this.sessionFlags.fileOperations = true;
      } else if (operationType === 'bash') {
        this.sessionFlags.bashCommands = true;
      }
      // Could also set allOperations for global skip
    }

    return result;
  }

  confirmOperation(confirmed: boolean, dontAskAgain?: boolean): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed, dontAskAgain });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  rejectOperation(feedback?: string): void {
    if (this.resolveConfirmation) {
      this.resolveConfirmation({ confirmed: false, feedback });
      this.resolveConfirmation = null;
      this.pendingConfirmation = null;
    }
  }

  /**
   * Open a file in VS Code safely using spawn with separate arguments
   * This prevents command injection by not using shell interpolation
   */
  private async openInVSCode(filename: string): Promise<void> {
    // Sanitize the filename
    const sanitizedPath = sanitizeFilename(filename);

    // Try different VS Code commands
    const commands = ['code', 'code-insiders', 'codium'];

    for (const cmd of commands) {
      try {
        const exists = await commandExists(cmd);
        if (exists) {
          // Use spawn with separate arguments - prevents injection
          await spawnAsync(cmd, [sanitizedPath]);
          return;
        }
      } catch {
        // Continue to next command
        continue;
      }
    }

    throw new Error('VS Code not found');
  }

  isPending(): boolean {
    return this.pendingConfirmation !== null;
  }

  resetSession(): void {
    this.sessionFlags = {
      fileOperations: false,
      bashCommands: false,
      allOperations: false,
    };
    this.scopedSessionApprovals.clear();
  }

  getSessionFlags() {
    return { ...this.sessionFlags };
  }

  setSessionFlag(flagType: 'fileOperations' | 'bashCommands' | 'allOperations', value: boolean) {
    this.sessionFlags[flagType] = value;
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): void {
    this.pendingConfirmation = null;
    this.resolveConfirmation = null;
    this.scopedSessionApprovals.clear();
    this.removeAllListeners();
  }
}
