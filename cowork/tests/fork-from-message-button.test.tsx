// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForkFromMessageButton } from '../src/renderer/components/ForkFromMessageButton';
import { useAppStore } from '../src/renderer/store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const message = {
  id: 'persisted-message-2',
  sessionId: 'session-1',
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text: 'Second message' }],
  timestamp: 2,
};

describe('ForkFromMessageButton', () => {
  const fork = vi.fn();
  let setMessages: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fork.mockReset();
    fork.mockResolvedValue({ success: true, messages: [message] });
    (window as unknown as { electronAPI: unknown }).electronAPI = { session: { fork } };
    setMessages = vi.spyOn(useAppStore.getState(), 'setMessages');
  });

  afterEach(() => {
    setMessages.mockRestore();
    cleanup();
  });

  it('uses the stable persisted message id and installs the checked-out history', async () => {
    render(<ForkFromMessageButton message={message} />);
    fireEvent.click(screen.getByTestId('message-fork-persisted-message-2'));
    fireEvent.change(screen.getByPlaceholderText('branch.namePlaceholder'), {
      target: { value: 'Alternative' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'branch.createFork' }));

    await waitFor(() => expect(fork).toHaveBeenCalledWith(
      'session-1',
      'Alternative',
      undefined,
      'persisted-message-2',
    ));
    expect(setMessages).toHaveBeenCalledWith('session-1', [message]);
  });

  it('keeps the dialog open and exposes a backend refusal', async () => {
    fork.mockResolvedValueOnce({ success: false, error: 'Wait for the active turn.' });
    render(<ForkFromMessageButton message={message} />);
    fireEvent.click(screen.getByTestId('message-fork-persisted-message-2'));
    fireEvent.change(screen.getByPlaceholderText('branch.namePlaceholder'), {
      target: { value: 'Busy fork' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'branch.createFork' }));

    expect(await screen.findByText('Wait for the active turn.')).toBeTruthy();
    expect(setMessages).not.toHaveBeenCalled();
  });
});
