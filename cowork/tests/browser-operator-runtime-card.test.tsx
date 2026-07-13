// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserOperatorRuntimeCard } from '../src/renderer/components/BrowserOperatorRuntimeCard';
import type {
  BrowserOperatorRuntimeView,
  BrowserOperatorSessionDraftInput,
} from '../src/shared/browser-operator-runtime-types';

const runtime: BrowserOperatorRuntimeView = {
  runtimeId: 'runtime-1',
  ownerSessionId: 'chat-1',
  workspaceRoot: '/project',
  draftHash: 'a'.repeat(64),
  state: 'prepared',
  goal: 'Open the documentation menu',
  mode: 'isolated',
  interactionClass: 'interactive',
  sourceUrl: 'https://example.com/docs',
  actionCount: 2,
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  consent: null,
};

const draft: BrowserOperatorSessionDraftInput = {
  schemaVersion: 1,
  sessionId: runtime.runtimeId,
  generatedAt: runtime.createdAt,
  goal: runtime.goal,
  query: 'docs',
  sourceUrl: runtime.sourceUrl,
  mode: 'isolated',
  intent: 'research',
  dedicatedTab: { label: 'Docs', reason: 'Isolated' },
  consent: { required: true, granted: false, scopes: ['browser_interaction'], reason: 'Review' },
  stopControl: { enabled: true, label: 'Stop', stopConditions: [] },
  actionLog: [{
    id: 'navigate',
    sequence: 1,
    status: 'planned',
    tool: 'navigate',
    action: 'navigate',
    stage: 'observe',
    title: 'Open reviewed URL',
    evidence: 'visible-state',
    requiresConsent: false,
    expectedArtifact: 'browser.json',
    reason: 'Exact URL',
    inputs: { url: runtime.sourceUrl },
  }, {
    id: 'act',
    sequence: 2,
    status: 'planned',
    tool: 'browser',
    action: 'act',
    stage: 'interact',
    title: 'Open documentation menu',
    evidence: 'user-action',
    requiresConsent: true,
    expectedArtifact: 'browser-action-log.jsonl',
    reason: 'Reviewed action',
    inputs: { instruction: runtime.goal, maxActions: 1 },
  }],
  proofExport: { artifactName: 'runtime-1.json', includes: ['action log'] },
};

afterEach(cleanup);

describe('BrowserOperatorRuntimeCard', () => {
  it('requires explicit review before approving the exact draft hash', async () => {
    const onApprove = vi.fn(async () => ({
      ok: true as const,
      runtime: { ...runtime, state: 'running' as const },
    }));
    render(
      <BrowserOperatorRuntimeCard
        runtime={runtime}
        draft={draft}
        onApprove={onApprove}
        onStop={vi.fn()}
      />,
    );

    const approve = screen.getByRole('button', { name: 'Autoriser ce plan exact' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText('Open documentation menu')).toBeTruthy();
    expect(screen.getByText(runtime.draftHash.slice(0, 12))).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);

    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      runtimeId: runtime.runtimeId,
      ownerSessionId: runtime.ownerSessionId,
      expectedDraftHash: runtime.draftHash,
      approvedBy: 'Patrice',
    }));
  });

  it('stops the owned runtime instead of stopping only the chat session', async () => {
    const onStop = vi.fn(async () => ({
      ok: true as const,
      stopped: true,
      runtime: { ...runtime, state: 'stopping' as const },
    }));
    render(
      <BrowserOperatorRuntimeCard
        runtime={{ ...runtime, state: 'running' }}
        draft={draft}
        onApprove={vi.fn()}
        onStop={onStop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ARRÊTER LE NAVIGATEUR' }));
    await waitFor(() => expect(onStop).toHaveBeenCalledWith({
      runtimeId: runtime.runtimeId,
      ownerSessionId: runtime.ownerSessionId,
    }));
  });
});
