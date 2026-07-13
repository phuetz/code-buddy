/** @vitest-environment happy-dom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectEvolutionPanel } from '../src/renderer/components/settings/ProjectEvolutionPanel';
import type { ProjectEvolutionProposal } from '../src/shared/project-evolution';

const translate = vi.hoisted(() => (
  key: string,
  fallback?: string | Record<string, unknown>,
) => typeof fallback === 'string'
  ? fallback
  : typeof fallback?.defaultValue === 'string'
    ? fallback.defaultValue
    : key);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

const pending: ProjectEvolutionProposal = {
  id: 'proposal-1',
  projectId: 'project-1',
  type: 'master_instruction',
  status: 'pending',
  title: 'Update the master instruction',
  reason: 'One reusable statement.',
  evidence: [{ role: 'summary', excerpt: 'Always cite sources.' }],
  sourceKind: 'summary',
  beforeContent: 'Write in French.',
  afterContent: 'Write in French.\n\n- Always cite sources.\n',
  baseFingerprint: 'base',
  audit: [{ action: 'created', at: 1 }],
  createdAt: 1,
  updatedAt: 1,
};

const project = {
  id: 'project-1',
  name: 'Roman vivant',
  createdAt: 1,
  updatedAt: 1,
};

const api = {
  list: vi.fn(async () => ({ proposals: [pending] })),
  create: vi.fn(async () => ({ ...pending, id: 'proposal-2' })),
  approve: vi.fn(async () => ({
    ok: true,
    proposal: { ...pending, status: 'approved' as const },
  })),
  reject: vi.fn(async () => ({
    ok: true,
    proposal: { ...pending, status: 'rejected' as const },
  })),
  rollback: vi.fn(async () => ({
    ok: true,
    proposal: { ...pending, status: 'rolled_back' as const },
  })),
};

describe('ProjectEvolutionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { electronAPI: unknown }).electronAPI = { projectEvolution: api };
  });

  afterEach(() => cleanup());

  it('renders persistent evidence and an exact before/after review', async () => {
    render(<ProjectEvolutionPanel project={project} activeSessionId="session-1" />);

    expect(await screen.findByTestId('project-evolution-proposal-proposal-1')).toBeTruthy();
    expect(screen.getByTestId('project-evolution-before').textContent).toContain('Write in French.');
    expect(screen.getByTestId('project-evolution-after').textContent).toContain('Always cite sources.');
    expect(screen.getByText('Always cite sources.')).toBeTruthy();
    expect(screen.getByTestId('project-evolution-approve').hasAttribute('disabled')).toBe(false);
  });

  it('creates a deterministic summary proposal with an explicit target', async () => {
    render(<ProjectEvolutionPanel project={project} activeSessionId="session-1" />);
    await screen.findByTestId('project-evolution-proposal-proposal-1');

    fireEvent.click(screen.getByTestId('project-evolution-source-summary'));
    fireEvent.change(screen.getByTestId('project-evolution-summary'), {
      target: { value: 'Toujours dater les sources.' },
    });
    fireEvent.change(screen.getByTestId('project-evolution-target-type'), {
      target: { value: 'knowledge_file' },
    });
    fireEvent.change(screen.getByTestId('project-evolution-target-path'), {
      target: { value: 'docs/decisions.md' },
    });
    fireEvent.click(screen.getByTestId('project-evolution-create'));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      source: { kind: 'summary', text: 'Toujours dater les sources.' },
      target: { type: 'knowledge_file', path: 'docs/decisions.md' },
    }));
    expect(await screen.findByTestId('project-evolution-proposal-proposal-2')).toBeTruthy();
  });

  it('applies only after the explicit approval interaction', async () => {
    render(<ProjectEvolutionPanel project={project} activeSessionId="session-1" />);
    await screen.findByTestId('project-evolution-proposal-proposal-1');

    expect(api.approve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-evolution-approve'));

    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('proposal-1'));
    expect(screen.getByTestId('project-evolution-status').textContent).toBe('approved');
  });

  it('disables approval for a stale proposal', async () => {
    api.list.mockResolvedValueOnce({
      proposals: [{ ...pending, staleReason: 'The master instruction changed.' }],
    });
    render(<ProjectEvolutionPanel project={project} activeSessionId="session-1" />);

    expect(await screen.findByTestId('project-evolution-stale')).toBeTruthy();
    expect(screen.getByTestId('project-evolution-approve').hasAttribute('disabled')).toBe(true);
  });
});
