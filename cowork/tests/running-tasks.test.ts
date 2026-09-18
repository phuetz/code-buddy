import { describe, expect, it } from 'vitest';
import { listRunningTasks } from '../src/renderer/utils/running-tasks';
import type { Session } from '../src/renderer/types';
import type { SessionState } from '../src/renderer/store';

function session(partial: Partial<Session> & { id: string; title: string }): Session {
  return {
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: false,
    createdAt: 0,
    updatedAt: 0,
    status: 'idle',
    ...partial,
  };
}

const idleState: SessionState = {
  messages: [],
  partialMessage: '',
  partialThinking: '',
  pendingTurns: [],
  queuedIntents: [],
  activeTurn: null,
  executionClock: { startAt: null, endAt: null },
  traceSteps: [],
  contextWindow: 0,
};

describe('listRunningTasks', () => {
  it('lists sessions with an active turn or running status', () => {
    const sessions = [
      session({ id: 'a', title: 'Idle chat', status: 'idle' }),
      session({ id: 'b', title: 'Writing tests', status: 'running' }),
      session({ id: 'c', title: 'Tool round', status: 'idle' }),
    ];
    const states: Record<string, SessionState> = {
      a: idleState,
      b: idleState,
      c: { ...idleState, activeTurn: { stepId: 'bash', userMessageId: 'm1' } },
    };
    const lines = listRunningTasks(sessions, states);
    expect(lines.map((l) => l.id).sort()).toEqual(['b', 'c']);
    expect(lines.find((l) => l.id === 'c')?.label).toContain('bash');
  });
});
