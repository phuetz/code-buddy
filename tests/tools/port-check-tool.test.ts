import * as net from 'net';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PortCheckTool } from '../../src/tools/port-check-tool.js';

let server: net.Server | undefined;
let homeDir: string;
let originalHome: string | undefined;
let originalCodebuddyHome: string | undefined;

beforeEach(async () => {
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-'));
  originalHome = process.env.HOME;
  originalCodebuddyHome = process.env.CODEBUDDY_HOME;
  process.env.HOME = homeDir;
  process.env.CODEBUDDY_HOME = path.join(homeDir, '.codebuddy');
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;

  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalCodebuddyHome !== undefined) process.env.CODEBUDDY_HOME = originalCodebuddyHome;
  else delete process.env.CODEBUDDY_HOME;
  await fs.rm(homeDir, { recursive: true, force: true });
});

function listen(port = 0): Promise<number> {
  return new Promise((resolve) => {
    server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      const address = server?.address();
      if (typeof address === 'object' && address) resolve(address.port);
    });
  });
}

describe('PortCheckTool', () => {
  it('reports a listening loopback port as unavailable', async () => {
    const port = await listen();
    const result = await new PortCheckTool().execute({ port, host: '127.0.0.1' });
    expect(result.success).toBe(true);
    expect((result.data as { listening: boolean; available: boolean }).listening).toBe(true);
    expect((result.data as { listening: boolean; available: boolean }).available).toBe(false);
  });

  it('reports a very likely free port as available', async () => {
    const occupied = await listen();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    const result = await new PortCheckTool().execute({ port: occupied, host: '127.0.0.1' });
    expect(result.success).toBe(true);
    expect((result.data as { listening: boolean; available: boolean }).available).toBe(true);
  });
});
