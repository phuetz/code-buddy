import { fork, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { generateToken } from '../../src/server/auth/jwt.js';
import { FleetListener } from '../../src/fleet/fleet-listener.js';
import { parseCollaborationConfig, runCollaboration } from '../../src/fleet/collaboration.js';

it('authenticates two real Code Buddy processes, combines work, preserves a session and reports rejected credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'buddy-multiprocess-'));
  const children: ChildProcess[] = [];
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
        CODEBUDDY_HEADLESS: 'true', NO_COLOR: '1' });
      const child = fork(fileURLToPath(new URL('../fixtures/fleet/worker.ts', import.meta.url)), [], {
        cwd: home, env, execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
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
    const config = parseCollaborationConfig({ version: 1, peers: peers.map(({ id, url, tokenEnv }) => ({ id, url, tokenEnv })) });
    const env = { ALPHA: tokens[0], BETA: tokens[1] };
    const checked = await runCollaboration(config, { env, timeoutMs: 5000 });
    expect(checked.status).toBe('complete');
    expect(checked.peers.map(peer => peer.pid)).toEqual(peers.map(peer => peer.pid));
    const report = await runCollaboration(config, { env, goal: 'Improve fleet cooperation', timeoutMs: 10000 });
    expect(report.status, JSON.stringify(report)).toBe('complete');
    expect(report.peers.map(peer => peer.text)).toEqual(['alpha: contribution verified', 'beta: contribution verified']);
    expect(report.synthesis?.text).toBe('SYNTHESIS: alpha and beta contributions combined');
    const listener = new FleetListener({ url: peers[0]!.url, jwt: tokens[0], autoReconnect: false });
    listeners.push(listener);
    await listener.connect();
    const session = await listener.request('peer.chat-session.start') as { sessionId: string };
    await listener.request('peer.chat-session.continue', { sessionId: session.sessionId, prompt: 'remember-marker-731' });
    await listener.disconnect();
    await listener.connect();
    const continuation = await listener.request('peer.chat-session.continue', { sessionId: session.sessionId, prompt: 'recall-marker' }) as { text: string };
    expect(continuation.text).toBe('MEMORY: 731');
    await listener.request('peer.chat-session.end', { sessionId: session.sessionId });
    const rejected = await runCollaboration(config, { env: { ...env, BETA: tokens[0] }, timeoutMs: 2000 });
    expect(rejected.status).toBe('partial');
    expect(rejected.peers[0]?.status).toBe('ready');
    expect(rejected.peers[1]?.status).toBe('failed');
    expect(JSON.stringify(rejected)).not.toContain(tokens[0]);
    const observerToken = generateToken({ sub: 'observer', scopes: ['fleet:listen'] }, secrets[0]!, '15m');
    const forbidden = await runCollaboration(config, { env: { ...env, ALPHA: observerToken }, timeoutMs: 1000 });
    expect(forbidden.status).toBe('partial');
    expect(forbidden.peers[0]?.error).toContain('FORBIDDEN');
    expect(forbidden.peers[0]?.error).not.toContain('REQUEST_TIMEOUT');

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
