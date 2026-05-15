/**
 * HooksBridge — Claude Cowork parity Phase 3 step 13
 *
 * Reads and writes `.codebuddy/hooks.json` so the Cowork settings UI can
 * visually manage user-configurable hooks (PreToolUse, PostToolUse,
 * SessionStart, FileChanged, …). Each event maps to an ordered list of
 * handlers with type `command | http | prompt | agent`. Also exposes a
 * `test()` dry-run that executes a single command handler in the project
 * directory so authors can validate their script before saving.
 *
 * The core `UserHooksManager` still owns execution at runtime — this
 * bridge only touches the JSON config file, preserving full parity with
 * Code Buddy's format.
 *
 * @module main/hooks/hooks-bridge
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';

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
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TaskCreated'
  | 'TaskCompleted';

export const HOOK_EVENTS: UserHookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'Stop',
  'StopFailure',
  'FileChanged',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'TaskCreated',
  'TaskCompleted',
];

export type UserHookHandlerType = 'command' | 'http' | 'prompt' | 'agent';

export interface UserHookHandler {
  type: UserHookHandlerType;
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  prompt?: string;
  agent?: { role?: string; prompt: string };
  if?: string;
  timeout?: number;
}

export interface HooksConfigFile {
  hooks: Partial<Record<UserHookEvent, UserHookHandler[]>>;
}

export interface HookEntry {
  id: string;
  event: UserHookEvent;
  index: number;
  handler: UserHookHandler;
}

export interface HooksTestResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

export class HooksBridge {
  private workspaceDir: string | null = null;

  setWorkspace(dir: string | null): void {
    this.workspaceDir = dir;
  }

  private configPath(): string | null {
    if (!this.workspaceDir) return null;
    return path.join(this.workspaceDir, '.codebuddy', 'hooks.json');
  }

  async readConfig(): Promise<HooksConfigFile> {
    const p = this.configPath();
    if (!p) return { hooks: {} };
    try {
      const raw = await fs.readFile(p, 'utf-8');
      const parsed = JSON.parse(raw) as HooksConfigFile;
      return {
        hooks: parsed.hooks ?? {},
      };
    } catch {
      return { hooks: {} };
    }
  }

  async writeConfig(config: HooksConfigFile): Promise<void> {
    const p = this.configPath();
    if (!p) throw new Error('No workspace directory');
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(config, null, 2), 'utf-8');
  }

  async list(): Promise<HookEntry[]> {
    const config = await this.readConfig();
    const entries: HookEntry[] = [];
    for (const ev of HOOK_EVENTS) {
      const handlers = config.hooks[ev] ?? [];
      handlers.forEach((handler, idx) => {
        entries.push({
          id: `${ev}:${idx}`,
          event: ev,
          index: idx,
          handler,
        });
      });
    }
    return entries;
  }

  async upsert(
    event: UserHookEvent,
    handler: UserHookHandler,
    index?: number
  ): Promise<{ success: boolean; entry?: HookEntry; error?: string }> {
    try {
      const config = await this.readConfig();
      const list = config.hooks[event] ?? [];
      if (typeof index === 'number' && index >= 0 && index < list.length) {
        list[index] = handler;
      } else {
        list.push(handler);
      }
      config.hooks[event] = list;
      await this.writeConfig(config);
      const newIndex = typeof index === 'number' ? index : list.length - 1;
      return {
        success: true,
        entry: {
          id: `${event}:${newIndex}`,
          event,
          index: newIndex,
          handler,
        },
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async remove(event: UserHookEvent, index: number): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.readConfig();
      const list = config.hooks[event];
      if (!list || index < 0 || index >= list.length) {
        return { success: false, error: 'Hook not found' };
      }
      list.splice(index, 1);
      if (list.length === 0) {
        delete config.hooks[event];
      } else {
        config.hooks[event] = list;
      }
      await this.writeConfig(config);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Dry-run a hook handler. Supports `command` (spawn shell), `http`
   * (POST with synthetic dry-run body), and `prompt` (single LLM
   * round-trip via pi-ai's `completeSimple`). `agent` handlers spawn
   * a bounded dry-run sub-agent through the local bridge.
   */
  async test(handler: UserHookHandler): Promise<HooksTestResult> {
    if (handler.type === 'command') {
      return this.testCommandHandler(handler);
    }
    if (handler.type === 'http') {
      return this.testHttpHandler(handler);
    }
    if (handler.type === 'prompt') {
      return this.testPromptHandler(handler);
    }
    if (handler.type === 'agent') {
      return this.testAgentHandler(handler);
    }
    const unknownType = (handler as { type?: string }).type ?? 'unknown';
    return {
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      error: `Unsupported hook handler type: ${unknownType}`,
    };
  }

  /**
   * Dry-run an `agent`-type handler: spawn a sub-agent with the
   * configured prompt + role, wait up to 10 s, return the result. Used
   * by the SettingsHooks Test button.
   */
  private async testAgentHandler(handler: UserHookHandler): Promise<HooksTestResult> {
    const prompt = handler.agent?.prompt?.trim();
    if (!prompt) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'Empty agent.prompt',
      };
    }
    try {
      const { dryRunSubAgent } = await import('../agent/sub-agent-bridge');
      const result = await dryRunSubAgent(
        prompt,
        handler.agent?.role,
        handler.timeout ?? 10_000
      );
      const ok = result.status === 'completed';
      return {
        success: ok,
        exitCode: ok ? 0 : 1,
        stdout: result.result ?? `(agent ${result.status})`,
        stderr: result.error ?? '',
        durationMs: result.durationMs,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async testCommandHandler(handler: UserHookHandler): Promise<HooksTestResult> {
    if (!handler.command) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'Empty command',
      };
    }
    if (!this.workspaceDir) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'No workspace directory',
      };
    }
    const start = Date.now();
    const timeout = handler.timeout ?? 10_000;
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd' : 'sh';
    const shellFlag = isWindows ? '/c' : '-c';

    return new Promise<HooksTestResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let finished = false;
      const child = spawn(shell, [shellFlag, handler.command as string], {
        cwd: this.workspaceDir as string,
        env: { ...process.env, CODEBUDDY_HOOK_DRY_RUN: '1' },
      });
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try {
          child.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          error: `Timed out after ${timeout}ms`,
        });
      }, timeout);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: null,
          stdout,
          stderr,
          durationMs: Date.now() - start,
          error: err.message,
        });
      });
      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
          durationMs: Date.now() - start,
        });
      });
    });
  }

  /**
   * Dry-run an HTTP handler: POST a synthetic body with the
   * `X-CodeBuddy-Hook-DryRun: 1` header so the receiver can choose to
   * skip side effects. We don't follow redirects and we cap response
   * body to 64 KB to keep the UI snappy.
   */
  private async testHttpHandler(handler: UserHookHandler): Promise<HooksTestResult> {
    const url = handler.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'Invalid HTTP url (must start with http:// or https://)',
      };
    }
    const start = Date.now();
    const timeout = handler.timeout ?? 10_000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-codebuddy-hook-dryrun': '1',
      ...(handler.headers ?? {}),
    };
    const body = JSON.stringify({
      tool: 'sample',
      event: 'PreToolUse',
      dryRun: true,
      cwd: this.workspaceDir ?? process.cwd(),
    });
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers,
        body,
        redirect: 'manual',
      });
      clearTimeout(timer);
      // Cap response read to 64 KB to keep the UI fast.
      const reader = res.body?.getReader();
      let stdout = '';
      let total = 0;
      const cap = 64 * 1024;
      if (reader) {
        const decoder = new TextDecoder();
        while (total < cap) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const remaining = cap - total;
            const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
            stdout += decoder.decode(chunk, { stream: true });
            total += chunk.byteLength;
          }
        }
        stdout += decoder.decode();
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
      }
      return {
        success: res.ok,
        exitCode: res.status,
        stdout,
        stderr: '',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      clearTimeout(timer);
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Timed out after ${timeout}ms`
            : err.message
          : String(err);
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - start,
        error: message,
      };
    }
  }
  /**
   * Dry-run a prompt handler: send the prompt to the configured LLM
   * (no agent loop, no tool use) and return the answer text. Useful
   * for authors to verify their prompt template before wiring it to
   * the real lifecycle event.
   */
  private async testPromptHandler(handler: UserHookHandler): Promise<HooksTestResult> {
    const prompt = handler.prompt?.trim();
    if (!prompt) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        error: 'Empty prompt',
      };
    }
    const start = Date.now();
    try {
      const { dryRunPromptHook } = await import('../claude/claude-sdk-one-shot');
      const { configStore } = await import('../config/config-store');
      const config = configStore.getAll();
      const result = await dryRunPromptHook(prompt, config);
      return {
        success: true,
        exitCode: 0,
        stdout: result.text || (result.hasThinking
          ? '(model returned only a thinking block; see logs)'
          : ''),
        stderr: '',
        durationMs: result.durationMs,
      };
    } catch (err) {
      return {
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

let singleton: HooksBridge | null = null;

export function getHooksBridge(): HooksBridge {
  if (!singleton) {
    singleton = new HooksBridge();
  }
  return singleton;
}
