import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTestDir, removeTestDirAsync } from './tmp.js';

const created: string[] = [];

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-removal-'));
  created.push(dir);
  return dir;
}

function codeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: directory not empty`), { code });
}

afterEach(() => {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('removeTestDir', () => {
  it('repeats the whole removal when a pass meets ENOTEMPTY', () => {
    const dir = scratch();
    const calls: string[] = [];
    removeTestDir(dir, (target, options) => {
      calls.push(target);
      if (calls.length < 3) throw codeError('ENOTEMPTY');
      fs.rmSync(target, options);
    });
    expect(calls).toEqual([dir, dir, dir]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('throws with the entries still present when the directory never frees up', () => {
    const dir = scratch();
    fs.writeFileSync(path.join(dir, 'late.json'), '{}');
    let calls = 0;
    expect(() => removeTestDir(dir, () => {
      calls += 1;
      throw codeError('ENOTEMPTY');
    })).toThrow(/not removed after 6 full pass\(es\).*\(ENOTEMPTY\); still present: late\.json/);
    expect(calls).toBe(6);
  });

  it('does not retry an error a later pass cannot clear', () => {
    const dir = scratch();
    let calls = 0;
    expect(() => removeTestDir(dir, () => {
      calls += 1;
      throw codeError('ENOTDIR');
    })).toThrow(/after 1 full pass\(es\).*\(ENOTDIR\)/);
    expect(calls).toBe(1);
  });

  it('removes a directory while a writer is still adding files to it', async () => {
    const dir = scratch();
    let writes = 0;
    const writer = setInterval(() => {
      try {
        fs.writeFileSync(path.join(dir, `late-${writes}.json`), '{}');
        writes += 1;
      } catch {
        // ENOENT once the directory is gone: the writer never re-creates it.
      }
    }, 2);
    setTimeout(() => clearInterval(writer), 150);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await removeTestDirAsync(dir);
    clearInterval(writer);
    expect(writes).toBeGreaterThan(0);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
