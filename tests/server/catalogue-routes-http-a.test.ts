/**
 * Catalogue HTTP, partie A — 18 routes sans réseau ni API payante.
 * Serveur réel en processus, 127.0.0.1, port éphémère.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CatalogueServer,
  asArray,
  asObject,
  httpCall,
  unexpectedRepoDirtyPaths,
  parseJson,
  startCatalogueServer,
} from './catalogue-routes-http-harness.js';

const UNAUTHORIZED = {
  code: 'UNAUTHORIZED',
  message: 'No authentication token provided',
  status: 401,
};

let ctx: CatalogueServer;

beforeAll(async () => {
  ctx = await startCatalogueServer();
}, 180_000);

afterAll(async () => {
  if (ctx) await ctx.restore();
}, 60_000);

describe('catalogue HTTP partie A', () => {
  it('GET /api/health répond 200 dégradé sans fournisseur', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/health', undefined, false);
    expect(response.status).toBe(200);
    const body = asObject(parseJson(response.text, 'health'), 'health');
    const checks = asObject(body.checks, 'health.checks');
    const heartbeat = asObject(body.apiHeartbeat, 'health.apiHeartbeat');
    expect(body.status).toBe('degraded');
    expect(body.version).toBe('2.2.0');
    expect(checks.database).toBe('ok');
    expect(checks.api).toBe('unknown');
    expect(checks.memory).toBe('ok');
    expect(heartbeat.status).toBe('unknown');
    expect(heartbeat.lastCheck).toBeNull();
  });

  it('GET /api/health/live répond 200 vivant', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/health/live', undefined, false);
    expect(response.status).toBe(200);
    const body = asObject(parseJson(response.text, 'live'), 'live');
    expect(body.alive).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.pid).toBe(process.pid);
  });

  it('GET /api/health/ready répond 503 sans fournisseur', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/health/ready', undefined, false);
    expect(response.status).toBe(503);
    const body = asObject(parseJson(response.text, 'ready'), 'ready');
    const checks = asObject(body.checks, 'ready.checks');
    const provider = asObject(checks.provider, 'ready.provider');
    const database = asObject(checks.database, 'ready.database');
    const memory = asObject(checks.memory, 'ready.memory');
    expect(body.ready).toBe(false);
    expect(body.status).toBe('not_ready');
    expect(provider.ready).toBe(false);
    expect(provider.message).toBe('No LLM provider configured');
    expect(database.ready).toBe(true);
    expect(memory.ready).toBe(true);
    expect(checks.providerApi).toBeUndefined();
  });

  it('GET /api/health/metrics répond du texte Prometheus', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/health/metrics', undefined, false);
    expect(response.status).toBe(200);
    expect(response.text).toContain('# HELP codebuddy_uptime_seconds Server uptime in seconds');
    expect(response.text).toContain('# TYPE codebuddy_uptime_seconds gauge');
    expect(response.text).toContain('# HELP codebuddy_memory_rss_bytes Resident set size');
  });

  it('GET /api/docs exige un jeton et annonce le port lié', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/docs', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'docs sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/docs');
    expect(response.status).toBe(200);
    const body = asObject(parseJson(response.text, 'docs'), 'docs');
    const info = asObject(body.info, 'docs.info');
    const servers = asArray(body.servers, 'docs.servers');
    const first = asObject(servers[0], 'docs.servers[0]');
    expect(body.openapi).toBe('3.0.0');
    expect(info.title).toBe('Code Buddy API');
    expect(info.version).toBe('2.2.0');
    expect(first.url, 'OpenAPI annonce le port 0').toBe(`http://127.0.0.1:${ctx.port}`);
    expect(ctx.port).toBeGreaterThan(0);
  });

  it('GET /api/sessions refuse l\'anonyme puis liste un tableau vide', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/sessions', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'sessions sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/sessions');
    expect(response.status).toBe(200);
    const body = asObject(parseJson(response.text, 'sessions'), 'sessions');
    expect(body.sessions).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it('POST /api/sessions crée une session relue dans la liste et par identifiant', async () => {
    const refused = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'POST',
      '/api/sessions',
      { name: 'Catalogue HTTP' },
      false,
    );
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'création sans jeton')).toEqual(UNAUTHORIZED);

    const created = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/sessions', { name: 'Catalogue HTTP' });
    expect(created.status).toBe(201);
    const body = asObject(parseJson(created.text, 'création'), 'création');
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe('Catalogue HTTP');
    expect(body.model).toBe('grok-3-latest');
    const id = String(body.id);

    const listed = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/sessions');
    expect(listed.status).toBe(200);
    const listBody = asObject(parseJson(listed.text, 'liste après création'), 'liste');
    const sessions = asArray(listBody.sessions, 'liste.sessions');
    expect(listBody.total).toBe(1);
    expect(sessions).toHaveLength(1);
    expect(asObject(sessions[0], 'session listée').id).toBe(id);

    const fetched = await httpCall(ctx.baseUrl, ctx.token, 'GET', `/api/sessions/${id}`);
    expect(fetched.status).toBe(200);
    const detail = asObject(parseJson(fetched.text, 'détail'), 'détail');
    expect(detail.id).toBe(id);
    expect(detail.name).toBe('Catalogue HTTP');
    expect(detail.model).toBe('grok-3-latest');
    expect(detail.messageCount).toBe(0);
    expect(detail.messages).toEqual([]);
  });

  it('POST /api/sessions/:id/messages est relu par GET messages', async () => {
    const created = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/sessions', { name: 'Messages catalogue' });
    expect(created.status).toBe(201);
    const id = String(asObject(parseJson(created.text, 'session messages'), 'session messages').id);

    const refused = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'POST',
      `/api/sessions/${id}/messages`,
      { role: 'user', content: 'catalogue-http-message' },
      false,
    );
    expect(refused.status).toBe(401);

    const posted = await httpCall(ctx.baseUrl, ctx.token, 'POST', `/api/sessions/${id}/messages`, {
      role: 'user',
      content: 'catalogue-http-message',
    });
    expect(posted.status).toBe(201);
    const postedBody = asObject(parseJson(posted.text, 'message créé'), 'message créé');
    expect(postedBody.role).toBe('user');
    expect(postedBody.content).toBe('catalogue-http-message');

    const reread = await httpCall(ctx.baseUrl, ctx.token, 'GET', `/api/sessions/${id}/messages`);
    expect(reread.status).toBe(200);
    const page = asObject(parseJson(reread.text, 'messages'), 'messages');
    const messages = asArray(page.messages, 'messages.messages');
    expect(page.total).toBe(1);
    expect(messages).toEqual([
      expect.objectContaining({ type: 'user', content: 'catalogue-http-message' }),
    ]);
  });

  it('POST /api/memory est relu par GET /api/memory', async () => {
    const before = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/memory');
    expect(before.status).toBe(200);
    const beforeBody = asObject(parseJson(before.text, 'mémoire avant'), 'mémoire avant');
    expect(beforeBody.entries).toEqual([]);
    expect(beforeBody.total).toBe(0);

    const refused = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'POST',
      '/api/memory',
      { content: 'Note de catalogue HTTP.', category: 'note' },
      false,
    );
    expect(refused.status).toBe(401);
    const stillEmpty = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/memory');
    expect(asObject(parseJson(stillEmpty.text, 'mémoire inchangée'), 'mémoire inchangée').total).toBe(0);

    const created = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/memory', {
      content: 'Note de catalogue HTTP.',
      category: 'note',
    });
    expect(created.status).toBe(201);
    const createdBody = asObject(parseJson(created.text, 'mémoire créée'), 'mémoire créée');
    expect(createdBody.content).toBe('Note de catalogue HTTP.');
    expect(createdBody.category).toBe('custom');

    const after = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/memory');
    expect(after.status).toBe(200);
    const afterBody = asObject(parseJson(after.text, 'mémoire après'), 'mémoire après');
    const entries = asArray(afterBody.entries, 'mémoire.entries');
    expect(afterBody.total).toBe(1);
    expect(entries).toHaveLength(1);
    expect(asObject(entries[0], 'entrée').content).toBe('Note de catalogue HTTP.');
  });

  it('GET /api/tools liste les outils dont view_file', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/tools', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'tools sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/tools');
    expect(response.status).toBe(200);
    const body = asObject(parseJson(response.text, 'tools'), 'tools');
    const tools = asArray(body.tools, 'tools.tools');
    expect(body.total).toBe(tools.length);
    expect(tools.length).toBeGreaterThan(0);
    const names = tools.map((tool) => asObject(tool, 'outil').name);
    expect(names).toContain('view_file');
  });

  it('POST /api/lessons est relu par GET /api/lessons', async () => {
    const before = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/lessons');
    expect(before.status).toBe(200);
    const beforeBody = asObject(parseJson(before.text, 'leçons avant'), 'leçons avant');
    expect(beforeBody.lessons).toEqual([]);
    expect(beforeBody.total).toBe(0);

    const created = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/lessons', {
      content: 'Le catalogue HTTP a enregistre cette lecon.',
      category: 'INSIGHT',
    });
    expect(created.status).toBe(201);
    const createdBody = asObject(parseJson(created.text, 'leçon créée'), 'leçon créée');
    expect(createdBody.content).toBe('Le catalogue HTTP a enregistre cette lecon.');
    expect(createdBody.category).toBe('INSIGHT');

    const after = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/lessons');
    expect(after.status).toBe(200);
    const afterBody = asObject(parseJson(after.text, 'leçons après'), 'leçons après');
    const lessons = asArray(afterBody.lessons, 'lessons');
    expect(afterBody.total).toBe(1);
    expect(asObject(lessons[0], 'leçon').content).toBe('Le catalogue HTTP a enregistre cette lecon.');
  });

  it('GET /api/runs répond une liste vide', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/runs', undefined, false);
    expect(refused.status).toBe(401);
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/runs');
    expect(response.status).toBe(200);
    expect(parseJson(response.text, 'runs')).toEqual({ runs: [] });
  });

  it('GET /api/groups/status répond les compteurs par défaut', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/groups/status');
    expect(response.status).toBe(200);
    expect(parseJson(response.text, 'groups')).toEqual({
      enabled: true,
      totalGroups: 0,
      defaultMode: 'mention-only',
      globalAllowlistSize: 0,
      blocklistSize: 0,
      groupsByMode: {},
    });
  });

  it('GET /api/webhooks/triggers répond une liste vide', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/webhooks/triggers');
    expect(response.status).toBe(200);
    expect(parseJson(response.text, 'triggers')).toEqual({ triggers: [], count: 0 });
  });

  it('ne laisse dans git que les fichiers du catalogue', () => {
    expect(unexpectedRepoDirtyPaths(ctx.repoRoot)).toEqual([]);
  });
});
