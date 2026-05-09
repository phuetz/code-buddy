/**
 * Phase 9 — verify CodeBuddyEngineAdapter caps the cached
 * `CodeBuddyAgent` registry at MAX_CACHED_SESSIONS using LRU
 * eviction, matching the pi runner's behavior.
 *
 * Prevents memory leaks on long-running Cowork sessions (each user
 * session previously created a permanent agent instance).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

let constructorCalls: string[] = [];
let disposed: string[] = [];

class FakeCodeBuddyAgent {
  constructor(public _apiKey: string, public _baseURL?: string, public _model?: string) {
    constructorCalls.push('new');
  }
  addToHistory() {}
  async *processUserMessageStream() {
    yield { type: 'done' };
  }
  dispose() {
    disposed.push('disposed');
  }
}

vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: FakeCodeBuddyAgent,
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/codebuddy/tools.js', () => ({
  getMCPManager: () => ({ addServer: vi.fn(), removeServer: vi.fn() }),
}));

import { CodeBuddyEngineAdapter } from '../../src/desktop/codebuddy-engine-adapter';

const cap = CodeBuddyEngineAdapter.MAX_CACHED_SESSIONS;

async function runOne(adapter: CodeBuddyEngineAdapter, sessionId: string): Promise<void> {
  await adapter.runSession(
    sessionId,
    [{ role: 'user', content: 'hi' }],
    () => undefined,
  );
}

describe('CodeBuddyEngineAdapter — LRU eviction (Phase 9)', () => {
  beforeEach(() => {
    constructorCalls = [];
    disposed = [];
  });

  it(`exposes the same MAX_CACHED_SESSIONS cap (${cap}) as pi`, () => {
    expect(cap).toBe(50);
  });

  it('keeps every session up to the cap with no eviction', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    for (let i = 0; i < cap; i++) {
      await runOne(adapter, `sess-${i}`);
    }
    expect(disposed).toHaveLength(0);
    expect(constructorCalls).toHaveLength(cap);
  });

  it('evicts the least-recently-used session when the cap is exceeded', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    for (let i = 0; i < cap; i++) {
      await runOne(adapter, `sess-${i}`);
    }
    // One more session pushes us over the cap → evict oldest.
    await runOne(adapter, 'sess-extra');
    expect(disposed).toHaveLength(1);
  });

  it('refreshes LRU position on access (touched session is not evicted first)', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    for (let i = 0; i < cap; i++) {
      await runOne(adapter, `sess-${i}`);
    }
    // Touch sess-0 — should now be the most-recently-used.
    await runOne(adapter, 'sess-0');
    // Add one more new session → should evict sess-1 (now the actual oldest).
    await runOne(adapter, 'sess-new');

    expect(disposed).toHaveLength(1);
    // We can verify by trying to runSession on sess-1 (which would
    // increment constructorCalls if it had been evicted).
    const callsBefore = constructorCalls.length;
    await runOne(adapter, 'sess-1');
    expect(constructorCalls.length).toBe(callsBefore + 1); // sess-1 reconstructed → was evicted

    // sess-0 should still be cached → no new construction.
    const callsBefore2 = constructorCalls.length;
    await runOne(adapter, 'sess-0');
    expect(constructorCalls.length).toBe(callsBefore2); // sess-0 reused
  });

  it('disposes evicted agents (memory cleanup)', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    // Stuff the cache then add 5 more sessions — 5 evictions expected.
    for (let i = 0; i < cap + 5; i++) {
      await runOne(adapter, `s-${i}`);
    }
    expect(disposed).toHaveLength(5);
  });

  it('clearSession does not count toward eviction', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    await runOne(adapter, 'a');
    adapter.clearSession('a');
    expect(disposed).toHaveLength(1); // disposed by clearSession
    // Cache is now empty → no implicit eviction issues.
    await runOne(adapter, 'b');
    expect(disposed).toHaveLength(1); // still 1
  });

  it('global dispose() clears cache and disposes every agent', async () => {
    const adapter = new CodeBuddyEngineAdapter({ apiKey: 'k', model: 'm' });
    await runOne(adapter, 's1');
    await runOne(adapter, 's2');
    await runOne(adapter, 's3');
    adapter.dispose();
    expect(disposed).toHaveLength(3);
  });
});
