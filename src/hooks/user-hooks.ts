/**
 * User-Configurable Hooks System
 *
 * Reads `.codebuddy/hooks.json` (event-keyed format) and executes
 * user-defined hooks with 4 handler types: command, http, prompt, agent.
 *
 * Configuration format:
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [{ "type": "command", "command": "eslint --fix $FILE", "if": "str_replace_editor" }],
 *     "PostToolUse": [{ "type": "http", "url": "https://example.com/hook" }]
 *   }
 * }
 * ```
 *
 * Exit code semantics (command handlers):
 * - 0  → allow; parse stdout as JSON for hookSpecificOutput
 * - 2  → BLOCK; send stderr as feedback to the LLM
 * - other → non-blocking warning
 *
 * @module hooks/user-hooks
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { ContextCompactionPayload } from '../events/types.js';

// ─── Event Types ──────────────────────────────────────────────────────────────

export type UserHookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Stop'
  | 'StopFailure'
  | 'FileChanged'
  | 'PreCompact'
  | 'PostCompact'
  | 'BeforeMemoryWrite'
  | 'AfterRunComplete'
  | 'BeforeScheduledDelivery'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'pre_compact';

// ─── Handler Types ────────────────────────────────────────────────────────────

export type UserHookHandlerType = 'command' | 'http' | 'prompt' | 'agent';

export interface UserHookHandler {
  type: UserHookHandlerType;
  /** Shell command string (for 'command' type). Supports $TOOL_NAME, $FILE, $SESSION_ID, $CWD, $TOOL_INPUT. */
  command?: string;
  /** URL to POST context JSON to (for 'http' type). */
  url?: string;
  /** Additional HTTP headers; ${ENV_VAR} placeholders resolved from process.env. */
  headers?: Record<string, string>;
  /** LLM prompt text to evaluate (for 'prompt' type). Returns yes/no decision. */
  prompt?: string;
  /** Sub-agent configuration (for 'agent' type). */
  agent?: { role?: string; prompt: string };
  /**
   * Conditional execution filter: only run this handler when the tool name
   * matches this string (exact or substring).
   */
  if?: string;
  /** Timeout in milliseconds (default: 10000). */
  timeout?: number;
}

// ─── Context & Result ─────────────────────────────────────────────────────────

export interface HookContext {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { success: boolean; output?: string };
  filePath?: string;
  sessionId?: string;
  [key: string]: unknown;
}

/** JSON output emitted by a command handler on stdout (exit 0). */
export interface UserHookOutput {
  hookEventName?: string;
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
  decision?: 'block' | 'allow';
  reason?: string;
}

export interface HookResult {
  /** false when blocked by exit-code 2 or HTTP 403. */
  allowed: boolean;
  /** Message to inject into LLM context (from stderr on exit 2, or body on 403). */
  feedback?: string;
  /** Modified tool input to pass through. */
  updatedInput?: Record<string, unknown>;
  /** Additional context string from hook output. */
  additionalContext?: string;
}

// ─── Config Shape ─────────────────────────────────────────────────────────────

type HooksConfigFile = {
  hooks?: Partial<Record<UserHookEvent, UserHookHandler[]>>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve `${ENV_VAR}` placeholders in a string from process.env.
 * Unknown variables are left as-is.
 */
function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    return process.env[name] ?? `\${${name}}`;
  });
}

/**
 * Expand hook-specific $VARIABLE tokens in a command string.
 * Uses shell-safe quoting for JSON-serialised values.
 */
function expandCommandVars(command: string, context: HookContext, event: UserHookEvent): string {
  let result = command;

  const toolName = context.toolName ?? '';
  const filePath = context.filePath ?? '';
  const sessionId = context.sessionId ?? '';
  const cwd = process.cwd();
  const toolInput = context.toolInput ? JSON.stringify(context.toolInput) : '{}';

  result = result
    .replace(/\$TOOL_NAME/g, toolName)
    .replace(/\$FILE/g, filePath)
    .replace(/\$SESSION_ID/g, sessionId)
    .replace(/\$CWD/g, cwd)
    .replace(/\$TOOL_INPUT/g, toolInput)
    .replace(/\$EVENT/g, event);

  // Also resolve ${ENV_VAR} placeholders
  result = resolveEnvPlaceholders(result);

  return result;
}

/**
 * Resolve `${ENV_VAR}` placeholders in all header values.
 */
function resolveHeaderEnvVars(headers: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = resolveEnvPlaceholders(value);
  }
  return resolved;
}

/**
 * Check whether a handler's `if` condition matches the current tool name.
 * Returns true when no condition is set.
 */
function matchesCondition(handler: UserHookHandler, context: HookContext): boolean {
  if (!handler.if) return true;
  if (!context.toolName) return false;
  return context.toolName === handler.if || context.toolName.includes(handler.if);
}

/** Merge a child HookResult into the combined accumulator (first block wins). */
function mergeResult(combined: HookResult, child: HookResult): HookResult {
  if (!child.allowed) {
    return {
      allowed: false,
      feedback: child.feedback ?? combined.feedback,
      updatedInput: child.updatedInput ?? combined.updatedInput,
      additionalContext: child.additionalContext ?? combined.additionalContext,
    };
  }
  return {
    allowed: combined.allowed,
    feedback: combined.feedback,
    updatedInput: child.updatedInput
      ? { ...combined.updatedInput, ...child.updatedInput }
      : combined.updatedInput,
    additionalContext: child.additionalContext
      ? [combined.additionalContext, child.additionalContext].filter(Boolean).join('\n')
      : combined.additionalContext,
  };
}

// ─── UserHooksManager ────────────────────────────────────────────────────────

export class UserHooksManager {
  private configDir: string;
  private hooksMap: Partial<Record<UserHookEvent, UserHookHandler[]>> = {};

  constructor(configDir: string) {
    this.configDir = configDir;
    this.loadConfig();
  }

  /**
   * (Re-)load hooks from `.codebuddy/hooks.json`.
   * Silently skips missing files; logs warnings on parse errors.
   */
  loadConfig(): void {
    const configPath = path.join(this.configDir, '.codebuddy', 'hooks.json');
    if (!fs.existsSync(configPath)) {
      this.hooksMap = {};
      return;
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as HooksConfigFile;
      this.hooksMap = parsed.hooks ?? {};
      const count = Object.values(this.hooksMap).reduce((s, h) => s + (h?.length ?? 0), 0);
      logger.debug(`[user-hooks] Loaded ${count} handler(s) from ${configPath}`);
    } catch (err) {
      logger.warn(`[user-hooks] Failed to parse hooks.json: ${err}`);
      this.hooksMap = {};
    }
  }

  /**
   * Execute all handlers registered for `event`, filtered by their `if`
   * condition. Returns an aggregated HookResult. The first blocking handler
   * short-circuits further execution.
   */
  async executeHooks(event: UserHookEvent, context: HookContext): Promise<HookResult> {
    const handlers = this.hooksMap[event];
    if (!handlers || handlers.length === 0) {
      return { allowed: true };
    }

    let combined: HookResult = { allowed: true };

    for (const handler of handlers) {
      if (!matchesCondition(handler, context)) continue;

      let result: HookResult;
      try {
        switch (handler.type) {
          case 'command':
            result = await this.executeCommand(handler, context, event);
            break;
          case 'http':
            result = await this.executeHttp(handler, context, event);
            break;
          case 'prompt':
            result = await this.executePrompt(handler, context);
            break;
          case 'agent':
            result = await this.executeAgent(handler, context);
            break;
          default:
            logger.warn(`[user-hooks] Unknown handler type: ${(handler as UserHookHandler).type}`);
            result = { allowed: true };
        }
      } catch (err) {
        logger.warn(`[user-hooks] Handler threw unexpectedly: ${err}`);
        result = { allowed: true };
      }

      combined = mergeResult(combined, result);

      // Short-circuit on first block
      if (!combined.allowed) break;
    }

    return combined;
  }

  /**
   * Run command handlers configured for the synchronous compaction boundary.
   * ContextManagerV2 deliberately remains synchronous, so this uses the same
   * hooks.json command format with a bounded synchronous child process.
   * Hook output is advisory: failures are logged and never block compaction.
   */
  runPreCompact(payload: ContextCompactionPayload): string | undefined {
    const handlers = [
      ...(this.hooksMap.pre_compact ?? []),
      ...(this.hooksMap.PreCompact ?? []),
    ];
    if (handlers.length === 0) return undefined;
    const hookContext: HookContext = { ...payload };

    const preserved: string[] = [];
    for (const handler of handlers) {
      if (!matchesCondition(handler, hookContext)) continue;
      if (handler.type !== 'command') {
        logger.warn('[user-hooks] pre_compact hooks currently support command handlers only');
        continue;
      }

      const output = this.executePreCompactCommand(handler, payload, hookContext);
      if (output) preserved.push(output);
      if (preserved.join('\n').length >= 2_000) break;
    }

    const result = preserved.join('\n').trim().slice(0, 2_000);
    return result || undefined;
  }

  private executePreCompactCommand(
    handler: UserHookHandler,
    payload: ContextCompactionPayload,
    hookContext: HookContext,
  ): string | undefined {
    if (!handler.command) {
      logger.warn('[user-hooks] pre_compact command handler missing `command` field');
      return undefined;
    }

    const timeout = Math.min(Math.max(handler.timeout ?? 5_000, 1), 5_000);
    const event: UserHookEvent = 'pre_compact';
    const expandedCommand = expandCommandVars(handler.command, hookContext, event);
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellFlag = isWindows ? '/c' : '-c';
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync(shell, [shellFlag, expandedCommand], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        timeout,
        killSignal: 'SIGTERM',
        windowsHide: true,
        env: {
          ...process.env,
          CODEBUDDY_HOOK_EVENT: event,
          TOOL_NAME: '',
          TOOL_INPUT: '{}',
          FILE: '',
          SESSION_ID: '',
          CWD: process.cwd(),
        },
      });
    } catch (error: unknown) {
      logger.warn(`[user-hooks] pre_compact hook failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }

    if (result.error) {
      logger.warn(`[user-hooks] pre_compact hook failed: ${result.error.message}`);
      return undefined;
    }
    if (result.status !== 0) {
      const detail = String(result.stderr ?? result.stdout ?? '').trim();
      logger.warn(
        `[user-hooks] pre_compact hook exited ${result.status ?? 'without a status'}${detail ? `: ${detail}` : ''}`,
      );
      return undefined;
    }

    return String(result.stdout ?? '').trim() || undefined;
  }

  // ─── Command Handler ──────────────────────────────────────────────────────

  private async executeCommand(
    handler: UserHookHandler,
    context: HookContext,
    event: UserHookEvent
  ): Promise<HookResult> {
    if (!handler.command) {
      logger.warn('[user-hooks] command handler missing `command` field');
      return { allowed: true };
    }

    const timeout = handler.timeout ?? 10_000;
    const expandedCommand = expandCommandVars(handler.command, context, event);

    return new Promise<HookResult>((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd' : 'sh';
      const shellFlag = isWindows ? '/c' : '-c';

      const child = spawn(shell, [shellFlag, expandedCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: !isWindows,
        windowsHide: true,
        env: {
          ...process.env,
          TOOL_NAME: context.toolName ?? '',
          TOOL_INPUT: context.toolInput ? JSON.stringify(context.toolInput) : '{}',
          FILE: context.filePath ?? '',
          SESSION_ID: context.sessionId ?? '',
          CWD: process.cwd(),
        },
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (!isWindows && child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill('SIGTERM');
          }
        } else {
          child.kill('SIGTERM');
        }
      }, timeout);

      // Write context JSON to stdin
      child.stdin.on('error', (err: Error) => {
        logger.debug(`[user-hooks] command stdin closed: ${err.message}`);
      });
      try {
        child.stdin.end(JSON.stringify({ event, ...context }));
      } catch {
        // stdin may already be closed
      }

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        logger.warn(`[user-hooks] command spawn error: ${err.message}`);
        resolve({ allowed: true });
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);

        if (timedOut) {
          logger.warn(`[user-hooks] command handler timed out after ${timeout}ms`);
          resolve({ allowed: true });
          return;
        }

        // Parse optional JSON output from stdout
        let parsed: UserHookOutput | null = null;
        try {
          const trimmed = stdout.trim();
          if (trimmed.startsWith('{')) {
            parsed = JSON.parse(trimmed) as UserHookOutput;
          }
        } catch {
          // stdout is plain text — not JSON, ignore parse error
        }

        if (code === 0) {
          resolve({
            allowed: true,
            updatedInput: parsed?.updatedInput,
            additionalContext: parsed?.additionalContext,
            feedback: parsed?.reason,
          });
        } else if (code === 2) {
          // Exit 2 = BLOCK (Standard convention)
          const feedback = stderr.trim() || stdout.trim() || 'Blocked by hook';
          logger.debug(`[user-hooks] command handler blocked action: ${feedback}`);
          resolve({ allowed: false, feedback });
        } else {
          // Any other non-zero exit: non-blocking warning
          logger.warn(`[user-hooks] command handler exited ${code}: ${stderr.trim() || stdout.trim()}`);
          resolve({ allowed: true });
        }
      });
    });
  }

  // ─── HTTP Handler ─────────────────────────────────────────────────────────

  private async executeHttp(
    handler: UserHookHandler,
    context: HookContext,
    event: UserHookEvent
  ): Promise<HookResult> {
    if (!handler.url) {
      logger.warn('[user-hooks] http handler missing `url` field');
      return { allowed: true };
    }

    const timeout = handler.timeout ?? 10_000;
    const resolvedHeaders = handler.headers ? resolveHeaderEnvVars(handler.headers) : {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(handler.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...resolvedHeaders,
        },
        body: JSON.stringify({ event, ...context }),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const body = await response.text();

      let parsed: UserHookOutput | null = null;
      try {
        const trimmed = body.trim();
        if (trimmed.startsWith('{')) {
          parsed = JSON.parse(trimmed) as UserHookOutput;
        }
      } catch {
        // plain text body — acceptable
      }

      if (response.ok) {
        // Check JSON-level decision override
        if (parsed?.decision === 'block') {
          return { allowed: false, feedback: parsed.reason ?? body };
        }
        return {
          allowed: true,
          updatedInput: parsed?.updatedInput,
          additionalContext: parsed?.additionalContext,
        };
      } else if (response.status === 403) {
        // 403 = block (Standard convention for HTTP hooks)
        return { allowed: false, feedback: body || 'Blocked by HTTP hook' };
      } else {
        logger.warn(`[user-hooks] HTTP hook ${handler.url} returned ${response.status}`);
        return { allowed: true };
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[user-hooks] HTTP hook request failed: ${message}`);
      return { allowed: true };
    }
  }

  // ─── Prompt Handler ───────────────────────────────────────────────────────

  private async executePrompt(
    handler: UserHookHandler,
    _context: HookContext
  ): Promise<HookResult> {
    if (!handler.prompt) {
      logger.warn('[user-hooks] prompt handler missing `prompt` field');
      return { allowed: true };
    }

    // Prompt handlers require a live model integration. Deferred until a
    // model provider is wired via setPromptEvaluator().
    if (!_promptEvaluator) {
      logger.debug('[user-hooks] prompt handler skipped: no evaluator registered');
      return { allowed: true };
    }

    try {
      const decision = await _promptEvaluator(handler.prompt, _context);
      if (decision === 'deny') {
        return { allowed: false, feedback: 'Blocked by prompt hook' };
      }
      return { allowed: true };
    } catch (err) {
      logger.warn(`[user-hooks] prompt handler error: ${err}`);
      return { allowed: true };
    }
  }

  // ─── Agent Handler ────────────────────────────────────────────────────────

  private async executeAgent(
    handler: UserHookHandler,
    _context: HookContext
  ): Promise<HookResult> {
    if (!handler.agent?.prompt) {
      logger.warn('[user-hooks] agent handler missing `agent.prompt` field');
      return { allowed: true };
    }

    // Agent handlers spawn a read-only sub-agent. Deferred until an agent
    // spawner is wired via setAgentSpawner().
    if (!_agentSpawner) {
      logger.debug('[user-hooks] agent handler skipped: no spawner registered');
      return { allowed: true };
    }

    try {
      const result = await _agentSpawner(handler.agent, _context);
      return result;
    } catch (err) {
      logger.warn(`[user-hooks] agent handler error: ${err}`);
      return { allowed: true };
    }
  }

  /** Return the raw handler array for a given event (for introspection/tests). */
  getHandlers(event: UserHookEvent): UserHookHandler[] {
    return this.hooksMap[event] ?? [];
  }

  /** Return all configured events that have at least one handler. */
  getActiveEvents(): UserHookEvent[] {
    return (Object.keys(this.hooksMap) as UserHookEvent[]).filter(
      (e) => (this.hooksMap[e]?.length ?? 0) > 0
    );
  }
}

// ─── Optional integration hooks ──────────────────────────────────────────────

/**
 * Optional prompt evaluator for 'prompt' handler type.
 * Register via `setPromptEvaluator()` from a model-aware module.
 * Signature: (prompt, context) => Promise<'allow' | 'deny'>
 */
let _promptEvaluator:
  | ((prompt: string, context: HookContext) => Promise<'allow' | 'deny'>)
  | null = null;

export function setPromptEvaluator(
  fn: (prompt: string, context: HookContext) => Promise<'allow' | 'deny'>
): void {
  _promptEvaluator = fn;
}

/**
 * Optional agent spawner for 'agent' handler type.
 * Register via `setAgentSpawner()` from the agent registry.
 */
let _agentSpawner:
  | ((agentConfig: { role?: string; prompt: string }, context: HookContext) => Promise<HookResult>)
  | null = null;

export function setAgentSpawner(
  fn: (agentConfig: { role?: string; prompt: string }, context: HookContext) => Promise<HookResult>
): void {
  _agentSpawner = fn;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance: UserHooksManager | null = null;

/**
 * Get (or create) the singleton UserHooksManager for the given working
 * directory. Passing a new `cwd` replaces the existing instance.
 */
export function getUserHooksManager(cwd: string = process.cwd()): UserHooksManager {
  if (!_instance || _instance['configDir'] !== cwd) {
    _instance = new UserHooksManager(cwd);
  }
  return _instance;
}

/**
 * Reset the singleton (useful in tests).
 */
export function resetUserHooksManager(): void {
  _instance = null;
}
