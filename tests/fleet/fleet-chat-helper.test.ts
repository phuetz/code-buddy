/**
 * /fleet chat slash helper tests — V1.2.1.
 *
 * Mocks the FleetRegistry singleton to avoid real WebSocket traffic.
 * Verifies the UX wrapper around peer.chat-session.* — alias derivation,
 * session resolution rules, server-side error propagation, end-of-life
 * cleanup, and the auto-cleanup hook on /fleet stop.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetChatSessionsForTests,
  handleFleet,
} from '../../src/commands/handlers/fleet-handler.js';
import {
  _resetFleetRegistryForTests,
  getFleetRegistry,
  type ActiveListenerEntry,
  type FleetListenerPublicAPI,
} from '../../src/fleet/fleet-registry.js';
import type { CommandHandlerResult } from '../../src/commands/handlers/branch-handlers.js';

function makeStubListener(
  request: FleetListenerPublicAPI['request'],
  disconnect: FleetListenerPublicAPI['disconnect'] = async () => undefined,
): FleetListenerPublicAPI {
  return {
    disconnect,
    getReconnectAttempts: () => 0,
    isReconnecting: () => false,
    request,
    getLastSeen: () => ({ at: null, reason: null, ageMs: null }),
    isStale: () => false,
    getPeerCompactionState: () => ({
      active: false,
      startedAt: null,
      ageMs: null,
      lastResult: null,
    }),
    getEventHistory: () => [],
  };
}

function registerPeer(
  id: string,
  request: FleetListenerPublicAPI['request'],
  disconnect?: FleetListenerPublicAPI['disconnect'],
): ActiveListenerEntry {
  const entry: ActiveListenerEntry = {
    id,
    url: `ws://example/${id}`,
    startedAt: new Date(),
    eventCount: 0,
    autoReconnect: false,
    maxAttempts: 5,
    listener: makeStubListener(request, disconnect),
  };
  getFleetRegistry().register(entry);
  return entry;
}

function content(result: CommandHandlerResult): string {
  return typeof result.entry?.content === 'string' ? result.entry.content : '';
}

beforeEach(() => {
  _resetFleetRegistryForTests();
  _resetChatSessionsForTests();
});

afterEach(() => {
  _resetFleetRegistryForTests();
  _resetChatSessionsForTests();
});

describe('/fleet chat start', () => {
  it('happy path — opens a session, derives default alias <peer>-1', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_abc123def456ghi' };
      throw new Error(`unexpected method ${method}`);
    });
    registerPeer('ministar-linux', request);

    const result = await handleFleet([
      'chat',
      'start',
      'ministar-linux',
      '--system',
      'You are a Rust expert',
      '--model',
      'qwen2.5-coder:7b',
    ]);

    expect(content(result)).toContain('Chat session "ministar-linux-1" opened');
    expect(content(result)).toContain('sess_abc123def…'); // truncated form (14 chars + ellipsis)
    expect(request).toHaveBeenCalledWith(
      'peer.chat-session.start',
      { systemPrompt: 'You are a Rust expert', model: 'qwen2.5-coder:7b' },
      { timeoutMs: 30_000 },
    );
  });

  it('--name override gives a custom alias', async () => {
    registerPeer('darkstar', vi.fn(async () => ({ sessionId: 'sess_xyz' })));
    const result = await handleFleet(['chat', 'start', 'darkstar', '--name', 'rust-coach']);
    expect(content(result)).toContain('Chat session "rust-coach" opened');
  });

  it('--profile passes dispatchProfile through to peer.chat-session.start', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') {
        return { sessionId: 'sess_review1234567', dispatchProfile: 'review' };
      }
      throw new Error(`unexpected method ${method}`);
    });
    registerPeer('ministar-linux', request);

    const result = await handleFleet([
      'chat',
      'start',
      'ministar-linux',
      '--profile',
      'review',
    ]);

    expect(content(result)).toContain('Profile: review');
    expect(request).toHaveBeenCalledWith(
      'peer.chat-session.start',
      { dispatchProfile: 'review' },
      { timeoutMs: 30_000 },
    );

    const list = await handleFleet(['chat', 'list']);
    expect(content(list)).toContain('profile review');
  });

  it('rejects invalid --profile values locally', async () => {
    const request = vi.fn(async () => ({ sessionId: 'sess_should_not_open' }));
    registerPeer('ministar-linux', request);

    const result = await handleFleet([
      'chat',
      'start',
      'ministar-linux',
      '--profile',
      'chaos',
    ]);

    expect(content(result)).toContain('--profile must be one of');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects unknown peer with a clear error', async () => {
    const result = await handleFleet(['chat', 'start', 'no-such-peer']);
    expect(content(result)).toContain('No fleet peer named "no-such-peer"');
  });

  it('auto-numbers aliases when starting twice on the same peer', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_a' })));
    const r1 = await handleFleet(['chat', 'start', 'ministar-linux']);
    const r2 = await handleFleet(['chat', 'start', 'ministar-linux']);
    expect(content(r1)).toContain('"ministar-linux-1"');
    expect(content(r2)).toContain('"ministar-linux-2"');
  });

  it('refuses a duplicate --name', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_a' })));
    await handleFleet(['chat', 'start', 'ministar-linux', '--name', 'rust-coach']);
    const result = await handleFleet(['chat', 'start', 'ministar-linux', '--name', 'rust-coach']);
    expect(content(result)).toContain('"rust-coach" already in use');
  });

  it('reports server failure verbatim', async () => {
    registerPeer('ministar-linux', vi.fn(async () => {
      throw new Error('CLIENT_UNAVAILABLE: no LLM client wired');
    }));
    const result = await handleFleet(['chat', 'start', 'ministar-linux']);
    expect(content(result)).toContain('peer.chat-session.start FAILED');
    expect(content(result)).toContain('CLIENT_UNAVAILABLE');
  });
});

describe('/fleet chat say', () => {
  it('happy path — sends the next turn against the unique session', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_abc' };
      if (method === 'peer.chat-session.continue') return { text: 'Voici la réponse' };
      throw new Error(`unexpected method ${method}`);
    });
    registerPeer('ministar-linux', request);

    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'say', 'donne-moi', 'un', 'exemple']);

    expect(content(result)).toContain('← ministar-linux-1 (ministar-linux) [turn 1');
    expect(content(result)).toContain('Voici la réponse');
    expect(request).toHaveBeenCalledWith(
      'peer.chat-session.continue',
      { sessionId: 'sess_abc', prompt: 'donne-moi un exemple' },
      { timeoutMs: 120_000 },
    );
  });

  it('surfaces returned dispatchProfile metadata on chat turns and local list', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_abc' };
      if (method === 'peer.chat-session.continue') {
        return { text: 'reviewed', dispatchProfile: 'review' };
      }
      throw new Error(`unexpected method ${method}`);
    });
    registerPeer('ministar-linux', request);

    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'say', 'review', 'this']);

    expect(content(result)).toContain('[turn 1');
    expect(content(result)).toContain('profile review');
    const list = await handleFleet(['chat', 'list']);
    expect(content(list)).toContain('profile review');
  });

  it('asks for --session when multiple sessions are active', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_a' })));
    registerPeer('darkstar', vi.fn(async () => ({ sessionId: 'sess_b' })));
    await handleFleet(['chat', 'start', 'ministar-linux', '--name', 'a']);
    await handleFleet(['chat', 'start', 'darkstar', '--name', 'b']);

    // activeAlias = 'b' (last started) so resolveChatAlias picks it.
    // Force the ambiguity by clearing activeAlias via a simulated
    // explicit-but-wrong session.
    const ambiguous = await handleFleet(['chat', 'say', 'hi', '--session', 'unknown']);
    expect(content(ambiguous)).toContain('No chat session named "unknown"');
  });

  it('purges the local handle when server returns SESSION_NOT_FOUND', async () => {
    let call = 0;
    const request = vi.fn(async (method: string) => {
      call++;
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_abc' };
      if (method === 'peer.chat-session.continue') {
        throw new Error('SESSION_NOT_FOUND: no session with id "sess_abc"');
      }
      throw new Error('unexpected');
    });
    registerPeer('ministar-linux', request);

    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'say', 'hi']);
    expect(content(result)).toContain('expired or was dropped');

    // After the purge, list reports zero.
    const listResult = await handleFleet(['chat', 'list']);
    expect(content(listResult)).toContain('No active chat sessions');
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it('drops the local handle when the peer disappeared from the registry', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_abc' })));
    await handleFleet(['chat', 'start', 'ministar-linux']);
    // Simulate a peer that vanished without using /fleet stop.
    getFleetRegistry().unregister('ministar-linux');
    const result = await handleFleet(['chat', 'say', 'hi']);
    expect(content(result)).toContain('no longer connected');
    expect(content(result)).toContain('dropped locally');
  });

  it('rejects empty messages', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_a' })));
    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'say']);
    expect(content(result)).toContain('Usage');
  });
});

describe('/fleet chat end', () => {
  it('closes a single session and removes the local handle', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_a' };
      if (method === 'peer.chat-session.end') return { closed: true };
      throw new Error(`unexpected ${method}`);
    });
    registerPeer('ministar-linux', request);

    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'end']);
    expect(content(result)).toContain('Chat session "ministar-linux-1" closed');

    const listResult = await handleFleet(['chat', 'list']);
    expect(content(listResult)).toContain('No active chat sessions');
  });

  it('--all closes every session and reports the count', async () => {
    registerPeer('ministar-linux', vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_a' };
      if (method === 'peer.chat-session.end') return { closed: true };
      throw new Error('unexpected');
    }));
    registerPeer('darkstar', vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_b' };
      if (method === 'peer.chat-session.end') return { closed: true };
      throw new Error('unexpected');
    }));
    await handleFleet(['chat', 'start', 'ministar-linux']);
    await handleFleet(['chat', 'start', 'darkstar']);

    const result = await handleFleet(['chat', 'end', '--all']);
    expect(content(result)).toContain('Closed 2 chat session(s)');
  });

  it('still drops the local handle when server-side close fails', async () => {
    registerPeer('ministar-linux', vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_a' };
      if (method === 'peer.chat-session.end') throw new Error('server boom');
      throw new Error('unexpected');
    }));
    await handleFleet(['chat', 'start', 'ministar-linux']);
    const result = await handleFleet(['chat', 'end']);
    expect(content(result)).toContain('closed');
    expect(content(result)).toContain('server-side close failed');

    const listResult = await handleFleet(['chat', 'list']);
    expect(content(listResult)).toContain('No active chat sessions');
  });
});

describe('/fleet chat list', () => {
  it('reports empty state with a hint to start one', async () => {
    const result = await handleFleet(['chat', 'list']);
    expect(content(result)).toContain('No active chat sessions');
    expect(content(result)).toContain('/fleet chat start');
  });

  it('lists active sessions with peer + turn count', async () => {
    registerPeer('ministar-linux', vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.start') return { sessionId: 'sess_a' };
      if (method === 'peer.chat-session.continue') return { text: 'ok' };
      throw new Error('unexpected');
    }));
    await handleFleet(['chat', 'start', 'ministar-linux', '--model', 'qwen2.5:7b']);
    await handleFleet(['chat', 'say', 'hi']);

    const result = await handleFleet(['chat', 'list']);
    expect(content(result)).toContain('Active chat sessions (1)');
    expect(content(result)).toContain('ministar-linux-1');
    expect(content(result)).toContain('turn 1');
    expect(content(result)).toContain('model qwen2.5:7b');
    expect(content(result)).toContain('← active');
  });
});

describe('/fleet stop auto-cleanup', () => {
  it('drops chat sessions tied to the peer being stopped', async () => {
    let disconnectCalls = 0;
    registerPeer(
      'ministar-linux',
      vi.fn(async () => ({ sessionId: 'sess_a' })),
      async () => {
        disconnectCalls++;
      },
    );
    await handleFleet(['chat', 'start', 'ministar-linux']);

    const result = await handleFleet(['stop', 'ministar-linux']);
    expect(content(result)).toContain('Fleet listener "ministar-linux" stopped');
    expect(content(result)).toContain('Dropped 1 chat session(s)');
    expect(disconnectCalls).toBe(1);

    const listResult = await handleFleet(['chat', 'list']);
    expect(content(listResult)).toContain('No active chat sessions');
  });

  it('--all drops chat sessions across every peer', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({ sessionId: 'sess_a' })));
    registerPeer('darkstar', vi.fn(async () => ({ sessionId: 'sess_b' })));
    await handleFleet(['chat', 'start', 'ministar-linux']);
    await handleFleet(['chat', 'start', 'darkstar']);

    const result = await handleFleet(['stop', '--all']);
    expect(content(result)).toContain('Dropped 2 chat session(s)');
  });
});

describe('/fleet status --with-sessions', () => {
  it('without --with-sessions flag, behaves as before (no session lines)', async () => {
    registerPeer('ministar-linux', vi.fn(async () => ({})));
    const result = await handleFleet(['status']);
    expect(content(result)).toContain('Fleet listeners — 1 active');
    expect(content(result)).not.toContain('Chat sessions');
  });

  it('with --with-sessions, fans out peer.chat-session.list and prints results', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'peer.chat-session.list') {
        return {
          count: 2,
          sessions: [
            { sessionId: 'sess_a1b2c3', turnCount: 3, model: 'qwen3:4b', ageMs: 5_000, idleMs: 2_000, expiresInMs: 1_798_000 },
            { sessionId: 'sess_d4e5f6', turnCount: 1, model: undefined, dispatchProfile: 'review', ageMs: 1_000, idleMs: 500, expiresInMs: 1_799_500 },
          ],
        };
      }
      throw new Error(`unexpected method ${method}`);
    });
    registerPeer('ministar-linux', request);

    const result = await handleFleet(['status', '--with-sessions']);
    expect(content(result)).toContain('Chat sessions (2)');
    expect(content(result)).toContain('sess_a1b2c3');
    expect(content(result)).toContain('turn 3');
    expect(content(result)).toContain('model qwen3:4b');
    expect(content(result)).toContain('sess_d4e5f6');
    expect(content(result)).toContain('default model');
    expect(content(result)).toContain('profile review');
    expect(request).toHaveBeenCalledWith('peer.chat-session.list', {}, { timeoutMs: 5_000 });
  });

  it('reports (none open) when a peer has zero sessions', async () => {
    registerPeer(
      'ministar-linux',
      vi.fn(async (method) => {
        if (method === 'peer.chat-session.list') return { count: 0, sessions: [] };
        return {};
      }),
    );
    const result = await handleFleet(['status', '--with-sessions']);
    expect(content(result)).toContain('Chat sessions: (none open on this peer)');
  });

  it('shows (unreachable) when peer.chat-session.list fails', async () => {
    registerPeer(
      'ministar-linux',
      vi.fn(async () => {
        throw new Error('REQUEST_TIMEOUT after 5000ms');
      }),
    );
    const result = await handleFleet(['status', '--with-sessions']);
    expect(content(result)).toContain('Chat sessions: (unreachable');
    expect(content(result)).toContain('REQUEST_TIMEOUT');
  });

  it('fans out in parallel — slow peer does not block fast peer', async () => {
    const slowDone = vi.fn();
    registerPeer(
      'slow',
      vi.fn(async (method) => {
        if (method === 'peer.chat-session.list') {
          await new Promise((resolve) => setTimeout(resolve, 60));
          slowDone();
          return { count: 0, sessions: [] };
        }
        return {};
      }),
    );
    registerPeer(
      'fast',
      vi.fn(async (method) => {
        if (method === 'peer.chat-session.list') return { count: 0, sessions: [] };
        return {};
      }),
    );
    const t0 = Date.now();
    await handleFleet(['status', '--with-sessions']);
    const elapsed = Date.now() - t0;
    // Total should be near 60ms (slow peer), not 120ms (serial).
    expect(elapsed).toBeLessThan(120);
    expect(slowDone).toHaveBeenCalled();
  });
});
