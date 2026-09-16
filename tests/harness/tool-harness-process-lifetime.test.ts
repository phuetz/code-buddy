/**
 * Real-process side of the termination contract: whatever ends a run — success,
 * script failure, timeout, abort, or `dispose()` on a running cell — the
 * sandbox process must be gone when the promise resolves, because the caller
 * (for example the skill behavior gate) deletes the workspace right after.
 *
 * Process inspection uses /proc, so these run on Linux only; the contract
 * itself is covered portably in tests/tools/code-exec-child-exit.test.ts.
 * Linux releases the working-directory handle earlier than Windows, so the
 * EBUSY reported by CI is NOT reproduced here: what is asserted is the process
 * lifetime, i.e. the condition the Windows lock depends on.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolHarness } from '../../src/harness/tool-harness.js';
import type { CodeBuddyTool } from '../../src/codebuddy/tool-definitions/types.js';

const onLinux = process.platform === 'linux';
const tools: CodeBuddyTool[] = [{
  type: 'function',
  function: { name: 'read_file', description: 'read a file', parameters: { type: 'object', properties: {} } },
}];

/** Pid of the sandbox process, identified by its working directory. */
function holderPid(dir: string): number | null {
  for (const entry of fsSync.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try { if (fsSync.readlinkSync(`/proc/${entry}/cwd`) === dir) return Number(entry); } catch { /* gone */ }
  }
  return null;
}

/** 'gone' once the OS reaped it; 'Z' = still a process object; 'R'/'S' = alive. */
function processState(pid: number): string {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] ?? '?';
  } catch { return 'gone'; }
}

async function captureSandboxPid(dir: string): Promise<number | null> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const pid = holderPid(dir);
    if (pid !== null) return pid;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

const dirs: string[] = [];
async function fixtureDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-skill-behavior-test-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

// A bounded CPU loop: the sandbox has no timers, and this keeps the process
// observable long enough to capture its pid before it finishes.
const BUSY = 'let sum = 0; for (let i = 0; i < 4e7; i++) sum += i;';

describe.skipIf(!onLinux)('ToolHarness sandbox process lifetime (real processes)', () => {
  it('a successful run: result is success and the process is gone', async () => {
    const root = await fixtureDir();
    const harness = new ToolHarness({ cwd: root, tools, dispatch: async () => ({ success: true }) });
    try {
      const running = harness.exec(`${BUSY} text(String(sum));`, { timeoutMs: 20_000 });
      const pid = await captureSandboxPid(root);
      expect(pid, 'sandbox process not observed').not.toBeNull();
      const result = await running;
      expect(result.success, result.error ?? String(result.output)).toBe(true);
      // The termination must be observed, not timed out: a successful run may
      // never be reported as an unterminated sandbox.
      expect(String(result.output)).not.toMatch(/did not terminate/);
      expect(processState(pid!)).toBe('gone');
    } finally { await harness.dispose(); }
  });

  it('a failing script: failure is reported and the process is gone', async () => {
    const root = await fixtureDir();
    const harness = new ToolHarness({ cwd: root, tools, dispatch: async () => ({ success: true }) });
    try {
      const running = harness.exec(`${BUSY} throw new Error('boom');`, { timeoutMs: 20_000 });
      const pid = await captureSandboxPid(root);
      expect(pid, 'sandbox process not observed').not.toBeNull();
      const result = await running;
      expect(result.success).toBe(false);
      expect(String(result.output ?? result.error)).toContain('boom');
      expect(processState(pid!)).toBe('gone');
    } finally { await harness.dispose(); }
  });

  it('a timeout: failure is reported and the killed process is gone', async () => {
    const root = await fixtureDir();
    const harness = new ToolHarness({ cwd: root, tools, dispatch: async () => ({ success: true }) });
    try {
      const running = harness.exec('while (true) {}', { timeoutMs: 700 });
      const pid = await captureSandboxPid(root);
      expect(pid, 'sandbox process not observed').not.toBeNull();
      const result = await running;
      expect(result.success).toBe(false);
      expect(String(result.output ?? result.error)).toMatch(/timed out/i);
      expect(processState(pid!)).toBe('gone');
    } finally { await harness.dispose(); }
  });

  it('an abort: cancellation is reported and the killed process is gone', async () => {
    const root = await fixtureDir();
    const harness = new ToolHarness({ cwd: root, tools, dispatch: async () => ({ success: true }) });
    const controller = new AbortController();
    try {
      const running = harness.exec('while (true) {}', { timeoutMs: 60_000, signal: controller.signal });
      const pid = await captureSandboxPid(root);
      expect(pid, 'sandbox process not observed').not.toBeNull();
      controller.abort();
      const result = await running;
      expect(result.success).toBe(false);
      expect(String(result.output ?? result.error)).toMatch(/cancel/i);
      expect(processState(pid!)).toBe('gone');
    } finally { await harness.dispose(); }
  });

  it('dispose() on a running cell: resolves only once the process is gone', async () => {
    const root = await fixtureDir();
    const harness = new ToolHarness({ cwd: root, tools, dispatch: async () => ({ success: true }) });
    const running = harness.exec('while (true) {}', { timeoutMs: 60_000 });
    const pid = await captureSandboxPid(root);
    expect(pid, 'sandbox process not observed').not.toBeNull();

    await harness.dispose();

    expect(processState(pid!)).toBe('gone');
    await running.catch(() => undefined);
  });
});
