/**
 * Phase 6 — TabBar pin / reorder / unread state machine.
 *
 * Drives the Zustand store directly (no React tree) and asserts the
 * shape of `openTabs` after each action. The component layer is a thin
 * shell over these primitives, so the store-level tests are the real
 * regression net.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/renderer/store';

const reset = () => {
  // Drop everything to a known shape — store is a global singleton.
  useAppStore.setState({
    openTabs: [],
    activeSessionId: null,
    sessionStates: {},
  });
};

const seedTabs = (
  ...tabs: Array<{ id: string; sessionId: string; title: string; pinned?: boolean; unread?: number }>
) => {
  useAppStore.setState({ openTabs: tabs });
};

describe('Tab management — store actions', () => {
  beforeEach(reset);

  it('togglePinnedTab moves the tab to the leftmost pinned slot', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' },
      { id: 'c', sessionId: 's-c', title: 'C' }
    );
    useAppStore.getState().togglePinnedTab('b');
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    expect(ids).toEqual(['b', 'a', 'c']);
    expect(useAppStore.getState().openTabs[0].pinned).toBe(true);
  });

  it('togglePinnedTab unpins and preserves the relative order of unpinned tabs', () => {
    seedTabs(
      { id: 'p1', sessionId: 's-p1', title: 'P1', pinned: true },
      { id: 'p2', sessionId: 's-p2', title: 'P2', pinned: true },
      { id: 'a', sessionId: 's-a', title: 'A' }
    );
    useAppStore.getState().togglePinnedTab('p1');
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    // After unpin, p1 keeps its original position within the unpinned
    // group (Chrome-style: unpinning preserves DOM order). p2 is the
    // remaining pinned and stays leftmost.
    expect(ids).toEqual(['p2', 'p1', 'a']);
  });

  it('closeTab refuses to close a pinned tab', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A', pinned: true },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.setState({ activeSessionId: 's-a' });
    useAppStore.getState().closeTab('a');
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    expect(ids).toEqual(['a', 'b']); // unchanged
  });

  it('closeOtherTabs keeps the target + every pinned tab', () => {
    seedTabs(
      { id: 'pin', sessionId: 's-pin', title: 'PIN', pinned: true },
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' },
      { id: 'c', sessionId: 's-c', title: 'C' }
    );
    useAppStore.getState().closeOtherTabs('b');
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    expect(ids).toEqual(['pin', 'b']);
    expect(useAppStore.getState().activeSessionId).toBe('s-b');
  });

  it('closeTabsToRight closes everything after the target except pinned', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' },
      { id: 'pin', sessionId: 's-pin', title: 'PIN', pinned: true },
      { id: 'c', sessionId: 's-c', title: 'C' }
    );
    useAppStore.getState().closeTabsToRight('a');
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    // a stays, b closes (right of a, not pinned), pin stays (immune), c closes.
    expect(ids).toEqual(['a', 'pin']);
  });

  it('reorderTabs preserves the pinned-on-the-left invariant', () => {
    seedTabs(
      { id: 'pin', sessionId: 's-pin', title: 'PIN', pinned: true },
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    // Try to drag the pinned tab past an unpinned one — impossible in the
    // contract: result still has the pinned at position 0.
    useAppStore.getState().reorderTabs(0, 2);
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    expect(ids[0]).toBe('pin');
  });

  it('addMessage bumps unread on a non-active session and clamps at 99', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.setState({ activeSessionId: 's-a' });
    const addMessage = useAppStore.getState().addMessage;
    for (let i = 0; i < 100; i++) {
      addMessage('s-b', {
        id: `m${i}`,
        sessionId: 's-b',
        role: 'assistant',
        timestamp: i,
        content: [{ type: 'text', text: `msg ${i}` }],
      });
    }
    const tabB = useAppStore.getState().openTabs.find((t) => t.id === 'b');
    expect(tabB?.unread).toBe(99);
  });

  it('setActiveSession clears the unread badge for the now-active tab', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A', unread: 7 },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.getState().setActiveSession('s-a');
    const tabA = useAppStore.getState().openTabs.find((t) => t.id === 'a');
    expect(tabA?.unread).toBe(0);
  });

  it('addMessage does NOT bump unread for the active session', () => {
    seedTabs({ id: 'a', sessionId: 's-a', title: 'A' });
    useAppStore.setState({ activeSessionId: 's-a' });
    useAppStore.getState().addMessage('s-a', {
      id: 'm1',
      sessionId: 's-a',
      role: 'assistant',
      timestamp: 1,
      content: [{ type: 'text', text: 'hi' }],
    });
    const tabA = useAppStore.getState().openTabs.find((t) => t.id === 'a');
    expect(tabA?.unread ?? 0).toBe(0);
  });

  it('addMessage does NOT bump unread for user messages', () => {
    seedTabs({ id: 'a', sessionId: 's-a', title: 'A' });
    useAppStore.setState({ activeSessionId: 's-other' });
    useAppStore.getState().addMessage('s-a', {
      id: 'um1',
      sessionId: 's-a',
      role: 'user',
      timestamp: 1,
      content: [{ type: 'text', text: 'hi' }],
    });
    const tabA = useAppStore.getState().openTabs.find((t) => t.id === 'a');
    expect(tabA?.unread ?? 0).toBe(0);
  });
});
