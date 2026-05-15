import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/remote/remote-config-store', () => ({
  remoteConfigStore: {
    getAll: () => ({ gateway: { enabled: false }, channels: {} }),
    isEnabled: () => false,
    getPairedUsers: () => [],
  },
}));

import { RemoteManager } from '../src/main/remote/remote-manager';

type TestRemoteManager = RemoteManager & {
  gateway: { sendResponse: ReturnType<typeof vi.fn> };
  sessionIdMapping: Map<string, string>;
  sessionChannelMapping: Map<string, { channelType: 'feishu'; channelId: string }>;
};

describe('RemoteManager question interactions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on question timeout instead of a fake empty answer', async () => {
    vi.useFakeTimers();
    const manager = new RemoteManager() as TestRemoteManager;
    manager.gateway = { sendResponse: vi.fn().mockResolvedValue(undefined) };
    manager.sessionIdMapping.set('actual-session', 'remote-session');
    manager.sessionChannelMapping.set('remote-session', {
      channelType: 'feishu',
      channelId: 'channel-1',
    });

    const answerPromise = manager.handleQuestionRequest(
      'actual-session',
      'remote-session',
      [{ question: 'Proceed?' }],
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getPendingInteractionsCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    await expect(answerPromise).resolves.toBeNull();
    expect(manager.getPendingInteractionsCount()).toBe(0);
  });
});
