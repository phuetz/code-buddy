import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { log, logError } from './utils/logger';

const BOOT_LOG_CAP = 200;
const BOOT_LINE_CAP = 2048;
const PROBE_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 30000;
let bootLog: string[] = [];

type Result = { success: boolean; error?: string };
type Config = { url: string; port: number; external: boolean; directory: string };
type OwnedProcess = {
  child: ChildProcess;
  config: Config;
  ready: boolean;
  stopping: boolean;
  closed: Promise<void>;
  controller: AbortController;
};
let owned: OwnedProcess | null = null;
let starting: Promise<Result> | null = null;
let startController: AbortController | null = null;

function pushBootLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed) bootLog.push(trimmed.slice(0, BOOT_LINE_CAP));
  }
  bootLog = bootLog.slice(-BOOT_LOG_CAP);
}

function config(): Config {
  // Explicit URL means connect-only: its lifecycle belongs to another manager.
  // Keep the historical npm dev / port 8080 contract for local launches.
  const explicit = process.env.CODEBUDDY_WORKFLOW_URL;
  const url = new URL(explicit || 'http://127.0.0.1:8080');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('CODEBUDDY_WORKFLOW_URL must be an HTTP(S) URL without credentials or fragment');
  }
  return {
    url: url.href,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    external: Boolean(explicit),
    directory: process.env.CODEBUDDY_WORKFLOW_DIR || join(process.env.HOME || process.env.USERPROFILE || '', 'workflow'),
  };
}

/** Checks the editor identity, not the health of every execution backend. */
async function probe(url: string, signal?: AbortSignal): Promise<{ reachable: boolean; ready: boolean; embeddable?: boolean }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, PROBE_TIMEOUT_MS);
  let reachable = false;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error', cache: 'no-store' });
    reachable = true;
    // Cowork has a different origin. Without an explicit embedding contract,
    // honor restrictive response headers and offer the browser instead.
    const frameOptions = response.headers.get('x-frame-options');
    const csp = response.headers.get('content-security-policy') || '';
    const embeddable = !frameOptions && !/(?:^|[;,])\s*frame-ancestors\b/i.test(csp);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return { reachable, ready: false };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    try {
      while (bytes < 65536) {
        const { value, done } = await reader.read();
        if (done) break;
        const remaining = 65536 - bytes;
        bytes += value.byteLength;
        html += decoder.decode(value.subarray(0, remaining), { stream: true });
        const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        if (title !== undefined) {
          return { reachable, ready: /\bWorkflow\s*Builder\b|\bWorkflow Automation Platform\b/i.test(title), embeddable };
        }
      }
    } finally {
      await reader.cancel();
    }
    return { reachable, ready: false };
  } catch {
    return { reachable, ready: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 250);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function terminate(record: OwnedProcess): void {
  if (record.stopping) return;
  record.stopping = true;
  record.ready = false;
  record.controller.abort();
  // npm dev can own Vite/concurrently children. Only signal our own process group.
  if (process.platform !== 'win32' && record.child.pid) process.kill(-record.child.pid, 'SIGTERM');
  else record.child.kill('SIGTERM');
}

async function launch(controller: AbortController): Promise<Result> {
  bootLog = [];
  try {
    const settings = owned?.config || config();
    const before = await probe(settings.url, controller.signal);
    if (controller.signal.aborted) throw new Error('Startup cancelled');
    if (settings.external) {
      if (!before.ready) throw new Error('Configured URL is unavailable or is not the WorkflowBuilder editor');
      pushBootLog(`Connected to configured WorkflowBuilder: ${settings.url} (externally managed)`);
      return { success: true };
    }
    if (owned) {
      if (owned.ready && before.ready && !owned.stopping) return { success: true };
      throw new Error('Owned WorkflowBuilder is not ready; stop it before retrying');
    }
    if (before.reachable) throw new Error('Local port is already occupied; use CODEBUDDY_WORKFLOW_URL to connect to an existing WorkflowBuilder');
    log('[WorkflowService] Starting external workflow builder...');
    pushBootLog(`Starting WorkflowBuilder (npm run dev); waiting for ${settings.url}`);
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
      cwd: settings.directory,
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    });
    let settleClosed!: () => void;
    const record: OwnedProcess = {
      child, config: settings, ready: false, stopping: false, controller,
      closed: new Promise<void>((resolve) => { settleClosed = resolve; }),
    };
    owned = record;
    let failure: string | undefined;
    child.stdout?.on('data', (data) => pushBootLog(data.toString()));
    child.stderr?.on('data', (data) => pushBootLog(data.toString()));
    const closed = () => {
      record.ready = false;
      controller.abort();
      if (owned === record) owned = null;
      settleClosed();
    };
    child.on('error', (error) => {
      failure = `Failed to start WorkflowBuilder: ${error.message}`;
      pushBootLog(failure);
      logError(`[WorkflowService] ${failure}`);
      closed();
    });
    child.on('close', (code) => {
      failure ||= `WorkflowBuilder exited with code ${code}`;
      pushBootLog(failure);
      closed();
    });
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!controller.signal.aborted && Date.now() < deadline) {
      const result = await probe(settings.url, controller.signal);
      if (controller.signal.aborted) break;
      if (result.ready) {
        record.ready = true;
        pushBootLog(`WorkflowBuilder editor ready: ${settings.url}`);
        return { success: true };
      }
      await pause(controller.signal);
    }
    if (owned === record) terminate(record);
    throw new Error(failure || (Date.now() >= deadline ? 'Timed out waiting for WorkflowBuilder editor' : 'Startup cancelled'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushBootLog(message);
    logError(`[WorkflowService] ${message}`);
    return { success: false, error: message };
  }
}

export const WorkflowService = {
  start(): Promise<Result> {
    if (starting) return starting;
    const controller = new AbortController();
    startController = controller;
    starting = launch(controller).finally(() => {
      starting = null;
      if (startController === controller) startController = null;
    });
    return starting;
  },

  async stop(): Promise<Result> {
    startController?.abort();
    const record = owned;
    if (!record) {
      if (starting) await starting;
      return { success: true }; // No external service is ever signalled.
    }
    try {
      terminate(record);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const closed = await Promise.race([
        record.closed.then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 2000); }),
      ]);
      clearTimeout(timer);
      if (!closed) return { success: false, error: 'Stop requested; owned process has not exited yet' };
      pushBootLog('Stopped owned WorkflowBuilder');
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  async status() {
    try {
      const record = owned;
      const settings = record?.config || config();
      const result = settings.external || record?.ready ? await probe(settings.url) : { ready: false, embeddable: false };
      return {
        running: result.ready && (settings.external || (owned === record && !record?.stopping)),
        port: settings.port, url: settings.url, managed: Boolean(record),
        external: settings.external, starting: Boolean(starting),
        embeddable: result.ready && result.embeddable === true,
      };
    } catch (error) {
      return { running: false, port: 8080, url: '', managed: false, external: false, starting: false, error: String(error) };
    }
  },

  logs(limit = 50): { lines: string[] } {
    const count = Number.isFinite(limit) ? Math.max(0, Math.min(BOOT_LOG_CAP, Math.floor(limit))) : 50;
    return { lines: count ? bootLog.slice(-count) : [] };
  },
};
