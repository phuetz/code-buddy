import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Server } from 'http';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { mobileRouter, activePairingCode, activeTokens, isLoopbackRequest, loopbackOnlyMiddleware } from '../../src/server/routes/mobile.js';

let tempDir: string;

vi.mock('../../src/observability/mobile-supervision-snapshot.js', () => ({
  buildMobileSupervisionSnapshot: vi.fn().mockResolvedValue({ status: 'active', steps: [] }),
}));

vi.mock('../../src/observability/mobile-supervision-gateway-contract.js', () => ({
  buildMobileSupervisionGatewayContract: vi.fn().mockResolvedValue({ basePath: '/api/mobile' }),
}));

vi.mock('../../src/observability/mobile-supervision-gateway-policy.js', () => ({
  buildMobileSupervisionGatewayReviewDraft: vi.fn().mockReturnValue({ action: 'draft_followup_prompt' }),
}));

vi.mock('../../src/observability/run-store.js', () => ({
  getActiveRunStore: () => ({
    getRunsDir: () => tempDir,
  }),
}));

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mobile-router-'));
  activeTokens.clear();
});

afterEach(async () => {
  await fs.remove(tempDir);
});

describe('mobileRouter', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {

    app = express();
    app.use(express.json());
    app.use('/api/mobile', mobileRouter);
    
    server = app.listen(0);
    const address = server.address();
    if (address && typeof address !== 'string') {
      baseUrl = `http://localhost:${address.port}/api/mobile`;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('should return pairing-status', async () => {
    const res = await fetch(`${baseUrl}/pairing-status`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.pairingCode).toBe(activePairingCode);
  });

  it('should pair successfully with correct code and issue token', async () => {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test iPad' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.scopes).toContain('mobile:read');
  });

  it('should reject pairing with incorrect code', async () => {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wrong-code', deviceLabel: 'Test iPad' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json() as any;
    expect(data.ok).toBe(false);
  });

  it('should reject requests to auth-gated endpoints with missing token', async () => {
    const res = await fetch(`${baseUrl}/snapshot`);
    expect(res.status).toBe(401);
  });

  it('should accept authorized requests and serve snapshot', async () => {
    // 1. Get valid token
    const pairRes = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test iPad' }),
    });
    const { token } = await pairRes.json() as any;

    // 2. Fetch snapshot
    const res = await fetch(`${baseUrl}/snapshot`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.snapshot).toBeDefined();
  });

  it('should serve files inside the artifact directory', async () => {
    // 1. Create a dummy run artifact
    const runId = 'run-999';
    const artifactSubPath = 'logs/info.log';
    const fullArtifactDir = path.join(tempDir, runId, 'artifacts');
    await fs.ensureDir(fullArtifactDir);
    const artifactFile = path.join(fullArtifactDir, artifactSubPath);
    await fs.ensureDir(path.dirname(artifactFile));
    await fs.writeFile(artifactFile, 'Hello, operator!', 'utf-8');

    // 2. Get valid token
    const pairRes = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test iPad' }),
    });
    const { token } = await pairRes.json() as any;

    // 3. Fetch artifact
    const res = await fetch(`${baseUrl}/runs/${runId}/artifacts/${artifactSubPath}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.content).toBe('Hello, operator!');
    expect(data.metadata.name).toBe('info.log');
  });

  it('should block directory traversal requests with 403', async () => {
    // 1. Create a dummy file outside the artifact folder
    const runId = 'run-999';
    const forbiddenFile = path.join(tempDir, runId, 'secret.txt');
    await fs.ensureDir(path.dirname(forbiddenFile));
    await fs.writeFile(forbiddenFile, 'forbidden data', 'utf-8');

    // 2. Get valid token
    const pairRes = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test iPad' }),
    });
    const { token } = await pairRes.json() as any;

    // 3. Try directory traversal using raw http to prevent client-side normalization
    const port = (server.address() as any).port;
    const rawPath = `/api/mobile/runs/${runId}/artifacts/%2e%2e/secret.txt`;
    const res = await new Promise<{ status: number; data: any }>((resolve, reject) => {
      const req = http.get({
        hostname: 'localhost',
        port,
        path: rawPath,
        headers: { 'Authorization': `Bearer ${token}` }
      }, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => {
          try {
            resolve({ status: r.statusCode || 0, data: JSON.parse(body) });
          } catch {
            resolve({ status: r.statusCode || 0, data: body });
          }
        });
      });
      req.on('error', reject);
    });

    expect(res.status).toBe(403);
    expect(res.data.ok).toBe(false);
    expect(res.data.error).toContain('Path traversal');
  });

  it('should save followup-draft review drafts', async () => {
    // 1. Get valid token
    const pairRes = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test iPad' }),
    });
    const { token } = await pairRes.json() as any;

    // 2. Post followup draft
    const res = await fetch(`${baseUrl}/followup-draft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt: 'Please write tests for the frontend', query: 'frontend tests' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.draft.prompt).toBe('Please write tests for the frontend');
    expect(data.draft.id).toBeDefined();
    expect(data.draft.status).toBe('needs_local_operator');
  });
});

describe('mobileRouter follow-up review queue (GAP-5 P2)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/mobile', mobileRouter);
    server = app.listen(0);
    const address = server.address();
    if (address && typeof address !== 'string') {
      baseUrl = `http://localhost:${address.port}/api/mobile`;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  async function deviceToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'Test Device' }),
    });
    const { token } = await res.json() as any;
    return token;
  }

  it('submit-prompt requires a device token', async () => {
    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'do something' }),
    });
    expect(res.status).toBe(401);
  });

  it('a paired device submits a prompt that lands as a pending draft (never executed)', async () => {
    const token = await deviceToken();
    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Summarize the latest run', query: 'run summary' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.draft.status).toBe('needs_local_operator');
    expect(data.draft.source).toBe('mobile_device');
    expect(data.message).toContain('will not run');
  });

  it('the local operator approves a pending draft (review-gate marker, no dispatch)', async () => {
    // device submits
    const token = await deviceToken();
    const submit = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Review the failing test' }),
    });
    const { draft } = await submit.json() as any;

    // local operator (loopback) approves — no token required
    const res = await fetch(`${baseUrl}/followup-draft/${draft.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewer: 'patrice' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.draft.status).toBe('approved');
    expect(data.draft.approvedBy).toBe('patrice');
    expect(typeof data.draft.approvedAt).toBe('number');
    // Contract invariant: approval never dispatches work. This route imports no
    // agent/executor surface, so there is structurally no execution path here —
    // the message states the negative-space property explicitly.
    expect(data.message).toContain('No work is dispatched');
  });

  it('rejects a second approval of an already-approved draft with 409', async () => {
    const token = await deviceToken();
    const submit = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Once-approvable' }),
    });
    const { draft } = await submit.json() as any;

    const first = await fetch(`${baseUrl}/followup-draft/${draft.id}/approve`, { method: 'POST' });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/followup-draft/${draft.id}/approve`, { method: 'POST' });
    expect(second.status).toBe(409);

    // and you cannot cancel a draft that was already approved
    const cancelAfterApprove = await fetch(`${baseUrl}/followup-draft/${draft.id}/cancel`, { method: 'POST' });
    expect(cancelAfterApprove.status).toBe(409);
  });

  it('cancels a pending draft and 404s for an unknown id', async () => {
    const token = await deviceToken();
    const submit = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Cancellable' }),
    });
    const { draft } = await submit.json() as any;

    const cancel = await fetch(`${baseUrl}/followup-draft/${draft.id}/cancel`, { method: 'POST' });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as any).draft.status).toBe('cancelled');

    const missing = await fetch(`${baseUrl}/followup-draft/does-not-exist/approve`, { method: 'POST' });
    expect(missing.status).toBe(404);
  });

  it('lists the review queue for the local operator', async () => {
    const token = await deviceToken();
    const submitted = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'Queue listing fixture' }),
    });
    expect(submitted.status).toBe(200);
    const res = await fetch(`${baseUrl}/followup-drafts`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.drafts)).toBe(true);
    expect(data.drafts.length).toBeGreaterThan(0);
  });
});

describe('mobileRouter loopback guard (GAP-5)', () => {
  // The pairing code is a bearer-equivalent secret. /pairing-status and
  // /pairing-code must be reachable from the local operator only. We unit-test
  // the middleware directly because real loopback TCP can't fake a remote peer.
  function mockReq(remoteAddress: string | undefined, headers: Record<string, string> = {}) {
    return {
      path: '/pairing-status',
      headers,
      socket: { remoteAddress },
    } as any;
  }

  function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (payload: any) => { res.body = payload; return res; };
    return res;
  }

  it('treats 127.0.0.1, ::1 and IPv4-mapped IPv6 as loopback', () => {
    expect(isLoopbackRequest(mockReq('127.0.0.1'))).toBe(true);
    expect(isLoopbackRequest(mockReq('::1'))).toBe(true);
    expect(isLoopbackRequest(mockReq('::ffff:127.0.0.1'))).toBe(true);
    expect(isLoopbackRequest(mockReq('127.0.0.5'))).toBe(true);
  });

  it('treats LAN / public addresses as non-loopback', () => {
    expect(isLoopbackRequest(mockReq('192.168.1.50'))).toBe(false);
    expect(isLoopbackRequest(mockReq('10.0.0.7'))).toBe(false);
    expect(isLoopbackRequest(mockReq('203.0.113.9'))).toBe(false);
    expect(isLoopbackRequest(mockReq(undefined))).toBe(false);
  });

  it('allows a loopback request through the middleware', () => {
    const next = vi.fn();
    const res = mockRes();
    loopbackOnlyMiddleware(mockReq('127.0.0.1'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('denies a non-loopback request with 403', () => {
    const next = vi.fn();
    const res = mockRes();
    loopbackOnlyMiddleware(mockReq('192.168.1.50'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it('ignores a spoofed X-Forwarded-For header (socket is authoritative)', () => {
    const next = vi.fn();
    const res = mockRes();
    // Attacker on the LAN sets X-Forwarded-For: 127.0.0.1 but their socket is not loopback.
    loopbackOnlyMiddleware(
      mockReq('10.0.0.7', { 'x-forwarded-for': '127.0.0.1' }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
