/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ stopSession: vi.fn() }));

vi.mock('../src/renderer/hooks/useIPC', () => ({
  useIPC: () => ipc,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const options = typeof fallbackOrOptions === 'object'
        ? fallbackOrOptions
        : maybeOptions;
      const fallback = typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : typeof options?.defaultValue === 'string'
          ? options.defaultValue
          : key;
      return Object.entries(options ?? {}).reduce(
        (value, [name, replacement]) => value.replaceAll(`{{${name}}}`, String(replacement)),
        fallback,
      );
    },
  }),
}));

import { BrowserOperatorOverlay } from '../src/renderer/components/BrowserOperatorOverlay';
import { useAppStore } from '../src/renderer/store';
import type {
  BrowserOperatorRuntimeEvent,
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
} from '../src/shared/browser-operator-runtime-types';

const draft: BrowserOperatorSessionDraftInput = {
  schemaVersion: 1,
  sessionId: 'proposal-1',
  generatedAt: '2026-07-12T00:00:00.000Z',
  goal: 'Open the documentation menu',
  query: 'documentation menu',
  sourceUrl: 'https://example.com/docs',
  mode: 'isolated',
  intent: 'research',
  dedicatedTab: { label: 'Docs', reason: 'Isolated review' },
  consent: {
    required: true,
    granted: false,
    scopes: ['browser_interaction'],
    reason: 'Review required',
  },
  stopControl: { enabled: true, label: 'Stop', stopConditions: ['captcha'] },
  actionLog: [{
    id: 'act',
    sequence: 1,
    status: 'planned',
    tool: 'browser',
    action: 'act',
    stage: 'interact',
    title: 'Open documentation menu',
    evidence: 'user-action',
    requiresConsent: true,
    expectedArtifact: 'browser-action-log.jsonl',
    reason: 'Exact reviewed action',
    inputs: { instruction: 'Open documentation menu', maxActions: 1 },
  }],
  proofExport: { artifactName: 'proposal.json', includes: ['action log'] },
};

function runtime(state: BrowserOperatorRuntimeView['state']): BrowserOperatorRuntimeView {
  return {
    runtimeId: 'runtime-1',
    ownerSessionId: 'session-1',
    workspaceRoot: '/workspace',
    draftHash: 'a'.repeat(64),
    state,
    goal: draft.goal,
    mode: draft.mode,
    interactionClass: 'interactive',
    sourceUrl: draft.sourceUrl!,
    actionCount: draft.actionLog.length,
    createdAt: draft.generatedAt,
    updatedAt: draft.generatedAt,
    consent: null,
  };
}

describe('BrowserOperatorOverlay runtime integration', () => {
  let runtimeListener: ((event: BrowserOperatorRuntimeEvent) => void) | null;
  const prepare = vi.fn(async () => ({
    ok: true as const,
    runtime: runtime('prepared'),
    draft: { ...draft, sessionId: 'runtime-1' },
  }));
  const start = vi.fn(async () => ({ ok: true as const, runtime: runtime('running') }));
  const stop = vi.fn(async () => ({
    ok: true as const,
    stopped: true,
    runtime: runtime('stopping'),
  }));

  beforeEach(() => {
    ipc.stopSession.mockReset();
    prepare.mockClear();
    start.mockClear();
    stop.mockClear();
    runtimeListener = null;
    useAppStore.setState({
      activeSessionId: 'session-1',
      browserActions: [{
        sessionId: 'session-1',
        toolUseId: 'tool-1',
        action: 'browser_operator',
        details: { operatorDraft: draft },
        timestamp: 1,
      }],
      showBrowserOperatorOverlay: true,
    });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      browserOperatorRuntime: {
        prepare,
        start,
        stop,
        status: vi.fn(),
        list: vi.fn(),
        onEvent: (listener: (event: BrowserOperatorRuntimeEvent) => void) => {
          runtimeListener = listener;
          return () => {
            runtimeListener = null;
          };
        },
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('prepares, approves and stops the owned runtime instead of the chat session', async () => {
    render(<BrowserOperatorOverlay />);

    fireEvent.click(screen.getByTestId('browser-operator-prepare-runtime'));
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({
      ownerSessionId: 'session-1',
      draft,
    }));
    expect(await screen.findByTestId('browser-operator-runtime-card')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Autoriser ce plan exact' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'runtime-1',
      ownerSessionId: 'session-1',
      expectedDraftHash: 'a'.repeat(64),
    })));

    expect(runtimeListener).toBeTypeOf('function');
    const panicButton = screen.getByText('STOP').closest('button');
    expect(panicButton).not.toBeNull();
    fireEvent.click(panicButton!);
    await waitFor(() => expect(stop).toHaveBeenCalledWith({
      runtimeId: 'runtime-1',
      ownerSessionId: 'session-1',
    }));
    expect(ipc.stopSession).not.toHaveBeenCalled();
  });
});
