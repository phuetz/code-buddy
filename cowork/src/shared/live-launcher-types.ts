/**
 * Research / Flow live launcher — shared payload types between the
 * main-process bridge, the preload surface, and the renderer panel.
 *
 * The launcher runs the REAL core CLI (`buddy research` / `buddy flow`)
 * as a child process — the GUI launches and observes, the CLI owns the
 * workflow (same doctrine as `spec.next` and `autonomy.runTick`).
 */

export type LiveLauncherKind = 'research' | 'flow';

export type LiveLauncherRunStatusValue = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface LiveLauncherStartInput {
  kind: LiveLauncherKind;
  /** Research topic or flow goal. */
  prompt: string;
  /** Model override (default: the autonomy ladder's local $0 choice). */
  model?: string;
  /** 'ollama' (default — $0 local) pins CODEBUDDY_PROVIDER; 'inherit' uses ambient env. */
  provider?: 'ollama' | 'inherit';
  /** Ollama base URL when provider==='ollama' (default http://localhost:11434). */
  ollamaUrl?: string;
  /** Research only — force the parallel-worker (Manus-style) mode in headless runs. */
  wide?: boolean;
  /** Research only — worker count for wide mode. */
  workers?: number;
  /** Flow only — max retries per failed step. */
  maxRetries?: number;
  /** Overall timeout. Defaults: 300_000 (research) / 600_000 (flow). */
  timeoutMs?: number;
}

export interface LiveLauncherRunView {
  runId: string;
  kind: LiveLauncherKind;
  prompt: string;
  model?: string;
  provider: 'ollama' | 'inherit';
  status: LiveLauncherRunStatusValue;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
  /** Research artifact path (markdown report). */
  reportPath?: string;
  /** Capped tail of stdout+stderr lines. */
  logTail: string[];
  /** Final output: research report content, or the flow's stdout. */
  result?: string;
  error?: string;
}

export type LiveLauncherEventPayload =
  | { runId: string; kind: 'log'; stream: 'stdout' | 'stderr'; lines: string[] }
  | { runId: string; kind: 'status'; run: LiveLauncherRunView };
