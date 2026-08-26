/**
 * /api/lessons — journey-parity REST management of the learned-lessons store,
 * real HTTP round-trips against startServer({port: 0}) with the REAL tracker
 * writing `.codebuddy/lessons.md` in a temp cwd (no store mocks).
 *
 * Assertions filter on ids created by the test — the tracker also merges the
 * developer's real ~/.codebuddy/lessons.md, whose content must not matter.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('lessons HTTP routes (real tracker)', () => {
  let tmpDir: string;
  let cwdBefore: string;
  let server: HttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-http-'));
    cwdBefore = process.cwd();
    process.chdir(tmpDir);

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
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    const { stopServer } = await import('../../src/server/index.js');
    await stopServer(server);
    process.chdir(cwdBefore);
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const projectFile = (): string => path.join(tmpDir, '.codebuddy', 'lessons.md');

  const create = async (content: string, category = 'RULE', context?: string): Promise<string> => {
    const res = await fetch(`${baseUrl}/api/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, category, ...(context ? { context } : {}) }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  it('POST → GET /:id round-trips through the REAL lessons.md', async () => {
    const id = await create('always run the gate before pushing', 'RULE', 'ci');

    expect(fs.readFileSync(projectFile(), 'utf-8')).toContain(`[${id}] always run the gate before pushing`);

    const got = (await (await fetch(`${baseUrl}/api/lessons/${id}`)).json()) as Record<string, unknown>;
    expect(got.category).toBe('RULE');
    expect(got.context).toBe('ci');
    expect((got.locations as Array<{ scope: string }>)[0]?.scope).toBe('project');
  });

  it('GET / lists the created lesson; ?category filters; bad category → 400', async () => {
    const id = await create('pattern to keep', 'PATTERN');

    const all = (await (await fetch(`${baseUrl}/api/lessons`)).json()) as { lessons: Array<{ id: string }> };
    expect(all.lessons.some((l) => l.id === id)).toBe(true);

    const filtered = (await (
      await fetch(`${baseUrl}/api/lessons?category=pattern`)
    ).json()) as { lessons: Array<{ id: string; category: string }> };
    expect(filtered.lessons.some((l) => l.id === id)).toBe(true);
    expect(filtered.lessons.every((l) => l.category === 'PATTERN')).toBe(true);

    expect((await fetch(`${baseUrl}/api/lessons?category=bogus`)).status).toBe(400);
  });

  it('PUT edits content+category in the real file; corrupting patches → 400', async () => {
    const id = await create('old wording', 'INSIGHT');

    const put = await fetch(`${baseUrl}/api/lessons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new wording via REST', category: 'RULE' }),
    });
    expect(put.status).toBe(200);
    const raw = fs.readFileSync(projectFile(), 'utf-8');
    expect(raw).toContain(`[${id}] new wording via REST`);

    const bad = await fetch(`${baseUrl}/api/lessons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'bad <!-- comment' }),
    });
    expect(bad.status).toBe(400);

    const empty = await fetch(`${baseUrl}/api/lessons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });

  it('DELETE removes the lesson and names the file; then 404', async () => {
    const id = await create('to delete');

    const del = await fetch(`${baseUrl}/api/lessons/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const body = (await del.json()) as { removed: boolean; removedFrom: Array<{ scope: string; path: string }> };
    expect(body.removed).toBe(true);
    expect(body.removedFrom[0]?.path).toContain('lessons.md');

    expect(fs.readFileSync(projectFile(), 'utf-8')).not.toContain(`[${id}]`);
    expect((await fetch(`${baseUrl}/api/lessons/${id}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/lessons/${id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
