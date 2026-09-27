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
  start(input: {
    cwd: string;
    command: string;
    url: string;
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
  }): Promise<ToolResult>;
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

/** Noms de variables de l'hôte qui ressemblent à un secret (clés d'API de Cowork, jetons…). */
const HOST_SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

/**
 * Environnement du serveur de dev : les secrets de l'HÔTE (clés d'API de
 * Cowork…) sont retirés — le code généré n'a pas à les voir —, les secrets
 * du PROJET (saisis dans App Studio, rangés hors du projet) sont ajoutés.
 */
export function devServerEnv(
  projectEnv: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of Object.keys(base)) if (HOST_SECRET_NAME.test(key)) env[key] = undefined;
  // Cowork tourne souvent avec NODE_ENV=production : hérité, il ferait servir
  // au serveur de DEV une app en mode production (React sans _debugSource ni
  // avertissements) — constaté dans la vraie fenêtre. Le projet peut le fixer.
  if ('NODE_ENV' in base) env.NODE_ENV = undefined;
  return { ...env, ...projectEnv };
}

export interface StudioDevServerOptions {
  /** Secrets du projet à injecter (processus principal seulement). */
  projectEnv?: (cwd: string) => Promise<Record<string, string>>;
  /** Masque les secrets du projet dans les journaux avant de les rendre au renderer. */
  redact?: (cwd: string, text: string) => Promise<string>;
}

export class StudioDevServer {
  private readonly instances = new Map<number, StudioDevServerInstance>();
  private toolPromise: Promise<CoreAppServerTool | null> | null = null;

  constructor(private readonly options: StudioDevServerOptions = {}) {}

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

      const projectEnv = this.options.projectEnv ? await this.options.projectEnv(cwd).catch(() => ({})) : {};
      const result = await tool.start({
        cwd,
        command,
        url,
        env: devServerEnv(projectEnv),
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
      const cwd = this.instances.get(pid)?.cwd;
      const raw = result.output ?? '';
      const output = cwd && this.options.redact ? await this.options.redact(cwd, raw).catch(() => '') : raw;
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
