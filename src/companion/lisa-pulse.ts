/** Opt-in initiative gate. A cheap observation precedes every model wake. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inAwayWindow, isAwayPaused, loadAwayState, resolveAwayClock } from './away-mode.js';
import { LisaActionStore } from '../checkpoints/lisa-action-store.js';
import { resolveToolEffect } from '../tools/tool-effect.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export interface LisaSignal { source: string; fingerprint: string; summary: string }
export interface LisaProposedAction { tool: string; args: Record<string, unknown>; effect: 'read' | 'reversible' | 'emission'; files?: string[]; /** Untrusted model hint; never used as authority. */ mandateId?: string }
export type LisaDecision =
  | { kind: 'silence'; reason: string }
  | { kind: 'notify'; reason: string; text: string }
  | { kind: 'act'; reason: string; action: LisaProposedAction };
export type LisaAuthority = 'allow' | 'allow+checkpoint' | 'ask' | 'deny';
export interface LisaAuthorization { decision: LisaAuthority; mandateId?: string }
export interface LisaPulseEvent {
  kind: 'silence' | 'notify' | 'action_started' | 'action' | 'summary_started' | 'summary' | 'failure' | 'decision_required';
  reason: string;
  result?: string;
  mandateId?: string;
  checkpointId?: string;
  action?: LisaProposedAction;
}
export interface LisaPulseDependencies {
  observe?: () => Promise<LisaSignal[]>;
  decide?: (signals: LisaSignal[], checklist: string) => Promise<LisaDecision>;
  /** Mandate adapter for PR #233. Absent means deny. */
  authorizeAction?: (action: LisaProposedAction, origin: 'initiative') => Promise<LisaAuthorization>;
  /** Restricted executor. Must refuse scheduling and policy changes itself. */
  executeAction?: (action: LisaProposedAction, origin: 'initiative') => Promise<{ success: boolean; detail: string }>;
  record?: (event: LisaPulseEvent) => void;
  alertOwner?: (message: string) => Promise<boolean>;
  now?: () => number;
  statePath?: string;
  workspace?: string;
}

interface PulseState { fingerprint?: string; date?: string; wakes: number }
const MAX_WAKES_PER_DAY = 3;
const BLOCKED_TOOLS = /(?:cron|schedule|heartbeat|initiative|mandate|policy|identity|config)/i;
const READ_TOOLS = new Set(['view_file', 'read_file', 'list_directory', 'search']);
const REVERSIBLE_TOOLS = new Set(['create_file', 'write_file', 'edit_file', 'str_replace_editor', 'multi_edit']);

export function lisaPulseEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEBUDDY_LISA_PULSE === 'true' && env.CODEBUDDY_LISA_UNIFIED_CHECKPOINTS === 'true' &&
    env.CODEBUDDY_LISA_JOURNAL === 'true';
}

function stateFile(): string {
  return path.join(os.homedir(), '.codebuddy', 'lisa', 'pulse-state.json');
}

function readState(file: string): PulseState {
  return readJsonAtomicSync<PulseState>(file, { wakes: 0 }, {
    mode: 0o600,
    isValid: (value): value is PulseState => Boolean(
      value && typeof value === 'object' && !Array.isArray(value) &&
      typeof (value as PulseState).wakes === 'number',
    ),
  });
}

function command(commandName: string, args: string[], cwd: string): string | null {
  const result = spawnSync(commandName, args, {
    cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return result.status === 0 ? result.stdout.trim().slice(0, 4096) : null;
}

function countSnapshot(file: string | undefined, source: string): LisaSignal | null {
  if (!file) return null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw) as unknown;
    const count = typeof data === 'number' ? data
      : Array.isArray(data) ? data.length
        : data && typeof data === 'object' && 'count' in data ? (data as { count: unknown }).count : null;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
    return { source, fingerprint: createHash('sha256').update(raw).digest('hex'), summary: `${source} count: ${count}` };
  } catch { return null; }
}

/** No model, no tools with write effects, and no worktree mutation. */
export async function observeLisaSignals(workspace = process.cwd()): Promise<LisaSignal[]> {
  const signals: LisaSignal[] = [];
  const git = command('git', ['status', '--porcelain=v1', '--untracked-files=no'], workspace);
  if (git !== null) signals.push({ source: 'git', fingerprint: git, summary: `Git tracked changes: ${git.split('\n').filter(Boolean).length}` });
  if (process.env.CODEBUDDY_LISA_PULSE_GH === 'true') {
    const runs = command('gh', ['run', 'list', '--limit', '10', '--json', 'databaseId,status,conclusion,updatedAt'], workspace);
    if (runs !== null) {
      try {
        const rows = JSON.parse(runs) as Array<{ conclusion?: string; status?: string }>;
        const failed = rows.filter(row => row.conclusion === 'failure').length;
        const ongoing = rows.filter(row => row.status !== 'completed').length;
        signals.push({ source: 'ci', fingerprint: runs, summary: `Recent CI runs: ${failed} failed, ${ongoing} ongoing` });
      } catch { /* unavailable probe */ }
    }
    const prs = command('gh', ['pr', 'list', '--state', 'open', '--json', 'number,updatedAt'], workspace);
    if (prs !== null) {
      try {
        const rows = JSON.parse(prs) as unknown[];
        signals.push({ source: 'pr', fingerprint: prs, summary: `Open pull requests: ${rows.length}` });
      } catch { /* unavailable probe */ }
    }
  }
  try {
    const file = process.env.CODEBUDDY_REMINDERS_FILE || path.join(os.homedir(), '.codebuddy', 'reminders.json');
    const stat = fs.lstatSync(file);
    if (stat.isFile() && stat.size <= 256 * 1024) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      const list = Array.isArray(parsed) ? parsed
        : parsed && typeof parsed === 'object' && 'reminders' in parsed ? (parsed as { reminders: unknown }).reminders : [];
      const rows: unknown[] = Array.isArray(list) ? list : [];
      const reminders = rows
        .filter((item): item is { id: string; enabled: boolean; time?: string; date?: string; lastDoneAt?: string } =>
          Boolean(item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' &&
            'enabled' in item && item.enabled === true))
        .map(item => ({ id: item.id, time: item.time, date: item.date, done: item.lastDoneAt }));
      signals.push({ source: 'reminders', fingerprint: JSON.stringify(reminders), summary: `Enabled reminders: ${reminders.length}` });
    }
  } catch { /* unavailable optional reminders */ }
  if (process.env.CODEBUDDY_FLEET_COLAB_DIR) {
    try {
      const file = path.join(process.env.CODEBUDDY_FLEET_COLAB_DIR, 'colab-tasks.json');
      const stat = fs.lstatSync(file);
      if (stat.isFile() && stat.size <= 256 * 1024) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw) as { tasks?: Array<{ id?: string; status?: string; priority?: string; claimedAt?: string }> };
        const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
        const compact = tasks.map(task => ({ id: task.id, status: task.status, priority: task.priority, claimedAt: task.claimedAt }));
        signals.push({ source: 'fleet', fingerprint: JSON.stringify(compact),
          summary: `Fleet queue: ${tasks.filter(task => task.status === 'open').length} open, ${tasks.filter(task => task.status === 'blocked').length} blocked` });
      }
    } catch { /* unavailable optional queue */ }
  }
  const agenda = countSnapshot(process.env.CODEBUDDY_LISA_PULSE_AGENDA_SNAPSHOT, 'agenda');
  if (agenda) signals.push(agenda);
  const mail = countSnapshot(process.env.CODEBUDDY_LISA_PULSE_MAIL_COUNT_SNAPSHOT, 'mail');
  if (mail) signals.push(mail);
  return signals;
}

function fingerprint(signals: LisaSignal[], checklist: string): string {
  const stable = [...signals].sort((a, b) => a.source.localeCompare(b.source))
    .map(item => [item.source, item.fingerprint]);
  return createHash('sha256').update(JSON.stringify([stable, checklist])).digest('hex');
}

export async function decideLisaWithConfiguredModel(signals: LisaSignal[], checklist: string): Promise<LisaDecision> {
  const model = process.env.CODEBUDDY_LISA_PULSE_MODEL;
  const apiKey = process.env.CODEBUDDY_LISA_PULSE_API_KEY;
  const baseURL = process.env.CODEBUDDY_LISA_PULSE_BASE_URL;
  if (!model || !apiKey || !baseURL) return { kind: 'silence', reason: 'No decision model configured' };
  const { CodeBuddyClient } = await import('../codebuddy/client.js');
  const client = new CodeBuddyClient(apiKey, model, baseURL);
  const response = await client.chat([
    { role: 'system', content: 'You are Lisa’s decision brain. Return only JSON with kind silence, notify, or act. Never schedule another initiative. Never claim an action happened. The host checks every action and may refuse it.' },
    { role: 'user', content: JSON.stringify({ signals: signals.map(({ source, summary }) => ({ source, summary })), checklist }) },
  ], undefined, { responseFormat: 'json' });
  const raw = response?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return { kind: 'silence', reason: 'Empty decision' };
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.kind === 'notify' && typeof parsed.text === 'string' && typeof parsed.reason === 'string') {
    return { kind: 'notify', text: parsed.text.slice(0, 1000), reason: parsed.reason.slice(0, 300) };
  }
  if (parsed.kind === 'act' && typeof parsed.reason === 'string' && parsed.action && typeof parsed.action === 'object') {
    const action = parsed.action as LisaProposedAction;
    if (typeof action.tool === 'string' && ['read', 'reversible', 'emission'].includes(action.effect) &&
        action.args && typeof action.args === 'object' && !Array.isArray(action.args)) {
      return { kind: 'act', reason: parsed.reason.slice(0, 300), action };
    }
  }
  return { kind: 'silence', reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : 'Invalid decision' };
}

/** A single heartbeat tick. This function does not start timers or jobs. */
export async function runLisaPulse(checklist: string, deps: LisaPulseDependencies = {}): Promise<LisaPulseEvent> {
  const record = (event: LisaPulseEvent): LisaPulseEvent => { deps.record?.(event); return event; };
  if (!lisaPulseEnabled()) return record({ kind: 'silence', reason: 'Pulse disabled' });
  const now = (deps.now ?? Date.now)();
  const clock = resolveAwayClock(now);
  if (isAwayPaused(loadAwayState(), now)) return record({ kind: 'silence', reason: 'Paused by owner' });
  if (!inAwayWindow(clock.minutesOfDay)) return record({ kind: 'silence', reason: 'Quiet hours' });
  const file = deps.statePath ?? stateFile();
  const state = readState(file);
  const current: PulseState = state.date === clock.localDate ? state : { wakes: 0, date: clock.localDate };
  const signals = await (deps.observe ?? (() => observeLisaSignals(deps.workspace)))();
  const nextFingerprint = fingerprint(signals, checklist);
  if (!current.fingerprint || current.fingerprint === nextFingerprint) {
    if (!current.fingerprint) writeJsonAtomicSync(file, { ...current, fingerprint: nextFingerprint }, { mode: 0o600 });
    return record({ kind: 'silence', reason: current.fingerprint ? 'No new signal' : 'Baseline recorded' });
  }
  if (current.wakes >= MAX_WAKES_PER_DAY) return record({ kind: 'silence', reason: 'Daily wake cap' });
  writeJsonAtomicSync(file, { ...current, fingerprint: nextFingerprint, wakes: current.wakes + 1 }, { mode: 0o600 });
  let decision: LisaDecision;
  try {
    decision = await (deps.decide ?? decideLisaWithConfiguredModel)(signals, checklist);
  } catch (error) {
    const event = record({ kind: 'failure', reason: 'Decision brain failed', result: String(error) });
    await deps.alertOwner?.('Lisa: le pouls a échoué ; aucune action lancée.');
    return event;
  }
  if (decision.kind === 'silence') return record({ kind: 'silence', reason: decision.reason });
  if (decision.kind === 'notify') return record({ kind: 'notify', reason: decision.reason, result: decision.text });
  const action = decision.action;
  if (action.effect === 'emission' || resolveToolEffect(action.tool) !== action.effect ||
      BLOCKED_TOOLS.test(action.tool) ||
      (action.effect === 'read' && !READ_TOOLS.has(action.tool)) ||
      (action.effect === 'reversible' && !REVERSIBLE_TOOLS.has(action.tool))) {
    const event = record({ kind: 'decision_required', reason: 'Effect or tool requires owner approval', action });
    return event;
  }
  if (action.effect === 'reversible') {
    const declaredTarget = action.args.path ?? action.args.file_path ?? action.args.target_file;
    const root = deps.workspace ?? process.cwd();
    if (typeof declaredTarget !== 'string' || action.files?.length !== 1 ||
        path.resolve(root, declaredTarget) !== path.resolve(root, action.files[0]!)) {
      const event = record({ kind: 'failure', reason: 'Action target and checkpoint target differ', action });
      return event;
    }
  }
  let authorization: LisaAuthorization | undefined;
  try {
    authorization = await deps.authorizeAction?.(action, 'initiative');
  } catch (error) {
    const event = record({ kind: 'failure', reason: 'Mandate decision failed', result: String(error), action });
    await deps.alertOwner?.('Lisa: la décision de mandat a échoué ; aucune action lancée.');
    return event;
  }
  const authority = authorization?.decision ?? 'deny';
  const mandateId = authorization?.mandateId;
  if (authority === 'ask') {
    const event = record({ kind: 'decision_required', reason: decision.reason, action, mandateId });
    return event;
  }
  if (authority === 'deny' || !deps.executeAction) return record({ kind: 'silence', reason: 'No authorized executor' });
  if (action.effect === 'reversible' && (authority !== 'allow+checkpoint' || !action.files?.length)) {
    const event = record({ kind: 'failure', reason: 'Reversible action lacks a return point', action });
    return event;
  }
  let checkpointId: string | undefined;
  const store = new LisaActionStore(deps.workspace);
  try {
    if (action.effect === 'reversible') {
      checkpointId = store.prepare(`pulse-${now}`, decision.reason, 'initiative', action.files!).id;
    }
    record({ kind: 'action_started', reason: decision.reason, action, mandateId, checkpointId });
    const result = await deps.executeAction(action, 'initiative');
    if (checkpointId) store.complete(checkpointId);
    const event = record({ kind: result.success ? 'action' : 'failure', reason: decision.reason,
      result: result.detail, action, mandateId, checkpointId });
    if (!result.success) await deps.alertOwner?.('Lisa: une action autonome a échoué. Consulte le journal.');
    return event;
  } catch (error) {
    if (checkpointId) {
      try {
        if (store.get(checkpointId).state === 'prepared') store.complete(checkpointId);
      } catch {
        // The prepared snapshot remains durable for manual recovery.
      }
    }
    const event = record({ kind: 'failure', reason: decision.reason, result: String(error), action,
      mandateId, checkpointId });
    await deps.alertOwner?.('Lisa: une action autonome a échoué. Consulte le journal.');
    return event;
  }
}

/** Existing heartbeat calls this once; it never installs another schedule. */
export async function runConfiguredLisaPulse(checklist: string): Promise<LisaPulseEvent> {
  const [{ appendLisaJournal, maybeDeliverLisaEveningSummary }, { sendTelegramAlert }] = await Promise.all([
    import('./lisa-journal.js'), import('../sensory/alert.js'),
  ]);
  const event = await runLisaPulse(checklist, {
    record: appendLisaJournal,
    alertOwner: message => sendTelegramAlert(message),
  });
  await maybeDeliverLisaEveningSummary();
  return event;
}
