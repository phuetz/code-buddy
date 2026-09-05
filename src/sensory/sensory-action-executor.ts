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
import { readFileSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { isDangerousCommand, matchAllDangerousPatterns } from '../security/dangerous-patterns.js';
import { sendTelegramAlert } from './alert.js';
import { buildFilteredSubprocessEnv } from '../utils/subprocess-env.js';
import { assertSafeUrl, isLoopbackHttpUrl } from '../security/ssrf-guard.js';
import { safeFetchFollow } from '../security/safe-fetch.js';
import { getGlobalEventBus } from '../events/event-bus.js';

export interface SensoryEventContext {
  modality?: string;
  kind?: string;
  /** Emitter of the percept (`BaseEvent.source`): `system-vitals` for the in-process monitor,
   *  `buddy-sense` for frames that crossed the WS bridge. Destructive actions key off it. */
  source?: string;
  camera?: string;
  description?: string;
  imagePath?: string;
  salience?: number;
  payload?: Record<string, unknown>;
}

export type KillProcessAction = {
  type: 'kill_process';
  /** Default true: journalise without signalling. A live kill also needs CODEBUDDY_RUNAWAY_KILL=true. */
  dryRun?: boolean;
  /** After SIGTERM, send SIGKILL if the same process is still alive. Default false. */
  escalate?: boolean;
  /** Wait before SIGKILL when escalate is true. Default 5000, clamped 1000–60000. */
  graceMs?: number;
};

export type SensoryAction =
  | { type: 'shell'; command: string; timeoutMs?: number }
  | { type: 'webhook'; url: string; method?: string; headers?: Record<string, string> }
  | { type: 'alert'; message?: string; photo?: boolean }
  | { type: 'agent'; prompt: string; timeoutMs?: number }
  | KillProcessAction;

export interface ActionResult {
  ok: boolean;
  detail?: string;
}

/** Live identity re-read from /proc before a kill (anti PID-reuse). */
export interface ProcIdentity {
  pid: number;
  ppid?: number;
  comm: string;
  /** /proc/<pid>/stat field 22 (starttime, clock ticks). */
  startTime: number;
  uid: number | null;
}

export interface ProcessRemediatedPayload {
  pid?: number;
  comm?: string;
  signal?: string;
  dryRun: boolean;
  ok: boolean;
  reason: string;
}

export interface KillProcessDeps {
  readProc?: (pid: number) => ProcIdentity | null;
  getuid?: () => number;
  selfPid?: number;
  sleep?: (ms: number) => Promise<void>;
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

/** Action-level destructive flag: a live kill_process (dryRun:false) is destructive.
 *  validateRule still accepts it when match.kind is process_runaway — fire-time is double opt-in. */
export function isDestructiveAction(action: SensoryAction): boolean {
  if (action.type === 'shell') return isDestructive(action.command);
  if (action.type === 'kill_process') return action.dryRun === false;
  return false;
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

/** Parse `/proc/<pid>/stat`: comm (field 2, parenthesized) + ppid (4) + starttime (22). */
export function parseProcStat(content: string): { comm: string; ppid: number; startTime: number } | null {
  const open = content.indexOf('(');
  const close = content.lastIndexOf(')');
  if (open < 0 || close < 0 || close < open) return null;
  const comm = content.slice(open + 1, close);
  const after = content.slice(close + 1).trim().split(/\s+/);
  const ppid = Number(after[1]);
  const startTime = Number(after[19]);
  if (!Number.isFinite(startTime)) return null;
  return { comm, ppid: Number.isFinite(ppid) ? ppid : 0, startTime };
}

export function readProcIdentity(pid: number): ProcIdentity | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const parsed = parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    if (!parsed) return null;
    let uid: number | null = null;
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const m = /^Uid:\s+(\d+)/m.exec(status);
      if (m?.[1] !== undefined) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) uid = n;
      }
    } catch {
      /* uid unreadable → fail closed later */
    }
    return { pid, ppid: parsed.ppid, comm: parsed.comm, startTime: parsed.startTime, uid };
  } catch {
    return null;
  }
}

function perceptPid(payload: Record<string, unknown> | undefined): number | null {
  const raw = payload?.pid;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(n)) return null;
  return n;
}

function clampGraceMs(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : 5000;
  return Math.min(60_000, Math.max(1_000, Math.floor(n)));
}

function isRunawayKillArmed(): boolean {
  return process.env.CODEBUDDY_RUNAWAY_KILL === 'true';
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t === 'object' && t && 'unref' in t) (t as NodeJS.Timeout).unref();
  });
}

function currentUid(getuid?: () => number): number | null {
  try {
    if (getuid) return getuid();
    if (typeof process.getuid === 'function') return process.getuid();
  } catch {
    /* */
  }
  return null;
}

function isAncestorOfSelf(
  targetPid: number,
  selfPid: number,
  readProc: (pid: number) => ProcIdentity | null,
): boolean {
  let current = selfPid;
  const seen = new Set<number>();
  while (current > 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const info = readProc(current);
    const ppid = info?.ppid;
    if (!ppid || ppid <= 0) break;
    if (ppid === targetPid) return true;
    current = ppid;
  }
  return false;
}

function emitProcessRemediated(payload: ProcessRemediatedPayload): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'kill-process',
    metadata: {
      modality: 'system',
      kind: 'process_remediated',
      salience: 180,
      payload,
    },
  });
}

function finishKill(
  result: ActionResult & { payload: ProcessRemediatedPayload },
): ActionResult {
  const { payload, ...res } = result;
  if (res.ok) logger.info(`[rules] kill_process ${payload.reason} pid=${payload.pid ?? ''} comm=${payload.comm ?? ''}`);
  else logger.warn(`[rules] kill_process ${payload.reason}${payload.pid ? ` pid=${payload.pid}` : ''}`);
  try {
    emitProcessRemediated(payload);
  } catch {
    /* never throw from the action path */
  }
  return res;
}

async function runKillProcess(
  action: KillProcessAction,
  ctx: SensoryEventContext,
  deps: KillProcessDeps = {},
): Promise<ActionResult> {
  const readProc = deps.readProc ?? readProcIdentity;
  const selfPid = deps.selfPid ?? process.pid;
  const sleep = deps.sleep ?? defaultSleep;
  const requestedDry = action.dryRun !== false;
  const armed = isRunawayKillArmed();
  const dryRun = requestedDry || !armed;
  const dryReason = !requestedDry && !armed ? 'CODEBUDDY_RUNAWAY_KILL unset' : 'dryRun';

  if (ctx.kind !== 'process_runaway') {
    return finishKill({
      ok: false,
      detail: 'kind not process_runaway',
      payload: { dryRun: true, ok: false, reason: 'kind not process_runaway' },
    });
  }
  // Trust boundary: only the in-process vitals emitter may name a pid to kill. A frame that
  // crossed the WS bridge (any client on loopback holding the token) can carry
  // kind=process_runaway under another modality — it must never reach process.kill.
  if (ctx.modality !== 'system' || ctx.source !== 'system-vitals') {
    return finishKill({
      ok: false,
      detail: 'percept not from the in-process system-vitals emitter',
      payload: { dryRun: true, ok: false, reason: 'untrusted percept source' },
    });
  }

  const pid = perceptPid(ctx.payload);
  const commExpected = typeof ctx.payload?.comm === 'string' ? ctx.payload.comm : '';
  const startExpectedRaw = ctx.payload?.startTime;
  const startExpected =
    typeof startExpectedRaw === 'number'
      ? startExpectedRaw
      : typeof startExpectedRaw === 'string'
        ? Number(startExpectedRaw)
        : NaN;

  if (pid === null || pid <= 0) {
    return finishKill({
      ok: false,
      detail: pid === null ? 'pid absent' : 'invalid pid',
      payload: { pid: pid ?? undefined, comm: commExpected || undefined, dryRun: true, ok: false, reason: pid === null ? 'pid absent' : 'invalid pid' },
    });
  }

  const live = readProc(pid);
  if (!live) {
    return finishKill({
      ok: false,
      detail: 'pid absent',
      payload: { pid, comm: commExpected || undefined, dryRun: true, ok: false, reason: 'pid absent' },
    });
  }

  if (!commExpected || live.comm !== commExpected) {
    return finishKill({
      ok: false,
      detail: 'comm mismatch',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'comm mismatch' },
    });
  }

  if (!Number.isFinite(startExpected)) {
    return finishKill({
      ok: false,
      detail: 'startTime missing',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'startTime missing' },
    });
  }
  if (live.startTime !== startExpected) {
    return finishKill({
      ok: false,
      detail: 'startTime mismatch',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'startTime mismatch' },
    });
  }

  if (pid === 1) {
    return finishKill({
      ok: false,
      detail: 'pid 1',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'pid 1' },
    });
  }
  if (pid === selfPid) {
    return finishKill({
      ok: false,
      detail: 'self',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'self' },
    });
  }
  if (isAncestorOfSelf(pid, selfPid, readProc)) {
    return finishKill({
      ok: false,
      detail: 'ancestor',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'ancestor' },
    });
  }

  const uid = currentUid(deps.getuid);
  if (uid === null || live.uid === null || live.uid !== uid) {
    return finishKill({
      ok: false,
      detail: 'other uid',
      payload: { pid, comm: live.comm, dryRun: true, ok: false, reason: 'other uid' },
    });
  }

  if (dryRun) {
    return finishKill({
      ok: true,
      detail: dryReason,
      payload: {
        pid,
        comm: live.comm,
        signal: 'SIGTERM',
        dryRun: true,
        ok: true,
        reason: dryReason,
      },
    });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return finishKill({
      ok: false,
      detail: reason,
      payload: { pid, comm: live.comm, signal: 'SIGTERM', dryRun: false, ok: false, reason },
    });
  }

  if (action.escalate === true) {
    await sleep(clampGraceMs(action.graceMs));
    const still = readProc(pid);
    if (
      still &&
      still.comm === commExpected &&
      still.startTime === startExpected &&
      still.pid !== 1 &&
      still.pid !== selfPid
    ) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return finishKill({
          ok: false,
          detail: reason,
          payload: { pid, comm: live.comm, signal: 'SIGKILL', dryRun: false, ok: false, reason },
        });
      }
      return finishKill({
        ok: true,
        detail: 'SIGKILL',
        payload: { pid, comm: live.comm, signal: 'SIGKILL', dryRun: false, ok: true, reason: 'SIGKILL' },
      });
    }
  }

  return finishKill({
    ok: true,
    detail: 'SIGTERM',
    payload: { pid, comm: live.comm, signal: 'SIGTERM', dryRun: false, ok: true, reason: 'SIGTERM' },
  });
}

export async function executeSensoryAction(
  action: SensoryAction,
  ctx: SensoryEventContext,
  deps: KillProcessDeps = {},
): Promise<ActionResult> {
  switch (action.type) {
    case 'shell':
      return runShell(action.command, ctx, action.timeoutMs ?? 15_000);
    case 'webhook':
      return runWebhook(action, ctx);
    case 'kill_process':
      return runKillProcess(action, ctx, deps);
    case 'alert': {
      const msg =
        action.message ??
        `${ctx.kind ?? 'event'}${ctx.camera ? ` (${ctx.camera})` : ''}${ctx.description ? `: ${ctx.description}` : ''}`;
      // BUG-02: propagate the real delivery result. sendTelegramAlert returns false when the
      // token/chat is unconfigured or delivery fails — a silent {ok:true} makes the audit lie
      // and leaves the operator unwarned. Fail closed + log locally as a fallback.
      const delivered = await sendTelegramAlert(
        msg,
        action.photo === false ? undefined : ctx.imagePath,
      );
      if (!delivered) {
        logger.warn(`[sensory] alert NOT delivered (Telegram unconfigured or failed): ${msg}`);
        return { ok: false, detail: 'telegram alert unconfigured or delivery failed' };
      }
      return { ok: true };
    }
    case 'agent':
      return runAgent(action.prompt, ctx, action.timeoutMs ?? 60_000);
    default:
      return { ok: false, detail: 'unknown action type' };
  }
}

/** Exported for tests. */
export const __test = { isDestructive, isDestructiveAction, actionEnv, parseProcStat, readProcIdentity };
