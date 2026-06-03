/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesMessagingGatewayStrip,
  type ChannelGatewayStatusReport,
} from '../src/renderer/components/hermes-messaging-gateway-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

const cleanGatewayStatus: ChannelGatewayStatusReport = {
  config: {
    channels: [
      {
        allowedChannelsCount: 1,
        allowedUsersCount: 1,
        enabled: true,
        hasToken: true,
        hasWebhookUrl: false,
        optionKeys: ['parseMode'],
        type: 'telegram',
      },
    ],
    configuredCount: 1,
    disabledCount: 0,
    enabledCount: 1,
    path: 'D:/workspace/.codebuddy/channels.json',
  },
  generatedAt: '2026-05-31T13:58:00.000Z',
  kind: 'codebuddy_channel_status',
  operatorCommands: [
    {
      command: 'buddy hermes messaging status --json --config "D:/workspace/.codebuddy/channels.json"',
      description: 'Refresh the Hermes messaging gateway readiness report.',
      id: 'messaging-status',
      label: 'Inspect readiness',
    },
    {
      command: 'buddy hermes messaging start --json --config "D:/workspace/.codebuddy/channels.json"',
      description: 'Register and connect every enabled messaging channel from the current config.',
      id: 'messaging-start',
      label: 'Start gateway',
    },
    {
      command: 'buddy hermes messaging stop --json',
      description: 'Disconnect all runtime messaging channels in the current process.',
      id: 'messaging-stop',
      label: 'Stop gateway',
    },
  ],
  recommendations: [],
  runtime: {
    authenticatedCount: 1,
    channels: [
      {
        authenticated: true,
        connected: true,
        lastActivity: '2026-05-31T13:57:59.000Z',
        type: 'telegram',
      },
    ],
    connectedCount: 1,
    registeredCount: 1,
  },
  schemaVersion: 1,
};

describe('HermesMessagingGatewayStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders channel gateway readiness and the real CLI command', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesMessagingGatewayStrip, { status: cleanGatewayStatus }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-messaging-gateway"]');
    expect(strip?.textContent).toContain('Hermes messaging gateway');
    expect(strip?.textContent).toContain('gateway ready');
    expect(strip?.textContent).toContain('Configured');
    expect(strip?.textContent).toContain('1/1');
    expect(strip?.textContent).toContain('telegram');
    expect(strip?.textContent).toContain('buddy hermes messaging status --json');
    expect(strip?.textContent).toContain('buddy hermes messaging start --json');
    expect(strip?.textContent).toContain('buddy hermes messaging stop --json');
  });

  it('loads gateway readiness from the existing channels IPC bridge', async () => {
    const target = container();
    const status = vi.fn().mockResolvedValue({
      items: [],
      ok: true,
      report: {
        ...cleanGatewayStatus,
        recommendations: ['No runtime channels are registered in this process.'],
        runtime: {
          authenticatedCount: 0,
          channels: [],
          connectedCount: 0,
          registeredCount: 0,
        },
      },
    });
    (window as unknown as {
      electronAPI?: {
        channels?: {
          status: typeof status;
        };
      };
    }).electronAPI = {
      channels: {
        status,
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesMessagingGatewayStrip));
      await Promise.resolve();
    });

    expect(status).toHaveBeenCalledWith();
    expect(target.textContent).toContain('gateway attention');
    expect(target.textContent).toContain('No runtime channels are registered in this process.');
  });
});
