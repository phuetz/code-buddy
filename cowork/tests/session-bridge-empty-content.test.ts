import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { SessionBridge } from '../src/main/codebuddy/session-bridge';
import type { CodeBuddyAdapter } from '../src/main/codebuddy/codebuddy-adapter';

function makeWindow() {
  const send = vi.fn();
  const win = {
    isDestroyed: () => false,
    webContents: { send },
  } as unknown as BrowserWindow;
  return { win, send };
}

function makeAdapter(events: AsyncIterable<unknown>): CodeBuddyAdapter {
  return {
    chat: () => events,
    abort: vi.fn(),
  } as unknown as CodeBuddyAdapter;
}

describe('SessionBridge honesty', () => {
  it('emits a final assistant message when streamed content exists', async () => {
    async function* events() {
      yield { type: 'content', content: 'hello' };
      yield { type: 'done' };
    }

    const { win, send } = makeWindow();
    const bridge = new SessionBridge(makeAdapter(events()), win);

    await bridge.runSession('session-1', [{ role: 'user', content: 'hi' }]);

    expect(send).toHaveBeenCalledWith('stream.message', {
      sessionId: 'session-1',
      role: 'assistant',
      content: 'hello',
    });
    expect(send).toHaveBeenCalledWith('session.status', {
      sessionId: 'session-1',
      status: 'idle',
    });
  });

  it('reports an error instead of completing with empty assistant content', async () => {
    async function* events() {
      yield { type: 'done' };
    }

    const { win, send } = makeWindow();
    const bridge = new SessionBridge(makeAdapter(events()), win);

    await bridge.runSession('session-2', [{ role: 'user', content: 'hi' }]);

    expect(send).toHaveBeenCalledWith('error', {
      sessionId: 'session-2',
      message: 'Code Buddy session ended without assistant content',
    });
    expect(send).toHaveBeenCalledWith('session.status', {
      sessionId: 'session-2',
      status: 'error',
    });
    expect(send).not.toHaveBeenCalledWith(
      'stream.message',
      expect.objectContaining({ sessionId: 'session-2' })
    );
  });
});
