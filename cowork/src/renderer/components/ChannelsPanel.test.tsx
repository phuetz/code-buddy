// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store';
import { ChannelsPanel } from './ChannelsPanel';

function makeApi() {
  return {
    channels: {
      status: vi.fn().mockResolvedValue({ ok: true, items: [], report: null }),
      listConfig: vi.fn().mockResolvedValue({
        ok: true,
        path: '/tmp/channels.json',
        channels: [{
          type: 'matrix',
          enabled: false,
          configured: true,
          hasSecret: true,
          hasSecrets: { accessToken: true },
          legacyPlaintextSecrets: { accessToken: true },
          hasWebhookUrl: false,
          allowedUsers: ['alice'],
          allowedChannels: [],
          optionKeys: ['homeserverUrl', 'userId'],
          values: {
            homeserverUrl: 'https://matrix.example',
            userId: '@buddy:matrix.example',
            autoJoin: true,
            syncTimeout: 30,
          },
          connected: false,
          authenticated: false,
        }],
        catalog: [{
          type: 'matrix',
          label: 'Matrix',
          description: 'Matrix homeserver bot.',
          fields: [
            { key: 'homeserverUrl', label: 'Homeserver URL', kind: 'url', location: 'options', required: true },
            { key: 'userId', label: 'User ID', kind: 'text', location: 'options', required: true },
            { key: 'accessToken', label: 'Access token', kind: 'secret', location: 'options', required: true, primarySecret: true },
            { key: 'autoJoin', label: 'Auto-join invitations', kind: 'boolean', location: 'options' },
            { key: 'syncTimeout', label: 'Sync timeout', kind: 'number', location: 'options' },
          ],
        }],
      }),
      setConfig: vi.fn().mockResolvedValue({ ok: true }),
      setEnabled: vi.fn().mockResolvedValue({ ok: true }),
      setSecret: vi.fn().mockResolvedValue({ ok: true }),
      deleteSecret: vi.fn().mockResolvedValue({ ok: true }),
      removeChannel: vi.fn().mockResolvedValue({ ok: true }),
    },
    pairing: {
      status: vi.fn().mockResolvedValue({
        ok: true,
        enabled: true,
        totalApproved: 1,
        totalPending: 0,
        totalBlocked: 0,
        approvedByChannel: { matrix: 1 },
      }),
      list: vi.fn().mockResolvedValue({
        ok: true,
        approved: [{
          channelType: 'matrix',
          senderId: '@alice:matrix.example',
          displayName: 'Alice',
          approvedAt: '2026-08-01T00:00:00.000Z',
          approvedBy: 'owner',
        }],
      }),
      pending: vi.fn().mockResolvedValue({ ok: true, pending: [] }),
      approve: vi.fn().mockResolvedValue({ ok: true }),
      approveDirect: vi.fn().mockResolvedValue({ ok: true }),
      revoke: vi.fn().mockResolvedValue({ ok: true, revoked: true }),
    },
  };
}

describe('ChannelsPanel', () => {
  beforeEach(() => {
    useAppStore.setState({ showChannelsPanel: true });
  });

  afterEach(() => {
    cleanup();
    useAppStore.setState({ showChannelsPanel: false });
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.restoreAllMocks();
  });

  it('renders the core-defined form and writes secrets through the masked API', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
    render(<ChannelsPanel />);

    fireEvent.click(screen.getByTestId('channels-tab-configure'));
    expect(await screen.findByText('Matrix')).toBeTruthy();
    fireEvent.click(screen.getByTestId('channel-edit'));
    expect(screen.getByText(/legacy plaintext/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Homeserver URL *'), {
      target: { value: 'https://matrix.changed' },
    });
    fireEvent.click(screen.getByTestId('channel-config-save'));
    await waitFor(() => expect(api.channels.setConfig).toHaveBeenCalledWith('matrix', {
      allowedUsers: ['alice'],
      allowedChannels: [],
      options: {
        homeserverUrl: 'https://matrix.changed',
        userId: '@buddy:matrix.example',
        autoJoin: true,
        syncTimeout: 30,
      },
    }));

    fireEvent.change(screen.getByLabelText('Sync timeout'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('channel-config-save'));
    await waitFor(() => expect(api.channels.setConfig).toHaveBeenLastCalledWith('matrix', expect.objectContaining({
      allowedUsers: ['alice'],
      allowedChannels: [],
      options: expect.objectContaining({
        syncTimeout: null,
      }),
    })));

    const secretInput = screen.getByTestId('channel-secret-accessToken') as HTMLInputElement;
    expect(secretInput.type).toBe('password');
    fireEvent.change(secretInput, { target: { value: 'matrix-secret' } });
    fireEvent.click(screen.getByTestId('channel-edit'));
    fireEvent.click(screen.getByTestId('channel-edit'));
    expect((screen.getByTestId('channel-secret-accessToken') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByTestId('channel-secret-accessToken'), {
      target: { value: 'matrix-secret' },
    });
    fireEvent.click(screen.getByTestId('channel-secret-save-accessToken'));
    await waitFor(() => expect(api.channels.setSecret).toHaveBeenCalledWith(
      'matrix',
      'accessToken',
      'matrix-secret',
    ));
  });

  it('requires explicit confirmation before revoking DM access', async () => {
    const api = makeApi();
    (window as unknown as { electronAPI: unknown }).electronAPI = api;
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm });
    render(<ChannelsPanel />);

    fireEvent.click(screen.getByTestId('channels-tab-pairing'));
    expect(await screen.findByText(/Alice/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('pairing-revoke'));
    expect(api.pairing.revoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('pairing-revoke'));
    await waitFor(() => expect(api.pairing.revoke).toHaveBeenCalledWith(
      'matrix',
      '@alice:matrix.example',
    ));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
