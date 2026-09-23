/**
 * Catalogue HTTP, partie B — flotte, pairs, A2A, webchat et WebSocket.
 * Au plus 15 routes. Client WebSocket réel. Aucun appel de modèle.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { WebChatChannel } from '../../src/channels/webchat/index.js';
import {
  type CatalogueServer,
  asArray,
  asObject,
  httpCall,
  parseJson,
  startCatalogueServer,
  unexpectedRepoDirtyPaths,
} from './catalogue-routes-http-harness.js';

const UNAUTHORIZED = {
  code: 'UNAUTHORIZED',
  message: 'No authentication token provided',
  status: 401,
};

const REMOTE_NAME = 'catalogue-remote';
const REMOTE_URL = 'http://192.0.2.10/a2a';
const WEBCHAT_TOKEN = 'catalogue-webchat-token';

let ctx: CatalogueServer;
let webchat: WebChatChannel;
let webchatBase: string;

beforeAll(async () => {
  ctx = await startCatalogueServer();
  webchat = new WebChatChannel({
    type: 'webchat',
    enabled: true,
    host: '127.0.0.1',
    port: 0,
    title: 'Catalogue WebChat',
    authToken: WEBCHAT_TOKEN,
  });
  await webchat.connect();
  const bound = (webchat as unknown as { server: HttpServer | null }).server;
  const address = bound?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Le serveur webchat n\'a pas de port');
  }
  webchatBase = `http://127.0.0.1:${(address as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  if (webchat) await webchat.disconnect();
  if (ctx) await ctx.restore();
}, 60_000);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  return asObject(value, label);
}

interface SocketInbox {
  ws: WebSocket;
  next: (label: string) => Promise<Record<string, unknown>>;
  close: () => void;
}

function openSocket(url: string): Promise<SocketInbox> {
  const ws = new WebSocket(url);
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(message: Record<string, unknown>) => void> = [];
  ws.on('message', (data) => {
    const message = asRecord(parseJson(String(data), 'trame websocket'), 'trame websocket');
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.once('open', () => {
      resolve({
        ws,
        next: (label: string) => {
          const queued = queue.shift();
          const pending = queued
            ? Promise.resolve(queued)
            : new Promise<Record<string, unknown>>((done) => {
              waiters.push(done);
            });
          return new Promise((resolveMessage, rejectMessage) => {
            const timer = setTimeout(() => rejectMessage(new Error(`délai dépassé : ${label}`)), 8_000);
            pending.then(
              (message) => {
                clearTimeout(timer);
                resolveMessage(message);
              },
              (error: unknown) => {
                clearTimeout(timer);
                rejectMessage(error);
              },
            );
          });
        },
        close: () => {
          ws.close();
        },
      });
    });
  });
}

describe('catalogue HTTP partie B', () => {
  it('GET /api/fleet/status décrit les connexions locales', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/fleet/status', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'fleet status sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/fleet/status');
    expect(response.status).toBe(200);
    expect(parseJson(response.text, 'fleet status')).toEqual({
      status: 'ok',
      connections: { total: 0, authenticated: 0, streaming: 0, totalBroadcastsDropped: 0 },
    });
  });

  it('GET /api/fleet/describe répond la carte des méthodes', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/fleet/describe');
    expect(response.status).toBe(200);
    const body = asRecord(parseJson(response.text, 'describe'), 'describe');
    expect(body.httpMethods).toEqual(['peer.describe']);
    expect(asArray(body.wsOnlyMethods, 'wsOnlyMethods').length).toBeGreaterThan(0);
    expect(asArray(body.methods, 'methods')).toContain('peer.describe');
    expect(typeof body.hostname).toBe('string');
    expect(String(body.hostname).length).toBeGreaterThan(0);
  });

  it('GET /api/fleet/peers répond une liste vide', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/fleet/peers', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'peers sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/fleet/peers');
    expect(response.status).toBe(200);
    expect(parseJson(response.text, 'peers')).toEqual({ peers: [] });
  });

  it('GET /api/a2a/.well-known/agent.json est public', async () => {
    const response = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'GET',
      '/api/a2a/.well-known/agent.json',
      undefined,
      false,
    );
    expect(response.status).toBe(200);
    const body = asRecord(parseJson(response.text, 'agent card'), 'agent card');
    const skills = asArray(body.skills, 'skills');
    expect(body.name).toBe('Code Buddy');
    expect(skills.map((skill) => asRecord(skill, 'skill').id)).toContain('code-search');
  });

  it('GET /api/a2a/agents exige admin et liste codebuddy', async () => {
    const refused = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/agents', undefined, false);
    expect(refused.status).toBe(401);
    expect(parseJson(refused.text, 'agents sans jeton')).toEqual(UNAUTHORIZED);

    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/agents');
    expect(response.status).toBe(200);
    const body = asRecord(parseJson(response.text, 'agents'), 'agents');
    const agents = asArray(body.agents, 'agents.agents');
    const names = agents.map((agent) => asRecord(agent, 'agent').name);
    expect(names).toContain('codebuddy');
    expect(body.remoteAgents).toEqual([]);
  });

  it('enregistre, bat le cœur puis retire un agent distant', async () => {
    const registered = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/a2a/agents/register', {
      name: REMOTE_NAME,
      url: REMOTE_URL,
      card: { skills: [{ id: 'catalogue-skill' }] },
    });
    expect(registered.status).toBe(200);
    expect(parseJson(registered.text, 'register')).toEqual({
      status: 'registered',
      agent: REMOTE_NAME,
      url: REMOTE_URL,
    });

    const afterRegister = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/agents');
    const registeredBody = asRecord(parseJson(afterRegister.text, 'agents après register'), 'agents');
    const remotes = asArray(registeredBody.remoteAgents, 'remoteAgents');
    expect(remotes).toHaveLength(1);
    const remote = asRecord(remotes[0], 'remote');
    expect(remote.name).toBe(REMOTE_NAME);
    expect(remote.url).toBe(REMOTE_URL);
    expect(typeof remote.lastHeartbeat).toBe('number');
    const heartbeatBefore = remote.lastHeartbeat as number;

    const beat = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'POST',
      `/api/a2a/agents/${REMOTE_NAME}/heartbeat`,
    );
    expect(beat.status).toBe(200);
    const beatBody = asRecord(parseJson(beat.text, 'heartbeat'), 'heartbeat');
    expect(beatBody.status).toBe('ok');
    expect(typeof beatBody.timestamp).toBe('number');

    const afterBeat = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/agents');
    const beatList = asArray(
      asRecord(parseJson(afterBeat.text, 'agents après heartbeat'), 'agents').remoteAgents,
      'remoteAgents',
    );
    const updated = asRecord(beatList[0], 'remote après heartbeat');
    expect(updated.lastHeartbeat).toEqual(expect.any(Number));
    expect(updated.lastHeartbeat as number).toBeGreaterThanOrEqual(heartbeatBefore);

    const removed = await httpCall(ctx.baseUrl, ctx.token, 'DELETE', `/api/a2a/agents/${REMOTE_NAME}`);
    expect(removed.status).toBe(200);
    expect(parseJson(removed.text, 'delete')).toEqual({ status: 'unregistered', agent: REMOTE_NAME });

    const afterDelete = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/agents');
    expect(asRecord(parseJson(afterDelete.text, 'agents après delete'), 'agents').remoteAgents).toEqual([]);
  });

  it('GET /api/a2a/tasks/:id répond 404 pour une tâche inconnue', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'GET', '/api/a2a/tasks/absent-task-id');
    expect(response.status).toBe(404);
    expect(parseJson(response.text, 'tâche')).toEqual({ error: 'Task not found' });
  });

  it('POST /api/a2a/tasks/:id/cancel répond 404 pour une tâche inconnue', async () => {
    const response = await httpCall(
      ctx.baseUrl,
      ctx.token,
      'POST',
      '/api/a2a/tasks/absent-task-id/cancel',
    );
    expect(response.status).toBe(404);
    expect(parseJson(response.text, 'annulation')).toEqual({
      error: 'Task not found or already completed',
    });
  });

  it('POST /api/a2a/tasks/send refuse un corps sans message', async () => {
    const response = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/a2a/tasks/send', {
      agent: 'codebuddy',
    });
    expect(response.status).toBe(400);
    expect(parseJson(response.text, 'envoi')).toEqual({ error: 'Missing required field: message' });
  });

  it('WebSocket /ws salue, refuse, pong et authentifie', async () => {
    const socket = await openSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    const greeting = await socket.next('salutation');
    expect(greeting.type).toBe('connected');
    const payload = asRecord(greeting.payload, 'connected.payload');
    expect(payload.authRequired).toBe(true);
    const capabilities = asRecord(payload.capabilities, 'capabilities');
    const methods = asArray(capabilities.methods, 'methods');
    expect(methods).toContain('authenticate');
    expect(methods).toContain('ping');
    expect(methods).toContain('session.attach');

    socket.ws.send(JSON.stringify({ type: 'session.attach', payload: { sessionId: 'session_absente' } }));
    const refused = await socket.next('attach anonyme');
    expect(refused.type).toBe('error');
    expect(asRecord(refused.error, 'erreur').code).toBe('UNAUTHORIZED');
    expect(asRecord(refused.error, 'erreur').message).toBe('Authentication required');

    socket.ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await socket.next('pong');
    expect(pong.type).toBe('pong');
    expect(typeof pong.timestamp).toBe('string');

    socket.ws.send(JSON.stringify({ type: 'authenticate', payload: { token: ctx.token } }));
    const authenticated = await socket.next('authentifié');
    expect(authenticated.type).toBe('authenticated');
    expect(asRecord(authenticated.payload, 'authenticated.payload').userId).toBe('catalogue-http-user');
    socket.close();
  });

  it('deux clients WebSocket partagent une session créée par HTTP', async () => {
    const created = await httpCall(ctx.baseUrl, ctx.token, 'POST', '/api/sessions', {
      name: 'Session partagée',
    });
    expect(created.status).toBe(201);
    const sessionId = String(asRecord(parseJson(created.text, 'session'), 'session').id);

    const first = await openSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    expect((await first.next('salut 1')).type).toBe('connected');
    first.ws.send(JSON.stringify({ type: 'authenticate', payload: { token: ctx.token } }));
    expect((await first.next('auth 1')).type).toBe('authenticated');
    first.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'cli' },
    }));
    const presence = await first.next('présence 1');
    const attached = await first.next('attaché 1');
    expect(presence.type).toBe('session_presence');
    expect(asArray(asRecord(presence.payload, 'présence').participants, 'participants')).toHaveLength(1);
    expect(attached.type).toBe('session_attached');
    expect(asRecord(attached.payload, 'attaché').sessionId).toBe(sessionId);

    const second = await openSocket(`ws://127.0.0.1:${ctx.port}/ws`);
    expect((await second.next('salut 2')).type).toBe('connected');
    second.ws.send(JSON.stringify({ type: 'authenticate', payload: { token: ctx.token } }));
    expect((await second.next('auth 2')).type).toBe('authenticated');
    second.ws.send(JSON.stringify({
      type: 'session.attach',
      payload: { sessionId, surface: 'mobile' },
    }));
    const secondPresence = await second.next('présence 2');
    const secondAttached = await second.next('attaché 2');
    expect(secondPresence.type).toBe('session_presence');
    expect(asArray(asRecord(secondPresence.payload, 'présence 2').participants, 'participants 2')).toHaveLength(2);
    expect(secondAttached.type).toBe('session_attached');
    const participants = asArray(
      asRecord(secondAttached.payload, 'attaché 2').participants,
      'participants attachés',
    );
    expect(participants).toHaveLength(2);
    expect(participants.map((item) => asRecord(item, 'participant').userId)).toEqual([
      'catalogue-http-user',
      'catalogue-http-user',
    ]);

    const fanout = await first.next('fanout présence');
    expect(fanout.type).toBe('session_presence');
    expect(asArray(asRecord(fanout.payload, 'fanout').participants, 'fanout participants')).toHaveLength(2);

    second.ws.send(JSON.stringify({ type: 'session.detach' }));
    const detached = await second.next('détaché');
    expect(detached.type).toBe('session_detached');
    expect(asRecord(detached.payload, 'détaché').sessionId).toBe(sessionId);
    first.close();
    second.close();
  });

  it('webchat refuse un message anonyme, puis diffuse et archive', async () => {
    const advertised = (webchat as unknown as { status: { info?: { port?: number } } }).status.info;
    expect(advertised?.port).toBe(0);
    expect(webchatBase.startsWith('http://127.0.0.1:')).toBe(true);
    expect(webchatBase).not.toBe('http://127.0.0.1:0');

    const healthBefore = await fetch(`${webchatBase}/api/health`);
    expect(healthBefore.status).toBe(200);
    const healthBody = asRecord(parseJson(await healthBefore.text(), 'webchat health'), 'webchat health');
    expect(healthBody.status).toBe('ok');
    expect(healthBody.clients).toBe(0);

    const sender = await openSocket(webchatBase.replace('http://', 'ws://'));
    sender.ws.send(JSON.stringify({ type: 'message', content: 'trop tot' }));
    const refused = await sender.next('webchat anonyme');
    expect(refused).toEqual({ type: 'system', content: 'Please authenticate first' });

    sender.ws.send(JSON.stringify({ type: 'auth', token: 'mauvais-jeton' }));
    const badAuth = await sender.next('mauvais jeton');
    expect(badAuth).toEqual({ type: 'system', content: 'Authentication failed' });

    await new Promise<void>((resolve, reject) => {
      sender.ws.once('close', () => resolve());
      sender.ws.once('error', reject);
    });

    const again = await openSocket(webchatBase.replace('http://', 'ws://'));
    again.ws.send(JSON.stringify({ type: 'auth', token: WEBCHAT_TOKEN }));
    const welcomeA = await again.next('bienvenue A');
    expect(welcomeA.type).toBe('system');
    expect(String(welcomeA.content).startsWith('Welcome to Catalogue WebChat!')).toBe(true);

    const peer = await openSocket(webchatBase.replace('http://', 'ws://'));
    peer.ws.send(JSON.stringify({ type: 'auth', token: WEBCHAT_TOKEN }));
    const welcomeB = await peer.next('bienvenue B');
    expect(welcomeB.type).toBe('system');
    expect(String(welcomeB.content).startsWith('Welcome to Catalogue WebChat!')).toBe(true);
    const joined = await again.next('arrivée du pair');
    expect(joined.type).toBe('system');
    expect(String(joined.content).includes('has joined the chat')).toBe(true);

    again.ws.send(JSON.stringify({
      type: 'message',
      id: 'catalogue-webchat-1',
      content: 'catalogue-webchat-preuve',
    }));
    const delivered = await peer.next('message diffusé');
    expect(delivered.type).toBe('message');
    expect(delivered.content).toBe('catalogue-webchat-preuve');
    expect(delivered.id).toBe('catalogue-webchat-1');

    const history = await fetch(`${webchatBase}/api/history`);
    expect(history.status).toBe(200);
    const historyBody = asRecord(parseJson(await history.text(), 'historique'), 'historique');
    const messages = asArray(historyBody.messages, 'historique.messages');
    expect(messages).toHaveLength(1);
    expect(asRecord(messages[0], 'message archivé').content).toBe('catalogue-webchat-preuve');

    const healthAfter = await fetch(`${webchatBase}/api/health`);
    expect(asRecord(parseJson(await healthAfter.text(), 'health après'), 'health après').clients).toBe(2);
    again.close();
    peer.close();
  });

  it('ne laisse dans git que les fichiers du catalogue', () => {
    expect(unexpectedRepoDirtyPaths(ctx.repoRoot)).toEqual([]);
  });
});
