/**
 * OpenShell Sandbox Backend
 *
 * NVIDIA OpenShell-compatible sandbox backend with two workspace modes:
 * - mirror: Local workspace mounted into the sandbox (development mode)
 * - remote: Remote workspace via API (cloud execution mode)
 *
 * Native Engine v2026.3.14 alignment.
 */

import { logger } from '../utils/logger.js';
import type { SandboxBackendInterface, SandboxExecOptions, SandboxExecResult } from './sandbox-backend.js';

// ============================================================================
// Types
// ============================================================================

export type OpenShellMode = 'mirror' | 'remote';

export interface OpenShellConfig {
  /** Workspace mode */
  mode: OpenShellMode;
  /** API endpoint for remote mode */
  apiUrl?: string;
  /** API key for remote mode */
  apiKey?: string;
  /** Local workspace path for mirror mode */
  workspacePath?: string;
  /** Default command timeout in ms */
  timeout?: number;
}

// ============================================================================
// OpenShell Backend
// ============================================================================

const DEFAULT_TIMEOUT = 60_000;

export class OpenShellBackend implements SandboxBackendInterface {
  readonly name = 'openshell';
  private config: OpenShellConfig;

  constructor(config: OpenShellConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (this.config.mode === 'mirror') {
      // Mirror mode requires local workspace
      return !!this.config.workspacePath;
    }

    if (this.config.mode === 'remote') {
      // Remote mode requires API endpoint and key
      if (!this.config.apiUrl || !this.config.apiKey) return false;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${this.config.apiUrl}/health`, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        return response.ok;
      } catch {
        return false;
      }
    }

    return false;
  }

  async execute(command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const timeout = opts?.timeout ?? this.config.timeout ?? DEFAULT_TIMEOUT;

    try {
      if (this.config.mode === 'mirror') {
        return await this.executeMirror(command, timeout, opts);
      } else {
        return await this.executeRemote(command, timeout, opts);
      }
    } catch (error) {
      const errorMessage = `OpenShell execution failed: ${error instanceof Error ? error.message : String(error)}`;
      return {
        success: false,
        output: errorMessage,
        error: errorMessage,
        exitCode: 1,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async kill(_containerId: string): Promise<boolean> {
    // OpenShell manages container lifecycle internally
    logger.debug('OpenShell kill requested (delegated to backend)');
    return true;
  }

  async cleanup(): Promise<void> {
    logger.debug('OpenShell cleanup');
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async executeMirror(
    command: string,
    timeout: number,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const startTime = Date.now();

    // Mirror mode: execute via local subprocess with workspace mounted
    const { spawn } = await import('child_process');

    return new Promise<SandboxExecResult>((resolve) => {
      const env = { ...process.env, ...opts?.env };
      const proc = spawn('sh', ['-c', command], {
        cwd: opts?.workDir ?? this.config.workspacePath,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const success = !timedOut && code === 0;
        const error = timedOut ? `Timed out after ${timeout}ms` : stderr || undefined;
        resolve({
          success,
          output: stdout || (!success ? error ?? '' : ''),
          error,
          exitCode: code ?? 1,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  private async executeRemote(
    command: string,
    timeout: number,
    opts?: SandboxExecOptions,
  ): Promise<SandboxExecResult> {
    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`${this.config.apiUrl}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          command,
          workDir: opts?.workDir,
          env: opts?.env,
          timeout,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = `OpenShell API error ${response.status}: ${text || response.statusText}`;
        return {
          success: false,
          output: error,
          error,
          exitCode: 1,
          durationMs: Date.now() - startTime,
        };
      }

      const result = await response.json() as {
        output?: string;
        error?: string;
        exitCode?: number;
      };
      const exitCode = result.exitCode ?? 1;
      const success = exitCode === 0;

      return {
        success,
        output: result.output ?? (!success ? result.error ?? '' : ''),
        error: result.error,
        exitCode,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
}
