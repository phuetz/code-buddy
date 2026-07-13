import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectEvolutionProposal } from '../src/shared/project-evolution';

const ipcMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  };
});

vi.mock('electron', () => ({ ipcMain: { handle: ipcMock.handle } }));
vi.mock('../src/main/ipc-main-bridge', () => ({ sendToRenderer: vi.fn() }));

import { registerProjectIpcHandlers } from '../src/main/ipc/project-ipc';

const proposal: ProjectEvolutionProposal = {
  id: 'proposal-1',
  projectId: 'project-1',
  type: 'master_instruction',
  status: 'pending',
  title: 'Update instruction',
  reason: 'Reusable rule',
  evidence: [{ role: 'summary', excerpt: 'Always cite sources.' }],
  sourceKind: 'summary',
  beforeContent: '',
  afterContent: '- Always cite sources.\n',
  baseFingerprint: 'base',
  audit: [{ action: 'created', at: 1 }],
  createdAt: 1,
  updatedAt: 1,
};

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcMock.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
  return Promise.resolve(handler({}, ...args) as T);
}

describe('Project evolution IPC', () => {
  const activity = { record: vi.fn() };
  const evolution = {
    list: vi.fn(() => [proposal]),
    create: vi.fn(() => proposal),
    approve: vi.fn(() => ({ ok: true, proposal: { ...proposal, status: 'approved' as const } })),
    reject: vi.fn(() => ({ ok: true, proposal: { ...proposal, status: 'rejected' as const } })),
    rollback: vi.fn(() => ({ ok: true, proposal: { ...proposal, status: 'rolled_back' as const } })),
  };

  beforeEach(() => {
    ipcMock.handlers.clear();
    ipcMock.handle.mockClear();
    vi.clearAllMocks();
    registerProjectIpcHandlers(
      { list: () => [], get: () => null, getActive: () => null } as never,
      activity as never,
      evolution as never,
    );
  });

  it('registers and serves the persistent proposal list', async () => {
    const result = await call<{ proposals: ProjectEvolutionProposal[] }>(
      'project.evolution.list',
      'project-1',
    );

    expect(result.proposals).toEqual([proposal]);
    expect(evolution.list).toHaveBeenCalledWith('project-1');
  });

  it('creates a local proposal and records metadata without proposal content', async () => {
    const input = {
      projectId: 'project-1',
      source: { kind: 'summary' as const, text: 'Always cite sources.' },
      target: { type: 'master_instruction' as const },
    };

    const result = await call<ProjectEvolutionProposal>('project.evolution.create', input);

    expect(result).toEqual(proposal);
    expect(evolution.create).toHaveBeenCalledWith(input);
    expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({
      type: 'gui.action',
      projectId: 'project-1',
      metadata: expect.objectContaining({ proposalId: 'proposal-1' }),
    }));
    expect(JSON.stringify(activity.record.mock.calls)).not.toContain('Always cite sources');
  });

  it('routes approval, rejection, and rollback through explicit handlers', async () => {
    const approved = await call<{ ok: boolean; proposal: ProjectEvolutionProposal }>(
      'project.evolution.approve',
      'proposal-1',
    );
    const rejected = await call<{ ok: boolean; proposal: ProjectEvolutionProposal }>(
      'project.evolution.reject',
      { proposalId: 'proposal-1' },
    );
    const rolledBack = await call<{ ok: boolean; proposal: ProjectEvolutionProposal }>(
      'project.evolution.rollback',
      'proposal-1',
    );

    expect(approved.proposal.status).toBe('approved');
    expect(rejected.proposal.status).toBe('rejected');
    expect(rolledBack.proposal.status).toBe('rolled_back');
    expect(evolution.approve).toHaveBeenCalledWith('proposal-1');
    expect(evolution.reject).toHaveBeenCalledWith({ proposalId: 'proposal-1' });
    expect(evolution.rollback).toHaveBeenCalledWith('proposal-1');
  });
});
