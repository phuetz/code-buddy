/**
 * /api/memory backed by the REAL persistent store — real HTTP round-trips
 * against startServer({port: 0}), real memory files in a temp dir, no store
 * mocks. Locks the rewire away from the old ephemeral in-process Map.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PersistentMemoryManager,
  getMemoryManager,
  resetMemoryManagerForTests,
} from '../../src/memory/persistent-memory.js';

describe('memory HTTP routes (real persistent store)', () => {
  let tmpDir: string;
  let projectFile: string;
  let userFile: string;
  let server: HttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-http-'));
    projectFile = path.join(tmpDir, 'CODEBUDDY_MEMORY.md');
    userFile = path.join(tmpDir, 'memory.md');
    // Seed the singleton the route resolves via getMemoryManager() with
    // temp-file paths BEFORE the server boots.
    resetMemoryManagerForTests();
    getMemoryManager({ projectMemoryPath: projectFile, userMemoryPath: userFile });

    const { startServer } = await import('../../src/server/index.js');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      authEnabled: false,
      websocketEnabled: false,
      logging: false,
      rateLimit: false,
      cors: false,
    });
    server = started.server;
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    const { stopServer } = await import('../../src/server/index.js');
    await stopServer(server);
    resetMemoryManagerForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('POST → GET /:id round-trips through the REAL memory file', async () => {
    const created = await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'favorite-editor', content: 'Patrice uses VS Code', category: 'preferences' }),
    });
    expect(created.status).toBe(201);
    const entry = (await created.json()) as Record<string, unknown>;
    expect(entry.id).toBe('favorite-editor');
    expect(entry.scope).toBe('project');

    // The REAL on-disk project memory file carries the write.
    const raw = fs.readFileSync(projectFile, 'utf-8');
    expect(raw).toContain('favorite-editor');
    expect(raw).toContain('Patrice uses VS Code');

    const got = await fetch(`${baseUrl}/api/memory/${encodeURIComponent('favorite-editor')}`);
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as Record<string, unknown>;
    expect(gotBody.content).toBe('Patrice uses VS Code');
    expect(gotBody.category).toBe('preferences');
    // Non-reinforcing read: a REST GET must not distort the forgetting curve.
    expect(gotBody.accessCount).toBe(0);
  });

  it('GET / lists and /search finds entries; category filter applies', async () => {
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k1', content: 'alpha fact about vitest', category: 'context' }),
    });
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'k2', content: 'beta fact', category: 'decisions' }),
    });

    const list = (await (await fetch(`${baseUrl}/api/memory`)).json()) as { entries: Array<{ id: string }>; total: number };
    expect(list.total).toBe(2);
    expect(list.entries.map((e) => e.id).sort()).toEqual(['k1', 'k2']);

    const filtered = (await (
      await fetch(`${baseUrl}/api/memory?category=decisions`)
    ).json()) as { entries: Array<{ id: string }> };
    expect(filtered.entries.map((e) => e.id)).toEqual(['k2']);

    const search = (await (
      await fetch(`${baseUrl}/api/memory/search?query=vitest`)
    ).json()) as { results: Array<{ id: string }>; total: number };
    expect(search.results.map((r) => r.id)).toEqual(['k1']);
  });

  it('PUT /:id edits the entry in the real file; DELETE removes it (404 afterwards)', async () => {
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'mutable', content: 'v1' }),
    });

    const put = await fetch(`${baseUrl}/api/memory/mutable`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'v2 — edited over REST' }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as Record<string, unknown>).content).toBe('v2 — edited over REST');
    expect(fs.readFileSync(projectFile, 'utf-8')).toContain('v2 — edited over REST');

    const del = await fetch(`${baseUrl}/api/memory/mutable`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await fetch(`${baseUrl}/api/memory/mutable`)).status).toBe(404);
    expect(fs.readFileSync(projectFile, 'utf-8')).not.toContain('v2 — edited over REST');
  });

  it('duplicate POST → 409; oversized content → 400 (char budget enforced by the store)', async () => {
    const body = JSON.stringify({ key: 'dup', content: 'same content' });
    await fetch(`${baseUrl}/api/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const second = await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(second.status).toBe(409);

    const oversized = await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'big', content: 'x'.repeat(10_000) }),
    });
    expect(oversized.status).toBe(400);
  });

  it('scope=user routes to the user memory file', async () => {
    const created = await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'user-fact', content: 'lives in the user scope', scope: 'user' }),
    });
    expect(created.status).toBe(201);
    expect(fs.readFileSync(userFile, 'utf-8')).toContain('user-fact');
    expect(fs.existsSync(projectFile) ? fs.readFileSync(projectFile, 'utf-8') : '').not.toContain('user-fact');

    const got = (await (
      await fetch(`${baseUrl}/api/memory/user-fact?scope=user`)
    ).json()) as Record<string, unknown>;
    expect(got.scope).toBe('user');
  });

  it('a SECOND real manager instance reads the same files — no in-process Map', async () => {
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'shared', content: 'visible to any instance' }),
    });

    const other = new PersistentMemoryManager({ projectMemoryPath: projectFile, userMemoryPath: userFile });
    await other.initialize();
    expect(other.get('shared')?.value).toBe('visible to any instance');
  });

  it('stats and clear operate on the persistent store', async () => {
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 's1', content: 'one', category: 'context' }),
    });
    await fetch(`${baseUrl}/api/memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 's2', content: 'two', category: 'decisions' }),
    });

    const stats = (await (await fetch(`${baseUrl}/api/memory/stats`)).json()) as {
      totalEntries: number;
      byCategory: Record<string, number>;
    };
    expect(stats.totalEntries).toBe(2);
    expect(stats.byCategory.decisions).toBe(1);

    const cleared = await fetch(`${baseUrl}/api/memory/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'context' }),
    });
    expect(((await cleared.json()) as Record<string, unknown>).cleared).toBe(1);
    const after = (await (await fetch(`${baseUrl}/api/memory`)).json()) as { total: number };
    expect(after.total).toBe(1);
  });

  it('GET on a missing key → 404; expiredOnly clear → 400 (TTLs do not exist)', async () => {
    expect((await fetch(`${baseUrl}/api/memory/never-stored`)).status).toBe(404);
    const res = await fetch(`${baseUrl}/api/memory/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiredOnly: true }),
    });
    expect(res.status).toBe(400);
  });
});
