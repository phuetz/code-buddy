/**
 * Crash Handler for Code Buddy
 *
 * Provides graceful crash recovery with:
 * - Session state preservation
 * - Error context logging
 * - Recovery file creation
 * - Clean terminal restoration
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export interface CrashContext {
  timestamp: Date;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  sessionId?: string;
  workingDirectory: string;
  nodeVersion: string;
  platform: string;
  lastMessages?: Array<{ role: string; content: string }>;
  pendingOperations?: string[];
}

export interface RecoveryInfo {
  sessionId: string;
  timestamp: Date;
  recoveryFilePath: string;
  reason: string;
  resumable: boolean;
}

const RECOVERY_DIR = path.join(os.homedir(), '.codebuddy', 'recovery');

/**
 * Crash Handler singleton
 */
class CrashHandler {
  private sessionId: string | null = null;
  private lastMessages: Array<{ role: string; content: string }> = [];
  private pendingOperations: string[] = [];
  private isInitialized = false;

  /**
   * Initialize the crash handler
   */
  initialize(): void {
    if (this.isInitialized) return;

    fs.ensureDirSync(RECOVERY_DIR);
    this.isInitialized = true;
  }

  /**
   * Set the current session ID for recovery
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Track messages for crash recovery
   */
  trackMessage(role: string, content: string): void {
    // Keep last 10 messages for context
    this.lastMessages.push({ role, content: content.slice(0, 1000) });
    if (this.lastMessages.length > 10) {
      this.lastMessages.shift();
    }
  }

  /**
   * Track pending operations
   */
  trackOperation(operation: string): void {
    this.pendingOperations.push(operation);
  }

  /**
   * Clear a completed operation
   */
  clearOperation(operation: string): void {
    const index = this.pendingOperations.indexOf(operation);
    if (index !== -1) {
      this.pendingOperations.splice(index, 1);
    }
  }

  /**
   * Save crash context to a recovery file
   */
  saveCrashContext(error: Error, reason: string): string | null {
    try {
      this.initialize();

      const crashId = `crash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const crashFile = path.join(RECOVERY_DIR, `${crashId}.json`);

      const context: CrashContext = {
        timestamp: new Date(),
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        sessionId: this.sessionId || undefined,
        workingDirectory: process.cwd(),
        nodeVersion: process.version,
        platform: process.platform,
        lastMessages: this.lastMessages.length > 0 ? this.lastMessages : undefined,
        pendingOperations: this.pendingOperations.length > 0 ? this.pendingOperations : undefined,
      };

      fs.writeJsonSync(crashFile, context, { spaces: 2 });

      // Also create a recovery info file for quick checks
      const recoveryInfo: RecoveryInfo = {
        sessionId: this.sessionId || crashId,
        timestamp: new Date(),
        recoveryFilePath: crashFile,
        reason,
        resumable: !!this.sessionId,
      };

      const latestFile = path.join(RECOVERY_DIR, 'latest.json');
      fs.writeJsonSync(latestFile, recoveryInfo, { spaces: 2 });

      return crashFile;
    } catch (_e) {
      // Don't throw during crash handling
      return null;
    }
  }

  /**
   * Get the latest recovery info if available
   */
  getLatestRecovery(): RecoveryInfo | null {
    try {
      const latestFile = path.join(RECOVERY_DIR, 'latest.json');
      if (fs.existsSync(latestFile)) {
        const info = fs.readJsonSync(latestFile) as RecoveryInfo;
        // Only return if recent (within 1 hour)
        const age = Date.now() - new Date(info.timestamp).getTime();
        if (age < 3600000) {
          return info;
        }
      }
    } catch (_e) {
      // Ignore errors
    }
    return null;
  }

  /**
   * Get crash context from a recovery file
   */
  getCrashContext(filePath: string): CrashContext | null {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readJsonSync(filePath) as CrashContext;
      }
    } catch (_e) {
      // Ignore errors
    }
    return null;
  }

  /**
   * Clear recovery files after successful session start
   */
  clearRecovery(): void {
    try {
      const latestFile = path.join(RECOVERY_DIR, 'latest.json');
      if (fs.existsSync(latestFile)) {
        fs.unlinkSync(latestFile);
      }
    } catch (_e) {
      // Ignore errors
    }
  }

  /**
   * Clean up old crash files (keep last 10)
   */
  cleanupOldCrashes(): void {
    try {
      const files = fs.readdirSync(RECOVERY_DIR)
        .filter(f => f.startsWith('crash_') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(RECOVERY_DIR, f),
          mtime: fs.statSync(path.join(RECOVERY_DIR, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Keep only the 10 most recent
      for (const file of files.slice(10)) {
        fs.unlinkSync(file.path);
      }
    } catch (_e) {
      // Ignore errors
    }
  }

  /**
   * Restore terminal to normal state
   */
  restoreTerminal(): void {
    try {
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }
      // Show cursor
      process.stdout.write('\x1B[?25h');
      // Reset colors
      process.stdout.write('\x1B[0m');
    } catch (_e) {
      // Ignore errors during terminal restoration
    }
  }

  /**
   * Handle a crash - save context and restore terminal
   */
  handleCrash(error: Error, reason: string): string | null {
    this.restoreTerminal();
    const crashFile = this.saveCrashContext(error, reason);
    return crashFile;
  }
}

// Singleton instance
let crashHandlerInstance: CrashHandler | null = null;

/**
 * Get the crash handler singleton
 */
export function getCrashHandler(): CrashHandler {
  if (!crashHandlerInstance) {
    crashHandlerInstance = new CrashHandler();
  }
  return crashHandlerInstance;
}

/**
 * Format crash info for display
 */
export function formatCrashInfo(recovery: RecoveryInfo): string {
  const lines: string[] = [
    '',
    '== Previous Session Crash Detected ==',
    '',
    `Time: ${new Date(recovery.timestamp).toLocaleString()}`,
    `Session: ${recovery.sessionId}`,
    `Reason: ${recovery.reason}`,
    '',
  ];

  if (recovery.resumable) {
    lines.push('You can resume the previous session with:');
    lines.push(`  grok --resume ${recovery.sessionId}`);
    lines.push('');
  }

  return lines.join('\n');
}
