/**
 * Sensory action executor — runs a rule's ACTION when a sensory event fires.
 *
 * SECURITY BOUNDARY (the camera sees the world → event data is untrusted/adversarial):
 *  - event data is passed to a shell/agent action via ENV (`VISION_*`) + stdin JSON,
 *    **never interpolated** into the command — a sign reading "; rm -rf" can't become code;
 *  - the (user-authored, fixed) command is still **hard-screened** for destructive patterns
 *    (rm -rf / dd / mkfs / sudo / fork bombs) and refused if matched;
 *  - run-as-user, SIGTERM timeout, no privilege escalation; best-effort, never throws.
 *
 * @module sensory/sensory-action-executor
 */
import { spawn } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { isDangerousCommand, matchAllDangerousPatterns } from '../security/dangerous-patterns.js';
import { sendTelegramAlert } from './alert.js';
import { buildFilteredSubprocessEnv } from '../utils/subprocess-env.js';
import { assertSafeUrl, isLoopbackHttpUrl } from '../security/ssrf-guard.js';
import { safeFetchFollow } from '../security/safe-fetch.js';

export interface SensoryEventContext {
  modality?: string;
  kind?: string;
  camera?: string;
  description?: string;
  imagePath?: string;
  salience?: number;
  payload?: Record<string, unknown>;
}

export type SensoryAction =
  | { type: 'shell'; command: string; timeoutMs?: number }
  | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'alert'; message?: string; photo?: boolean }
  | { type: 'agent'; prompt: string; timeoutMs?: number };

export interface ActionResult {
  ok: boolean;
  detail?: string;
}

/** Injection-safe context exposed to a shell/agent action (env, not interpolation). */
function actionEnv(ctx: SensoryEventContext): NodeJS.ProcessEnv {
  return buildFilteredSubprocessEnv({
    extraEnv: {
      VISION_KIND: ctx.kind ?? '',
      VISION_MODALITY: ctx.modality ?? '',
      VISION_CAMERA: ctx.camera ?? '',
      VISION_DESC: ctx.description ?? '',
      VISION_IMAGE: ctx.imagePath ?? '',
      VISION_SALIENCE: String(ctx.salience ?? ''),
    },
  });
}

/** Refuse a command that contains a destructive pattern (guardrail even for user rules). */
/** True when a shell command hits the dangerous-command set or a destructive bash pattern.
 *  Exported so the rules admin can run the SAME gate at write-time (reject a bad rule on save),
 *  not only at fire-time. */
export function isDestructive(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0] ?? '';
  return isDangerousCommand(firstWord) || matchAllDangerousPatterns(command, 'bash').length > 0;
}

function runShell(command: string, ctx: SensoryEventContext, timeoutMs: number): Promise<ActionResult> {
  if (isDestructive(command)) {
    logger.warn(`[rules] BLOCKED destructive shell action: ${command.slice(0, 80)}`);
    return Promise.resolve({ ok: false, detail: 'blocked: destructive pattern' });
  }
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { env: actionEnv(ctx), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), Math.max(1000, timeoutMs));
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (out += String(d)));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: out.slice(0, 500).trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: String(err) });
    });
    // Full event also on stdin as JSON — again, never spliced into the command.
    // The command may not read stdin and may exit first → swallow the EPIPE on the
    // stdin stream (an unhandled 'error' here would crash the host process).
    child.stdin?.on('error', () => {
      /* child closed stdin without reading (EPIPE) — harmless */
    });
    try {
      child.stdin?.end(JSON.stringify(ctx));
    } catch {
      /* ignore */
    }
  });
}

async function runWebhook(
  action: { url: string; method?: string; headers?: Record<string, string> },
  ctx: SensoryEventContext,
): Promise<ActionResult> {
  try {
    const loopback = isLoopbackHttpUrl(action.url);
    if (!loopback) {
      const ssrfCheck = await assertSafeUrl(action.url);
      if (!ssrfCheck.safe) {
        return { ok: false, detail: `blocked by SSRF guard: ${ssrfCheck.reason}` };
      }
    }

    const init: RequestInit = {
      method: action.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...(action.headers ?? {}) },
      body: JSON.stringify({ event: ctx }),
      signal: AbortSignal.timeout(10_000),
    };

    // Loopback is user-authored local automation (HA / n8n / a test hook).
    // Fetch it directly with redirects refused so a 30x cannot hop to metadata.
    if (loopback) {
      const res = await fetch(action.url, { ...init, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, detail: 'blocked: loopback webhook redirected' };
      }
      return { ok: res.ok, detail: `HTTP ${res.status}` };
    }

    const res = await safeFetchFollow(action.url, init);
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Run a bounded headless agent turn (`buddy -p`) — inherits the agent's own tool
 *  approval guardrails; the rule's prompt is fixed, the event context is in env. */
function runAgent(prompt: string, ctx: SensoryEventContext, timeoutMs: number): Promise<ActionResult> {
  return new Promise((resolve) => {
    const entry = process.argv[1] ?? 'dist/index.js';
    const child = spawn(process.execPath, [entry, '-p', prompt, '--output', 'text'], {
      env: actionEnv(ctx),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), Math.max(5000, timeoutMs));
    child.stdout?.on('data', (d) => (out += String(d)));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: out.slice(0, 500).trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: String(err) });
    });
  });
}

export async function executeSensoryAction(action: SensoryAction, ctx: SensoryEventContext): Promise<ActionResult> {
  switch (action.type) {
    case 'shell':
      return runShell(action.command, ctx, action.timeoutMs ?? 15_000);
    case 'webhook':
      return runWebhook(action, ctx);
    case 'alert': {
      const msg =
        action.message ??
        `${ctx.kind ?? 'event'}${ctx.camera ? ` (${ctx.camera})` : ''}${ctx.description ? `: ${ctx.description}` : ''}`;
      await sendTelegramAlert(msg, action.photo === false ? undefined : ctx.imagePath);
      return { ok: true };
    }
    case 'agent':
      return runAgent(action.prompt, ctx, action.timeoutMs ?? 60_000);
    default:
      return { ok: false, detail: 'unknown action type' };
  }
}

/** Exported for tests. */
export const __test = { isDestructive, actionEnv };
