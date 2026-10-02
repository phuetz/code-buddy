import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { exec, execFile, execFileSync, spawn } from '../../src/utils/tool-process.js';
import { waitForToolOperations, withToolExecutionContext } from '../../src/utils/tool-execution-context.js';
import { UnifiedVfsRouter, withVfsTextTransportAsync } from '../../src/services/vfs/unified-vfs-router.js';

describe('owned tool subprocesses', () => {
  it('resolves a direct relative VFS read against the editor transport root', async () => {
    const root = path.resolve('_qa/acp/home/editor-root');
    const content = await withVfsTextTransportAsync({ root, signal: new AbortController().signal,
      readTextFile: async (file) => { expect(file).toBe(path.join(root, 'sample.txt')); return 'unsaved'; },
    }, () => UnifiedVfsRouter.Instance.readFile('sample.txt'));
    expect(content).toBe('unsaved');
  });

  it('resolves an explicit relative subprocess cwd against its session', async () => {
    const root = fs.mkdtempSync(path.resolve('_qa/acp/home/cwd-'));
    fs.mkdirSync(path.join(root, 'nested'));
    try {
      const result = await withToolExecutionContext({ cwd: root }, () => promisify(execFile)(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: 'nested' }));
      expect(result.stdout).toBe(path.join(root, 'nested'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['spawn', 'execFile', 'exec'] as const)('cancels %s and drains it before a delayed disk write', async (kind) => {
    const root = fs.mkdtempSync(path.resolve('_qa/acp/home/subprocess-'));
    const controller = new AbortController();
    const script = "process.stdout.write('ready'); setTimeout(() => require('fs').writeFileSync('late.txt', 'late'), 1500)";
    try {
      await withToolExecutionContext({ cwd: root, signal: controller.signal }, async () => {
        let child: ChildProcess;
        let result: Promise<unknown> | undefined;
        if (kind === 'spawn') child = spawn(process.execPath, ['-e', script]);
        else {
          const promise = kind === 'execFile'
            ? promisify(execFile)(process.execPath, ['-e', script])
            : promisify(exec)(`"${process.execPath}" -e "${script}"`);
          child = promise.child;
          // Attach before cancellation: AbortError is expected, never unhandled.
          result = promise.catch((error: Error) => error);
        }
        child.on('error', () => { /* Node emits AbortError when killed by signal. */ });
        const closed = once(child, 'close').catch(() => undefined);
        await once(child.stdout!, 'data');
        controller.abort();
        await result;
        await waitForToolOperations();
        await closed;
        expect(fs.existsSync(path.join(root, 'late.txt'))).toBe(false);
      });
    } finally {
      controller.abort();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses synchronous subprocess writes once cancellation has arrived', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => withToolExecutionContext({ cwd: path.resolve('_qa/acp/home'), signal: controller.signal }, () => {
      execFileSync(process.execPath, ['-e', "require('fs').writeFileSync('forbidden.txt', 'bad')"]);
    })).toThrow();
    expect(fs.existsSync(path.resolve('_qa/acp/home/forbidden.txt'))).toBe(false);
  });

  it('preserves an existing tool timeout signal when a session signal is present', async () => {
    const session = new AbortController();
    const toolTimeout = new AbortController();
    await withToolExecutionContext({ cwd: path.resolve('_qa/acp/home'), signal: session.signal }, async () => {
      const child = spawn(process.execPath, ['-e', "process.stdout.write('ready'); setInterval(() => {}, 1000)"], { signal: toolTimeout.signal });
      child.on('error', () => { /* AbortError is expected. */ });
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      try {
        await once(child.stdout!, 'data');
        toolTimeout.abort();
        await closed;
        expect(session.signal.aborted).toBe(false);
        expect(child.killed).toBe(true);
      } finally {
        session.abort();
        await waitForToolOperations();
        await closed;
      }
    });
  });

  it.skipIf(process.platform !== 'linux')('keeps execFile descendants owned when cancellation comes from outside the tool context', async () => {
    const root = fs.mkdtempSync(path.resolve('_qa/acp/home/descendant-'));
    const controller = new AbortController();
    const descendantScript = `const fs=require('node:fs'); const root=${JSON.stringify(root)};
      fs.writeFileSync(root+'/pid',String(process.pid)); process.on('SIGTERM',()=>{});
      process.stdout.write('ready'); setTimeout(()=>fs.writeFileSync(root+'/late.txt','bad'),5000); setInterval(()=>{},1000);`;
    const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendantScript)}],{stdio:'inherit'}); setInterval(()=>{},1000);`;
    let reached!: () => void;
    const ready = new Promise<void>((resolve) => { reached = resolve; });
    let finished = false;
    const execution = withToolExecutionContext({ cwd: root, signal: controller.signal }, async () => {
      const pending = promisify(execFile)(process.execPath, ['-e', script]);
      pending.child.stdout!.once('data', reached);
      try { await pending; } catch { /* AbortError expected. */ }
      finally { await waitForToolOperations(); }
    }).then(() => { finished = true; });
    try {
      await ready;
      controller.abort(); // editor/server callback has no ambient tool context
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(finished).toBe(false);
      await execution;
      expect(fs.existsSync(path.join(root, 'late.txt'))).toBe(false);
    } finally {
      controller.abort();
      if (fs.existsSync(path.join(root, 'pid'))) {
        const pid = Number(fs.readFileSync(path.join(root, 'pid'), 'utf8'));
        try {
          if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(root)) process.kill(pid, 'SIGKILL');
        } catch { /* already terminated; never kill a recycled unrelated PID */ }
      }
      await execution;
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
