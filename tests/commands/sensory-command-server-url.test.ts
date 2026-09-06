import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerSensoryCommand } from '../../src/commands/cli/sensory-command.js';

describe('B-5: buddy sensory status displays tested URL and accepts --server-url / CODEBUDDY_SERVER_URL', () => {
  let originalEnvServerUrl: string | undefined;
  let testServer: Server | null = null;
  let serverPort = 0;

  beforeEach(() => {
    originalEnvServerUrl = process.env.CODEBUDDY_SERVER_URL;
    delete process.env.CODEBUDDY_SERVER_URL;
  });

  afterEach(async () => {
    if (originalEnvServerUrl !== undefined) {
      process.env.CODEBUDDY_SERVER_URL = originalEnvServerUrl;
    } else {
      delete process.env.CODEBUDDY_SERVER_URL;
    }
    if (testServer) {
      await new Promise<void>((resolve, reject) => {
        testServer?.close((err) => (err ? reject(err) : resolve()));
      });
      testServer = null;
    }
  });

  function createProgram(write: (msg: string) => void): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerSensoryCommand(program, write);
    return program;
  }

  async function run(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
    const chunks: string[] = [];
    const previous = process.exitCode;
    process.exitCode = undefined;
    const program = createProgram((msg) => {
      chunks.push(msg);
    });
    await program.parseAsync(['node', 'buddy', ...args]);
    const exitCode = process.exitCode;
    process.exitCode = previous;
    return { out: chunks.join('\n'), exitCode };
  }

  it('affiche l URL par defaut quand le serveur est non joignable', async () => {
    const { out } = await run(['sensory', 'status']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:3000');
  });

  it('accepte l option --server-url et affiche l URL testee', async () => {
    const { out } = await run(['sensory', 'status', '--server-url', 'http://127.0.0.1:4550']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4550');
  });

  it('prend en compte la variable d environnement CODEBUDDY_SERVER_URL', async () => {
    process.env.CODEBUDDY_SERVER_URL = 'http://127.0.0.1:4560';
    const { out } = await run(['sensory', 'status']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4560');
  });

  it('--server-url a la priorite sur CODEBUDDY_SERVER_URL', async () => {
    process.env.CODEBUDDY_SERVER_URL = 'http://127.0.0.1:4560';
    const { out } = await run(['sensory', 'status', '--server-url', 'http://127.0.0.1:4570']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4570');
    expect(out).not.toContain('4560');
  });

  it('fournit serverUrl et serverMessage avec URL dans la sortie --json', async () => {
    const { out } = await run(['sensory', 'status', '--server-url', 'http://127.0.0.1:4580', '--json']);
    const parsed = JSON.parse(out) as { serverReachable: boolean; serverUrl: string; serverMessage: string };
    expect(parsed.serverReachable).toBe(false);
    expect(parsed.serverUrl).toBe('http://127.0.0.1:4580');
    expect(parsed.serverMessage).toContain('serveur non joignable sur http://127.0.0.1:4580');
  });

  it('detecte un serveur joignable quand HTTP 200 repond sur l URL donnee', async () => {
    testServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise<void>((resolve) => testServer?.listen(0, '127.0.0.1', resolve));
    serverPort = (testServer.address() as AddressInfo).port;

    const { out } = await run(['sensory', 'status', '--server-url', `http://127.0.0.1:${serverPort}`]);
    expect(out).toContain(`serveur joignable sur http://127.0.0.1:${serverPort}`);
  });
});
