// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BranchSwitcher } from '../src/renderer/components/BranchSwitcher';
import { useAppStore } from '../src/renderer/store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const restoredMessage = {
  id: 'branch-message',
  sessionId: 'session-1',
  role: 'user' as const,
  content: [{ type: 'text' as const, text: 'restored' }],
  timestamp: 1,
};

describe('BranchSwitcher persisted checkout', () => {
  const branches = vi.fn();
  const checkout = vi.fn();
  let setMessages: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    branches.mockReset();
    checkout.mockReset();
    branches.mockResolvedValue([
      {
        id: 'main',
        sessionId: 'session-1',
        name: 'main',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 3,
        isCurrent: true,
      },
      {
        id: 'alternative',
        sessionId: 'session-1',
        name: 'alternative',
        parentId: 'main',
        parentMessageId: 'm2',
        parentMessageIndex: 1,
        createdAt: 2,
        updatedAt: 2,
        messageCount: 2,
        isCurrent: false,
      },
    ]);
    checkout.mockResolvedValue({ success: true, messages: [restoredMessage] });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      session: { branches, checkout },
    };
    setMessages = vi.spyOn(useAppStore.getState(), 'setMessages');
  });

  afterEach(() => {
    setMessages.mockRestore();
    cleanup();
  });

  it('loads the actual current branch and installs checkout messages in the store', async () => {
    render(<BranchSwitcher sessionId="session-1" />);
    await waitFor(() => expect(branches).toHaveBeenCalledWith('session-1'));

    fireEvent.click(screen.getByTitle('branch.switcherTooltip'));
    fireEvent.click(await screen.findByText('alternative'));

    await waitFor(() => expect(checkout).toHaveBeenCalledWith('session-1', 'alternative'));
    expect(setMessages).toHaveBeenCalledWith('session-1', [restoredMessage]);
  });
});
