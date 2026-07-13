/**
 * Barge-in turn cancellation (Part B).
 *
 * On barge-in we must cancel the RUNNING agent turn, not just cut the TTS, so no
 * ghost reply lands after the interruption. This exercises:
 *   1. `resolveBargeInCancel` — the pure decision the renderer listener uses.
 *   2. `CodeBuddyEngineRunner.cancel` — the main-side abort the stop-turn path
 *      (`session.stop` → `SessionManager.stopSession` → `agentRunner.cancel`)
 *      ultimately reaches. It must abort via the adapter and never throw.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/core-loader', () => ({
  loadCoreModule: vi.fn(async () => null),
}));
vi.mock('../src/main/reasoning/reasoning-bridge', () => ({
  getReasoningBridge: () => ({}),
}));
vi.mock('../src/main/reasoning/reasoning-capture', () => ({
  createReasoningCapture: () => ({ push: vi.fn(), complete: vi.fn() }),
}));

import { resolveBargeInCancel } from '../src/renderer/hooks/useBargeInTurnCancel';
import { CodeBuddyEngineRunner } from '../src/main/engine/codebuddy-engine-runner';

describe('resolveBargeInCancel', () => {
  it('cancels the active session on a barge_in reason', () => {
    expect(resolveBargeInCancel('barge_in', 'sess-1')).toEqual({
      cancel: true,
      sessionId: 'sess-1',
    });
  });
  it('does not cancel for non-barge_in reasons', () => {
    for (const reason of ['manual', 'new_speech', 'stop', undefined]) {
      expect(resolveBargeInCancel(reason, 'sess-1').cancel).toBe(false);
    }
  });
  it('does not cancel when there is no active session', () => {
    expect(resolveBargeInCancel('barge_in', null).cancel).toBe(false);
    expect(resolveBargeInCancel('barge_in', undefined).cancel).toBe(false);
  });
});

function makeRunner(cancelImpl: (sessionId: string) => void = () => undefined) {
  const cancel = vi.fn(cancelImpl);
  const adapter = {
    runSession: vi.fn(async () => ({ content: '' })),
    cancel,
    clearSession: vi.fn(),
  };
  const runner = new CodeBuddyEngineRunner(adapter as never, {
    sendToRenderer: vi.fn(),
    saveMessage: vi.fn(),
  });
  return { runner, cancel };
}

describe('CodeBuddyEngineRunner.cancel', () => {
  it('aborts the in-flight turn via the adapter', () => {
    const { runner, cancel } = makeRunner();
    runner.cancel('sess-42');
    expect(cancel).toHaveBeenCalledWith('sess-42');
  });

  it('never-throws when the adapter cancel fails (e.g. no running turn)', () => {
    const { runner, cancel } = makeRunner(() => {
      throw new Error('nothing to cancel');
    });
    expect(() => runner.cancel('sess-unknown')).not.toThrow();
    expect(cancel).toHaveBeenCalledWith('sess-unknown');
  });
});
