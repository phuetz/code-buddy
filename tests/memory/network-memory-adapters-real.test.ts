import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  Mem0MemoryProvider,
  HonchoMemoryProvider,
  SupermemoryMemoryProvider,
  OpenVikingMemoryProvider,
  RetainDBMemoryProvider,
} from '../../src/memory/adapters/network-memory-adapters.js';
import { ByteRoverMemoryProvider } from '../../src/memory/adapters/cli-memory-adapters.js';
import { probeMemoryProvider } from '../../src/agent/hermes-memory-providers.js';
import { resetMemoryProviderRegistry } from '../../src/memory/memory-provider.js';

/**
 * Real-HTTP shape tests: each adapter is pointed at a real local HTTP server
 * (no fetch mock). These prove the adapter builds requests against the exact
 * upstream paths/bodies sourced from the real plugins/SDKs, and parses the
 * documented response shapes. Live round-trip validation against a configured
 * instance is a separate step (`buddy hermes memory probe`).
 */

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
  headers: http.IncomingHttpHeaders;
}

type Responder = (req: CapturedRequest) => { status?: number; json?: unknown } | undefined;

async function withServer(
  responder: Responder,
  fn: (baseUrl: string, captured: CapturedRequest[]) => Promise<void>,
): Promise<void> {
  const captured: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        /* leave as string */
      }
      const captureReq: CapturedRequest = { method: req.method ?? '', url: req.url ?? '', body, headers: req.headers };
      captured.push(captureReq);
      const result = responder(captureReq) ?? { status: 200, json: {} };
      res.writeHead(result.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.json ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl, captured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Mem0MemoryProvider (self-hosted REST)', () => {
  it('writes to POST /memories and searches POST /search (no /v1 prefix)', async () => {
    await withServer(
      (req) => {
        if (req.url === '/search') return { json: [{ memory: 'Prefers TypeScript' }] };
        return { json: { results: [] } };
      },
      async (baseUrl, captured) => {
        const provider = new Mem0MemoryProvider({ baseUrl });
        await provider.initialize();
        await provider.remember('lang', 'TypeScript');
        const hits = await provider.getRelevantMemories('language', 3);

        const write = captured.find((c) => c.url === '/memories');
        expect(write?.method).toBe('POST');
        expect((write?.body as { messages?: unknown[] }).messages).toBeTruthy();
        const search = captured.find((c) => c.url === '/search');
        expect(search?.method).toBe('POST');
        expect(hits[0]?.value).toBe('Prefers TypeScript');
      },
    );
  });

  it('searches the SAME user_id partition it wrote to (project scope) so recall finds what remember stored', async () => {
    // Regression: Mem0 partitions by user_id. `remember` writes under
    // `<userId>:project` but `search` previously queried bare `<userId>`, so
    // recall silently missed every project-scoped write (live probe stayed
    // PENDING). write and read must resolve to the same partition.
    await withServer(
      (req) => {
        if (req.url === '/search') return { json: { results: [{ memory: 'token cb-probe-xyz' }] } };
        return { json: { results: [] } };
      },
      async (baseUrl, captured) => {
        const provider = new Mem0MemoryProvider({ baseUrl, userId: 'codebuddy' });
        await provider.initialize();
        await provider.remember('probe', 'token cb-probe-xyz');
        const hit = await provider.recall('probe');

        const writeUid = (captured.find((c) => c.url === '/memories')?.body as { user_id?: string }).user_id;
        const searchUid = (captured.find((c) => c.url === '/search')?.body as { user_id?: string }).user_id;
        expect(writeUid).toBe('codebuddy:project');
        expect(searchUid).toBe(writeUid);
        expect(hit).toBe('token cb-probe-xyz');
      },
    );
  });
});

describe('HonchoMemoryProvider (v3 REST)', () => {
  it('get-or-creates workspace/peer/session then posts messages and searches', async () => {
    await withServer(
      (req) => {
        if (req.url?.endsWith('/search')) return { json: { items: [{ content: 'Likes vitest' }] } };
        return { json: {} };
      },
      async (baseUrl, captured) => {
        const provider = new HonchoMemoryProvider({ baseUrl, apiKey: 'k', workspace: 'cb', peer: 'cb' });
        await provider.initialize();
        await provider.remember('testing', 'vitest');
        const hits = await provider.getRelevantMemories('testing', 3);

        const paths = captured.map((c) => c.url);
        expect(paths).toContain('/v3/workspaces');
        expect(paths).toContain('/v3/workspaces/cb/peers');
        expect(paths).toContain('/v3/workspaces/cb/sessions');
        expect(paths).toContain('/v3/workspaces/cb/sessions/default/messages');
        expect(paths).toContain('/v3/workspaces/cb/search');
        const msg = captured.find((c) => c.url === '/v3/workspaces/cb/sessions/default/messages');
        expect((msg?.body as { messages?: Array<{ peer_id?: string }> }).messages?.[0]?.peer_id).toBe('cb');
        expect(hits[0]?.value).toBe('Likes vitest');
      },
    );
  });

  it('treats an explicit base URL (no key) as remote — does NOT silently use local', async () => {
    await withServer(
      () => ({ json: {} }),
      async (baseUrl, captured) => {
        // Self-hosted Honcho without a key must still hit the server (matches the
        // readiness matrix; otherwise the probe could report a false remote PASS).
        const provider = new HonchoMemoryProvider({ baseUrl, workspace: 'cb', peer: 'cb' });
        await provider.initialize();
        await provider.remember('k', 'v');
        expect(captured.some((c) => c.url === '/v3/workspaces/cb/sessions/default/messages')).toBe(true);
      },
    );
  });
});

describe('SupermemoryMemoryProvider (v3 cloud REST)', () => {
  it('adds via POST /v3/documents and searches via POST /v3/search', async () => {
    await withServer(
      (req) => {
        if (req.url === '/v3/search') return { json: { results: [{ content: 'remembered fact' }] } };
        return { json: {} };
      },
      async (baseUrl, captured) => {
        const provider = new SupermemoryMemoryProvider({ apiKey: 'k', baseUrl });
        await provider.initialize();
        await provider.remember('fact', 'something');
        const hits = await provider.getRelevantMemories('fact', 3);

        const add = captured.find((c) => c.url === '/v3/documents');
        expect(add?.method).toBe('POST');
        expect((add?.headers.authorization)).toBe('Bearer k');
        expect(hits[0]?.value).toBe('remembered fact');
      },
    );
  });
});

describe('OpenVikingMemoryProvider (self-hosted /api/v1)', () => {
  it('searches /api/v1/search/find, writes /api/v1/content/write, sends tenant headers', async () => {
    await withServer(
      (req) => {
        if (req.url === '/api/v1/search/find') {
          return { json: { result: { items: [{ uri: 'viking://x', abstract: 'tiered hit', score: 0.9 }] } } };
        }
        return { json: { status: 'ok' } };
      },
      async (baseUrl, captured) => {
        const provider = new OpenVikingMemoryProvider({ endpoint: baseUrl });
        await provider.initialize();
        await provider.remember('k', 'v');
        const hits = await provider.getRelevantMemories('q', 3);

        const write = captured.find((c) => c.url === '/api/v1/content/write');
        expect(write?.method).toBe('POST');
        expect(write?.headers['x-openviking-agent']).toBe('codebuddy');
        expect(hits[0]?.value).toBe('tiered hit');
      },
    );
  });
});

describe('RetainDBMemoryProvider (cloud REST)', () => {
  it('adds POST /v1/memory and searches POST /v1/memory/search with Bearer', async () => {
    await withServer(
      (req) => {
        if (req.url === '/v1/memory/search') return { json: { results: [{ content: 'hybrid hit' }] } };
        return { json: {} };
      },
      async (baseUrl, captured) => {
        const provider = new RetainDBMemoryProvider({ apiKey: 'tok', baseUrl });
        await provider.initialize();
        await provider.remember('k', 'v');
        const hits = await provider.getRelevantMemories('q', 3);

        const add = captured.find((c) => c.url === '/v1/memory');
        expect(add?.method).toBe('POST');
        expect(add?.headers.authorization).toBe('Bearer tok');
        expect((add?.body as { project?: string }).project).toBe('codebuddy');
        expect(hits[0]?.value).toBe('hybrid hit');
      },
    );
  });
});

describe('ByteRoverMemoryProvider (brv CLI subprocess)', () => {
  let dir: string;
  let brvPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brv-'));
    if (process.platform === 'win32') {
      brvPath = path.join(dir, 'brv.cmd');
      fs.writeFileSync(
        brvPath,
        '@echo off\r\n' +
          'if "%1"=="query" echo FAKE_MEMORY hit\r\n' +
          'if "%1"=="curate" echo curated\r\n' +
          'if "%1"=="status" echo ok\r\n' +
          'exit /b 0\r\n',
      );
    } else {
      brvPath = path.join(dir, 'brv');
      fs.writeFileSync(
        brvPath,
        '#!/bin/sh\n' +
          'case "$1" in\n' +
          '  query) echo "FAKE_MEMORY hit" ;;\n' +
          '  curate) echo "curated" ;;\n' +
          '  status) echo "ok" ;;\n' +
          'esac\n' +
          'exit 0\n',
      );
      fs.chmodSync(brvPath, 0o755);
    }
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('resolves brv, queries on recall, and curates on remember', async () => {
    const provider = new ByteRoverMemoryProvider({ brvPath, cwd: dir });
    expect(provider.isAvailable()).toBe(true);
    await provider.initialize();

    await provider.remember('k', 'v'); // curate, exit 0
    const hits = await provider.getRelevantMemories('anything', 3);
    expect(hits[0]?.value).toContain('FAKE_MEMORY');
    const recalled = await provider.recall('anything');
    expect(recalled).toContain('FAKE_MEMORY');
  });

  it('falls back to local when brv is not installed', async () => {
    const provider = new ByteRoverMemoryProvider({ brvPath: '/nonexistent/brv', cwd: dir });
    // explicit bogus path => not available
    expect(provider.isAvailable()).toBe(true); // path string provided; resolution deferred to spawn
    await provider.initialize();
    await provider.remember('fk', 'fv');
    const val = await provider.recall('fk');
    expect(val).toBe('fv'); // served by local fallback after spawn error
  });
});

describe('probeMemoryProvider (live round-trip)', () => {
  afterEach(() => {
    delete process.env.MEM0_BASE_URL;
    delete process.env.MEM0_API_KEY;
    resetMemoryProviderRegistry();
  });

  it('passes against a configured (self-hosted) Mem0 backend and reports remote=true', async () => {
    await withServer(
      (req) => {
        if (req.url === '/search') return { json: { results: [{ memory: req.body && JSON.stringify(req.body) }] } };
        return { json: {} };
      },
      async (baseUrl) => {
        // Reflect the searched query back so the probe finds its own marker.
        // The server echoes the request body (which contains the query token).
        process.env.MEM0_BASE_URL = baseUrl;
        resetMemoryProviderRegistry();
        const result = await probeMemoryProvider('mem0');
        expect(result.remote).toBe(true);
        expect(result.wrote).toBe(true);
        expect(result.retrieved).toBe(true);
        expect(result.ok).toBe(true);
      },
    );
  });

  it('marks an unconfigured provider as local fallback (not a remote pass)', async () => {
    resetMemoryProviderRegistry();
    const result = await probeMemoryProvider('mem0');
    expect(result.remote).toBe(false);
    expect(result.verdict).toBe('pass'); // local fallback round-trips synchronously
    expect(result.notes.join(' ')).toContain('not configured');
  });

  it('reports FAIL (not a false remote PASS) when a configured remote silently falls back to local', async () => {
    await withServer(
      // Remote always errors -> adapter catches and falls back to local memory.
      () => ({ status: 500, json: { error: 'boom' } }),
      async (baseUrl) => {
        process.env.MEM0_BASE_URL = baseUrl;
        resetMemoryProviderRegistry();
        const result = await probeMemoryProvider('mem0');
        expect(result.remote).toBe(true);
        expect(result.fellBackToLocal).toBe(true);
        expect(result.verdict).toBe('fail');
        expect(result.ok).toBe(false);
        expect(result.notes.join(' ')).toMatch(/fell back|unreachable|LOCAL/i);
      },
    );
  });

  it('reports PENDING (not FAIL) when a remote backend wrote but has not indexed yet', async () => {
    await withServer(
      // Accept the write, but return no search hits (extraction not done yet).
      () => ({ json: { results: [] } }),
      async (baseUrl) => {
        process.env.MEM0_BASE_URL = baseUrl;
        resetMemoryProviderRegistry();
        const result = await probeMemoryProvider('mem0');
        expect(result.remote).toBe(true);
        expect(result.wrote).toBe(true);
        expect(result.retrieved).toBe(false);
        expect(result.verdict).toBe('pending');
        expect(result.ok).toBe(true); // pending must NOT be a hard fail / exit 1
      },
    );
  });
});
