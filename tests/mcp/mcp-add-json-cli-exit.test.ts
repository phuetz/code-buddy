/**
 * Mutation: `buddy mcp add-json --yes` used to keep the stdio child, so the CLI
 * never exited (lot 6 EXIT 124 under timeout). The command must finish by itself
 * with EXIT 0 and no leftover fixture process.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distEntry = path.join(repoRoot, 'dist', 'index.js');
const fixtureSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/real-mcp-fixture.mjs');

const CLI_WAIT_MS = 12_000;

function pidsWithArg(needle: string): number[] {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    const found: number[] = [];
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.includes(needle)) continue;
      const pid = Number(trimmed.split(/\s+/, 1)[0]);
      if (Number.isInteger(pid) && pid > 0) found.push(pid);
    }
    return found;
  } catch {
    return [];
  }
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      reject(new Error(`CLI did not exit within ${timeoutMs}ms (stdio child still holding the event loop)`));
    }, timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

describe('mcp add-json --yes CLI exit (stdio fixture)', () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes) {
      try {
        fs.rmSync(home, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    homes.length = 0;
  });

  it('terminates with EXIT 0 and leaves no stdio MCP child', async () => {
    if (!fs.existsSync(distEntry)) {
      throw new Error('dist/index.js is missing — run npm run build first');
    }
    if (!fs.existsSync(fixtureSrc)) {
      throw new Error(`missing fixture ${fixtureSrc}`);
    }

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-add-json-exit-'));
    homes.push(home);
    // Keep the fixture inside the repo so Node can resolve @modelcontextprotocol.
    // Extra argv token is unique so a leaked child is identifiable in `ps`.
    const marker = `lot6b-exit-${process.pid}-${Date.now()}`;
    const json = JSON.stringify({
      command: process.execPath,
      args: [fixtureSrc, marker],
    });

    const child = spawn(
      process.execPath,
      [distEntry, 'mcp', 'add-json', 'lot6bexit', json, '--yes'],
      {
        cwd: home,
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          CODEBUDDY_SENSORY: 'false',
          CODEBUDDY_TELEMETRY: 'false',
          FORCE_COLOR: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const started = Date.now();
    const result = await waitExit(child, CLI_WAIT_MS);
    const elapsedMs = Date.now() - started;

    expect(result.signal, `signal=${result.signal} stdout=${stdout}\nstderr=${stderr}`).toBeNull();
    expect(result.code, `stdout=${stdout}\nstderr=${stderr}`).toBe(0);
    expect(stdout).toMatch(/Added MCP server: lot6bexit/);
    expect(stdout).toMatch(/Connected to MCP server: lot6bexit/);
    expect(elapsedMs).toBeLessThan(CLI_WAIT_MS);

    // Parent is gone; a leaked stdio child would still list the unique argv marker.
    expect(pidsWithArg(marker)).toEqual([]);
  }, CLI_WAIT_MS + 5_000);
});
