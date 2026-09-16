import { mkdtempSync, rmSync } from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSensoryCommand } from '../../src/commands/cli/sensory-command.js';

describe('B-5: buddy sensory status displays tested URL and accepts --server-url / CODEBUDDY_SERVER_URL', () => {
  let testServer: Server | null = null;
  let serverPort = 0;
  let profileDir = '';
  /** URLs the status command tried to reach during the test. */
  let probedUrls: string[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // A private, empty profile: the status snapshot, the rules and the rule
    // runs of the user running the tests must never be read.
    profileDir = mkdtempSync(join(tmpdir(), 'cb-sensory-status-profile-'));
    const home = join(profileDir, 'home');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_CONFIG_HOME', join(home, '.config'));
    vi.stubEnv('XDG_DATA_HOME', join(home, '.local', 'share'));
    vi.stubEnv('XDG_STATE_HOME', join(home, '.local', 'state'));
    vi.stubEnv('XDG_CACHE_HOME', join(home, '.cache'));
    vi.stubEnv('CODEBUDDY_SENSORY_STATUS_FILE', join(home, '.codebuddy', 'sensory-status.json'));
    vi.stubEnv('CODEBUDDY_SENSORY_RULES_FILE', join(home, '.codebuddy', 'sensory-rules.json'));
    vi.stubEnv('CODEBUDDY_RULE_RUNS_FILE', join(home, '.codebuddy', 'companion', 'rule-runs.jsonl'));
    // The default URL comes from these when --server-url and CODEBUDDY_SERVER_URL are absent.
    vi.stubEnv('CODEBUDDY_SERVER_URL', undefined);
    vi.stubEnv('CODEBUDDY_SERVER_HOST', undefined);
    vi.stubEnv('CODEBUDDY_SERVER_PORT', undefined);
    vi.stubEnv('PORT', undefined);

    // Only this test's own loopback server is really contacted; any other URL
    // (127.0.0.1:3000 may host a real service) answers like a closed port.
    probedUrls = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      probedUrls.push(url);
      if (testServer && url.startsWith(`http://127.0.0.1:${serverPort}/`)) {
        return realFetch(input, init);
      }
      throw new TypeError('fetch failed');
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (testServer) {
      await new Promise<void>((resolve, reject) => {
        testServer?.close((err) => (err ? reject(err) : resolve()));
      });
      testServer = null;
    }
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
    expect(probedUrls).toEqual(['http://127.0.0.1:3000/api/health']);
  });

  it('accepte l option --server-url et affiche l URL testee', async () => {
    const { out } = await run(['sensory', 'status', '--server-url', 'http://127.0.0.1:4550']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4550');
    expect(probedUrls).toEqual(['http://127.0.0.1:4550/api/health']);
  });

  it('prend en compte la variable d environnement CODEBUDDY_SERVER_URL', async () => {
    vi.stubEnv('CODEBUDDY_SERVER_URL', 'http://127.0.0.1:4560');
    const { out } = await run(['sensory', 'status']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4560');
    expect(probedUrls).toEqual(['http://127.0.0.1:4560/api/health']);
  });

  it('--server-url a la priorite sur CODEBUDDY_SERVER_URL', async () => {
    vi.stubEnv('CODEBUDDY_SERVER_URL', 'http://127.0.0.1:4560');
    const { out } = await run(['sensory', 'status', '--server-url', 'http://127.0.0.1:4570']);
    expect(out).toContain('serveur non joignable sur http://127.0.0.1:4570');
    expect(out).not.toContain('4560');
    expect(probedUrls).toEqual(['http://127.0.0.1:4570/api/health']);
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
    expect(probedUrls).toEqual([`http://127.0.0.1:${serverPort}/api/health`]);
  });
});
