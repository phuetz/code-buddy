// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../src/renderer/types';

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock('../src/renderer/store', () => ({
  useAppStore: {
    getState: () => ({ updateSession: mocks.updateSession }),
  },
}));

vi.mock('../src/renderer/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

import { CompanionThreadToggle } from '../src/renderer/components/CompanionThreadToggle';

function session(tags: string[] = []): Session {
  return {
    id: 'session-1',
    title: 'Conversation',
    status: 'idle',
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    tags,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('CompanionThreadToggle', () => {
  it('exposes explicit consent and persists the companion tag', async () => {
    const updateTags = vi.fn(async () => true);
    render(<CompanionThreadToggle session={session()} updateTags={updateTags} />);

    const button = screen.getByRole('button', { name: 'Continuer cette session avec Lisa' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);

    await waitFor(() => expect(updateTags).toHaveBeenCalledWith(['companion']));
  });

  it('restores the prior tags when persistence fails', async () => {
    const updateTags = vi.fn(async () => false);
    render(
      <CompanionThreadToggle
        session={session(['research', 'companion'])}
        updateTags={updateTags}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Isoler cette session de Lisa' }));

    await waitFor(() => {
      expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
        tags: ['research', 'companion'],
      });
    });
  });
});
