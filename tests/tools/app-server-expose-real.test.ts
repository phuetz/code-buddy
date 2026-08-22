/**
 * app_server expose/unexpose — real process lifecycle with a stub tunnel
 * binary. The stub is a REAL executable that prints the cloudflared
 * quick-tunnel banner and stays alive: the spawn, the URL parsing, the TTL
 * kill, and the teardown-with-server paths all run for real; only the
 * network egress is absent (tests must never actually publish a port).
 */
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppServerTool } from '../../src/tools/app-server-tool.js';
import { resetDevOrigins } from '../../src/security/dev-origins.js';
import { resetProcessTool } from '../../src/tools/process-tool.js';

vi.setConfig({ testTimeout: 30_000 });

const FAKE_URL = 'https://buddy-preview-test.trycloudflare.com';

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function serverCommand(port: number): string {
  return `node -e 'require("http").createServer((q,s)=>s.end("ok")).listen(${port},"127.0.0.1")'`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('app_server expose (stub tunnel binary, real lifecycle)', () => {
  let tool: AppServerTool;
  let stubDir: string;
  let stubBin: string;

  beforeEach(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-tunnel-stub-'));
    stubBin = path.join(stubDir, 'fake-cloudflared');
    // Mimics cloudflared: banner on stderr after a beat, then stays alive.
    fs.writeFileSync(
      stubBin,
      [
        '#!/usr/bin/env node',
        'setTimeout(() => {',
        `  console.error('INF |  Your quick Tunnel has been created! Visit it at:  |');`,
        `  console.error('INF |  ${FAKE_URL}  |');`,
        '}, 100);',
        'setInterval(() => {}, 1000);',
      ].join('\n'),
    );
    fs.chmodSync(stubBin, 0o755);
    process.env.CODEBUDDY_TUNNEL_BIN = stubBin;
  });

  afterEach(async () => {
    delete process.env.CODEBUDDY_TUNNEL_BIN;
    await tool?.stopAll();
    resetDevOrigins();
    resetProcessTool();
    fs.rmSync(stubDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  async function startServer(): Promise<{ pid: number; port: number }> {
    tool = new AppServerTool();
    const port = await freePort();
    const started = await tool.start({ command: serverCommand(port), url: `http://127.0.0.1:${port}/`, timeoutMs: 15_000 });
    expect(started.success, started.error).toBe(true);
    return { pid: (started.data as { pid: number }).pid, port };
  }

  function tunnelPidOf(toolInstance: AppServerTool, pid: number): number | undefined {
    type Peek = { servers: Map<number, { tunnel?: { pid: number } }> };
    return (toolInstance as unknown as Peek).servers.get(pid)?.tunnel?.pid;
  }

  it('expose parses the public URL, unexpose kills the tunnel but keeps the server', async () => {
    const { pid } = await startServer();

    const exposed = await tool.expose(pid);
    expect(exposed.success, exposed.error).toBe(true);
    expect(exposed.output).toContain(FAKE_URL);
    expect(exposed.output).toContain('expires');
    const tunnelPid = tunnelPidOf(tool, pid)!;
    expect(isAlive(tunnelPid)).toBe(true);

    const status = await tool.status();
    expect(status.output).toContain(`PUBLIC ${FAKE_URL}`);

    const closed = await tool.unexpose(pid);
    expect(closed.success, closed.error).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(isAlive(tunnelPid)).toBe(false);
    expect(isAlive(pid)).toBe(true);

    // Idempotent: no tunnel → friendly no-op.
    const again = await tool.unexpose(pid);
    expect(again.success).toBe(true);
    expect(again.output).toContain('no active public tunnel');
  });

  it('stopping the server tears the tunnel down with it', async () => {
    const { pid } = await startServer();
    const exposed = await tool.expose(pid);
    expect(exposed.success, exposed.error).toBe(true);
    const tunnelPid = tunnelPidOf(tool, pid)!;

    const stopped = await tool.stop(pid);
    expect(stopped.success, stopped.error).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(isAlive(tunnelPid)).toBe(false);
  });

  it('refuses to expose an unmanaged pid and reports a missing binary cleanly', async () => {
    const { pid } = await startServer();

    const unknown = await tool.expose(999999);
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('not an app_server-managed server');

    process.env.CODEBUDDY_TUNNEL_BIN = path.join(stubDir, 'does-not-exist');
    const missing = await tool.expose(pid);
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/tunnel|binary|URL/i);
    expect(tunnelPidOf(tool, pid)).toBeUndefined();
  });
});
