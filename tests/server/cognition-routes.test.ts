import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { CognitiveHub } from '../../src/cognition/cognitive-hub.js';
import { createCognitionRoutes } from '../../src/server/routes/cognition.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => error ? reject(error) : resolve());
  });
  server = undefined;
});
async function listen(hub: CognitiveHub, scopes: string[]): Promise<string> {
  const app = express();
  app.use((req, _res, next) => {
    req.auth = {
      userId: 'route-test',
      scopes: scopes as NonNullable<typeof req.auth>['scopes'],
      type: 'user',
    };
    next();
  });
  app.use('/api/cognition', createCognitionRoutes(hub));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  return `http://127.0.0.1:${address.port}`;
}

describe('cognition snapshot route', () => {
  it('returns a bounded route-safe snapshot and rejects malformed cursors', async () => {
    const hub = new CognitiveHub();
    hub.workspace.publish({
      kind: 'hypothesis',
      producerId: 'reflector',
      correlationId: 'turn',
      salience: 0.8,
      confidence: 0.8,
      privacy: 'local-only',
      provenance: { source: 'test' },
      ttlMs: 60_000,
      payload: { summary: 'private' },
    });
    const baseUrl = await listen(hub, ['cognition:raw', 'cognition:read-local']);
    const response = await fetch(`${baseUrl}/api/cognition/snapshot?limit=1&kinds=hypothesis`);
    expect(response.status).toBe(200);
    const body = await response.json() as { serverEpoch: string; revision: number; items: unknown[] };
    expect(body.serverEpoch).toBe(hub.serverEpoch);
    expect(body.revision).toBe(1);
    expect(body.items).toHaveLength(1);

    const malformed = await fetch(`${baseUrl}/api/cognition/snapshot?afterRevision=oops`);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: 'COGNITION_INVALID_REQUEST' },
    });
  });
});
