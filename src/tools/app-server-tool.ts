/**
 * App Server Tool — managed dev-server lifecycle for the develop → launch →
 * browse → verify loop (the agent testing the app it just built).
 *
 * `start` spawns the given command in the background, waits until the given
 * loopback URL answers HTTP, then registers that origin as browsable
 * (security/dev-origins.ts). The registration lives exactly as long as the
 * process: exit or `stop` unregisters it.
 *
 * Security invariants:
 * - The readiness URL must be LOOPBACK — enforced here and again by the
 *   dev-origin registry.
 * - The port must be FREE before the spawn. If something already listens
 *   there, we refuse: the tool must never "adopt" a pre-existing local
 *   service (Ollama, a Docker API, an admin panel) and open the browser
 *   onto it. Only a server this tool itself started becomes browsable.
 * - `stop`/`logs` only accept PIDs of servers this tool started.
 */

import { spawn } from 'child_process';
import net from 'net';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getProcessTool } from './process-tool.js';
import { isLoopbackHost, registerDevOrigin, unregisterDevOrigin } from '../security/dev-origins.js';
import { protectedWorkspaceProcessRefusal } from '../security/git-secret-process-boundary.js';

export interface AppServerStartInput {
  /** Shell command that starts the server, e.g. "npm run dev". */
  command: string;
  /** Loopback URL to poll for readiness, e.g. http://127.0.0.1:5173/ */
  url: string;
  cwd?: string;
  /** Total readiness budget in ms (default 45s). */
  timeoutMs?: number;
  /** Extra env vars merged over process.env; a value of undefined REMOVES the var. */
  env?: Record<string, string | undefined>;
}

interface AppServerRecord {
  pid: number;
  command: string;
  origin: string;
  url: string;
  cwd: string;
  startedAt: Date;
  running: boolean;
  tunnel?: {
    pid: number;
    url: string;
    expiresAt: number;
    ttlTimer: NodeJS.Timeout;
  };
}

const READINESS_POLL_MS = 250;
const DEFAULT_TIMEOUT_MS = 45_000;
const STOP_GRACE_MS = 3_000;
const TUNNEL_URL_TIMEOUT_MS = 20_000;
const DEFAULT_TUNNEL_TTL_MS = 30 * 60_000;
// cloudflared quick-tunnel banner, or the TUNNEL_URL= contract for custom bins.
const TUNNEL_URL_PATTERNS = [
  /TUNNEL_URL=(https:\/\/\S+)/,
  /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i,
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if something accepts TCP connections on host:port. */
function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

/** Any HTTP response (even 4xx/5xx) means the server is up and owning the port. */
async function answersHttp(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      await fetch(url, { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class AppServerTool {
  private servers = new Map<number, AppServerRecord>();
  private exitHookInstalled = false;

  async start(input: AppServerStartInput): Promise<ToolResult> {
    const command = input.command?.trim();
    if (!command) {
      return { success: false, error: 'command is required (e.g. "npm run dev")' };
    }

    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return { success: false, error: `Invalid readiness url: ${input.url}` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: `Readiness url must be http(s), got ${parsed.protocol}` };
    }
    if (!isLoopbackHost(parsed.hostname)) {
      return {
        success: false,
        error: `Readiness url must be loopback (localhost/127.x/::1), got ${parsed.hostname}. app_server only manages local dev servers.`,
      };
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;

    // Never adopt a pre-existing service: the port must be ours to open.
    if (await isPortListening(parsed.hostname, port)) {
      return {
        success: false,
        error: `Port ${port} on ${parsed.hostname} is already in use. app_server refuses to adopt a pre-existing service — stop it first or pick another port.`,
      };
    }

    const cwd = input.cwd ?? process.cwd();
    const processRefusal = protectedWorkspaceProcessRefusal(cwd);
    if (processRefusal) return processRefusal;
    const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...input.env };
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (value === undefined) delete childEnv[key];
    }
    const child = spawn(command, {
      shell: true,
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    if (child.pid === undefined) {
      return { success: false, error: `Failed to spawn: ${command}` };
    }
    const pid = child.pid;

    // Reuse the ProcessTool buffering so `process log`/`app_server logs` work.
    const processTool = getProcessTool();
    processTool.trackProcess(pid, command, child);

    const record: AppServerRecord = {
      pid,
      command,
      origin: parsed.origin,
      url: input.url,
      cwd,
      startedAt: new Date(),
      running: true,
    };
    this.servers.set(pid, record);
    this.installExitHook();

    child.on('exit', (code) => {
      record.running = false;
      unregisterDevOrigin(record.origin);
      this.killTunnel(record);
      logger.debug(`app_server ${pid} exited (code ${code}); dev origin ${record.origin} unregistered`);
    });

    // Readiness loop: bail fast if the process dies, else poll HTTP.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!record.running) {
        return {
          success: false,
          error: `Server process exited before becoming ready.\n${this.logTail(pid)}`,
        };
      }
      if (await answersHttp(input.url)) {
        const registration = registerDevOrigin(record.origin);
        if (!registration.ok) {
          await this.stop(pid);
          return { success: false, error: `Origin registration failed: ${registration.error}` };
        }
        return {
          success: true,
          output: [
            `Dev server ready (pid ${pid}).`,
            `Command: ${command}`,
            `Browsable origin: ${record.origin} (registered for this session; unregistered when the server stops)`,
            `Next: use the browser tool to navigate to ${input.url}, snapshot, interact, and check browser_console for errors.`,
          ].join('\n'),
          data: { pid, origin: record.origin, url: input.url },
        };
      }
      await sleep(READINESS_POLL_MS);
    }

    // Timed out: clean up — no zombie server, no dangling origin.
    await this.stop(pid);
    return {
      success: false,
      error: `Server did not answer on ${input.url} within ${timeoutMs}ms. Process killed.\n${this.logTail(pid)}`,
    };
  }

  async stop(pid: number): Promise<ToolResult> {
    const record = this.servers.get(pid);
    if (!record) {
      return { success: false, error: `Pid ${pid} is not an app_server-managed server.` };
    }

    unregisterDevOrigin(record.origin);
    this.killTunnel(record);

    if (record.running && isProcessAlive(pid)) {
      this.killGroup(pid, 'SIGTERM');
      const deadline = Date.now() + STOP_GRACE_MS;
      while (Date.now() < deadline && isProcessAlive(pid)) {
        await sleep(100);
      }
      if (isProcessAlive(pid)) {
        this.killGroup(pid, 'SIGKILL');
      }
    }
    record.running = false;

    return {
      success: true,
      output: `Server ${pid} stopped; origin ${record.origin} no longer browsable.\n${this.logTail(pid)}`,
    };
  }

  async status(): Promise<ToolResult> {
    if (this.servers.size === 0) {
      return { success: true, output: 'No app servers managed in this session.' };
    }
    const lines = [...this.servers.values()].map((record) => {
      const alive = record.running && isProcessAlive(record.pid);
      const uptime = Math.round((Date.now() - record.startedAt.getTime()) / 1000);
      const tunnel = record.tunnel
        ? ` — PUBLIC ${record.tunnel.url} (expires in ${Math.max(0, Math.round((record.tunnel.expiresAt - Date.now()) / 60_000))} min)`
        : '';
      return `pid ${record.pid} [${alive ? `running, ${uptime}s` : 'stopped'}] ${record.origin} — ${record.command}${tunnel}`;
    });
    return { success: true, output: lines.join('\n') };
  }

  async logs(pid: number, opts?: { lines?: number; stderr?: boolean }): Promise<ToolResult> {
    if (!this.servers.has(pid)) {
      return { success: false, error: `Pid ${pid} is not an app_server-managed server.` };
    }
    return getProcessTool().log(pid, opts);
  }

  /**
   * Expose a managed server through a public tunnel (cloudflared quick
   * tunnel by default). The Manus expose-port kill-chain is the anti-model
   * here: this NEVER happens implicitly — the tool call goes through the
   * normal confirmation gate, only servers this tool started can be
   * exposed, the URL expires after a TTL (default 30 min), and the tunnel
   * dies with the server.
   */
  async expose(pid: number, opts?: { ttlMinutes?: number }): Promise<ToolResult> {
    const record = this.servers.get(pid);
    if (!record) {
      return { success: false, error: `Pid ${pid} is not an app_server-managed server.` };
    }
    if (!record.running || !isProcessAlive(pid)) {
      return { success: false, error: `Server ${pid} is not running — nothing to expose.` };
    }
    if (record.tunnel) {
      return {
        success: true,
        output: `Already exposed: ${record.tunnel.url} (expires in ${Math.max(0, Math.round((record.tunnel.expiresAt - Date.now()) / 60_000))} min)`,
        data: { url: record.tunnel.url },
      };
    }

    const bin = process.env.CODEBUDDY_TUNNEL_BIN || 'cloudflared';
    const ttlMs = Math.min(
      Math.max(60_000, (opts?.ttlMinutes ?? 0) * 60_000 || Number(process.env.CODEBUDDY_PREVIEW_TTL_MS) || DEFAULT_TUNNEL_TTL_MS),
      4 * 60 * 60_000,
    );

    let tunnelChild;
    try {
      tunnelChild = spawn(bin, ['tunnel', '--url', record.url], {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return { success: false, error: `Cannot spawn tunnel binary "${bin}": ${err instanceof Error ? err.message : String(err)}` };
    }

    const url = await new Promise<string | null>((resolve) => {
      let buffer = '';
      const timer = setTimeout(() => resolve(null), TUNNEL_URL_TIMEOUT_MS);
      const scan = (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const pattern of TUNNEL_URL_PATTERNS) {
          const match = pattern.exec(buffer);
          if (match?.[1]) {
            clearTimeout(timer);
            resolve(match[1]);
            return;
          }
        }
      };
      tunnelChild.stdout?.on('data', scan);
      tunnelChild.stderr?.on('data', scan);
      tunnelChild.once('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      tunnelChild.once('exit', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    if (!url || tunnelChild.pid === undefined) {
      try {
        if (tunnelChild.pid !== undefined) this.killGroup(tunnelChild.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      return {
        success: false,
        error: `Tunnel did not produce a public URL within ${TUNNEL_URL_TIMEOUT_MS}ms (binary: ${bin}). Is cloudflared installed and outbound network available?`,
      };
    }

    const ttlTimer = setTimeout(() => {
      logger.info(`app_server preview TTL reached for pid ${pid}; closing tunnel ${url}`);
      const current = this.servers.get(pid);
      if (current) this.killTunnel(current);
    }, ttlMs);
    ttlTimer.unref();

    record.tunnel = { pid: tunnelChild.pid, url, expiresAt: Date.now() + ttlMs, ttlTimer };
    tunnelChild.on('exit', () => {
      const current = this.servers.get(pid);
      const tunnel = current?.tunnel;
      if (current && tunnel && tunnel.pid === tunnelChild.pid) {
        clearTimeout(tunnel.ttlTimer);
        current.tunnel = undefined;
      }
    });

    logger.warn(`app_server pid ${pid} (${record.origin}) is now PUBLICLY exposed at ${url} for ${Math.round(ttlMs / 60_000)} min`);
    return {
      success: true,
      output: [
        `PUBLIC preview URL: ${url}`,
        `Anyone with this link can reach ${record.origin} until it expires (${Math.round(ttlMs / 60_000)} min) or you run app_server unexpose/stop.`,
        `Never expose a server handling secrets or private data.`,
      ].join('\n'),
      data: { url, expiresAt: record.tunnel.expiresAt },
    };
  }

  /** Close the public tunnel, keep the server running. */
  async unexpose(pid: number): Promise<ToolResult> {
    const record = this.servers.get(pid);
    if (!record) {
      return { success: false, error: `Pid ${pid} is not an app_server-managed server.` };
    }
    if (!record.tunnel) {
      return { success: true, output: `Server ${pid} has no active public tunnel.` };
    }
    const url = record.tunnel.url;
    this.killTunnel(record);
    return { success: true, output: `Public tunnel closed: ${url} no longer reachable. Server ${pid} still runs locally.` };
  }

  private killTunnel(record: AppServerRecord): void {
    if (!record.tunnel) return;
    clearTimeout(record.tunnel.ttlTimer);
    try {
      this.killGroup(record.tunnel.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
    record.tunnel = undefined;
  }

  /** Server-side log tail for a managed origin (web_test's server oracle). */
  logTailForOrigin(origin: string, lines = 30): string | null {
    for (const record of this.servers.values()) {
      if (record.origin === origin) {
        return this.logTail(record.pid, lines);
      }
    }
    return null;
  }

  /** Stop everything (session end / tests). */
  async stopAll(): Promise<void> {
    for (const pid of [...this.servers.keys()]) {
      await this.stop(pid).catch(() => {});
    }
  }

  private logTail(pid: number, lines = 20): string {
    const managed = getProcessTool().getManagedProcesses().get(pid);
    if (!managed) return '(no logs)';
    const tail = [...managed.stdoutLines.slice(-lines), ...managed.stderrLines.slice(-lines)];
    return tail.length > 0 ? `Last output:\n${tail.join('\n')}` : '(no output yet)';
  }

  private killGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32') {
        process.kill(-pid, signal);
      } else {
        process.kill(pid, signal);
      }
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  }

  /** Best-effort: never leave detached dev servers running past our exit. */
  private installExitHook(): void {
    if (this.exitHookInstalled) return;
    this.exitHookInstalled = true;
    process.once('exit', () => {
      for (const record of this.servers.values()) {
        if (record.running) {
          try {
            process.kill(process.platform !== 'win32' ? -record.pid : record.pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
        }
      }
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let appServerToolInstance: AppServerTool | null = null;

export function getAppServerTool(): AppServerTool {
  if (!appServerToolInstance) {
    appServerToolInstance = new AppServerTool();
  }
  return appServerToolInstance;
}

/** Test hook: stops all managed servers, then drops the singleton. */
export async function resetAppServerTool(): Promise<void> {
  await appServerToolInstance?.stopAll();
  appServerToolInstance = null;
}
