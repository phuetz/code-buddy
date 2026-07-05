/**
 * StudioDevServer — Cowork App Studio orchestration around the core
 * `app_server` tool. The core tool owns process spawning, loopback checks,
 * port ownership, and dev-origin registration; this service only adapts it to
 * Studio-facing state.
 *
 * @module main/studio/dev-server-service
 */

import { loadCoreModule } from '../utils/core-loader.js';

type ToolResult<TData = unknown> = {
  success: boolean;
  output?: string;
  error?: string;
  data?: TData;
};

interface CoreAppServerTool {
  start(input: { cwd: string; command: string; url: string; timeoutMs?: number }): Promise<ToolResult>;
  stop(pid: number): Promise<ToolResult>;
  status(): Promise<ToolResult>;
  logs(pid: number, opts?: { lines?: number; stderr?: boolean }): Promise<ToolResult>;
}

interface CoreAppServerModule {
  getAppServerTool(): CoreAppServerTool;
}

export type StudioServerState = 'running' | 'dead' | 'unknown';

export interface StudioDevServerStartInput {
  cwd: string;
  command: string;
  url: string;
  timeoutMs?: number;
}

export interface StudioDevServerStartResult {
  pid: number;
  origin: string;
  url: string;
}

export interface StudioDevServerInstance extends StudioDevServerStartResult {
  command: string;
  cwd: string;
  state: StudioServerState;
  startedAt: string;
  updatedAt: string;
}

export interface StudioDevServerStatus {
  instances: StudioDevServerInstance[];
  raw: string;
}

export interface StudioDevServerLogs {
  pid: number;
  output: string;
  lines: string[];
}

export type StudioDevServerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function extractStartData(value: unknown): StudioDevServerStartResult | null {
  const record = asRecord(value);
  if (!record) return null;
  const pid = record.pid;
  const origin = record.origin;
  const url = record.url;
  if (typeof pid !== 'number' || !Number.isFinite(pid)) return null;
  if (typeof origin !== 'string' || !origin) return null;
  if (typeof url !== 'string' || !url) return null;
  return { pid, origin, url };
}

function linesFromOutput(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.length > 0);
}

export class StudioDevServer {
  private readonly instances = new Map<number, StudioDevServerInstance>();
  private toolPromise: Promise<CoreAppServerTool | null> | null = null;

  async start(input: StudioDevServerStartInput): Promise<StudioDevServerResult<StudioDevServerStartResult>> {
    try {
      const cwd = input.cwd.trim();
      const command = input.command.trim();
      const url = input.url.trim();
      if (!cwd) return { ok: false, error: 'cwd is required' };
      if (!command) return { ok: false, error: 'command is required' };
      if (!url) return { ok: false, error: 'url is required' };

      const tool = await this.getTool();
      if (!tool) return { ok: false, error: 'Core app_server tool is unavailable' };

      const result = await tool.start({
        cwd,
        command,
        url,
        ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
      });
      if (!result.success) {
        return { ok: false, error: result.error ?? result.output ?? 'app_server start failed' };
      }

      const data = extractStartData(result.data);
      if (!data) return { ok: false, error: 'app_server returned invalid start data' };

      const now = new Date().toISOString();
      this.instances.set(data.pid, {
        ...data,
        command,
        cwd,
        state: 'running',
        startedAt: now,
        updatedAt: now,
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async stop(pid: number): Promise<StudioDevServerResult<{ pid: number; output: string }>> {
    try {
      if (!Number.isFinite(pid)) return { ok: false, error: 'pid must be a finite number' };
      const tool = await this.getTool();
      if (!tool) return { ok: false, error: 'Core app_server tool is unavailable' };

      const result = await tool.stop(pid);
      if (!result.success) {
        return { ok: false, error: result.error ?? result.output ?? 'app_server stop failed' };
      }
      this.mark(pid, 'dead');
      return { ok: true, data: { pid, output: result.output ?? '' } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async status(): Promise<StudioDevServerResult<StudioDevServerStatus>> {
    try {
      const tool = await this.getTool();
      if (!tool) return { ok: false, error: 'Core app_server tool is unavailable' };

      const result = await tool.status();
      if (!result.success) {
        return { ok: false, error: result.error ?? result.output ?? 'app_server status failed' };
      }
      const raw = result.output ?? '';
      this.refreshFromStatus(raw);
      return { ok: true, data: { instances: [...this.instances.values()], raw } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  async logs(pid: number, lines?: number): Promise<StudioDevServerResult<StudioDevServerLogs>> {
    try {
      if (!Number.isFinite(pid)) return { ok: false, error: 'pid must be a finite number' };
      const tool = await this.getTool();
      if (!tool) return { ok: false, error: 'Core app_server tool is unavailable' };

      const result = await tool.logs(pid, lines ? { lines } : undefined);
      if (!result.success) {
        return { ok: false, error: result.error ?? result.output ?? 'app_server logs failed' };
      }
      const output = result.output ?? '';
      return { ok: true, data: { pid, output, lines: linesFromOutput(output) } };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async getTool(): Promise<CoreAppServerTool | null> {
    this.toolPromise ??= loadCoreModule<CoreAppServerModule>('tools/app-server-tool.js')
      .then((mod) => mod?.getAppServerTool() ?? null)
      .catch(() => null);
    return this.toolPromise;
  }

  private refreshFromStatus(raw: string): void {
    const now = new Date().toISOString();
    for (const instance of this.instances.values()) {
      const marker = `pid ${instance.pid} `;
      if (!raw.includes(marker)) {
        instance.state = instance.state === 'running' ? 'dead' : instance.state;
        instance.updatedAt = now;
        continue;
      }
      const line = raw.split(/\r?\n/).find((entry) => entry.includes(marker)) ?? '';
      instance.state = line.includes('[running') ? 'running' : 'dead';
      instance.updatedAt = now;
    }
  }

  private mark(pid: number, state: StudioServerState): void {
    const instance = this.instances.get(pid);
    if (!instance) return;
    instance.state = state;
    instance.updatedAt = new Date().toISOString();
  }
}
