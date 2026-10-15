import { describe, expect, it, vi } from 'vitest';
import { HeartbeatEngine } from '../../src/daemon/heartbeat.js';

const chat = vi.fn(async () => ({ choices: [{ message: { content: 'HEARTBEAT_OK' } }] }));
vi.mock('../../src/codebuddy/client.js', () => ({ CodeBuddyClient: class { chat = chat; } }));
vi.mock('../../src/commands/llm-provider-resolution.js', () => ({
  resolveCommandProvider: () => ({ apiKey: '', model: 'qwen3:4b-instruct', baseURL: 'http://127.0.0.1:11434/v1' }),
}));
vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class { constructor() { throw new Error('full agent prompt exceeds local context'); } },
}));

describe('heartbeat review', () => {
  it('sends only the checklist through a bounded model call', async () => {
    const engine = new HeartbeatEngine();
    expect(await engine['executeAgentReview']('- [ ] inspect fixture')).toBe('HEARTBEAT_OK');
    const [messages, tools, options] = chat.mock.calls[0]!;
    expect(JSON.stringify(messages)).toContain('inspect fixture');
    expect(tools).toEqual([]);
    expect(options.maxTokens).toBeLessThanOrEqual(512);
  });
});
