/**
 * Sandbox termination contract.
 *
 * The sandbox child runs with the caller's workspace as its working directory,
 * so a run must not report completion before the process really let go of it.
 * `exit` is not that moment: `exitCode` can be set while stdio is still open.
 * The contract is the OBSERVED `close`, bounded, and a process that never
 * closes is a failure — never a success with a silent timeout.
 *
 * Portable: driven by a child double, no spawn, no model, no network.
 */
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CHILD_CLOSE_GRACE_MS,
  sandboxNotTerminatedResult,
  waitForChildClose,
  type ChildRunResult,
} from '../../src/tools/code-exec-tool.js';

/** Minimal stand-in for the parts of ChildProcess the wait observes. */
function fakeChild(state: { pid?: number | undefined; exitCode?: number | null; signalCode?: NodeJS.Signals | null } = {}): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  Object.assign(child, {
    pid: 'pid' in state ? state.pid : 4242,
    exitCode: state.exitCode ?? null,
    signalCode: state.signalCode ?? null,
  });
  return child;
}

const settled = <T>(promise: Promise<T>): { done: () => boolean; value: () => T | undefined } => {
  let value: T | undefined;
  let done = false;
  void promise.then((v) => { value = v; done = true; });
  return { done: () => done, value: () => value };
};

describe('waitForChildClose', () => {
  it('does not settle on exit: a delayed close still keeps the run pending', async () => {
    const child = fakeChild();
    const state = settled(waitForChildClose(child, 1_000));

    Object.assign(child, { exitCode: null, signalCode: 'SIGKILL' });
    child.emit('exit', null, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 30));
    expect(state.done(), 'exit alone must not settle the wait').toBe(false);

    child.emit('close', null, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 5));
    expect(state.done()).toBe(true);
    expect(state.value()).toBe(true);
  });

  it('reports NOT closed when the grace elapses, and stays bounded', async () => {
    const started = Date.now();
    const closed = await waitForChildClose(fakeChild(), 60);
    const elapsed = Date.now() - started;
    expect(closed).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('removes its listener and timer on both paths', async () => {
    const closing = fakeChild();
    const wait = waitForChildClose(closing, 1_000);
    expect(closing.listenerCount('close')).toBe(1);
    closing.emit('close', 0, null);
    expect(await wait).toBe(true);
    expect(closing.listenerCount('close'), 'close listener must be removed').toBe(0);

    const stuck = fakeChild();
    expect(await waitForChildClose(stuck, 40)).toBe(false);
    expect(stuck.listenerCount('close'), 'close listener must be removed after the grace too').toBe(0);
    // A late close on a settled wait must not throw or resurrect anything.
    expect(() => stuck.emit('close', 0, null)).not.toThrow();
  });

  it('a spawn error with no pid does not hang: there is no process to wait for', async () => {
    const started = Date.now();
    const closed = await waitForChildClose(fakeChild({ pid: undefined }), 5_000);
    expect(closed).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('exposes a bounded, non-zero default grace', () => {
    expect(CHILD_CLOSE_GRACE_MS).toBeGreaterThan(0);
    expect(CHILD_CLOSE_GRACE_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('sandboxNotTerminatedResult', () => {
  it('never keeps a success when the process did not terminate', () => {
    const result = sandboxNotTerminatedResult({ success: true, output: 'computed 42' }, 2_000);
    expect(result.success).toBe(false);
    expect(result.output).toContain('computed 42');
    expect(result.output).toMatch(/did not terminate within 2000ms/);
    expect(result.output).toMatch(/workspace may still be locked/);
  });

  it('keeps the original diagnosis of an already failed run', () => {
    const original: ChildRunResult = { success: false, output: 'Script timed out after 5000ms', timedOut: true };
    const result = sandboxNotTerminatedResult(original);
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain('Script timed out after 5000ms');
    expect(result.output).toMatch(/did not terminate/);
  });
});
