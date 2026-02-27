/**
 * Advanced Hook System
 *
 * Extends the basic hook system with Claude Code-like capabilities:
 * - Command hooks: run shell commands, parse JSON stdout for decisions
 * - Prompt hooks: LLM-evaluated hooks (stub - returns allow with stored prompt)
 * - Agent hooks: spawns subagent evaluation (stub - returns allow)
 *
 * Supports event matching with regex matchers, async fire-and-forget,
 * one-shot hooks, and a registry for CRUD operations.
 */

import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type AdvancedHookType = 'command' | 'prompt' | 'agent';

export enum HookEvent {
  PreToolUse = 'PreToolUse',
  PostToolUse = 'PostToolUse',
  PreBash = 'PreBash',
  PostBash = 'PostBash',
  PreEdit = 'PreEdit',
  PostEdit = 'PostEdit',
  SessionStart = 'SessionStart',
  SessionEnd = 'SessionEnd',
  PreCompact = 'PreCompact',
  Notification = 'Notification',
  SubagentStart = 'SubagentStart',
  SubagentStop = 'SubagentStop',
  PermissionRequest = 'PermissionRequest',
  TaskCompleted = 'TaskCompleted',
  ConfigChange = 'ConfigChange',
}

export interface AdvancedHook {
  name: string;
  event: HookEvent;
  type: AdvancedHookType;
  matcher?: RegExp;
  command?: string;
  prompt?: string;
  async?: boolean;
  once?: boolean;
}

export interface HookDecision {
  action: 'allow' | 'deny' | 'ask';
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
  continue?: boolean;
}

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  [key: string]: unknown;
}

// ============================================================================
// AdvancedHookRunner
// ============================================================================

export class AdvancedHookRunner {
  private workingDirectory: string;
  private timeout: number;

  constructor(workingDirectory: string = process.cwd(), timeout: number = 30000) {
    this.workingDirectory = workingDirectory;
    this.timeout = timeout;
  }

  /**
   * Run a hook and return a decision
   */
  async runHook(hook: AdvancedHook, context: HookContext): Promise<HookDecision> {
    switch (hook.type) {
      case 'command':
        return this.runCommandHook(hook, context);
      case 'prompt':
        return this.runPromptHook(hook, context);
      case 'agent':
        return this.runAgentHook(hook, context);
      default:
        logger.warn(`Unknown hook type: ${hook.type}`, { source: 'AdvancedHookRunner' });
        return { action: 'allow' };
    }
  }

  /**
   * Fire-and-forget async hook execution
   */
  async runHookAsync(hook: AdvancedHook, context: HookContext): Promise<void> {
    this.runHook(hook, context).catch((error) => {
      logger.warn(`Async hook "${hook.name}" failed: ${error}`, { source: 'AdvancedHookRunner' });
    });
  }

  /**
   * Check if a hook matches a given event and optional tool name
   */
  matchesEvent(hook: AdvancedHook, event: HookEvent, toolName?: string): boolean {
    if (hook.event !== event) {
      return false;
    }

    if (hook.matcher && toolName) {
      return hook.matcher.test(toolName);
    }

    // If no matcher, match all tools for that event
    if (!hook.matcher) {
      return true;
    }

    // Has matcher but no toolName provided - no match
    return false;
  }

  private async runCommandHook(hook: AdvancedHook, context: HookContext): Promise<HookDecision> {
    if (!hook.command) {
      logger.warn(`Command hook "${hook.name}" has no command`, { source: 'AdvancedHookRunner' });
      return { action: 'allow' };
    }

    return new Promise<HookDecision>((resolve) => {
      let timedOut = false;

      const child = spawn(hook.command!, [], {
        cwd: this.workingDirectory,
        shell: true,
        env: {
          ...process.env,
          HOOK_EVENT: context.event,
          HOOK_TOOL: context.toolName || '',
          HOOK_INPUT: JSON.stringify(context.input || {}),
        },
      });

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, this.timeout);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          logger.warn(`Command hook "${hook.name}" timed out`, { source: 'AdvancedHookRunner' });
          resolve({ action: 'allow' });
          return;
        }

        if (code !== 0) {
          logger.warn(`Command hook "${hook.name}" exited with code ${code}: ${stderr}`, { source: 'AdvancedHookRunner' });
          resolve({ action: 'allow' });
          return;
        }

        try {
          const decision = JSON.parse(stdout.trim()) as HookDecision;
          if (decision.action && ['allow', 'deny', 'ask'].includes(decision.action)) {
            resolve(decision);
          } else {
            logger.warn(`Command hook "${hook.name}" returned invalid action`, { source: 'AdvancedHookRunner' });
            resolve({ action: 'allow' });
          }
        } catch {
          // Non-JSON output: if exit code 0, allow; non-zero handled above
          resolve({ action: 'allow' });
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.warn(`Command hook "${hook.name}" failed: ${error.message}`, { source: 'AdvancedHookRunner' });
        resolve({ action: 'allow' });
      });
    });
  }

  private async runPromptHook(hook: AdvancedHook, context: HookContext): Promise<HookDecision> {
    if (!hook.prompt) {
      logger.debug(`Prompt hook "${hook.name}" has no prompt, allowing`, { source: 'AdvancedHookRunner' });
      return { action: 'allow', additionalContext: undefined };
    }

    try {
      const { CodeBuddyClient } = await import('../codebuddy/client.js');
      const apiKey = process.env.GROK_API_KEY;
      if (!apiKey) {
        logger.warn(`Prompt hook "${hook.name}": no GROK_API_KEY, allowing`, { source: 'AdvancedHookRunner' });
        return { action: 'allow', additionalContext: hook.prompt };
      }

      const client = new CodeBuddyClient(apiKey);
      const prompt = `${hook.prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}\n\nRespond with exactly one of: ALLOW, DENY, or ASK. Then explain your reasoning.`;

      const response = await client.chat([{ role: 'user', content: prompt }], []);
      const content = response.choices[0]?.message?.content || '';
      const upper = content.toUpperCase();

      let action: 'allow' | 'deny' | 'ask' = 'allow';
      if (upper.includes('DENY')) action = 'deny';
      else if (upper.includes('ASK')) action = 'ask';

      return { action, additionalContext: content };
    } catch (error) {
      logger.warn(`Prompt hook "${hook.name}" LLM call failed, allowing`, {
        source: 'AdvancedHookRunner',
        error: error instanceof Error ? error.message : String(error),
      });
      return { action: 'allow', additionalContext: hook.prompt };
    }
  }

  private async runAgentHook(hook: AdvancedHook, context: HookContext): Promise<HookDecision> {
    try {
      const { CodeBuddyClient } = await import('../codebuddy/client.js');
      const apiKey = process.env.GROK_API_KEY;
      if (!apiKey) {
        logger.warn(`Agent hook "${hook.name}": no GROK_API_KEY, allowing`, { source: 'AdvancedHookRunner' });
        return { action: 'allow' };
      }

      const client = new CodeBuddyClient(apiKey);
      const systemPrompt = hook.prompt || `You are a security evaluation agent for hook "${hook.name}".`;
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Evaluate this action:\n${JSON.stringify(context, null, 2)}\n\nRespond with ALLOW, DENY, or ASK followed by your reasoning.` },
      ];

      const maxTurns = 3;
      let lastContent = '';

      for (let turn = 0; turn < maxTurns; turn++) {
        const response = await client.chat(messages, []);
        const choice = response.choices[0];
        lastContent = choice?.message?.content || '';

        if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
          break;
        }

        messages.push({ role: 'assistant', content: lastContent });
        messages.push({ role: 'user', content: 'Continue your evaluation.' });
      }

      const upper = lastContent.toUpperCase();
      let action: 'allow' | 'deny' | 'ask' = 'allow';
      if (upper.includes('DENY')) action = 'deny';
      else if (upper.includes('ASK')) action = 'ask';

      return { action, additionalContext: lastContent };
    } catch (error) {
      logger.warn(`Agent hook "${hook.name}" LLM call failed, allowing`, {
        source: 'AdvancedHookRunner',
        error: error instanceof Error ? error.message : String(error),
      });
      return { action: 'allow' };
    }
  }
}

// ============================================================================
// HookRegistry
// ============================================================================

export class HookRegistry {
  private hooks: Map<string, AdvancedHook> = new Map();
  private firedOnceHooks: Set<string> = new Set();

  /**
   * Add a hook to the registry
   */
  addHook(hook: AdvancedHook): void {
    this.hooks.set(hook.name, hook);
    logger.debug(`Hook "${hook.name}" registered for event ${hook.event}`, { source: 'HookRegistry' });
  }

  /**
   * Remove a hook by name
   */
  removeHook(name: string): boolean {
    const deleted = this.hooks.delete(name);
    this.firedOnceHooks.delete(name);
    if (deleted) {
      logger.debug(`Hook "${name}" removed`, { source: 'HookRegistry' });
    }
    return deleted;
  }

  /**
   * Get all hooks that match a given event, filtering out already-fired once hooks
   */
  getHooksForEvent(event: HookEvent, toolName?: string): AdvancedHook[] {
    const runner = new AdvancedHookRunner();
    const matching: AdvancedHook[] = [];

    for (const hook of this.hooks.values()) {
      // Skip once hooks that already fired
      if (hook.once && this.firedOnceHooks.has(hook.name)) {
        continue;
      }

      if (runner.matchesEvent(hook, event, toolName)) {
        matching.push(hook);
      }
    }

    return matching;
  }

  /**
   * Mark a once hook as fired
   */
  markFired(hookName: string): void {
    const hook = this.hooks.get(hookName);
    if (hook?.once) {
      this.firedOnceHooks.add(hookName);
    }
  }

  /**
   * List all registered hooks
   */
  listHooks(): AdvancedHook[] {
    return Array.from(this.hooks.values());
  }

  /**
   * Get a hook by name
   */
  getHook(name: string): AdvancedHook | undefined {
    return this.hooks.get(name);
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
    this.firedOnceHooks.clear();
  }

  /**
   * Get the number of registered hooks
   */
  get size(): number {
    return this.hooks.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let registryInstance: HookRegistry | null = null;
let runnerInstance: AdvancedHookRunner | null = null;

export function getHookRegistry(): HookRegistry {
  if (!registryInstance) {
    registryInstance = new HookRegistry();
  }
  return registryInstance;
}

export function getAdvancedHookRunner(workingDirectory?: string): AdvancedHookRunner {
  if (!runnerInstance || workingDirectory) {
    runnerInstance = new AdvancedHookRunner(workingDirectory);
  }
  return runnerInstance;
}

export function resetAdvancedHooks(): void {
  registryInstance = null;
  runnerInstance = null;
}
