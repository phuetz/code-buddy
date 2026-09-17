/**
 * Auto-Sandbox Router
 *
 * Automatically routes dangerous commands to Docker sandbox when available.
 * Configurable via environment variable or runtime flag.
 *
 * When enabled:
 * 1. Parses the command to extract base commands
 * 2. Checks if any are classified as "should-sandbox"
 * 3. If Docker is available, routes to DockerSandbox
 * 4. Falls back to normal execution if Docker unavailable, unless fail-closed is enabled
 */

import { parseBashCommand } from '../security/bash-parser.js';
import { isDangerousCommand } from '../security/dangerous-patterns.js';
import { auditLogger } from '../security/audit-logger.js';
import { logger } from '../utils/logger.js';
import { ensureSshSandboxRegistered } from './ssh-sandbox.js';

export interface AutoSandboxConfig {
  /** Enable auto-sandboxing (default: from AUTO_SANDBOX env) */
  enabled: boolean;
  /** Commands that should always be sandboxed */
  alwaysSandbox: Set<string>;
  /** Commands that should never be sandboxed (override) */
  neverSandbox: Set<string>;
  /** Docker image to use */
  image: string;
  /** Memory limit */
  memoryLimit: string;
  /** CPU limit */
  cpuLimit: string;
  /** Enable networking in sandbox */
  networkEnabled: boolean;
  /** Block commands that require sandboxing when Docker is unavailable */
  failClosedOnUnavailable: boolean;
  /**
   * Explicit backend request (e.g. `ssh`). Unset keeps the historical Docker
   * auto-route. SSH is never chosen implicitly.
   */
  explicitBackend?: string;
  /** Logical SSH host when explicitBackend is `ssh`. */
  explicitHost?: string;
}

const DEFAULT_CONFIG: AutoSandboxConfig = {
  enabled: process.env.AUTO_SANDBOX === 'true',
  alwaysSandbox: new Set([
    'npm', 'npx', 'yarn', 'pnpm',  // Package managers (can run arbitrary code)
    'pip', 'pip3',                    // Python package managers
    'cargo',                          // Rust package manager
    'make', 'cmake',                  // Build systems
  ]),
  neverSandbox: new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'date',
    'grep', 'rg', 'ag', 'find', 'which', 'file', 'stat',
    'git', 'cd',
  ]),
  image: 'node:22-slim',
  memoryLimit: '512m',
  cpuLimit: '1.0',
  networkEnabled: true,
  failClosedOnUnavailable:
    process.env.CODEBUDDY_AUTO_SANDBOX_FAIL_CLOSED === 'true' ||
    process.env.AUTO_SANDBOX_FAIL_CLOSED === 'true',
};

export class AutoSandboxRouter {
  private config: AutoSandboxConfig;
  private dockerAvailable: boolean | null = null;

  constructor(config: Partial<AutoSandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a command should be routed to the sandbox.
   */
  shouldSandbox(command: string): { sandbox: boolean; reason?: string } {
    if (this.config.explicitBackend === 'ssh') {
      const host = this.config.explicitHost ? ` host '${this.config.explicitHost}'` : '';
      return { sandbox: true, reason: `Explicit SSH backend${host}` };
    }

    if (!this.config.enabled) {
      return { sandbox: false, reason: 'Auto-sandbox disabled' };
    }

    try {
      const parsed = parseBashCommand(command);

      for (const cmd of parsed.commands) {
        const name = cmd.command.toLowerCase();

        // Never-sandbox override
        if (this.config.neverSandbox.has(name)) {
          continue;
        }

        // Always-sandbox commands
        if (this.config.alwaysSandbox.has(name)) {
          return { sandbox: true, reason: `Command '${name}' is always sandboxed` };
        }

        // Dangerous commands from centralized registry
        if (isDangerousCommand(name)) {
          return { sandbox: true, reason: `Command '${name}' is classified as dangerous` };
        }

        // Commands in subshells are more suspicious
        if (cmd.isSubshell && !this.config.neverSandbox.has(name)) {
          return { sandbox: true, reason: `Subshell command '${name}'` };
        }
      }
    } catch {
      // Parsing failed — don't sandbox (already validated elsewhere)
    }

    return { sandbox: false };
  }

  /**
   * Check if Docker is available on this system.
   * Result is cached after first check.
   */
  async isDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;

    try {
      const { spawnSync } = await import('child_process');
      const result = spawnSync('docker', ['info'], {
        stdio: 'pipe',
        timeout: 5000,
      });
      this.dockerAvailable = result.status === 0;
    } catch {
      this.dockerAvailable = false;
    }

    return this.dockerAvailable;
  }

  /**
   * Route a command: returns 'sandbox' or 'direct' with reason.
   */
  async route(command: string): Promise<{
    mode: 'sandbox' | 'direct' | 'blocked';
    reason: string;
  }> {
    const check = this.shouldSandbox(command);

    if (!check.sandbox) {
      return { mode: 'direct', reason: check.reason || 'No sandbox needed' };
    }

    if (this.config.explicitBackend === 'ssh') {
      ensureSshSandboxRegistered();
      auditLogger.log({
        action: 'sandbox_execute',
        decision: 'allow',
        source: 'auto-sandbox',
        target: command.slice(0, 200),
        details: check.reason || 'Explicit SSH backend',
      });
      return { mode: 'sandbox', reason: check.reason || 'Explicit SSH backend' };
    }

    const dockerOk = await this.isDockerAvailable();
    if (!dockerOk) {
      if (this.config.failClosedOnUnavailable) {
        logger.warn('Auto-sandbox: Docker not available, blocking sandbox-required command');
        auditLogger.log({
          action: 'sandbox_execute',
          decision: 'block',
          source: 'auto-sandbox',
          target: command.slice(0, 200),
          details: 'Docker unavailable — fail-closed enabled',
        });
        return { mode: 'blocked', reason: 'Docker not available and fail-closed is enabled' };
      }

      logger.debug('Auto-sandbox: Docker not available, falling back to direct execution');
      auditLogger.log({
        action: 'sandbox_execute',
        decision: 'warn',
        source: 'auto-sandbox',
        target: command.slice(0, 200),
        details: 'Docker unavailable — executing directly',
      });
      return { mode: 'direct', reason: 'Docker not available (would sandbox)' };
    }

    auditLogger.log({
      action: 'sandbox_execute',
      decision: 'allow',
      source: 'auto-sandbox',
      target: command.slice(0, 200),
      details: check.reason || 'Auto-sandboxed',
    });

    return { mode: 'sandbox', reason: check.reason || 'Auto-sandboxed' };
  }

  /**
   * Update configuration at runtime.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): Readonly<AutoSandboxConfig> {
    return { ...this.config };
  }
}

// Singleton
let instance: AutoSandboxRouter | null = null;

export function getAutoSandboxRouter(): AutoSandboxRouter {
  if (!instance) {
    const explicitBackend = process.env.CODEBUDDY_SANDBOX_BACKEND?.trim().toLowerCase();
    const explicitHost = process.env.CODEBUDDY_SSH_HOST?.trim();
    instance = new AutoSandboxRouter({
      ...(explicitBackend ? { explicitBackend } : {}),
      ...(explicitHost ? { explicitHost } : {}),
    });
  }
  return instance;
}
