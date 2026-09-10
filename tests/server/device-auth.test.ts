import { createPrivateKey, sign as nodeSign, webcrypto } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceAuthStore, DEVICE_NONCE_TTL_MS, PAIRING_TTL_MS } from '../../src/server/auth/device-store.js';
import { createDeviceAuthRoutes } from '../../src/server/routes/device-auth.js';
import { createUserToken, generateToken, refreshToken, verifyToken } from '../../src/server/auth/jwt.js';
import WebSocket, { type WebSocketServer } from 'ws';
import * as deviceStores from '../../src/server/auth/device-store.js';
import * as agentAdapter from '../../src/server/agent-adapter.js';
import * as companionTurn from '../../src/companion/companion-turn.js';
import { DEFAULT_SERVER_CONFIG } from '../../src/server/types.js';
import { closeAllConnections, registerWebSocketExtension, setupWebSocket } from '../../src/server/websocket/handler.js';
import { unwireMobileConfirmationBridge } from '../../src/server/websocket/confirmation-bridge.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager } from '../../src/security/permission-modes.js';
import { getDeviceSessionIdentity } from '../../src/server/auth/device-session-context.js';
import { createAuthMiddleware } from '../../src/server/middleware/auth.js';
import { updateDeviceStoreFile } from '../../src/utils/device-store-file.js';

const SECRET = 'device-auth-test-only-signing-secret';
const qa = resolve('_qa/device-auth/stores');
mkdirSync(qa, { recursive: true });

async function keyPair() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { ...keys, jwk: await webcrypto.subtle.exportKey('jwk', keys.publicKey) };
}
async function sign(key: webcrypto.CryptoKey, deviceId: string, nonce: string) {
  return Buffer.from(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(`${deviceId}.${nonce}`),
  )).toString('base64url');
}

describe('Android device authentication', () => {
  let store: DeviceAuthStore;
  let now: number;
  let server: Server;
  let base: string;
  let keys: Awaited<ReturnType<typeof keyPair>>;
  const audit = vi.fn();

  beforeEach(async () => {
    now = Date.now();
    audit.mockClear();
    store = new DeviceAuthStore(join(mkdtempSync(join(qa, 'case-')), 'devices.json'), () => now, audit);
    keys = await keyPair();
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use('/api/auth/device', createDeviceAuthRoutes(SECRET, store));
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/device`;
  });
  afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  async function post(route: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${base}/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, string> };
  }
  async function register() {
    const { pairingCode } = store.createPairing();
    const result = await post('register', { pairingCode, deviceName: 'Test Android', publicKeyJwk: keys.jwk });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ deviceId: expect.any(String) });
    return result.body.deviceId;
  }

  it('pairs once, persists only public material atomically with 0600, and mints the exact one-hour claims', async () => {
    const { pairingCode, expiresAt } = store.createPairing();
    expect(pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(Date.parse(expiresAt) - now).toBe(PAIRING_TTL_MS);
    const body = { pairingCode, deviceName: 'Test Android', publicKeyJwk: keys.jwk };
    const registered = await post('register', body);
    expect(registered.status).toBe(200);
    const deviceId = registered.body.deviceId;
    expect((await post('register', body))).toEqual({ status: 400, body: { error: 'Invalid pairing request' } });
    const challenge = await post('challenge', { deviceId });
    expect(challenge.status).toBe(200);
    expect(Buffer.from(challenge.body.nonce, 'base64url')).toHaveLength(32);
    expect(Date.parse(challenge.body.expiresAt) - now).toBe(DEVICE_NONCE_TTL_MS);
    const signature = await sign(keys.privateKey, deviceId, challenge.body.nonce);
    const result = await post('verify', { deviceId, nonce: challenge.body.nonce, signature });
    expect(result.status).toBe(200);
    const claims = verifyToken(result.body.token, SECRET)!;
    expect(claims).toEqual({
      sub: deviceId, type: 'user', scopes: ['chat', 'chat:stream', 'sessions', 'tools'],
      amr: ['biometric', 'device'], profile: 'agent', identity: 'owner',
      iat: expect.any(Number), exp: expect.any(Number),
    });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(await post('verify', { deviceId, nonce: challenge.body.nonce, signature }))
      .toEqual({ status: 401, body: { error: 'Authentication failed' } });
    const disk = readFileSync(store.file, 'utf8');
    expect(disk).not.toContain(pairingCode);
    expect(disk).not.toContain('"d":');
    expect(JSON.parse(disk).deviceAuth.devices[0].publicKeyJwk).toEqual({ kty: 'EC', crv: 'P-256', x: keys.jwk.x, y: keys.jwk.y });
    if (process.platform !== 'win32') expect(statSync(store.file).mode & 0o777).toBe(0o600);
    expect(audit.mock.calls).toEqual([
      ['device_register', true], ['device_register', false], ['device_verify', true], ['device_verify', false],
    ]);
  });

  it.each(['base64', 'base64url'] as const)('accepts native Android DER signatures encoded as %s', async encoding => {
    const deviceId = await register();
    const { nonce } = store.challenge(deviceId);
    const key = createPrivateKey({ key: await webcrypto.subtle.exportKey('jwk', keys.privateKey), format: 'jwk' });
    const signature = nodeSign('sha256', Buffer.from(`${deviceId}.${nonce}`), key).toString(encoding);
    expect((await post('verify', { deviceId, nonce, signature })).status).toBe(200);
    expect((await post('verify', { deviceId, nonce, signature })).status).toBe(401);
  });

  it('rejects invalid, expired and replayed pairing codes with the same generic response', async () => {
    const { pairingCode } = store.createPairing();
    now += PAIRING_TTL_MS;
    for (const code of ['AAAAAAAA', pairingCode, 'bad', null]) {
      expect(await post('register', { pairingCode: code, deviceName: 'Test', publicKeyJwk: keys.jwk }))
        .toEqual({ status: 400, body: { error: 'Invalid pairing request' } });
    }
    expect(store.list()).toEqual([]);
  });

  it('rejects private keys, wrong curves, invalid points and malformed input without consuming a valid code', async () => {
    const { pairingCode } = store.createPairing();
    for (const publicKeyJwk of [
      await webcrypto.subtle.exportKey('jwk', keys.privateKey),
      { ...keys.jwk, crv: 'P-384' }, { ...keys.jwk, x: 'A'.repeat(43), y: 'A'.repeat(43) }, null,
    ]) {
      expect((await post('register', { pairingCode, deviceName: 'Test', publicKeyJwk })).status).toBe(400);
    }
    expect((await post('register', { pairingCode, deviceName: 'Test', publicKeyJwk: keys.jwk })).status).toBe(200);
  });

  it('serializes concurrent registration attempts across independent store instances', async () => {
    const code = store.createPairing().pairingCode;
    const second = new DeviceAuthStore(store.file, () => now, audit);
    const results = await Promise.allSettled([
      store.register(code, 'First', keys.jwk), second.register(code, 'Second', keys.jwk),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(second.list()).toHaveLength(1);
  });

  it('expires nonces exactly at 60 seconds and invalidates older challenges', async () => {
    const deviceId = await register();
    const older = store.challenge(deviceId);
    const current = store.challenge(deviceId);
    expect(older.nonce).not.toBe(current.nonce);
    expect((await post('verify', { deviceId, nonce: older.nonce, signature: await sign(keys.privateKey, deviceId, older.nonce) })).status).toBe(401);
    now += DEVICE_NONCE_TTL_MS;
    expect((await post('verify', { deviceId, nonce: current.nonce, signature: await sign(keys.privateKey, deviceId, current.nonce) })).status).toBe(401);
  });

  it('rejects another key and consumes the nonce even after a bad signature', async () => {
    const deviceId = await register();
    const { nonce } = store.challenge(deviceId);
    const other = await keyPair();
    expect((await post('verify', { deviceId, nonce, signature: await sign(other.privateKey, deviceId, nonce) })).status).toBe(401);
    expect((await post('verify', { deviceId, nonce, signature: await sign(keys.privateKey, deviceId, nonce) })).status).toBe(401);
  });

  it('binds the signed bytes to deviceId and permits only one concurrent verification', async () => {
    const deviceId = await register();
    let challenge = store.challenge(deviceId);
    expect((await post('verify', { deviceId, nonce: challenge.nonce, signature: await sign(keys.privateKey, 'other-device', challenge.nonce) })).status).toBe(401);
    challenge = store.challenge(deviceId);
    const signature = await sign(keys.privateKey, deviceId, challenge.nonce);
    const results = await Promise.all([post('verify', { deviceId, nonce: challenge.nonce, signature }), post('verify', { deviceId, nonce: challenge.nonce, signature })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 401]);
  });

  it('sees CLI revocation without restarting the server, and refuses unknown devices uniformly', async () => {
    const deviceId = await register();
    const { nonce } = store.challenge(deviceId);
    const signature = await sign(keys.privateKey, deviceId, nonce);
    const cli = new DeviceAuthStore(store.file, () => now, audit);
    cli.rename(deviceId, 'Renamed');
    expect(store.list()[0].deviceName).toBe('Renamed');
    cli.revoke(deviceId);
    expect(store.isActive(deviceId)).toBe(false);
    expect((await post('verify', { deviceId, nonce, signature })).status).toBe(401);
    expect(await post('challenge', { deviceId })).toEqual(await post('challenge', { deviceId: 'unknown' }));
    expect(audit).toHaveBeenCalledWith('device_revoke', true);
  });

  it('preserves SSH/ADB nodes and authentication records in both write directions', async () => {
    updateDeviceStoreFile(store.file, data => Object.assign(data, { version: 1, devices: [{ id: 'node-test' }] }));
    const deviceId = await register();
    updateDeviceStoreFile(store.file, data => Object.assign(data, { version: 1, devices: [{ id: 'node-updated' }] }));
    expect(store.isActive(deviceId)).toBe(true);
    expect(JSON.parse(readFileSync(store.file, 'utf8')).devices).toEqual([{ id: 'node-updated' }]);
    store.revoke(deviceId);
    expect(JSON.parse(readFileSync(store.file, 'utf8')).devices).toEqual([{ id: 'node-updated' }]);
  });

  it('fails closed for corruption and competing writers without restoring stale revocations', async () => {
    const deviceId = await register();
    const snapshot = readFileSync(store.file, 'utf8');
    store.revoke(deviceId);
    writeFileSync(`${store.file}.bak`, snapshot);
    writeFileSync(store.file, '{');
    expect(store.isActive(deviceId)).toBe(false);
    expect((await post('challenge', { deviceId })).status).toBe(401);
    expect(() => store.createPairing()).toThrow('Device store unavailable');
    writeFileSync(store.file, snapshot);
    mkdirSync(`${store.file}.lock`);
    expect(() => store.createPairing()).toThrow('Device store unavailable');
  });

  it.each(['register', 'challenge', 'verify'])('rate limits %s even with forged proxy headers', async route => {
    for (let index = 0; index < 10; index++) {
      expect((await post(route, {}, { 'X-Forwarded-For': `192.0.2.${index + 1}` })).status).not.toBe(429);
    }
    expect(await post(route, {}, { 'X-Forwarded-For': '198.51.100.1' }))
      .toEqual({ status: 429, body: { error: 'Too many requests' } });
  });
});

type Frame = { type: string; payload?: Record<string, unknown>; error?: { code: string } };
async function waitUntil(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true), { timeout: 5000, interval: 10 });
}

describe('Device identity on real /ws and authenticated HTTP', () => {
  let server: Server;
  let wss: WebSocketServer;
  let base: string;
  let store: DeviceAuthStore;
  let token: string;
  let deviceId: string;
  let fakeAgent: agentAdapter.ServerAgent;
  let modeSeen: string[];
  let unregister: () => void;

  beforeEach(async () => {
    vi.stubEnv('JWT_SECRET', SECRET);
    vi.stubEnv('CODEBUDDY_MOBILE_PWA', 'false');
    vi.stubEnv('CODEBUDDY_MOBILE_HISTORY', 'false');
    store = new DeviceAuthStore(join(mkdtempSync(join(qa, 'ws-')), 'devices.json'), Date.now, vi.fn());
    vi.spyOn(deviceStores, 'getDeviceAuthStore').mockReturnValue(store);
    const keys = await keyPair();
    ({ deviceId } = await store.register(store.createPairing().pairingCode, 'Android', keys.jwk));
    const { nonce } = store.challenge(deviceId);
    ({ token } = await store.verify(deviceId, nonce, await sign(keys.privateKey, deviceId, nonce), SECRET));
    modeSeen = [];
    const run = async (input: string) => {
      modeSeen.push(getPermissionModeManager().getMode());
      expect(getDeviceSessionIdentity()).toEqual({ deviceId, profile: 'agent', identity: 'owner', amr: ['biometric', 'device'] });
      expect(Object.isFrozen(getDeviceSessionIdentity())).toBe(true);
      if (input === 'confirm') {
        const result = await ConfirmationService.getInstance().requestConfirmation(
          { operation: 'write', filename: 'test.txt', toolName: 'write_file', forcePrompt: true }, 'file',
        );
        return result.confirmed ? 'approved' : 'denied';
      }
      return 'full-agent';
    };
    fakeAgent = {
      processUserMessage: vi.fn(async (input: string) => [{ type: 'assistant', content: await run(input), timestamp: new Date() }]),
      processUserMessageStream: vi.fn(async function* (input: string) { yield { type: 'content', content: await run(input) }; }),
      getChatHistory: () => [], getCurrentModel: () => 'test-model', setModel: vi.fn(),
      abortCurrentOperation: vi.fn(), executeToolByName: vi.fn(), dispose: vi.fn(),
    };
    vi.spyOn(agentAdapter, 'createServerAgent').mockResolvedValue(fakeAgent);
    vi.spyOn(companionTurn, 'runCompanionTurn').mockResolvedValue({ text: 'legacy-companion', kind: 'text' });
    const app = express();
    app.use(express.json());
    app.use(createAuthMiddleware({ ...DEFAULT_SERVER_CONFIG, jwtSecret: SECRET, authEnabled: true }));
    app.get('/protected', (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    wss = await setupWebSocket(server, { ...DEFAULT_SERVER_CONFIG, jwtSecret: SECRET, authEnabled: true });
    unregister = registerWebSocketExtension({
      type: 'test.identity',
      handle: ctx => { ctx.send({ type: 'test.identity', payload: ctx.principal, timestamp: new Date().toISOString() }); },
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    unregister?.();
    closeAllConnections();
    unwireMobileConfirmationBridge();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    getPermissionModeManager().setMode('default');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  async function connect(authToken = token, extra = {}) {
    const events: Frame[] = [];
    const ws = new WebSocket(`ws://${base}/ws`);
    ws.on('message', data => events.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'authenticate', payload: { token: authToken, ...extra } }));
    await waitUntil(() => events.some(event => event.type === 'authenticated' || event.type === 'error'));
    return { ws, events };
  }

  it.each([false, true])('uses the full agent in default mode with stream=%s even for assistant companion', async stream => {
    getPermissionModeManager().setMode('bypassPermissions');
    const { ws, events } = await connect();
    expect(events.find(event => event.type === 'authenticated')?.payload).toEqual({
      userId: deviceId, scopes: ['chat', 'chat:stream', 'sessions', 'tools'],
      profile: 'agent', identity: 'owner', amr: ['biometric', 'device'],
    });
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', assistant: 'companion', stream } }));
    await waitUntil(() => events.some(event => event.type === (stream ? 'stream_end' : 'chat_response')));
    expect(modeSeen).toEqual(['default']);
    expect(getPermissionModeManager().getMode()).toBe('bypassPermissions');
    expect(companionTurn.runCompanionTurn).not.toHaveBeenCalled();
    expect(getDeviceSessionIdentity()).toBeUndefined();
    const response = events.find(event => event.type === (stream ? 'stream_chunk' : 'chat_response'))?.payload;
    expect(response?.[stream ? 'delta' : 'content']).toBe('full-agent');
    ws.send(JSON.stringify({ type: 'test.identity' }));
    await waitUntil(() => events.some(event => event.type === 'test.identity'));
    expect(events.find(event => event.type === 'test.identity')?.payload).toMatchObject({ identity: 'owner', profile: 'agent', amr: ['biometric', 'device'] });
  });

  it.each([true, false])('relays a real confirmation (approved=%s) during a waiting turn without the PWA', async approved => {
    const { ws, events } = await connect();
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'confirm', assistant: 'companion', stream: false } }));
    await waitUntil(() => events.some(event => event.type === 'confirmation_required'));
    const prompt = events.find(event => event.type === 'confirmation_required')!.payload!;
    expect(prompt).toMatchObject({ tool: 'write_file', summary: 'write: test.txt' });
    ws.send(JSON.stringify({ type: 'confirmation_response', payload: { id: prompt.id, approved } }));
    await waitUntil(() => events.some(event => event.type === 'chat_response'));
    expect(events.find(event => event.type === 'chat_response')?.payload?.content).toBe(approved ? 'approved' : 'denied');
  });

  it('keeps legacy authentication payload bytes and companion routing, ignoring client-forged claims', async () => {
    const legacy = createUserToken('legacy', ['chat'], SECRET);
    const { ws, events } = await connect(legacy, { profile: 'agent', identity: 'owner', amr: ['biometric', 'device'] });
    expect(JSON.stringify(events.find(event => event.type === 'authenticated')?.payload))
      .toBe('{"userId":"legacy","scopes":["chat"]}');
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', assistant: 'companion', stream: false, identity: 'owner' } }));
    await waitUntil(() => events.some(event => event.type === 'chat_response'));
    expect(events.find(event => event.type === 'chat_response')?.payload?.content).toBe('legacy-companion');
    expect(agentAdapter.createServerAgent).not.toHaveBeenCalled();
    ws.send(JSON.stringify({ type: 'test.identity' }));
    await waitUntil(() => events.some(event => event.type === 'test.identity'));
    const principal = events.find(event => event.type === 'test.identity')!.payload!;
    expect(principal).not.toHaveProperty('identity');
    expect(principal).not.toHaveProperty('profile');
    expect(principal).not.toHaveProperty('amr');
  });

  it('does not enlist legacy approval sockets when only native Android enabled the bridge', async () => {
    const legacy = await connect(createUserToken('legacy', ['chat', 'tools'], SECRET), { approvalCapable: true });
    const native = await connect();
    native.ws.send(JSON.stringify({ type: 'chat', payload: { message: 'confirm', stream: false } }));
    await waitUntil(() => native.events.some(event => event.type === 'confirmation_required'));
    const prompt = native.events.find(event => event.type === 'confirmation_required')!.payload!;
    native.ws.send(JSON.stringify({ type: 'confirmation_response', payload: { id: prompt.id, approved: false } }));
    await waitUntil(() => native.events.some(event => event.type === 'chat_response'));
    expect(legacy.events.some(event => event.type === 'confirmation_required')).toBe(false);
    expect(native.events.find(event => event.type === 'chat_response')?.payload?.content).toBe('denied');
  });

  it('clears device claims and agent history when the socket reauthenticates as legacy', async () => {
    const { ws, events } = await connect();
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: false } }));
    await waitUntil(() => events.some(event => event.type === 'chat_response'));
    ws.send(JSON.stringify({ type: 'authenticate', payload: { token: createUserToken('legacy', ['chat'], SECRET) } }));
    await waitUntil(() => events.filter(event => event.type === 'authenticated').length === 2);
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1);
    expect(events.filter(event => event.type === 'authenticated')[1].payload).toEqual({ userId: 'legacy', scopes: ['chat'] });
    ws.send(JSON.stringify({ type: 'test.identity' }));
    await waitUntil(() => events.some(event => event.type === 'test.identity'));
    expect(events.find(event => event.type === 'test.identity')!.payload).not.toHaveProperty('identity');
  });

  it('rejects revoked JWTs on new sockets, existing sockets and HTTP, and prevents refresh laundering', async () => {
    const existing = await connect();
    expect((await fetch(`http://${base}/protected`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(refreshToken(token, SECRET)).toBeNull();
    store.revoke(deviceId);
    const next = await connect();
    expect(next.events.find(event => event.type === 'error')?.error?.code).toBe('AUTH_FAILED');
    existing.ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: false } }));
    await waitUntil(() => existing.events.some(event => event.type === 'error'));
    expect(agentAdapter.createServerAgent).not.toHaveBeenCalled();
    expect((await fetch(`http://${base}/protected`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('uses the configured issuer secret for Android even without an environment secret', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const { events } = await connect();
    expect(events.find(event => event.type === 'authenticated')?.payload?.identity).toBe('owner');
    const legacy = await connect(createUserToken('legacy', ['chat'], SECRET));
    expect(legacy.events.find(event => event.type === 'error')?.error?.code).toBe('CONFIG_ERROR');
  });

  it('rechecks the one-hour expiry on an already authenticated socket', async () => {
    const { ws, events } = await connect();
    const claims = verifyToken(token, SECRET)!;
    vi.spyOn(Date, 'now').mockReturnValue(claims.exp * 1000);
    ws.send(JSON.stringify({ type: 'chat', payload: { message: 'hello', stream: false } }));
    await waitUntil(() => events.some(event => event.type === 'error'));
    expect(events.find(event => event.type === 'error')?.error?.code).toBe('AUTH_FAILED');
    expect(agentAdapter.createServerAgent).not.toHaveBeenCalled();
  });

  it('rejects an expired device token at authentication', async () => {
    const expired = generateToken({
      sub: deviceId, profile: 'agent', identity: 'owner', amr: ['biometric', 'device'], scopes: ['chat', 'tools'],
    }, SECRET, '0s');
    const { events } = await connect(expired);
    expect(events.find(event => event.type === 'error')?.error?.code).toBe('AUTH_FAILED');
  });
});
