import { useCallback } from 'react';
import { useAppStore } from '../store';
import type { Message } from '../types';
import { useIPC } from './useIPC';
import { computeRegenerationPlan } from '../utils/regenerate-helpers';

interface UseRegenerateResult {
  /** Whether this assistant message is regeneratable (a user message exists before it). */
  canRegenerate: boolean;
  /** Trims messages from the previous user msg onward and replays it. */
  handleRegenerate: () => Promise<void>;
}

/**
 * `useRegenerate(message)` — re-run the user prompt that produced this
 * assistant message. Mirrors the chat-ui `gitnexus-rs` regenerate UX
 * (chat-ui/src/hooks/use-chat.ts pattern): walks back to find the last
 * user message before `message`, drops everything from that user message
 * onward in the store, then calls `continueSession` to replay it.
 *
 * Only meaningful for assistant messages — user messages return
 * `canRegenerate=false`. The session must be idle (not currently
 * streaming) at the call site; the button caller is expected to gate
 * on that.
 *
 * The slice-and-replay logic itself lives in `utils/regenerate-helpers.ts`
 * as a pure function so it stays testable in the node vitest env.
 */
export function useRegenerate(message: Message): UseRegenerateResult {
  const setMessages = useAppStore((s) => s.setMessages);
  const messages = useAppStore((s) => s.sessionStates[message.sessionId]?.messages ?? []);
  const activeTurn = useAppStore((s) => s.sessionStates[message.sessionId]?.activeTurn ?? null);
  const { continueSession } = useIPC();

  const plan = computeRegenerationPlan(messages, message);
  const canRegenerate = plan !== null && !activeTurn;

  const handleRegenerate = useCallback(async () => {
    const currentSession = useAppStore.getState().sessionStates[message.sessionId];
    if (currentSession?.activeTurn) return;
    const current = currentSession?.messages ?? [];
    const fresh = computeRegenerationPlan(current, message);
    if (!fresh) return;
    setMessages(message.sessionId, fresh.slicedMessages);
    await continueSession(message.sessionId, fresh.replayContent);
  }, [message, setMessages, continueSession]);

  return { canRegenerate, handleRegenerate };
}
