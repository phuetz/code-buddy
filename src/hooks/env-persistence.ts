/**
 * Environment Persistence
 *
 * Persists environment variables across sessions via env files.
 * Supports setup hooks that modify env and captures changes for replay.
 *
 * Format: standard shell-compatible `export VAR=value` lines.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { readTextAtomicSync, writeFileAtomicSync } from '../utils/atomic-write.js';

// ============================================================================
// EnvPersistence
// ============================================================================

export class EnvPersistence {
  private envFilePath: string;
  private sessionEnv: Record<string, string>;
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID();
    this.envFilePath = path.join(
      os.tmpdir(),
      '.codebuddy-env',
      `session-${this.sessionId}.env`
    );
    this.sessionEnv = {};

    // Ensure directory exists
    const dir = path.dirname(this.envFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing env file if present
    if (fs.existsSync(this.envFilePath)) {
      this.sessionEnv = this.loadEnv();
    }

    logger.debug(`EnvPersistence initialized for session ${this.sessionId}`, { source: 'EnvPersistence' });
  }

  /**
   * Get the path to the env persistence file
   */
  getEnvFilePath(): string {
    return this.envFilePath;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set an environment variable and persist it
   */
  setVar(name: string, value: string): void {
    this.sessionEnv[name] = value;
    this.flush();
    logger.debug(`Env var set: ${name}`, { source: 'EnvPersistence' });
  }

  /**
   * Remove an environment variable
   */
  unsetVar(name: string): void {
    delete this.sessionEnv[name];
    this.flush();
    logger.debug(`Env var unset: ${name}`, { source: 'EnvPersistence' });
  }

  /**
   * Load all persisted environment variables from the env file
   */
  loadEnv(): Record<string, string> {
    try {
      if (!fs.existsSync(this.envFilePath)) {
        return {};
      }
      const content = readTextAtomicSync(this.envFilePath, '');
      if (!content) return {};
      const parsed = this.parseEnvFile(content);
      this.sessionEnv = { ...parsed };
      return { ...parsed };
    } catch (error) {
      logger.warn(`Failed to load env file: ${error}`, { source: 'EnvPersistence' });
      return {};
    }
  }

  /**
   * Apply all persisted env vars to process.env
   */
  applyToProcess(): void {
    for (const [key, value] of Object.entries(this.sessionEnv)) {
      process.env[key] = value;
    }
    logger.debug(`Applied ${Object.keys(this.sessionEnv).length} env vars to process`, { source: 'EnvPersistence' });
  }

  /**
   * Parse an env file with `export VAR=value` format
   */
  parseEnvFile(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Strip optional 'export ' prefix
      const withoutExport = trimmed.startsWith('export ')
        ? trimmed.slice(7)
        : trimmed;

      // Find first = sign
      const eqIndex = withoutExport.indexOf('=');
      if (eqIndex === -1) {
        continue;
      }

      const key = withoutExport.slice(0, eqIndex).trim();
      let value = withoutExport.slice(eqIndex + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key) {
        env[key] = value;
      }
    }

    return env;
  }

  /**
   * Serialize env vars to file content
   */
  serializeEnv(env: Record<string, string>): string {
    const lines: string[] = [
      '# Code Buddy session environment',
      `# Session: ${this.sessionId}`,
      `# Generated: ${new Date().toISOString()}`,
      '',
    ];

    const sortedEntries = Object.entries(env).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    for (const [key, value] of sortedEntries) {
      // Quote values that contain spaces or special characters
      const needsQuoting = /[\s"'$`\\!#&|;()]/.test(value);
      const quotedValue = needsQuoting ? `"${value.replace(/["\\]/g, '\\$&')}"` : value;
      lines.push(`export ${key}=${quotedValue}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Capture environment changes between before and after snapshots
   */
  captureEnvChanges(
    beforeEnv: Record<string, string>,
    afterEnv: Record<string, string>
  ): Record<string, string> {
    const changes: Record<string, string> = {};

    for (const [key, value] of Object.entries(afterEnv)) {
      if (beforeEnv[key] !== value) {
        changes[key] = value;
      }
    }

    // Persist captured changes
    for (const [key, value] of Object.entries(changes)) {
      this.sessionEnv[key] = value;
    }

    if (Object.keys(changes).length > 0) {
      this.flush();
    }

    return changes;
  }

  /**
   * Clean up the env file
   */
  cleanup(): void {
    try {
      if (fs.existsSync(this.envFilePath)) {
        fs.unlinkSync(this.envFilePath);
      }
    } catch (error) {
      logger.warn(`Failed to cleanup env file: ${error}`, { source: 'EnvPersistence' });
    }
    this.sessionEnv = {};
  }

  /**
   * Write current env state to file
   */
  private flush(): void {
    try {
      const content = this.serializeEnv(this.sessionEnv);
      writeFileAtomicSync(this.envFilePath, content, { mode: 0o600 });
    } catch (error) {
      logger.warn(`Failed to write env file: ${error}`, { source: 'EnvPersistence' });
    }
  }
}
