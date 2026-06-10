/**
 * LiveLauncherBridge — run `buddy research` / `buddy flow` LIVE from Cowork.
 *
 * The pilotability matrix gated "research / flow live" on a configured
 * provider; the local Ollama ($0) lifts that gate. This bridge spawns the
 * BUILT core CLI as a child process (same doctrine as `spec.next` and
 * `autonomy.runTick`: the CLI owns the workflow, the GUI launches and
 * observes), streams stdout/stderr line-by-line to the renderer as
 * `liveLauncher.event` ServerEvents, supports cancel (SIGTERM→SIGKILL)
 * and a hard timeout, and reads the research report artifact on success.
 *
 * One run at a time — this is a launcher, not a job farm; the fleet saga
 * system is the multi-run surface.
 *
 * @module main/launcher/live-launcher-bridge
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';
import { resolveCoreEntry } from '../utils/core-loader';
import { resolveNodeBinary } from '../autonomy/autonomy-daemon-bridge';
import { sendToRenderer } from '../ipc-main-bridge';
import { log, logWarn } from '../utils/logger';
import type {
  LiveLauncherEventPayload,
  LiveLauncherRunView,
  LiveLauncherStartInput,
} from '../../shared/live-launcher-types';

const DEFAULT_MODEL = 'qwen2.5:7b-instruct';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_RESEARCH_TIMEOUT_MS = 300_000;
const DEFAULT_FLOW_TIMEOUT_MS = 600_000;
/** Grace beyond the CLI's own timeout before we SIGTERM ourselves. */
const TIMEOUT_GRACE_MS = 30_000;
const SIGKILL_GRACE_MS = 5_000;
const LOG_TAIL_CAP = 2_000;
const MAX_KEPT_RUNS = 20;

type SendFn = (event: { type: 'liveLauncher.event'; payload: LiveLauncherEventPayload }) => void;

export interface LiveLauncherBridgeOptions {
  send?: SendFn;
  spawnImpl?: typeof spawn;
  /** Where research reports land. Default ~/.codebuddy/research. */
  reportDir?: string;
  readReport?: (reportPath: string) => Promise<string>;
}

/** Build the CLI argv for a run. Pure — unit-tested. */
export function buildLiveLauncherArgs(
  input: LiveLauncherStartInput,
  runId: string,
  reportDir: string,
): { args: string[]; reportPath?: string } {
  const prompt = input.prompt.trim();
  const model = input.model?.trim() || DEFAULT_MODEL;
  if (input.kind === 'research') {
    const reportPath = path.join(reportDir, `cowork-${runId}.md`);
    const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_RESEARCH_TIMEOUT_MS;
    return {
      args: [
        'research',
        prompt,
        '--model',
        model,
        '--timeout-ms',
        String(timeoutMs),
        '--report',
        reportPath,
        ...(input.wide
          ? ['--wide', '--workers', String(input.workers && input.workers > 0 ? Math.min(input.workers, 20) : 5)]
          : []),
      ],
      reportPath,
    };
  }
  return {
    args: [
      'flow',
      prompt,
      '--model',
      model,
      '--verbose',
      '--max-retries',
      String(input.maxRetries && input.maxRetries >= 0 ? input.maxRetries : 1),
    ],
  };
}

/** Build the child env for a run. Pure — unit-tested. */
export function buildLiveLauncherEnv(
  input: LiveLauncherStartInput,
  node: { electronAsNode: boolean },
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...(node.electronAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    ...((input.provider ?? 'ollama') === 'ollama'
      ? {
          CODEBUDDY_PROVIDER: 'ollama',
          OLLAMA_HOST: input.ollamaUrl?.trim() || DEFAULT_OLLAMA_URL,
        }
      : {}),
  };
}

interface ActiveRun {
  view: LiveLauncherRunView;
  child: ChildProcess;
  timeoutTimer: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

export class LiveLauncherBridge {
  private readonly send: SendFn;
  private readonly spawnImpl: typeof spawn;
  private readonly reportDir: string;
  private readonly readReport: (reportPath: string) => Promise<string>;
  private readonly runs = new Map<string, LiveLauncherRunView>();
  private active: ActiveRun | null = null;
  private counter = 0;

  constructor(options: LiveLauncherBridgeOptions = {}) {
    this.send = options.send ?? ((event) => sendToRenderer(event as never));
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.reportDir = options.reportDir ?? path.join(os.homedir(), '.codebuddy', 'research');
    this.readReport = options.readReport ?? ((p) => fs.readFile(p, 'utf-8'));
  }

  start(input: LiveLauncherStartInput): { ok: boolean; error?: string; runId?: string; reportPath?: string } {
    if (input?.kind !== 'research' && input?.kind !== 'flow') {
      return { ok: false, error: 'kind must be "research" or "flow".' };
    }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      return { ok: false, error: input.kind === 'research' ? 'A research topic is required.' : 'A flow goal is required.' };
    }
    if (this.active && this.active.view.status === 'running') {
      return { ok: false, error: `A ${this.active.view.kind} run is already in progress — cancel it first.` };
    }
    const entry = resolveCoreEntry();
    if (!entry) {
      return { ok: false, error: 'Built Code Buddy CLI not found (run `npm run build` in the core repo first).' };
    }
    const node = resolveNodeBinary();
    if (!node) {
      return { ok: false, error: 'No node-compatible executable found to run the CLI.' };
    }

    const runId = `ll_${Date.now().toString(36)}_${++this.counter}`;
    const { args, reportPath } = buildLiveLauncherArgs(input, runId, this.reportDir);
    const env = buildLiveLauncherEnv(input, node);
    const timeoutMs =
      (input.timeoutMs && input.timeoutMs > 0
        ? input.timeoutMs
        : input.kind === 'research'
          ? DEFAULT_RESEARCH_TIMEOUT_MS
          : DEFAULT_FLOW_TIMEOUT_MS) + TIMEOUT_GRACE_MS;

    const view: LiveLauncherRunView = {
      runId,
      kind: input.kind,
      prompt: input.prompt.trim(),
      model: input.model?.trim() || DEFAULT_MODEL,
      provider: input.provider ?? 'ollama',
      status: 'running',
      startedAt: Date.now(),
      ...(reportPath ? { reportPath } : {}),
      logTail: [],
    };

    let child: ChildProcess;
    try {
      child = this.spawnImpl(node.execPath, [entry, ...args], { env });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const timeoutTimer = setTimeout(() => {
      logWarn('[live-launcher] hard timeout — terminating run', { runId });
      this.terminate('failed', `Timed out after ${timeoutMs}ms (launcher hard cap).`);
    }, timeoutMs);
    timeoutTimer.unref?.();

    this.active = { view, child, timeoutTimer };
    this.runs.set(runId, view);
    this.pruneRuns();

    let stdoutRemainder = '';
    let stderrRemainder = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutRemainder = this.ingest(view, 'stdout', stdoutRemainder + chunk.toString('utf-8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrRemainder = this.ingest(view, 'stderr', stderrRemainder + chunk.toString('utf-8'));
    });
    child.on('error', (err) => {
      void this.finishActive(view, null, err.message, { stdoutRemainder, stderrRemainder });
    });
    child.on('close', (code) => {
      void this.finishActive(view, code, undefined, { stdoutRemainder, stderrRemainder });
    });

    log('[live-launcher] started', { runId, kind: input.kind, model: view.model });
    this.emitStatus(view);
    return { ok: true, runId, ...(reportPath ? { reportPath } : {}) };
  }

  cancel(runId: string): { ok: boolean; error?: string } {
    if (!this.active || this.active.view.runId !== runId) {
      return { ok: false, error: `No active run with id '${runId}'.` };
    }
    if (this.active.view.status !== 'running') {
      return { ok: false, error: `Run '${runId}' is already terminal ('${this.active.view.status}').` };
    }
    this.terminate('cancelled', 'Cancelled by operator.');
    return { ok: true };
  }

  status(runId: string): LiveLauncherRunView | null {
    const run = this.runs.get(runId);
    return run ? { ...run, logTail: [...run.logTail] } : null;
  }

  list(): LiveLauncherRunView[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((run) => ({ ...run, logTail: [...run.logTail] }));
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Split buffered text into complete lines; emit + tail them; return the remainder. */
  private ingest(view: LiveLauncherRunView, stream: 'stdout' | 'stderr', buffered: string): string {
    const parts = buffered.split('\n');
    const remainder = parts.pop() ?? '';
    const lines = parts.map((line) => line.replace(/\r$/, '')).filter((line) => line.length > 0);
    if (lines.length > 0) {
      view.logTail.push(...lines);
      if (view.logTail.length > LOG_TAIL_CAP) {
        view.logTail.splice(0, view.logTail.length - LOG_TAIL_CAP);
      }
      this.send({ type: 'liveLauncher.event', payload: { runId: view.runId, kind: 'log', stream, lines } });
    }
    return remainder;
  }

  /** SIGTERM the active child (SIGKILL after a grace), pre-setting the terminal status. */
  private terminate(status: 'failed' | 'cancelled', reason: string): void {
    const active = this.active;
    if (!active || active.view.status !== 'running') return;
    active.view.status = status;
    active.view.error = reason;
    try {
      active.child.kill('SIGTERM');
    } catch {
      /* already dead */
    }
    active.killTimer = setTimeout(() => {
      try {
        active.child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, SIGKILL_GRACE_MS);
    active.killTimer.unref?.();
  }

  private async finishActive(
    view: LiveLauncherRunView,
    exitCode: number | null,
    spawnError: string | undefined,
    remainders: { stdoutRemainder: string; stderrRemainder: string },
  ): Promise<void> {
    if (this.active?.view.runId !== view.runId) return;
    clearTimeout(this.active.timeoutTimer);
    if (this.active.killTimer) clearTimeout(this.active.killTimer);
    this.active = null;

    // Flush trailing partial lines so the last output isn't lost.
    if (remainders.stdoutRemainder.trim()) this.ingest(view, 'stdout', `${remainders.stdoutRemainder}\n`);
    if (remainders.stderrRemainder.trim()) this.ingest(view, 'stderr', `${remainders.stderrRemainder}\n`);

    view.endedAt = Date.now();
    if (exitCode !== null) view.exitCode = exitCode;

    const wasPreterminated = view.status !== 'running'; // cancel/timeout already set it
    if (!wasPreterminated) {
      if (spawnError) {
        view.status = 'failed';
        view.error = spawnError;
      } else if (exitCode === 0) {
        view.status = 'succeeded';
        if (view.kind === 'research' && view.reportPath) {
          try {
            view.result = await this.readReport(view.reportPath);
          } catch (err) {
            // Report unreadable — fall back to the log tail, stay honest.
            view.result = view.logTail.join('\n');
            logWarn('[live-launcher] report unreadable, falling back to log tail', {
              runId: view.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          view.result = view.logTail.join('\n');
        }
      } else {
        view.status = 'failed';
        view.error = `CLI exited with code ${exitCode}. ${view.logTail.slice(-5).join(' | ')}`.trim();
      }
    }

    log('[live-launcher] finished', { runId: view.runId, status: view.status, exitCode });
    this.emitStatus(view);
  }

  private emitStatus(view: LiveLauncherRunView): void {
    this.send({
      type: 'liveLauncher.event',
      payload: { runId: view.runId, kind: 'status', run: { ...view, logTail: [...view.logTail] } },
    });
  }

  private pruneRuns(): void {
    if (this.runs.size <= MAX_KEPT_RUNS) return;
    const oldest = Array.from(this.runs.values())
      .filter((run) => run.status !== 'running')
      .sort((a, b) => a.startedAt - b.startedAt);
    for (const run of oldest.slice(0, this.runs.size - MAX_KEPT_RUNS)) {
      this.runs.delete(run.runId);
    }
  }
}
