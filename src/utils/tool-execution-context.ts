import { AsyncLocalStorage } from 'node:async_hooks';
import { Writable } from 'node:stream';
import path from 'node:path';
import * as fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';

export interface ToolExecutionContext {
  cwd: string;
  signal?: AbortSignal;
}
interface ActiveContext extends ToolExecutionContext { operations: Set<Promise<unknown>> }
const context = new AsyncLocalStorage<ActiveContext>();
function activeContext(value: ToolExecutionContext): ActiveContext {
  return { ...value, signal: value.signal ?? context.getStore()?.signal, operations: new Set() };
}

/** Resolve ambient tool state at each call, including shared/lazy tool instances. */
export function withToolExecutionContext<T>(value: ToolExecutionContext, fn: () => T): T {
  return context.run(activeContext(value), fn);
}
export function getToolExecutionContext(): ToolExecutionContext | undefined {
  return context.getStore();
}
export function getToolWorkingDirectory(fallback?: string): string {
  return context.getStore()?.cwd ?? fallback ?? process.cwd();
}
/** Keep explicit absolute paths and non-path arguments (fd, URL, Buffer) intact. */
export function resolveToolPath<T>(value: T): T {
  const cwd = context.getStore()?.cwd;
  return cwd && typeof value === 'string' ? path.resolve(cwd, value) as T : value;
}
export function throwIfToolCancelled(): void {
  context.getStore()?.signal?.throwIfAborted();
}

export async function waitForToolOperations(): Promise<void> {
  const operations = context.getStore()?.operations;
  while (operations?.size) await Promise.allSettled([...operations]);
}
function trackOperation(operation: Promise<unknown>, operations = context.getStore()?.operations): void {
  if (!operations) return;
  operations.add(operation);
  void operation.then(() => operations.delete(operation), () => operations.delete(operation));
}

interface ProcessIdentity { pid: number; parent: number; group: number; started: string; state: string }
function processIdentity(pid: number): ProcessIdentity | undefined {
  if (process.platform !== 'linux') return undefined;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, parent: Number(fields[1]), group: Number(fields[2]), started: fields[19]!, state: fields[0]! };
  } catch { return undefined; }
}
function alive(identity: ProcessIdentity): boolean {
  const current = processIdentity(identity.pid);
  return current?.started === identity.started && current.state !== 'Z' && current.state !== 'X';
}
function descendants(owned: Map<number, ProcessIdentity>, group?: number): void {
  try {
    const entries = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))
      .map((entry) => processIdentity(Number(entry))).filter((entry): entry is ProcessIdentity => Boolean(entry));
    for (;;) {
      let added = false;
      for (const entry of entries) {
        if (owned.has(entry.pid)) continue;
        const parent = owned.get(entry.parent);
        if ((parent && alive(parent)) || (group !== undefined && entry.group === group)) {
          owned.set(entry.pid, entry); added = true;
        }
      }
      if (!added) break;
    }
  } catch { /* Other platforms still use the native signal/process-group path. */ }
}

/**
 * Register BEFORE Node's own AbortSignal listener, which can reap the parent.
 * exec/execFile do not forward `detached` to spawn; Linux needs a descendant
 * snapshot. Retain ownership until close AND descendant termination, including
 * children ignoring SIGTERM. PID start times prevent killing a recycled PID.
 */
export function ownToolProcess<T>(create: () => T, getChild: (result: T) => ChildProcess | undefined,
  detached: boolean, signal?: AbortSignal): T {
  const active = context.getStore();
  if (!active?.signal || !signal) return create();
  signal.throwIfAborted();
  const operations = active.operations; // abort can arrive outside this ALS scope
  let proc: ChildProcess | undefined;
  let initial: ProcessIdentity | undefined;
  let closed: Promise<void>;
  let processClosed = false;
  let cancelled = false;
  const owned = new Map<number, ProcessIdentity>();
  const refresh = (): void => {
    if (initial && alive(initial)) owned.set(initial.pid, initial);
    const current = initial ? processIdentity(initial.pid) : undefined;
    if (initial) descendants(owned, detached && (!current || current.started === initial.started) ? initial.pid : undefined);
  };
  const kill = (kind: NodeJS.Signals): void => {
    for (const entry of [...owned.values()].reverse()) {
      if (alive(entry)) try { process.kill(entry.pid, kind); } catch { /* exited */ }
    }
    try {
      const current = initial ? processIdentity(initial.pid) : undefined;
      if (detached && process.platform !== 'win32' && proc?.pid && (process.platform !== 'linux' || (initial && (!current || current.started === initial.started)))) process.kill(-proc.pid, kind);
      else if (proc?.constructor.name === 'ChildProcess') proc.kill(kind);
    } catch { /* already exited */ }
  };
  const abort = (): void => {
    if (!proc || cancelled) return;
    cancelled = true;
    refresh();
    kill('SIGTERM');
    const deadline = Date.now() + 3000;
    const terminated = new Promise<void>((resolve) => {
      const poll = (): void => {
        refresh();
        if (processClosed && ![...owned.values()].some(alive)) { resolve(); return; }
        if (Date.now() >= deadline) kill('SIGKILL');
        setTimeout(poll, 25);
      };
      poll();
    });
    trackOperation(Promise.all([closed, terminated]), operations);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const result = create();
    proc = getChild(result);
    if (!proc?.once) { signal.removeEventListener('abort', abort); return result; }
    const candidate = proc.pid ? processIdentity(proc.pid) : undefined;
    if (candidate?.parent === process.pid) initial = candidate;
    closed = new Promise<void>((resolve) => proc!.once('close', () => {
      processClosed = true;
      signal.removeEventListener('abort', abort);
      resolve();
    }));
    if (signal.aborted) abort();
    return result;
  } catch (error) {
    signal.removeEventListener('abort', abort);
    throw error;
  }
}

/** Prevent a delayed filesystem mutation after an intervening await/permission. */
export function guardToolMutation<T>(mutate: () => T): T {
  throwIfToolCancelled();
  const result = mutate();
  if (result instanceof Promise) trackOperation(result);
  const signal = context.getStore()?.signal;
  if (signal && result instanceof Writable) {
    const abort = (): void => { result.destroy(new Error('Tool execution cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    trackOperation(new Promise<void>((resolve) => result.once('close', () => { signal.removeEventListener('abort', abort); resolve(); })));
    if (signal.aborted) abort();
  }
  return result;
}

/** Async generators execute on next(), not when constructed. Scope every step. */
export async function* withToolGenerator<T, R>(value: ToolExecutionContext, create: () => AsyncGenerator<T, R, undefined>): AsyncGenerator<T, R, undefined> {
  const active = activeContext(value);
  const iterator = context.run(active, create);
  let complete = false;
  try {
    for (;;) {
      const step = await context.run(active, () => iterator.next());
      if (step.done) { complete = true; return step.value; }
      yield step.value;
    }
  } finally {
    try {
      if (!complete) await context.run(active, () => iterator.return(undefined as R));
    } finally {
      await context.run(active, waitForToolOperations);
    }
  }
}
