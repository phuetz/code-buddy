import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerEvolveCommands } from '../../../src/commands/cli/evolve-command.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeFiche } from '../../agent/self-improvement/evolution/experiment-fixture.js';

const proposal = vi.hoisted(() => vi.fn(async (_options: { minSimilarity?: number }) => ({
  status: 'stopped' as const,
  reason: 'NO_RECALL' as const,
  events: [],
})));

vi.mock('../../../src/agent/self-improvement/evolution/proposal-engine.js', () => ({
  proposeResearchImprovement: proposal,
}));

const root = mkdtempSync(path.join(os.tmpdir(), 'evolve-cli-fiche-'));
const ficheFile = path.join(root, 'fiche.json');
writeFileSync(ficheFile, JSON.stringify(completeFiche));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function propose(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerEvolveCommands(program);
  await program.parseAsync(['evolve', 'propose', '--fiche-input', ficheFile, ...args], { from: 'user' });
}

afterEach(() => {
  proposal.mockClear();
  process.exitCode = 0;
  writeFileSync(ficheFile, JSON.stringify(completeFiche));
});

describe('evolve propose similarity threshold', () => {
  it('passes the research guard threshold of 0.45 by default', async () => {
    await propose([]);
    expect(proposal).toHaveBeenCalledOnce();
    expect(proposal.mock.calls[0]?.[0]).toMatchObject({ minSimilarity: 0.45, usageShare: 0.8,
      lane: 'auto', fiche: { research: { articleId: 'arxiv:2605.01664' } } });
  });

  it('accepts an explicit threshold override', async () => {
    await propose(['--min-similarity', '0.6']);
    expect(proposal).toHaveBeenCalledOnce();
    expect(proposal.mock.calls[0]?.[0]).toMatchObject({ minSimilarity: 0.6 });
  });

  it('passes an explicit usage budget and lane', async () => {
    await propose(['--usage-share', '0.6', '--source', 'research']);
    expect(proposal.mock.calls[0]?.[0]).toMatchObject({ usageShare: 0.6, lane: 'research' });
  });

  it('refuses an incomplete input before invoking the proposal engine', async () => {
    writeFileSync(ficheFile, JSON.stringify({ ...completeFiche, acceptance: undefined }));
    await propose([]);
    expect(process.exitCode).toBe(2);
    expect(proposal).not.toHaveBeenCalled();
  });
});
