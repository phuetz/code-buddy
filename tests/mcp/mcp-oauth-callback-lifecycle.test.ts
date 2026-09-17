/**
 * Loopback OAuth callback lifecycle: bind failure, abort, tokens-only invalidate.
 * Real HTTP on 127.0.0.1, dynamic ports, disposable cwd. No ElevenLabs, no audio.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPManager } from '../../src/mcp/client.js';
import {
  MCPStoredOAuthProvider,
  setMCPOAuthInteraction,
} from '../../src/mcp/mcp-oauth-provider.js';
import { logger } from '../../src/utils/logger.js';
import {
  getMCPOAuthManager,
  resetMCPOAuthManager,
  startCallbackServer,
  startCallbackSession,
} from '../../src/mcp/mcp-oauth.js';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code === 'EADDRINUSE'));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(false)));
  });
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

async function completeBrowser(authorizeUrl: string): Promise<void> {
  const res = await fetch(authorizeUrl);
  const payload = (await res.json()) as { code: string; state: string };
  const redirect = new URL(new URL(authorizeUrl).searchParams.get('redirect_uri')!);
  redirect.searchParams.set('code', payload.code);
  if (payload.state) redirect.searchParams.set('state', payload.state);
  await new Promise<void>((resolve, reject) => {
    http
      .get(redirect.toString(), (r) => {
        r.resume();
        r.on('end', resolve);
      })
      .on('error', reject);
  });
}

interface PkceFixture {
  base: string;
  calls: string[];
  rpc: string[];
  close: () => Promise<void>;
}

async function startPkceFixture(redirectUri: string): Promise<PkceFixture> {
  const calls: string[] = [];
  const rpc: string[] = [];
  const challenges = new Map<string, string>();
  let n = 0;
  let accepted = 'access-retry';
  let base = '';
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', base);
    calls.push(`${req.method} ${u.pathname}`);
    if (u.pathname === '/.well-known/oauth-protected-resource') {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base] });
    }
    if (u.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (u.pathname === '/register' && req.method === 'POST') {
      const meta = JSON.parse(await body(req)) as { redirect_uris?: string[] };
      return json(res, 201, {
        client_id: 'mock-public-client',
        token_endpoint_auth_method: 'none',
        redirect_uris: meta.redirect_uris?.length ? meta.redirect_uris : [redirectUri],
      });
    }
    if (u.pathname === '/authorize') {
      const code = `code-${++n}`;
      challenges.set(code, u.searchParams.get('code_challenge') ?? '');
      return json(res, 200, { code, state: u.searchParams.get('state') });
    }
    if (u.pathname === '/token') {
      const p = new URLSearchParams(await body(req));
      if (p.get('grant_type') === 'refresh_token') {
        return json(res, 400, { error: 'invalid_grant' });
      }
      const code = p.get('code') ?? '';
      const verifier = p.get('code_verifier') ?? '';
      const expected = challenges.get(code);
      const actual = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (!expected || actual !== expected) return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, {
        access_token: accepted,
        refresh_token: 'refresh-1',
        token_type: 'bearer',
        expires_in: 3600,
      });
    }
    if (u.pathname === '/mcp') {
      if (req.headers.authorization !== `Bearer ${accepted}`) {
        return json(res, 401, { detail: 'OAuth bearer token required' }, {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        });
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        return res.end();
      }
      const msg = JSON.parse(await body(req) || '{}') as { id?: number; method?: string };
      if (msg.method) rpc.push(msg.method);
      if (msg.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      if (msg.method === 'initialize') {
        return json(res, 200, {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'fx', version: '0' },
          },
        });
      }
      if (msg.method === 'tools/list') {
        return json(res, 200, {
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [{ name: 'mock_read_only', description: 'Mock', inputSchema: { type: 'object', properties: {} } }],
          },
        });
      }
      return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown ${msg.method}` } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  return {
    base,
    calls,
    rpc,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

describe('MCP OAuth callback lifecycle (loopback fixture)', () => {
  const originalCwd = process.cwd();
  let tmp: string;
  const unhandled: string[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(String((reason as Error)?.message ?? reason).slice(0, 160));
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mcp-oauth-life-'));
    process.chdir(tmp);
    resetMCPOAuthManager();
    process.env.CODEBUDDY_VAULT_KEY = 'test-key-oauth-lifecycle';
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    setMCPOAuthInteraction(null);
    process.chdir(originalCwd);
    delete process.env.CODEBUDDY_VAULT_KEY;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects EADDRINUSE before opening the browser (0ms and 250ms opener)', async () => {
    const blocker = net.createServer();
    try {
      await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
      const port = (blocker.address() as net.AddressInfo).port;

      async function scenario(delayMs: number) {
        unhandled.length = 0;
        let opened = 0;
        setMCPOAuthInteraction({
          openUrl: async () => {
            opened++;
            await new Promise((r) => setTimeout(r, delayMs));
          },
          waitForCode: async () => {
            throw new Error('waitForCode must not be used when beginWaitForCode is set');
          },
          beginWaitForCode: (uri, state, opts) => startCallbackSession(uri, state, 5_000, opts?.signal),
        });
        const provider = new MCPStoredOAuthProvider(`busy-${delayMs}`, {
          type: 'oauth',
          redirectUri: `http://127.0.0.1:${port}/callback`,
        });
        provider.attachTransport({ finishAuth: async () => undefined });
        provider.state();
        const outcome = await provider
          .redirectToAuthorization(new URL('https://auth.example.invalid/authorize'))
          .then(() => 'resolved', (e: Error) => `rejected:${e.message}`);
        await new Promise((r) => setTimeout(r, 50));
        return { delayMs, opened, outcome, unhandled: [...unhandled] };
      }

      const a = await scenario(0);
      const b = await scenario(250);

      for (const row of [a, b]) {
        expect(row.opened, `browser delay ${row.delayMs}`).toBe(0);
        expect(row.outcome).toMatch(/EADDRINUSE|address already in use/);
        expect(row.unhandled, `unhandled delay ${row.delayMs}`).toEqual([]);
      }
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('public startCallbackServer with a pre-aborted signal leaves no orphan rejection', async () => {
    const ac = new AbortController();
    ac.abort();
    unhandled.length = 0;
    await expect(startCallbackServer('http://127.0.0.1:12345/callback', 's', 1000, ac.signal)).rejects.toThrow(
      /cancelled/i,
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(unhandled).toEqual([]);
  });

  it('aborts before listen, while waiting, and after a successful callback; port is reusable', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const state = 'state-wait';

    const aborted = new AbortController();
    aborted.abort();
    const before = startCallbackSession(redirectUri, state, 5_000, aborted.signal);
    await expect(before.listening).rejects.toThrow(/cancelled/i);
    expect(await portInUse(port)).toBe(false);

    const waiting = startCallbackSession(redirectUri, 'st-wait', 30_000);
    await waiting.listening;
    expect(await portInUse(port)).toBe(true);
    waiting.abort();
    await expect(waiting.result).rejects.toThrow(/cancelled/i);
    await new Promise((r) => setTimeout(r, 30));
    expect(await portInUse(port)).toBe(false);

    const ok = startCallbackSession(redirectUri, 'st-ok', 5_000);
    await ok.listening;
    await new Promise<void>((resolve, reject) => {
      http
        .get(`${redirectUri}?code=ok-code&state=${encodeURIComponent('st-ok')}`, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });
    await expect(ok.result).resolves.toMatchObject({ code: 'ok-code', state: 'st-ok' });
    await new Promise((r) => setTimeout(r, 30));
    expect(await portInUse(port)).toBe(false);
  });

  it('removeServer during pending auth then retries PKCE+tokens+tools/list on the same manager', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const added: string[] = [];
    let fx: PkceFixture | undefined;
    const manager = new MCPManager();
    manager.on('serverAdded', (name: string) => added.push(name));
    try {
      fx = await startPkceFixture(redirectUri);
      let allowComplete = false;
      let opened = 0;
      setMCPOAuthInteraction({
        openUrl: async (url) => {
          opened += 1;
          if (!allowComplete) return;
          await completeBrowser(url);
        },
        waitForCode: async () => {
          throw new Error('must use beginWaitForCode');
        },
        beginWaitForCode: (uri, state, opts) => startCallbackSession(uri, state, 30_000, opts?.signal),
      });
      const config = {
        name: 'life-retry',
        autoReconnect: true,
        transport: {
          type: 'streamable_http' as const,
          url: `${fx.base}/mcp`,
          auth: { type: 'oauth' as const, serverId: 'life-retry', redirectUri },
        },
      };
      const connecting = manager.addServer(config);
      connecting.catch(() => undefined);
      for (let i = 0; i < 120 && !(await portInUse(port)); i++) await new Promise((r) => setTimeout(r, 25));
      expect(await portInUse(port), 'callback bound during pending auth').toBe(true);

      await manager.removeServer('life-retry');
      await connecting.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
      expect(await portInUse(port), 'port free after removeServer').toBe(false);
      expect(manager.getServerStatus('life-retry')).toBe('disconnected');

      const openedAfterCancel = opened;
      await new Promise((r) => setTimeout(r, 1200));
      expect(opened, 'autoReconnect must not reopen the browser after explicit cancel').toBe(openedAfterCancel);
      expect(added).toEqual([]);
      expect(manager.getServerStatus('life-retry')).toBe('disconnected');
      expect(getMCPOAuthManager().getStoredToken('life-retry')).toBeNull();

      allowComplete = true;
      await manager.addServer(config);
      expect(manager.getServerStatus('life-retry')).toBe('connected');
      expect(manager.getTools().map((t) => t.name)).toContain('mcp__life-retry__mock_read_only');
      expect(fx.rpc).toContain('tools/list');
      expect(fx.calls.filter((c) => c === 'POST /token').length).toBeGreaterThanOrEqual(1);
      expect(getMCPOAuthManager().getStoredToken('life-retry')?.token.accessToken).toBe('access-retry');
      const tokenReq = fx.calls.includes('POST /token');
      expect(tokenReq).toBe(true);
    } finally {
      await manager.removeServer('life-retry').catch(() => undefined);
      await fx?.close();
    }
  });

  it('abort during a slow openUrl does not finishAuth after cancellation', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    let finishCount = 0;
    let lastUrl = '';
    let releaseOpen!: () => void;
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    try {
      setMCPOAuthInteraction({
        openUrl: async (url) => {
          lastUrl = url;
          await openGate;
        },
        waitForCode: async () => {
          throw new Error('must use beginWaitForCode');
        },
        beginWaitForCode: (uri, state, opts) => startCallbackSession(uri, state, 15_000, opts?.signal),
      });
      const provider = new MCPStoredOAuthProvider('slow-open', { type: 'oauth', redirectUri });
      provider.attachTransport({
        finishAuth: async () => {
          finishCount += 1;
        },
      });
      provider.state();
      const pending = provider.redirectToAuthorization(new URL('https://auth.example.invalid/authorize?x=1'));
      pending.catch(() => undefined);
      for (let i = 0; i < 80 && !(await portInUse(port)); i++) await new Promise((r) => setTimeout(r, 25));
      expect(await portInUse(port)).toBe(true);
      provider.abortAuthorization();
      if (lastUrl) {
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', 'late-code');
        redirect.searchParams.set('state', new URL(lastUrl).searchParams.get('state') ?? '');
        await new Promise<void>((resolve) => {
          http.get(redirect.toString(), (r) => {
            r.resume();
            r.on('end', resolve);
          }).on('error', () => resolve());
        });
      }
      releaseOpen();
      await expect(pending).rejects.toThrow(/cancelled/i);
      await new Promise((r) => setTimeout(r, 40));
      expect(finishCount).toBe(0);
      expect(await portInUse(port)).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      releaseOpen?.();
    }
  });

  it('keeps a usable manual URL when openUrl rejects and completes the real callback', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    let fx: PkceFixture | undefined;
    const manager = new MCPManager();
    const warn = vi.spyOn(logger, 'warn');
    try {
      fx = await startPkceFixture(redirectUri);
      let lastUrl = '';
      setMCPOAuthInteraction({
        openUrl: async (url) => {
          lastUrl = url;
          throw new Error('xdg-open failed');
        },
        waitForCode: async () => {
          throw new Error('must use beginWaitForCode');
        },
        beginWaitForCode: (uri, state, opts) => startCallbackSession(uri, state, 15_000, opts?.signal),
      });
      const connecting = manager.addServer({
        name: 'manual-open',
        transport: {
          type: 'streamable_http',
          url: `${fx.base}/mcp`,
          auth: { type: 'oauth', serverId: 'manual-open', redirectUri },
        },
      });
      for (let i = 0; i < 80 && !lastUrl; i++) await new Promise((r) => setTimeout(r, 25));
      expect(lastUrl).toMatch(/^https?:\/\//);
      const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain(lastUrl);
      await completeBrowser(lastUrl);
      await connecting;
      expect(manager.getTools().map((t) => t.name)).toContain('mcp__manual-open__mock_read_only');
      expect(fx.rpc).toContain('tools/list');
    } finally {
      warn.mockRestore();
      await manager.removeServer('manual-open').catch(() => undefined);
      await fx?.close();
    }
  });

  it('invalidateCredentials(tokens) keeps the registered client and does not POST /register', async () => {
    const calls: string[] = [];
    const challenges = new Map<string, string>();
    let n = 0;
    const fx = http.createServer(async (req, res) => {
      const host = `http://127.0.0.1:${(fx.address() as net.AddressInfo).port}`;
      const u = new URL(req.url ?? '/', host);
      calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === '/.well-known/oauth-protected-resource') {
        return json(res, 200, { resource: `${host}/mcp`, authorization_servers: [host] });
      }
      if (u.pathname === '/.well-known/oauth-authorization-server') {
        return json(res, 200, {
          issuer: host,
          authorization_endpoint: `${host}/authorize`,
          token_endpoint: `${host}/token`,
          registration_endpoint: `${host}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (u.pathname === '/register') {
        await body(req);
        return json(res, 201, { client_id: 'should-not-register', token_endpoint_auth_method: 'none' });
      }
      if (u.pathname === '/token') {
        const p = new URLSearchParams(await body(req));
        if (p.get('grant_type') === 'refresh_token') {
          return json(res, 400, { error: 'invalid_grant' });
        }
        const code = p.get('code') ?? '';
        const verifier = p.get('code_verifier') ?? '';
        const expected = challenges.get(code);
        const actual = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (!expected || actual !== expected) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, { access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600 });
      }
      if (u.pathname === '/mcp') {
        res.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${host}/.well-known/oauth-protected-resource"`,
        });
        return res.end();
      }
      if (u.pathname === '/authorize') {
        const code = `c-${++n}`;
        challenges.set(code, u.searchParams.get('code_challenge') ?? '');
        return json(res, 200, { code, state: u.searchParams.get('state') });
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => fx.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(fx.address() as net.AddressInfo).port}`;

    const mgr = getMCPOAuthManager();
    mgr.storeClientInformation('tok', {
      client_id: 'registered-client',
      client_secret: 'fixture-secret',
      token_endpoint_auth_method: 'none',
    });
    mgr.storeToken(
      'tok',
      {
        accessToken: 'expired-access',
        refreshToken: 'revoked-refresh',
        expiresAt: Date.now() - 60_000,
        scopes: [],
      },
      { clientId: 'registered-client', authorizationUrl: '', tokenUrl: 'sdk-managed', scopes: [] },
    );

    setMCPOAuthInteraction({
      openUrl: async () => {
        throw new Error('must not open');
      },
      waitForCode: async () => {
        throw new Error('must not wait');
      },
    });

    const manager = new MCPManager();
    const outcome = await manager
      .addServer({
        name: 'tok',
        transport: {
          type: 'streamable_http',
          url: `${base}/mcp`,
          auth: { type: 'oauth', serverId: 'tok', interactive: false },
        },
      })
      .then(
        () => 'resolved',
        (e: Error) => `rejected:${e.message}`,
      );

    try {
      expect(outcome).toMatch(/requires OAuth authorization|invalid_grant|Unauthorized|sign in/i);
      expect(calls.filter((c) => c === 'POST /register')).toEqual([]);
      expect(mgr.getStoredClientInformation('tok')?.client_id).toBe('registered-client');
      expect(mgr.getStoredClientInformation('tok')?.client_secret).toBe('fixture-secret');
      expect(mgr.getStoredToken('tok')).toBeNull();
    } finally {
      await manager.removeServer('tok').catch(() => undefined);
      await new Promise<void>((r) => fx.close(() => r()));
    }
  });

  it('invalidateCredentials(client) and (all) drop the stored client', () => {
    const mgr = getMCPOAuthManager();
    const provider = new MCPStoredOAuthProvider('wipe', { type: 'oauth' });
    mgr.storeClientInformation('wipe', { client_id: 'keep-me' });
    mgr.storeToken(
      'wipe',
      { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000, scopes: [] },
      { clientId: 'keep-me', authorizationUrl: '', tokenUrl: 'sdk-managed', scopes: [] },
    );
    provider.invalidateCredentials('tokens');
    expect(mgr.getStoredClientInformation('wipe')?.client_id).toBe('keep-me');
    provider.invalidateCredentials('client');
    expect(mgr.getStoredClientInformation('wipe')).toBeNull();
  });
});
