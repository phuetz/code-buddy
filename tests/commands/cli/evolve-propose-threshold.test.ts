import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerEvolveCommands } from '../../../src/commands/cli/evolve-command.js';

const proposal = vi.hoisted(() => vi.fn(async (_options: { minSimilarity?: number }) => ({
  status: 'stopped' as const,
  reason: 'NO_RECALL' as const,
  events: [],
})));

vi.mock('../../../src/agent/self-improvement/evolution/proposal-engine.js', () => ({
  proposeResearchImprovement: proposal,
}));

async function propose(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerEvolveCommands(program);
  await program.parseAsync(['evolve', 'propose', ...args], { from: 'user' });
}

afterEach(() => {
  proposal.mockClear();
  process.exitCode = 0;
});

describe('evolve propose similarity threshold', () => {
  it('passes the research guard threshold of 0.45 by default', async () => {
    await propose([]);
    expect(proposal).toHaveBeenCalledOnce();
    expect(proposal.mock.calls[0]?.[0]).toMatchObject({ minSimilarity: 0.45 });
  });

  it('accepts an explicit threshold override', async () => {
    await propose(['--min-similarity', '0.6']);
    expect(proposal).toHaveBeenCalledOnce();
    expect(proposal.mock.calls[0]?.[0]).toMatchObject({ minSimilarity: 0.6 });
  });
});
