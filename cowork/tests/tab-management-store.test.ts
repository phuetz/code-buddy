/**
 * Phase 6 — TabBar pin / reorder / unread state machine.
 *
 * Drives the Zustand store directly (no React tree) and asserts the
 * shape of `openTabs` after each action. The component layer is a thin
 * shell over these primitives, so the store-level tests are the real
 * regression net.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore, type SessionState } from '../src/renderer/store';
import type { A2ATask, DiffPreview, FleetPeer, SubAgent, TeamMember } from '../src/renderer/types';

const reset = () => {
  // Drop everything to a known shape — store is a global singleton.
  useAppStore.setState({
    openTabs: [],
    activeSessionId: null,
    sessionStates: {},
    diffPreviews: {},
    fleetPeers: {},
    fleetEvents: [],
    a2aTasks: {},
    teamMembers: {},
    subAgents: {},
    subAgentOutputs: {},
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

  it('record removal actions drop only the targeted keys', () => {
    const sessionState: SessionState = {
      messages: [],
      partialMessage: '',
      partialThinking: '',
      pendingTurns: [],
      activeTurn: null,
      executionClock: { startAt: null, endAt: null },
      traceSteps: [],
      contextWindow: 0,
    };
    const diffPreview: DiffPreview = {
      turnId: 1,
      sessionId: 's-target',
      diffs: [],
      timestamp: 1,
      status: 'pending',
    };
    const targetPeer: FleetPeer = {
      id: 'peer-target',
      url: 'ws://target.example',
      addedAt: 1,
      status: 'connected',
    };
    const keepPeer: FleetPeer = {
      id: 'peer-keep',
      url: 'ws://keep.example',
      addedAt: 2,
      status: 'authenticated',
    };
    const targetTask: A2ATask = {
      taskId: 'task-target',
      agentId: 'agent-target',
      status: 'working',
      startedAt: 1,
      updatedAt: 1,
    };
    const keepTask: A2ATask = {
      taskId: 'task-keep',
      agentId: 'agent-keep',
      status: 'completed',
      startedAt: 1,
      updatedAt: 2,
    };
    const targetMember: TeamMember = {
      id: 'member-target',
      role: 'coder',
      label: 'Target',
      status: 'working',
      currentTaskId: null,
      completedTasks: 0,
      joinedAt: '2026-06-03T00:00:00.000Z',
    };
    const keepMember: TeamMember = {
      id: 'member-keep',
      role: 'reviewer',
      label: 'Keep',
      status: 'idle',
      currentTaskId: null,
      completedTasks: 1,
      joinedAt: '2026-06-03T00:00:00.000Z',
    };
    const targetSubAgent: SubAgent = {
      id: 'sub-target',
      nickname: 'Target',
      role: 'worker',
      status: 'running',
      depth: 0,
      parentId: null,
      createdAt: 1,
    };
    const keepSubAgent: SubAgent = {
      id: 'sub-keep',
      nickname: 'Keep',
      role: 'reviewer',
      status: 'completed',
      depth: 0,
      parentId: null,
      createdAt: 1,
    };

    useAppStore.setState({
      sessions: [
        {
          id: 's-target',
          title: 'Target',
          status: 'idle',
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 's-keep',
          title: 'Keep',
          status: 'idle',
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeSessionId: 's-target',
      openTabs: [
        { id: 'tab-target', sessionId: 's-target', title: 'Target' },
        { id: 'tab-keep', sessionId: 's-keep', title: 'Keep' },
      ],
      sessionStates: { 's-target': sessionState, 's-keep': sessionState },
      diffPreviews: { 's-target': [diffPreview], 's-keep': [{ ...diffPreview, sessionId: 's-keep' }] },
      fleetPeers: { [targetPeer.id]: targetPeer, [keepPeer.id]: keepPeer },
      fleetEvents: [
        { peerId: targetPeer.id, type: 'lost', payload: {}, receivedAt: 1 },
        { peerId: keepPeer.id, type: 'kept', payload: {}, receivedAt: 2 },
      ],
      a2aTasks: { [targetTask.taskId]: targetTask, [keepTask.taskId]: keepTask },
      teamMembers: { [targetMember.id]: targetMember, [keepMember.id]: keepMember },
      subAgents: { 's-target': [targetSubAgent], 's-keep': [keepSubAgent] },
      subAgentOutputs: { 's-target': { [targetSubAgent.id]: 'drop' }, 's-keep': { [keepSubAgent.id]: 'keep' } },
    });

    const actions = useAppStore.getState();
    actions.removeSession('s-target');
    actions.clearDiffPreviews('s-target');
    actions.removeFleetPeer(targetPeer.id);
    actions.removeA2ATask(targetTask.taskId);
    actions.removeTeamMember(targetMember.id);
    actions.clearSubAgents('s-target');

    const state = useAppStore.getState();
    expect(state.sessions.map((s) => s.id)).toEqual(['s-keep']);
    expect(Object.keys(state.sessionStates)).toEqual(['s-keep']);
    expect(state.activeSessionId).toBeNull();
    expect(state.openTabs.map((t) => t.id)).toEqual(['tab-keep']);
    expect(Object.keys(state.diffPreviews)).toEqual(['s-keep']);
    expect(Object.keys(state.fleetPeers)).toEqual([keepPeer.id]);
    expect(state.fleetEvents.map((event) => event.peerId)).toEqual([keepPeer.id]);
    expect(Object.keys(state.a2aTasks)).toEqual([keepTask.taskId]);
    expect(Object.keys(state.teamMembers)).toEqual([keepMember.id]);
    expect(Object.keys(state.subAgents)).toEqual(['s-keep']);
    expect(Object.keys(state.subAgentOutputs)).toEqual(['s-keep']);
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

  // ── Pin persistence — hydration helper ───────────────────────────

  it('setPinnedSessionIds marks matching tabs and re-sorts pinned-first', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' },
      { id: 'c', sessionId: 's-c', title: 'C' }
    );
    useAppStore.getState().setPinnedSessionIds(['s-c']);
    const ids = useAppStore.getState().openTabs.map((t) => t.id);
    expect(ids).toEqual(['c', 'a', 'b']);
    expect(useAppStore.getState().openTabs[0].pinned).toBe(true);
  });

  it('setPinnedSessionIds drops unknown ids silently (deleted sessions)', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.getState().setPinnedSessionIds(['s-a', 's-deleted-long-ago']);
    const tabs = useAppStore.getState().openTabs;
    expect(tabs.find((t) => t.sessionId === 's-a')?.pinned).toBe(true);
    expect(tabs).toHaveLength(2); // no phantom tab created
  });

  it('setPinnedSessionIds with empty array unpins everything', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A', pinned: true },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.getState().setPinnedSessionIds([]);
    const allUnpinned = useAppStore
      .getState()
      .openTabs.every((t) => !t.pinned);
    expect(allUnpinned).toBe(true);
  });

  it('setPinnedSessionIds is idempotent', () => {
    seedTabs(
      { id: 'a', sessionId: 's-a', title: 'A' },
      { id: 'b', sessionId: 's-b', title: 'B' }
    );
    useAppStore.getState().setPinnedSessionIds(['s-b']);
    const first = JSON.stringify(useAppStore.getState().openTabs);
    useAppStore.getState().setPinnedSessionIds(['s-b']);
    const second = JSON.stringify(useAppStore.getState().openTabs);
    expect(second).toBe(first);
  });
});
