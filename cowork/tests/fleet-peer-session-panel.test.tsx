/**
 * @vitest-environment happy-dom
 *
 * FleetPeerSessionPanel — interactive peer chat sessions: start, attach,
 * send a turn (local transcript), end, and error surfacing.
 */
import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetPeerSessionPanel } from '../src/renderer/components/FleetPeerSessionPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeApi(sessions: Array<Record<string, unknown>> = []) {
  return {
    peerSessionStart: vi.fn().mockResolvedValue({ ok: true, sessionId: 'sess_new' }),
    peerSessionSay: vi.fn().mockResolvedValue({ ok: true, text: 'réponse du peer' }),
    peerSessionEnd: vi.fn().mockResolvedValue({ ok: true, closed: true }),
    peerSessionList: vi.fn().mockResolvedValue({ ok: true, count: sessions.length, sessions }),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderPanel(api: ReturnType<typeof makeApi>, peerId = 'darkstar') {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<FleetPeerSessionPanel peerId={peerId} />);
  });
}

function query(testId: string): HTMLElement | null {
  return container!.querySelector(`[data-testid="${testId}"]`);
}

async function click(testId: string) {
  const el = query(testId) as HTMLButtonElement | null;
  expect(el, `element ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.click();
  });
}

async function type(testId: string, value: string) {
  const el = query(testId) as HTMLInputElement | null;
  expect(el, `input ${testId} should be rendered`).not.toBeNull();
  await act(async () => {
    el!.value = value;
    Simulate.change(el!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FleetPeerSessionPanel', () => {
  it('lists existing sessions on mount and starts a new one', async () => {
    const api = makeApi([{ sessionId: 'sess_old', turnCount: 3, model: 'qwen3.6:27b' }]);
    await renderPanel(api);

    expect(api.peerSessionList).toHaveBeenCalledWith('darkstar');
    expect(query('fleet-peer-session-row-sess_old')).not.toBeNull();
    // No active session yet — no chat box.
    expect(query('fleet-peer-session-chat')).toBeNull();

    await click('fleet-peer-session-start');

    expect(api.peerSessionStart).toHaveBeenCalledWith('darkstar');
    expect(query('fleet-peer-session-chat')).not.toBeNull();
  });

  it('sends a turn and appends both sides to the local transcript', async () => {
    const api = makeApi();
    await renderPanel(api);
    await click('fleet-peer-session-start');

    await type('fleet-peer-session-input', 'comment va la flotte ?');
    await click('fleet-peer-session-send');

    expect(api.peerSessionSay).toHaveBeenCalledWith('darkstar', 'sess_new', 'comment va la flotte ?');
    const transcript = query('fleet-peer-session-transcript');
    expect(transcript?.textContent).toContain('comment va la flotte ?');
    expect(transcript?.textContent).toContain('réponse du peer');
    // The input clears after a successful turn.
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe('');
  });

  it('attaches to an existing session with an empty local transcript', async () => {
    const api = makeApi([{ sessionId: 'sess_old', turnCount: 3 }]);
    await renderPanel(api);

    await click('fleet-peer-session-row-sess_old');

    expect(query('fleet-peer-session-chat')).not.toBeNull();
    // Earlier turns live on the peer — nothing local to show yet.
    expect(query('fleet-peer-session-transcript')).toBeNull();

    await type('fleet-peer-session-input', 'suite de la conversation');
    await click('fleet-peer-session-send');
    expect(api.peerSessionSay).toHaveBeenCalledWith('darkstar', 'sess_old', 'suite de la conversation');
  });

  it('ends the session and closes the chat box', async () => {
    const api = makeApi();
    await renderPanel(api);
    await click('fleet-peer-session-start');

    await click('fleet-peer-session-end');

    expect(api.peerSessionEnd).toHaveBeenCalledWith('darkstar', 'sess_new');
    expect(query('fleet-peer-session-chat')).toBeNull();
  });

  it('surfaces remote errors inline', async () => {
    const api = makeApi();
    api.peerSessionSay.mockResolvedValue({ ok: false, error: 'SESSION_EXPIRED: idled past 30min' });
    await renderPanel(api);
    await click('fleet-peer-session-start');

    await type('fleet-peer-session-input', 'trop tard ?');
    await click('fleet-peer-session-send');

    expect(query('fleet-peer-session-error')?.textContent).toContain('SESSION_EXPIRED');
  });
});
