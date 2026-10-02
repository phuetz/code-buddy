import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { generateToken } from '../../src/server/auth/jwt.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';

it('enforces fleet guards through two isolated real server processes and actual WebSocket frames', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'buddy-multiprocess-'));
  const children: ChildProcess[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const listeners: FleetListener[] = [];
  const secrets = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
  const tokens = secrets.map(secret => generateToken({ sub: 'fleet-fixture', scopes: ['peer:invoke', 'fleet:listen'] }, secret, '15m'));
  try {
    const peers = await Promise.all(['alpha', 'beta'].map(async (id, index) => {
      const home = path.join(directory, id);
      await mkdir(home);
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
      Object.assign(env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'), NODE_ENV: 'test', JWT_SECRET: secrets[index],
        CODEBUDDY_PEER_PROVIDER: 'lmstudio', CODEBUDDY_PEER_MODEL: 'local-model',
        CODEBUDDY_FLEET_HOSTNAME: id, CODEBUDDY_SENSORY: 'false', CODEBUDDY_FLEET_ROOMS: 'false',
        CODEBUDDY_HEADLESS: 'true', NO_COLOR: '1', CODEBUDDY_PEER_MAX_DEPTH: '1', CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL: '128' });
      const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
      const child = fork(fileURLToPath(new URL('../fixtures/fleet/guard-worker.ts', import.meta.url)), [], {
        cwd: home, env, execArgv: ['--import', loader], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
      child.on('message', message => {
        if (message && typeof message === 'object' && 'type' in message && ['hop', 'model'].includes(String(message.type))) observations.push({ peer: id, ...message });
      });
      let logs = '';
      child.stdout?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
      child.stderr?.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
      const ready = await new Promise<{ url: string; pid: number }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Peer ${id} startup timeout: ${logs}`)), 45000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Peer ${id} exited ${code}: ${logs}`)); });
        child.on('message', message => {
          if (message && typeof message === 'object' && 'type' in message && message.type === 'ready') {
            clearTimeout(timer);
            resolve(message as { url: string; pid: number });
          }
        });
      });
      return { id, ...ready, tokenEnv: id.toUpperCase() };
    }));
    expect(new Set(peers.map(peer => peer.pid)).size).toBe(2);
    expect(peers.every(peer => peer.pid !== process.pid)).toBe(true);

    const connect = async (index: number, token = tokens[index]) => {
      const listener = new FleetListener({ url: peers[index]!.url, jwt: token, autoReconnect: false });
      listeners.push(listener); await listener.connect(); return listener;
    };
    const a = await connect(0);
    const chain = await a.request('peer.fixture-forward', { hops: [
      { url: peers[1]!.url, token: tokens[1] }, { url: peers[0]!.url, token: tokens[0] },
    ] }, { traceId: 'live-A-B-A', timeoutMs: 10000 }).then(response => ({ response }), error => ({ error: error.message }));
    expect(chain, JSON.stringify(observations)).toMatchObject({ error: expect.stringContaining('depth 2 > max 1') });
    expect(observations.filter(item => item.type === 'hop').map(item => [item.traceId, item.depth])).toEqual([['live-A-B-A', 0], ['live-A-B-A', 1]]);

    const started = await a.request('peer.chat-session.start') as { sessionId: string };
    const params = { sessionId: started.sessionId, prompt: 'fixture retry' };
    const first = await a.request('peer.chat-session.continue', params, { idempotencyKey: 'live-retry' });
    await a.disconnect();
    const reconnected = await connect(0);
    const retried = await reconnected.request('peer.chat-session.continue', params, { idempotencyKey: 'live-retry' });
    expect(retried).toEqual(first);
    expect(observations.filter(item => item.type === 'model')).toHaveLength(1);
    const foreignToken = generateToken({ sub: 'different-peer', scopes: ['peer:invoke', 'fleet:listen'] }, secrets[0]!, '15m');
    const foreign = await connect(0, foreignToken);
    for (const method of ['peer.chat-session.continue', 'peer.chat-session.continue-stream', 'peer.chat-session.end']) {
      await expect(foreign.request(method, params)).rejects.toThrow('SESSION_FORBIDDEN');
    }
    const chunks: string[] = [];
    const streamed = await reconnected.requestStream('peer.chat-stream', { prompt: 'stream', maxTokens: 9999 }, delta => chunks.push(delta));
    expect(streamed).toMatchObject({ text: 'fixture-stream' });
    expect(chunks).toEqual(['fixture-stream']);
    expect(observations.filter(item => item.type === 'model').every(item => item.maxTokens === 128)).toBe(true);

    const configure = async (config: Record<string, unknown>) => {
      const child = children[0]!;
      const ack = new Promise<void>(resolve => {
        const handler = (message: unknown) => {
          if (message && typeof message === 'object' && 'type' in message && message.type === 'configured') {
            child.off('message', handler); resolve();
          }
        };
        child.on('message', handler);
      });
      child.send({ config }); await ack;
    };
    await configure({ leaf: true });
    await expect(reconnected.request('peer.dispatch', { prompt: 'dispatch' })).rejects.toThrow('leaf receiver');
    expect(await reconnected.request('peer.chat', { prompt: 'local leaf service' })).toMatchObject({ text: 'fixture-call-3' });
    await configure({ leaf: false, cap: '0' });
    for (const method of ['peer.chat', 'peer.chat-stream', 'peer.chat-session.continue', 'peer.chat-session.continue-stream']) {
      await expect(reconnected.request(method, params)).rejects.toThrow('FLEET_BUDGET_EXCEEDED');
    }
    const dispatched = await reconnected.request('peer.dispatch', { id: 'live-capped-dispatch', prompt: 'blocked' }) as { runId: string };
    await new Promise(resolve => setTimeout(resolve, 100));
    const status = await reconnected.request('peer.dispatchStatus', { runId: dispatched.runId });
    expect(status).toMatchObject({ status: 'failed', error: expect.stringContaining('FLEET_BUDGET_EXCEEDED') });
    expect(observations.filter(item => item.type === 'model')).toHaveLength(3);
    await reconnected.request('peer.chat-session.end', { sessionId: started.sessionId });
    let realResponse: unknown;
    if (process.env.CODEBUDDY_QA_REAL_FLEET_MODEL) {
      await configure({ cap: '5', localModel: process.env.CODEBUDDY_QA_REAL_FLEET_MODEL });
      realResponse = await reconnected.request('peer.chat', {
        prompt: 'Reply with exactly FLOTTE_OK', systemPrompt: 'Follow the requested output format. No tools.',
      }, { timeoutMs: 60000 });
      expect(realResponse).toMatchObject({ text: expect.stringContaining('FLOTTE_OK'), providerResolved: 'ollama' });
    }
    if (process.env.CODEBUDDY_QA_FLEET_TRACE_FILE) {
      await writeFile(process.env.CODEBUDDY_QA_FLEET_TRACE_FILE, JSON.stringify({ observations, first, retried, streamed, status, realResponse }, null, 2), { flag: 'wx' });
    }

  } finally {
    await Promise.allSettled(listeners.map(listener => listener.disconnect()));
    await Promise.all(children.map(child => new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 7000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send('stop'); else child.kill();
    })));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 90000);
