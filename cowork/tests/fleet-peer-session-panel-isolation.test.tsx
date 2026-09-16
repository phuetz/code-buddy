/**
 * @vitest-environment happy-dom
 *
 * FleetPeerSessionPanel keeps its exported component in place while its keyed
 * stateful view follows the selected peer. Every answer must stay with the peer
 * and session it was asked for: late lists, starts, turns and ends must never
 * land in another peer's or session's view, and no request follows an unmount.
 * Nothing is ended remotely on the operator's behalf.
 */
import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FleetPeerSessionPanel } from '../src/renderer/components/FleetPeerSessionPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = Record<string, unknown>;

function deferred() {
  let resolve!: (value: Answer) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Answer>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function listOf(...sessionIds: string[]): Answer {
  return { ok: true, sessions: sessionIds.map((sessionId) => ({ sessionId, turnCount: 1 })) };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function makeApi() {
  return {
    peerSessionList: vi.fn(async (_peerId: string): Promise<Answer> => listOf()),
    peerSessionStart: vi.fn(async (): Promise<Answer> => ({ ok: true, sessionId: 'sess_new' })),
    peerSessionSay: vi.fn(async (): Promise<Answer> => ({ ok: true, text: 'réponse' })),
    peerSessionEnd: vi.fn(async (): Promise<Answer> => ({ ok: true, closed: true })),
  };
}

async function show(api: ReturnType<typeof makeApi>, peerId: string) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
  if (!container) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
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

async function type(value: string) {
  const el = query('fleet-peer-session-input') as HTMLInputElement;
  await act(async () => {
    el.value = value;
    Simulate.change(el);
  });
}

async function settle(fn: () => void) {
  await act(async () => {
    fn();
  });
}

function listCallsFor(api: ReturnType<typeof makeApi>, peerId: string): number {
  return api.peerSessionList.mock.calls.filter(([id]) => id === peerId).length;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FleetPeerSessionPanel keeps answers with their peer and session', () => {
  it('commits a fresh panel before layout observers see a newly selected peer', async () => {
    const api = makeApi();
    api.peerSessionList.mockImplementation(async (peerId: string) => listOf(`sess_${peerId}`));
    (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    let viewAtLayout: { peerId: string; oldRow: boolean; oldChat: boolean } | null = null;
    const Harness: React.FC<{ peerId: string }> = ({ peerId }) => {
      React.useLayoutEffect(() => {
        viewAtLayout = {
          peerId,
          oldRow: query('fleet-peer-session-row-sess_hub') !== null,
          oldChat: query('fleet-peer-session-chat')?.textContent?.includes('sess_hub') ?? false,
        };
      }, [peerId]);
      return <FleetPeerSessionPanel peerId={peerId} />;
    };
    await act(async () => {
      root!.render(<Harness peerId="hub" />);
    });
    await click('fleet-peer-session-row-sess_hub');

    act(() => {
      flushSync(() => root!.render(<Harness peerId="spoke" />));
    });

    expect(viewAtLayout).toEqual({ peerId: 'spoke', oldRow: false, oldChat: false });
  });

  it('never shows the previous peer’s late session list under the new peer', async () => {
    const api = makeApi();
    const hubList = deferred();
    api.peerSessionList.mockImplementation((peerId: string) =>
      peerId === 'hub' ? hubList.promise : Promise.resolve(listOf('sess_spoke'))
    );
    await show(api, 'hub');

    await show(api, 'spoke');
    expect(query('fleet-peer-session-row-sess_spoke')).not.toBeNull();
    await settle(() => hubList.resolve(listOf('sess_hub')));

    expect(query('fleet-peer-session-row-sess_hub')).toBeNull();
    expect(query('fleet-peer-session-row-sess_spoke')).not.toBeNull();
    expect(query('fleet-peer-session-refresh')?.hasAttribute('disabled')).toBe(false);
  });

  it('never shows the previous peer’s late list error under the new peer', async () => {
    const api = makeApi();
    const hubList = deferred();
    api.peerSessionList.mockImplementation((peerId: string) =>
      peerId === 'hub' ? hubList.promise : Promise.resolve(listOf('sess_spoke'))
    );
    await show(api, 'hub');

    await show(api, 'spoke');
    await settle(() => hubList.reject(new Error('hub socket closed')));

    expect(query('fleet-peer-session-error')).toBeNull();
    expect(query('fleet-peer-session-row-sess_spoke')).not.toBeNull();
  });

  it('does not open a session started on the previous peer under the new one', async () => {
    const api = makeApi();
    const started = deferred();
    api.peerSessionStart.mockImplementation(() => started.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-start');

    await show(api, 'spoke');
    const hubListsBefore = listCallsFor(api, 'hub');
    await settle(() => started.resolve({ ok: true, sessionId: 'sess_hub' }));

    expect(query('fleet-peer-session-chat')).toBeNull();
    expect(listCallsFor(api, 'hub')).toBe(hubListsBefore);
    expect(api.peerSessionEnd).not.toHaveBeenCalled();
    expect(query('fleet-peer-session-start')?.hasAttribute('disabled')).toBe(false);
  });

  it('does not show the previous peer’s reply, nor clear the new peer’s draft', async () => {
    const api = makeApi();
    const reply = deferred();
    api.peerSessionList.mockImplementation(async (peerId: string) => listOf(`sess_${peerId}`));
    api.peerSessionSay.mockImplementation(() => reply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_hub');
    await type('état du hub ?');
    await click('fleet-peer-session-send');

    await show(api, 'spoke');
    await click('fleet-peer-session-row-sess_spoke');
    await type('question pour spoke');
    await settle(() => reply.resolve({ ok: true, text: 'réponse du hub' }));

    expect(query('fleet-peer-session-transcript')).toBeNull();
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe(
      'question pour spoke'
    );
    expect(api.peerSessionEnd).not.toHaveBeenCalled();
  });

  it('does not put a reply into another session of the same peer', async () => {
    const api = makeApi();
    const reply = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_one', 'sess_two'));
    api.peerSessionSay.mockImplementation(() => reply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_one');
    await type('pour la première session');
    await click('fleet-peer-session-send');

    await click('fleet-peer-session-row-sess_two');
    await settle(() => reply.resolve({ ok: true, text: 'réponse de la première' }));

    expect(query('fleet-peer-session-chat')?.textContent).toContain('sess_two');
    expect(query('fleet-peer-session-transcript')).toBeNull();
  });

  it('preserves a new draft typed while the previous turn is pending', async () => {
    const api = makeApi();
    const reply = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_one'));
    api.peerSessionSay.mockImplementation(() => reply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_one');
    await type('prompt envoyé');
    await click('fleet-peer-session-send');
    await type('nouveau brouillon');

    await settle(() => reply.resolve({ ok: true, text: 'réponse au prompt envoyé' }));

    expect(query('fleet-peer-session-transcript')?.textContent).toContain('prompt envoyé');
    expect(query('fleet-peer-session-transcript')?.textContent).toContain(
      'réponse au prompt envoyé'
    );
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe(
      'nouveau brouillon'
    );
  });

  it('never reuses a draft after session selection, end, or start changes the session', async () => {
    const api = makeApi();
    api.peerSessionList.mockImplementation(async () => listOf('sess_one', 'sess_two'));
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_one');
    await type('brouillon session un');

    await click('fleet-peer-session-row-sess_two');
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe('');
    await type('brouillon session deux');
    await click('fleet-peer-session-end');
    await click('fleet-peer-session-row-sess_one');
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe('');

    await type('brouillon avant nouvelle session');
    await click('fleet-peer-session-start');
    expect(query('fleet-peer-session-chat')?.textContent).toContain('sess_new');
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe('');
  });

  it('keeps the session the operator switched to when an earlier end completes', async () => {
    const api = makeApi();
    const ended = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_one', 'sess_two'));
    api.peerSessionEnd.mockImplementation(() => ended.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_one');
    await click('fleet-peer-session-end');

    await click('fleet-peer-session-row-sess_two');
    await settle(() => ended.resolve({ ok: true, closed: true }));

    const chat = query('fleet-peer-session-chat');
    expect(chat, 'the session switched to must stay open').not.toBeNull();
    expect(chat!.textContent).toContain('sess_two');
    expect(api.peerSessionEnd).toHaveBeenCalledTimes(1);
  });

  it('does not leave the previous peer’s sessions clickable while the new peer lists', async () => {
    const api = makeApi();
    const spokeList = deferred();
    api.peerSessionList.mockImplementation((peerId: string) =>
      peerId === 'hub' ? Promise.resolve(listOf('sess_hub')) : spokeList.promise
    );
    await show(api, 'hub');
    expect(query('fleet-peer-session-row-sess_hub')).not.toBeNull();

    await show(api, 'spoke');

    expect(query('fleet-peer-session-row-sess_hub')).toBeNull();
    expect(query('fleet-peer-session-chat')).toBeNull();
    expect(api.peerSessionSay).not.toHaveBeenCalled();
  });

  it('ignores a start from an earlier visit after going A→B→A, and keeps the new operation busy', async () => {
    const api = makeApi();
    const oldStart = deferred();
    const newList = deferred();
    api.peerSessionStart.mockImplementation(() => oldStart.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-start');
    await show(api, 'spoke');
    await show(api, 'hub');
    api.peerSessionList.mockImplementation(() => newList.promise);
    await click('fleet-peer-session-refresh');

    await settle(() => oldStart.resolve({ ok: true, sessionId: 'sess_from_first_visit' }));

    expect(query('fleet-peer-session-chat')).toBeNull();
    expect(query('fleet-peer-session-refresh')?.hasAttribute('disabled')).toBe(true);
    await settle(() => newList.resolve(listOf('sess_from_first_visit')));
    expect(query('fleet-peer-session-refresh')?.hasAttribute('disabled')).toBe(false);
  });

  it('ignores a reply from an earlier visit after A→B→A, even on the same session', async () => {
    const api = makeApi();
    const oldReply = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_hub'));
    api.peerSessionSay.mockImplementationOnce(() => oldReply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_hub');
    await type('première visite');
    await click('fleet-peer-session-send');
    await show(api, 'spoke');
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_hub');
    await type('nouveau brouillon');

    await settle(() => oldReply.resolve({ ok: true, text: 'réponse de la première visite' }));

    expect(query('fleet-peer-session-transcript')).toBeNull();
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe('nouveau brouillon');
  });

  it('ignores a reply sent before the same session was selected again', async () => {
    const api = makeApi();
    const oldReply = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_one', 'sess_two'));
    api.peerSessionSay.mockImplementationOnce(() => oldReply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_one');
    await type('avant re-sélection');
    await click('fleet-peer-session-send');
    await click('fleet-peer-session-row-sess_two');
    await click('fleet-peer-session-row-sess_one');
    await type('brouillon après re-sélection');

    await settle(() => oldReply.resolve({ ok: true, text: 'ancienne réponse' }));

    expect(query('fleet-peer-session-transcript')).toBeNull();
    expect((query('fleet-peer-session-input') as HTMLInputElement).value).toBe(
      'brouillon après re-sélection'
    );
  });

  it('still lists and releases busy under StrictMode double effects', async () => {
    const api = makeApi();
    api.peerSessionList.mockImplementation(async () => listOf('sess_strict'));
    (window as unknown as { electronAPI?: unknown }).electronAPI = { fleet: api };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <React.StrictMode>
          <FleetPeerSessionPanel peerId="hub" />
        </React.StrictMode>
      );
    });

    expect(query('fleet-peer-session-row-sess_strict')).not.toBeNull();
    expect(query('fleet-peer-session-refresh')?.hasAttribute('disabled')).toBe(false);
  });

  it('sends no follow-up request once the panel is gone', async () => {
    const api = makeApi();
    const reply = deferred();
    api.peerSessionList.mockImplementation(async () => listOf('sess_hub'));
    api.peerSessionSay.mockImplementation(() => reply.promise);
    await show(api, 'hub');
    await click('fleet-peer-session-row-sess_hub');
    await type('dernière question');
    await click('fleet-peer-session-send');
    const listsBeforeUnmount = api.peerSessionList.mock.calls.length;

    act(() => root!.unmount());
    root = null;
    await settle(() => reply.resolve({ ok: true, text: 'trop tard' }));

    expect(api.peerSessionList.mock.calls.length).toBe(listsBeforeUnmount);
  });
});
