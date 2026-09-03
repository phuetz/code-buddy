import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleAgents: vi.fn(async () => ({
    handled: true,
    entry: { type: 'assistant', content: 'started', timestamp: new Date() },
  })),
  peek: vi.fn(() => 'hierarchical'),
  set: vi.fn(),
}));

vi.mock('../../src/commands/handlers/agents-handler.js', () => ({
  handleAgents: mocks.handleAgents,
  _peekActiveStrategy: mocks.peek,
  _setActiveStrategy: mocks.set,
}));

import { handleSwarm } from '../../src/commands/handlers/swarm-handler.js';

describe('/swarm thread delegation wiring', () => {
  const originalConcurrency = process.env.CODEBUDDY_SWARM_CONCURRENCY;

  beforeEach(() => {
    delete process.env.CODEBUDDY_SWARM_CONCURRENCY;
    mocks.handleAgents.mockClear();
    mocks.peek.mockClear();
    mocks.set.mockClear();
  });

  afterEach(() => {
    if (originalConcurrency === undefined) delete process.env.CODEBUDDY_SWARM_CONCURRENCY;
    else process.env.CODEBUDDY_SWARM_CONCURRENCY = originalConcurrency;
    vi.restoreAllMocks();
  });

  it('routes a swarm run through thread delegation with unchanged concurrency default', async () => {
    await handleSwarm(['build', 'the', 'toy']);

    expect(mocks.handleAgents).toHaveBeenCalledWith(
      ['run', 'build the toy'],
      expect.objectContaining({
        threadDelegation: expect.objectContaining({
          concurrency: 1,
        }),
      }),
    );
  });

  it('renders every multiplexed event with an agent and kind tag', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await handleSwarm(['inspect', 'toy']);
    const invocation = mocks.handleAgents.mock.calls[0]?.[1] as {
      threadDelegation?: { onEvent?: (event: { agentId: string; kind: string; payload: unknown }) => void };
    };

    invocation.threadDelegation?.onEvent?.({
      agentId: 'coder',
      kind: 'output',
      payload: { output: 'coder finished' },
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining('[swarm:coder:output]'));
    expect(write).toHaveBeenCalledWith(expect.stringContaining('coder finished'));
  });
});
