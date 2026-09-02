/**
 * Tests for A2A remote agents (cross-host fleet feature, V0.3).
 * Validates A2AAgentClient.registerRemoteCard / touchRemoteAgent /
 * listRemoteAgents / unregisterRemoteAgent + findAgentsWithSkill
 * cross-checks remote cards.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  A2AAgentClient,
  createAgentCard,
  type AgentCard,
  type RemoteAgent,
} from '../../src/protocols/a2a/index.js';

function makeCard(name: string, skillIds: string[]): AgentCard {
  return createAgentCard({
    name,
    description: `${name} agent`,
    skills: skillIds.map((id) => ({
      id,
      name: id,
      description: id,
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    })),
  });
}

describe('A2AAgentClient — remote agents', () => {
  it('register + listRemoteAgents', () => {
    const client = new A2AAgentClient();
    const card = makeCard('gpuNode-ollama', ['embed-nomic', 'chat-gemma4']);

    client.registerRemoteCard('gpuNode-ollama', {
      url: 'http://192.0.2.42:11434',
      card,
      lastHeartbeat: 1000,
    });

    const remotes = client.listRemoteAgents();
    expect(remotes).toHaveLength(1);
    expect(remotes[0].name).toBe('gpuNode-ollama');
    expect(remotes[0].url).toBe('http://192.0.2.42:11434');
    expect(remotes[0].card.skills).toHaveLength(2);
    expect(remotes[0].lastHeartbeat).toBe(1000);
  });

  it('getAgentCard fallback to remote', () => {
    const client = new A2AAgentClient();
    const card = makeCard('ministar-ollama', ['chat-qwen3']);
    client.registerRemoteCard('ministar-ollama', {
      url: 'http://203.0.113.10:11434',
      card,
      lastHeartbeat: Date.now(),
    });
    expect(client.getAgentCard('ministar-ollama')?.name).toBe('ministar-ollama');
  });

  it('touchRemoteAgent updates lastHeartbeat', () => {
    const client = new A2AAgentClient();
    const before = 1000;
    client.registerRemoteCard('spoke', {
      url: 'http://x',
      card: makeCard('spoke', ['s']),
      lastHeartbeat: before,
    });
    const ok = client.touchRemoteAgent('spoke');
    expect(ok).toBe(true);
    const remotes = client.listRemoteAgents();
    expect(remotes[0].lastHeartbeat).toBeGreaterThan(before);
  });

  it('touchRemoteAgent returns false for unknown agent', () => {
    const client = new A2AAgentClient();
    expect(client.touchRemoteAgent('nope')).toBe(false);
  });

  it('unregisterRemoteAgent', () => {
    const client = new A2AAgentClient();
    client.registerRemoteCard('spoke', {
      url: 'http://x',
      card: makeCard('spoke', ['s']),
      lastHeartbeat: Date.now(),
    });
    expect(client.listRemoteAgents()).toHaveLength(1);
    expect(client.unregisterRemoteAgent('spoke')).toBe(true);
    expect(client.listRemoteAgents()).toHaveLength(0);
    expect(client.unregisterRemoteAgent('spoke')).toBe(false);
  });

  it('findAgentsWithSkill includes remote agents', () => {
    const client = new A2AAgentClient();
    client.registerRemoteCard('a', {
      url: 'http://a',
      card: makeCard('a', ['embed-bge', 'chat-llama']),
      lastHeartbeat: Date.now(),
    });
    client.registerRemoteCard('b', {
      url: 'http://b',
      card: makeCard('b', ['chat-llama']),
      lastHeartbeat: Date.now(),
    });
    expect(client.findAgentsWithSkill('chat-llama').sort()).toEqual(['a', 'b']);
    expect(client.findAgentsWithSkill('embed-bge')).toEqual(['a']);
    expect(client.findAgentsWithSkill('inexistent')).toEqual([]);
  });

  it('local + remote co-existence (findAgentsWithSkill)', () => {
    const client = new A2AAgentClient();
    // Just remote here — local agent registration tested in a2a.test.ts
    client.registerRemoteCard('remote1', {
      url: 'http://r1',
      card: makeCard('remote1', ['shared-skill']),
      lastHeartbeat: Date.now(),
    });
    expect(client.findAgentsWithSkill('shared-skill')).toEqual(['remote1']);
  });

  it('RemoteAgent type is exported', () => {
    const ra: RemoteAgent = {
      url: 'http://x',
      card: makeCard('x', []),
      lastHeartbeat: 1,
    };
    expect(ra.url).toBe('http://x');
  });
});
