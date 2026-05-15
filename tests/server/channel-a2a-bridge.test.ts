/**
 * Channel -> A2A bridge unit tests.
 *
 * The bridge is wired through ChannelManager.onMessage. We use a real
 * ChannelManager singleton + a real MockChannel + a stub fetch.
 * resetChannelManager() runs in beforeEach to wipe handlers between tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startChannelA2ABridge } from '../../src/server/channel-a2a-bridge.js';
import {
  MockChannel,
  getChannelManager,
  resetChannelManager,
} from '../../src/channels/index.js';

interface FakeFetchCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

function makeFakeFetch(responses: Array<{ status?: number; json: unknown } | Error>) {
  const calls: FakeFetchCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    let body: unknown = null;
    try {
      body = init.body ? JSON.parse(String(init.body)) : null;
    } catch {
      /* ignore */
    }
    calls.push({ url, init, body });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.json), {
      status: next.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function flush() {
  // Let the EventEmitter -> handler chain finish.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('startChannelA2ABridge', () => {
  beforeEach(() => {
    resetChannelManager();
  });

  afterEach(() => {
    resetChannelManager();
  });

  it('forwards plain text via defaultSkill and replies with the result', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed', result: 'Hello back!' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      defaultModel: 'qwen3:4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hello');
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:3000/api/a2a/tasks/send');
    expect(calls[0].body).toMatchObject({
      skill: 'ollama-qwen3-4b',
      message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      metadata: { model: 'qwen3:4b' },
    });

    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe('Hello back!');
  });

  it('routes /skill <id> <text> with the explicit skill', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed', result: 'ok' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ignored-default',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('/skill ollama-gemma4-26b explique-moi le hub');
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      skill: 'ollama-gemma4-26b',
      message: { parts: [{ text: 'explique-moi le hub' }] },
    });
    expect(calls[0].body).not.toHaveProperty('agent');
  });

  it('includes configured auth headers on hub self-calls', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed', result: 'ok' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
      authHeaders: () => ({ Authorization: 'Bearer bridge-token' }),
    });

    channel.simulateMessage('hello');
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer bridge-token',
    });
  });

  it('routes /agent <name> <text> with the explicit agent', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed', result: 'pong' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'should-be-overridden',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('/agent ollama-darkstar ping');
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      agent: 'ollama-darkstar',
      message: { parts: [{ text: 'ping' }] },
    });
    expect(calls[0].body).not.toHaveProperty('skill');
  });

  it('replies locally to /help without calling the hub', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { result: 'should not be called' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('/help');
    await flush();

    expect(calls).toHaveLength(0);
    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('A2A bridge');
    expect(sent[0].content).toContain('/skill');
  });

  it('rejects messages from users not in allowedUsers', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli', allowedUsers: ['admin-only'] });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { result: 'never' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hello', { sender: { id: 'random-user', username: 'anon', displayName: 'Random' } });
    await flush();

    expect(calls).toHaveLength(0);
    expect(channel.getSentMessages()).toHaveLength(0);
  });

  it('reports a friendly error when the hub returns status=failed', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch } = makeFakeFetch([
      {
        status: 200,
        json: { id: 't', status: { status: 'failed', message: 'no spoke registered for skill x' } },
      },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'unknown-skill',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hi');
    await flush();

    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toMatch(/Task failed.*no spoke/);
  });

  it('reports a friendly error when fetch rejects (hub unreachable)', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch } = makeFakeFetch([
      Object.assign(new Error('connect ECONNREFUSED'), { name: 'FetchError' }),
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hi');
    await flush();

    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toMatch(/Hub unreachable/);
  });

  it('replies with a usage hint when /skill is missing arguments', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch, calls } = makeFakeFetch([
      { status: 200, json: { result: 'never called' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('/skill');
    await flush();

    expect(calls).toHaveLength(0);
    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toMatch(/Usage: \/skill/);
  });

  it('reports a task failure when result is missing', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hi');
    await flush();

    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe('Task failed: fleet returned no output');
  });

  it('reports a task failure when result is blank', async () => {
    const manager = getChannelManager();
    const channel = new MockChannel({ type: 'cli' });
    await channel.connect();
    manager.registerChannel(channel);

    const { fn: fakeFetch } = makeFakeFetch([
      { status: 200, json: { id: 't', status: 'completed', result: '   ' } },
    ]);

    startChannelA2ABridge({
      hubBaseUrl: 'http://127.0.0.1:3000',
      channelManager: manager,
      defaultSkill: 'ollama-qwen3-4b',
      fetchImpl: fakeFetch,
    });

    channel.simulateMessage('hi');
    await flush();

    const sent = channel.getSentMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toBe('Task failed: fleet returned no output');
  });
});
