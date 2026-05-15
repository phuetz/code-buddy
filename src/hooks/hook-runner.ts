/**
 * Hook Runner — Enterprise-grade multi-handler hook execution
 *
 * Supports 4 handler types: command, http, prompt, agent.
 * Integrates with the existing HookManager for backward compatibility
 * while adding extended handler types and new events.
 *
 * Configuration is loaded from `.codebuddy/hooks.json` under the
 * `extendedHooks` array key, keeping it alongside the existing
 * HookManager's `hooks` array.
 *
 * @module hook-runner
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type {
  ExtendedHook,
  ExtendedHookContext,
  ExtendedHookResult,
  ExtendedHookEvent,
  CommandHandler,
  HttpHandler,
} from './hook-types.js';

/**
 * HookRunner — executes extended hooks with multiple handler types.
 *
 * Usage:
 * ```typescript
 * const runner = getHookRunner('/path/to/project');
 * const result = await runner.run('PreToolUse', {
 *   toolName: 'bash',
 *   toolArgs: { command: 'npm test' },
 * });
 * if (result.blocked) {
 *   // Operation was blocked by a hook
 * }
 * ```
 */
export class HookRunner {
  private hooks: ExtendedHook[] = [];
  private enabled: boolean = true;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.loadConfig();
  }

  /**
   * Load extended hooks from `.codebuddy/hooks.json`.
   * Looks for the `extendedHooks` array in the config file.
   */
  private loadConfig(): void {
    const configPath = path.join(this.projectRoot, '.codebuddy', 'hooks.json');
    if (!fs.existsSync(configPath)) return;

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (Array.isArray(config.extendedHooks)) {
        this.hooks = config.extendedHooks;
      }
    } catch (err) {
      logger.debug(`Failed to load extended hooks: ${err}`);
    }
  }

  /**
   * Enable or disable the hook runner.
   * When disabled, `run()` returns an explicit skipped result.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Check if the hook runner is enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Get a copy of all registered extended hooks. */
  getHooks(): ExtendedHook[] {
    return [...this.hooks];
  }

  /**
   * Add a hook programmatically (not persisted to disk).
   * Use this for runtime-registered hooks.
   */
  addHook(hook: ExtendedHook): void {
    this.hooks.push(hook);
  }

  /**
   * Run all matching hooks for an event.
   *
   * Hooks are matched by event type, enabled status, and optional
   * pattern regex against the tool name. Hooks execute sequentially;
   * if any hook sets `blocked: true`, execution stops immediately.
   *
   * @param event - The event that triggered this run
   * @param context - Partial context; `event` and `timestamp` are auto-filled
   * @returns Combined result from all matching hooks
   */
  async run(
    event: ExtendedHookEvent,
    context: Partial<ExtendedHookContext>
  ): Promise<ExtendedHookResult> {
    if (!this.enabled) {
      return {
        success: true,
        output: 'Hook runner disabled; no hooks executed.',
      };
    }

    const fullContext: ExtendedHookContext = {
      event,
      timestamp: new Date(),
      ...context,
    };

    const matching = this.hooks.filter((h) => {
      if (h.event !== event) return false;
      if (h.enabled === false) return false;
      if (h.pattern && fullContext.toolName) {
        return new RegExp(h.pattern).test(fullContext.toolName);
      }
      return true;
    });

    if (matching.length === 0) {
      return {
        success: true,
        output: `No hooks registered for event: ${event}.`,
      };
    }

    let combined: ExtendedHookResult = { success: true };

    for (const hook of matching) {
      let result: ExtendedHookResult;

      switch (hook.handler.type) {
        case 'command':
          result = await this.runCommand(hook.handler, fullContext);
          break;
        case 'http':
          result = await this.runHttp(hook.handler, fullContext);
          break;
        case 'prompt':
          result = {
            success: false,
            error:
              'Prompt hook handlers are not wired to a model provider in HookRunner; use SmartHookRunner/AdvancedHookRunner or disable this hook.',
          };
          break;
        case 'agent':
          result = {
            success: false,
            error:
              'Agent hook handlers are not wired to a sub-agent runtime in HookRunner; use SmartHookRunner/AdvancedHookRunner or disable this hook.',
          };
          break;
        default:
          result = {
            success: false,
            error: `Unknown handler type: ${(hook.handler as Record<string, unknown>).type}`,
          };
      }

      if (!result.success) {
        combined.success = false;
        if (result.error) {
          combined.error = combined.error
            ? `${combined.error}\n${result.error}`
            : result.error;
        }
      }

      if (result.blocked) {
        combined.blocked = true;
        combined.error = result.error;
        break; // Stop processing further hooks
      }

      if (result.updatedInput) {
        combined.updatedInput = { ...combined.updatedInput, ...result.updatedInput };
      }

      if (result.permissionDecision) {
        combined.permissionDecision = result.permissionDecision;
      }

      if (result.output) {
        combined.output = combined.output
          ? `${combined.output}\n${result.output}`
          : result.output;
      }
    }

    return combined;
  }

  /**
   * Execute a command handler.
   *
   * The hook context is sent as JSON on stdin. Environment variables
   * `CODEBUDDY_HOOK_EVENT` and `CODEBUDDY_HOOK_TOOL` are set.
   *
   * Exit code protocol:
   * - 0 = success (stdout parsed as JSON if possible for updatedInput/permissionDecision)
   * - 2 = block the operation (Standard convention)
   * - other = error
   */
  private async runCommand(
    handler: CommandHandler,
    context: ExtendedHookContext
  ): Promise<ExtendedHookResult> {
    return new Promise((resolve) => {
      const timeout = handler.timeout || 30000;
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd' : 'sh';
      const shellFlag = isWindows ? '/c' : '-c';

      const child = spawn(shell, [shellFlag, handler.command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CODEBUDDY_HOOK_EVENT: context.event,
          CODEBUDDY_HOOK_TOOL: context.toolName || '',
        },
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdin.write(JSON.stringify(context));
      child.stdin.end();

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });

      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            success: false,
            error: `Timed out after ${timeout}ms`,
          });
          return;
        }

        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          // Not JSON — use as plain text
        }

        if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim(),
            updatedInput: parsed?.updatedInput as Record<string, unknown> | undefined,
            permissionDecision: parsed?.permissionDecision as
              | 'allow'
              | 'deny'
              | 'ask'
              | undefined,
          });
        } else if (code === 2) {
          // Exit code 2 = block (Standard convention)
          resolve({
            success: false,
            blocked: true,
            error: stderr.trim() || stdout.trim() || 'Blocked by hook',
          });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || `Hook exited with code ${code}`,
          });
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          error: `Hook execution failed: ${err.message}`,
        });
      });
    });
  }

  /**
   * Execute an HTTP webhook handler.
   *
   * POSTs the hook context as JSON to the configured URL.
   *
   * Response protocol:
   * - 200-299 = success (body parsed as JSON if possible)
   * - 403 = block the operation
   * - other = error
   */
  private async runHttp(
    handler: HttpHandler,
    context: ExtendedHookContext
  ): Promise<ExtendedHookResult> {
    try {
      const controller = new AbortController();
      const timeout = handler.timeout || 30000;
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(handler.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...handler.headers,
        },
        body: JSON.stringify(context),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const body = await response.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        // Not JSON — use as plain text
      }

      if (response.ok) {
        return {
          success: true,
          output: body,
          updatedInput: parsed?.updatedInput as Record<string, unknown> | undefined,
          permissionDecision: parsed?.permissionDecision as
            | 'allow'
            | 'deny'
            | 'ask'
            | undefined,
        };
      } else if (response.status === 403) {
        return {
          success: false,
          blocked: true,
          error: body || 'Blocked by HTTP hook',
        };
      } else {
        return {
          success: false,
          error: `HTTP hook returned ${response.status}: ${body}`,
        };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `HTTP hook failed: ${message}`,
      };
    }
  }

  /**
   * Reload hooks from the configuration file.
   * Clears all in-memory hooks and re-reads from disk.
   */
  reload(): void {
    this.hooks = [];
    this.loadConfig();
  }

  /**
   * Dispose the hook runner and clear all hooks.
   */
  dispose(): void {
    this.hooks = [];
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _runner: HookRunner | null = null;

/**
 * Get the singleton HookRunner instance.
 * Pass `projectRoot` to create a new instance for a different project.
 */
export function getHookRunner(projectRoot?: string): HookRunner {
  if (!_runner || projectRoot) {
    _runner = new HookRunner(projectRoot);
  }
  return _runner;
}

/**
 * Reset the singleton HookRunner instance.
 * Useful for testing and project switches.
 */
export function resetHookRunner(): void {
  _runner?.dispose();
  _runner = null;
}
