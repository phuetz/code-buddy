import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import http, { type Server } from 'http';
import os from 'os';
import path from 'path';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'fs/promises';

import {
  activePairingCode,
  activeTokens,
  followupDrafts,
  mobileRouter,
} from '../../src/server/routes/mobile.js';
import { RunStore, setActiveRunStore } from '../../src/observability/run-store.js';

describe('mobileRouter artifact containment (real HTTP)', () => {
  let baseUrl: string;
  let server: Server;
  let store: RunStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'mobile-artifacts-real-'));
    store = new RunStore(tempDir);
    setActiveRunStore(store);
    activeTokens.clear();
    followupDrafts.length = 0;

    const app = express();
    app.use(express.json());
    app.use('/api/mobile', mobileRouter);

    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP listener for mobile artifact containment test');
    }
    baseUrl = `http://127.0.0.1:${address.port}/api/mobile`;
  });

  afterEach(async () => {
    activeTokens.clear();
    followupDrafts.length = 0;
    store.dispose();
    setActiveRunStore(null);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  async function pairToken(): Promise<string> {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'real-http-test' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { token: string };
    return data.token;
  }

  it('rejects malformed pairing payloads as JSON instead of throwing', async () => {
    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 123456, deviceLabel: 'malformed-device' }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.text();
    expect(body).toContain('Missing or invalid code or deviceLabel');
    expect(body).not.toContain('TypeError');
    expect(body).not.toContain('code.trim');
  });

  it('rejects oversized pairing device labels before minting a token', async () => {
    const oversizedLabel = 'device-'.padEnd(5000, 'x');

    const res = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: oversizedLabel }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Missing or invalid code or deviceLabel');
    expect(activeTokens.size).toBe(0);
  });

  it('marks mobile supervision responses no-store so pairing secrets are never cached', async () => {
    const status = await fetch(`${baseUrl}/pairing-status`);
    const rotate = await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
    const pair = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: activePairingCode, deviceLabel: 'cache-check-device' }),
    });

    expect(status.status).toBe(200);
    expect(rotate.status).toBe(200);
    expect(pair.status).toBe(200);
    expect(status.headers.get('cache-control')).toBe('no-store');
    expect(rotate.headers.get('cache-control')).toBe('no-store');
    expect(pair.headers.get('cache-control')).toBe('no-store');
  });

  it('rotates the pairing code after a successful pair so captured codes are single-use', async () => {
    const capturedCode = activePairingCode;
    const first = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: capturedCode, deviceLabel: 'first-device' }),
    });
    expect(first.status).toBe(200);
    expect(activePairingCode).not.toBe(capturedCode);

    const second = await fetch(`${baseUrl}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: capturedCode, deviceLabel: 'second-device' }),
    });
    expect(second.status).toBe(401);
    const secondBody = await second.text();
    expect(secondBody).toContain('Invalid pairing code');
    expect(activeTokens.size).toBe(1);
  });

  it('hides and prunes expired tokens from pairing status', async () => {
    activeTokens.set('expired-token', {
      deviceLabel: 'expired-phone',
      expiresAt: Date.now() - 1000,
    });
    activeTokens.set('live-token', {
      deviceLabel: 'live-phone',
      expiresAt: Date.now() + 60_000,
    });

    const res = await fetch(`${baseUrl}/pairing-status`);

    expect(res.status).toBe(200);
    const data = await res.json() as { activeDevices: string[]; ok: boolean };
    expect(data.ok).toBe(true);
    expect(data.activeDevices).toEqual(['live-phone']);
    expect(activeTokens.has('expired-token')).toBe(false);
    expect(activeTokens.has('live-token')).toBe(true);
  });

  it('keeps active mobile pairing tokens bounded to the newest devices', async () => {
    const issuedTokens: string[] = [];

    for (let i = 0; i < 35; i += 1) {
      const res = await fetch(`${baseUrl}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: activePairingCode,
          deviceLabel: `device-${String(i).padStart(2, '0')}`,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { activeDeviceLimit: number; token: string };
      expect(data.activeDeviceLimit).toBe(20);
      issuedTokens.push(data.token);
    }

    const status = await fetch(`${baseUrl}/pairing-status`);
    expect(status.status).toBe(200);
    const data = await status.json() as { activeDeviceLimit: number; activeDevices: string[] };
    expect(data.activeDeviceLimit).toBe(20);
    expect(data.activeDevices).toHaveLength(20);
    expect(data.activeDevices[0]).toBe('device-15');
    expect(data.activeDevices.at(-1)).toBe('device-34');
    expect(activeTokens.size).toBe(20);

    const evicted = await fetch(`${baseUrl}/snapshot?query=evicted-token`, {
      headers: { Authorization: `Bearer ${issuedTokens[0]}` },
    });
    const newest = await fetch(`${baseUrl}/snapshot?query=newest-token`, {
      headers: { Authorization: `Bearer ${issuedTokens.at(-1)}` },
    });
    expect(evicted.status).toBe(401);
    expect(newest.status).toBe(200);
  });

  it('expires pairing codes before they can mint a token', async () => {
    const previousTtl = process.env.CODEBUDDY_MOBILE_PAIRING_CODE_TTL_MS;
    try {
      process.env.CODEBUDDY_MOBILE_PAIRING_CODE_TTL_MS = '50';
      const rotate = await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
      expect(rotate.status).toBe(200);
      const rotated = await rotate.json() as {
        pairingCode: string;
        pairingCodeExpiresAt: number;
        pairingCodeTtlSeconds: number;
      };
      expect(rotated.pairingCodeTtlSeconds).toBeGreaterThanOrEqual(0);
      expect(rotated.pairingCodeExpiresAt).toBeGreaterThan(Date.now());

      await new Promise((resolve) => setTimeout(resolve, 80));

      const pair = await fetch(`${baseUrl}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: rotated.pairingCode, deviceLabel: 'expired-code-device' }),
      });

      expect(pair.status).toBe(401);
      expect(await pair.text()).toContain('Invalid pairing code');
      expect(activeTokens.size).toBe(0);
    } finally {
      if (previousTtl === undefined) {
        delete process.env.CODEBUDDY_MOBILE_PAIRING_CODE_TTL_MS;
      } else {
        process.env.CODEBUDDY_MOBILE_PAIRING_CODE_TTL_MS = previousTtl;
      }
      await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
    }
  });

  it('rate-limits repeated invalid pairing attempts from the same client', async () => {
    const statuses: number[] = [];
    try {
      for (let i = 0; i < 21; i += 1) {
        const res = await fetch(`${baseUrl}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '000000', deviceLabel: `spray-device-${i}` }),
        });
        statuses.push(res.status);
        if (i === 20) {
          expect(res.headers.get('retry-after')).toBeTruthy();
          expect(await res.text()).toContain('Too many invalid pairing attempts');
        }
      }

      expect(statuses.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => 401));
      expect(statuses[20]).toBe(429);
      expect(activeTokens.size).toBe(0);
    } finally {
      await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
    }
  });

  it('rejects malformed follow-up draft payloads before building gateway context', async () => {
    const token = await pairToken();

    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: { nested: 'not-string' },
        query: { also: 'not-string' },
      }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.text();
    expect(body).toContain('Missing or invalid prompt or query');
    expect(body).not.toContain('query.trim');
    expect(followupDrafts).toHaveLength(0);
  });

  it('rejects oversized follow-up drafts before storing operator-visible text', async () => {
    const token = await pairToken();
    const oversizedPrompt = 'review this '.padEnd(25_000, 'x');

    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: oversizedPrompt,
        query: 'oversized follow-up draft',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Missing or invalid prompt or query');
    expect(followupDrafts).toHaveLength(0);
  });

  it('rejects oversized follow-up queries before building gateway context', async () => {
    const token = await pairToken();
    const oversizedQuery = 'mobile query '.padEnd(5_000, 'q');

    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: 'Summarize this run when a local operator approves it',
        query: oversizedQuery,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Missing or invalid prompt or query');
    expect(followupDrafts).toHaveLength(0);
  });

  it('rejects new follow-up drafts when the pending review queue is full', async () => {
    const token = await pairToken();
    for (let i = 0; i < 100; i += 1) {
      followupDrafts.push({
        id: `seeded-pending-${i}`,
        prompt: `pending prompt ${i}`,
        status: 'needs_local_operator',
        source: 'mobile_device',
        createdAt: Date.now(),
      });
    }

    const res = await fetch(`${baseUrl}/submit-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: 'This should not enter a full local review queue',
        query: 'full mobile review queue',
      }),
    });

    expect(res.status).toBe(429);
    expect(await res.text()).toContain('Mobile follow-up draft queue is full');
    expect(followupDrafts).toHaveLength(100);
  });

  it('keeps resolved follow-up draft history bounded across submit and cancel cycles', async () => {
    const token = await pairToken();

    for (let i = 0; i < 125; i += 1) {
      const submit = await fetch(`${baseUrl}/submit-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: `resolved cycle ${i}`,
          query: `resolved history ${i}`,
        }),
      });
      expect(submit.status).toBe(200);
      const { draft } = await submit.json() as { draft: { id: string } };

      const cancel = await fetch(`${baseUrl}/followup-draft/${draft.id}/cancel`, { method: 'POST' });
      expect(cancel.status).toBe(200);
    }

    const list = await fetch(`${baseUrl}/followup-drafts`);
    expect(list.status).toBe(200);
    const data = await list.json() as {
      counts: { cancelled: number };
      drafts: Array<{ prompt: string; status: string }>;
      limits: { maxResolvedDrafts: number };
    };
    expect(data.limits.maxResolvedDrafts).toBe(100);
    expect(data.drafts).toHaveLength(100);
    expect(data.counts.cancelled).toBe(100);
    expect(data.drafts.every((draft) => draft.status === 'cancelled')).toBe(true);
    expect(data.drafts[0].prompt).toBe('resolved cycle 25');
    expect(followupDrafts).toHaveLength(100);
  });

  it('rejects repeated mobile query parameters before recall builders receive them', async () => {
    const token = await pairToken();

    const snapshot = await fetch(`${baseUrl}/snapshot?query=one&query=two`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const recallPack = await fetch(`${baseUrl}/recall-pack?query=one&query=two`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(snapshot.status).toBe(400);
    expect(recallPack.status).toBe(400);
    expect(await snapshot.text()).toContain('Missing or invalid query');
    const recallBody = await recallPack.text();
    expect(recallBody).toContain('Missing or invalid query');
    expect(recallBody).not.toContain('query.trim');
  });

  async function rawMobileGet(pathname: string, token: string): Promise<{ body: string; status: number }> {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected TCP listener for raw mobile request');
    }

    return await new Promise((resolve, reject) => {
      const req = http.get({
        hostname: '127.0.0.1',
        port: address.port,
        path: pathname,
        headers: { Authorization: `Bearer ${token}` },
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ body, status: res.statusCode ?? 0 });
        });
      });
      req.on('error', reject);
    });
  }

  it('serves a nested artifact inside the run artifact directory', async () => {
    const token = await pairToken();
    const runId = 'run-real-artifact-ok';
    const artifactPath = path.join(tempDir, runId, 'artifacts', 'logs', 'summary.txt');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, 'inside artifact', 'utf8');

    const res = await fetch(`${baseUrl}/runs/${runId}/artifacts/logs/summary.txt`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { content: string; ok: boolean };
    expect(data).toMatchObject({ content: 'inside artifact', ok: true });
  });

  it('blocks encoded runId traversal before resolving artifact paths outside the run store', async () => {
    const token = await pairToken();
    const secretName = `outside-${Date.now()}.txt`;
    const outsideArtifact = path.join(path.dirname(tempDir), 'artifacts', secretName);
    await mkdir(path.dirname(outsideArtifact), { recursive: true });
    await writeFile(outsideArtifact, 'outside run root secret', 'utf8');

    try {
      const result = await rawMobileGet(`/api/mobile/runs/%2e%2e/artifacts/${secretName}`, token);

      expect(result.status).toBe(403);
      expect(result.body).toContain('Invalid runId path segment');
      expect(result.body).not.toContain('outside run root secret');
    } finally {
      await unlink(outsideArtifact).catch(() => undefined);
    }
  });

  it('refuses to inline oversized artifacts over the mobile route', async () => {
    const token = await pairToken();
    const runId = 'run-real-artifact-large';
    const artifactPath = path.join(tempDir, runId, 'artifacts', 'large.txt');
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, 'artifact '.padEnd(1_500_000, 'x'), 'utf8');

    const res = await fetch(`${baseUrl}/runs/${runId}/artifacts/large.txt`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(413);
    const body = await res.text();
    expect(body).toContain('Artifact file is too large to inline');
    expect(body).toContain('"size":1500000');
    expect(body).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('blocks encoded traversal into sibling directories with the same prefix', async () => {
    const token = await pairToken();
    const runId = 'run-real-artifact-escape';
    const artifactDir = path.join(tempDir, runId, 'artifacts');
    const siblingDir = path.join(tempDir, runId, 'artifacts_evil');
    const siblingSecret = path.join(siblingDir, 'secret.txt');
    await mkdir(artifactDir, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(siblingSecret, 'sibling secret should not be readable', 'utf8');

    const result = await rawMobileGet(
      `/api/mobile/runs/${runId}/artifacts/%2e%2e/artifacts_evil/secret.txt`,
      token,
    );

    expect(await readFile(siblingSecret, 'utf8')).toContain('sibling secret');
    expect(result.status).toBe(403);
    expect(result.body).toContain('Path traversal');
    expect(result.body).not.toContain('sibling secret');
  });
});
