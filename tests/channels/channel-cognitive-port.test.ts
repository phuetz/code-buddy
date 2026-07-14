import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketChannelCognitivePort } from '../../src/channels/channel-cognitive-port.js';
import type { CognitiveDraft } from '../../src/cognition/cognitive-wire-contract.js';

describe('WebSocketChannelCognitivePort', () => {
  const originalEnabled = process.env.CODEBUDDY_COGNITION_ENABLED;

  beforeEach(() => {
    process.env.CODEBUDDY_COGNITION_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.CODEBUDDY_COGNITION_ENABLED;
    else process.env.CODEBUDDY_COGNITION_ENABLED = originalEnabled;
  });

  function fakeClient() {
    const order: string[] = [];
    const context = {
      leaseId: '00000000-0000-4000-8000-000000000001',
      turnContext: 'Hypothèse interne.',
      evidence: 'Fait déterministe.',
      itemIds: ['workspace_test_1'],
      commit: vi.fn(async () => {
        order.push('commit');
      }),
      release: vi.fn(async () => {
        order.push('release');
      }),
    };
    const client = {
      isReady: true,
      on: vi.fn(),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      publish: vi.fn(async (draft: CognitiveDraft) => {
        const payload = draft.payload as { role: string };
        order.push(`publish:${payload.role}`);
        return {
          version: 1 as const,
          serverEpoch: '00000000-0000-4000-8000-000000000002',
          revision: order.length,
          replayed: false,
          item: {} as never,
        };
      }),
      acquireContext: vi.fn(async () => {
        order.push('acquire');
        return context;
      }),
      cancel: vi.fn(async () => {
        order.push('cancel');
        return true;
      }),
    };
    return { client, context, order };
  }

  it('uses the route privacy ceiling and commits the exact delivered reply', async () => {
    const { client, context, order } = fakeClient();
    const port = new WebSocketChannelCognitivePort(client);

    const turn = await port.begin({
      channelType: 'telegram',
      sessionKey: 'telegram:chat:42',
      messageId: 'update-7',
      content: 'Que vois-tu ?',
      egress: 'cloud',
    });
    expect(turn).not.toBeNull();
    expect(client.acquireContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrivacy: 'cloud-ok',
      })
    );

    order.push('delivered');
    await turn?.complete('Je vois un hamburger.');

    expect(order).toEqual(['publish:user', 'acquire', 'delivered', 'publish:assistant', 'commit']);
    const resultDraft = client.publish.mock.calls[1]?.[0];
    expect(resultDraft).toMatchObject({
      kind: 'result',
      payload: { content: 'Je vois un hamburger.', surface: 'telegram' },
    });
    expect(context.release).not.toHaveBeenCalled();
  });

  it('commits a visible partial prefix then cancels downstream cognition', async () => {
    const { client, context, order } = fakeClient();
    const port = new WebSocketChannelCognitivePort(client);
    const turn = await port.begin({
      channelType: 'telegram',
      sessionKey: 'telegram:chat:42',
      messageId: 'update-8',
      content: 'Explique en détail.',
      egress: 'local',
    });

    await turn?.complete('Préfixe réellement reçu.', { cancelAfter: true });

    expect(order).toEqual(['publish:user', 'acquire', 'publish:assistant', 'commit', 'cancel']);
    expect(context.release).not.toHaveBeenCalled();
    expect(client.acquireContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrivacy: 'local-only',
      })
    );
  });

  it('releases then cancels on generation or transport failure', async () => {
    const { client, context, order } = fakeClient();
    const port = new WebSocketChannelCognitivePort(client);
    const turn = await port.begin({
      channelType: 'telegram',
      sessionKey: 'telegram:chat:42',
      messageId: 'update-9',
      content: 'Bonjour.',
      egress: 'cloud',
    });

    await Promise.all([turn?.fail(), turn?.cancel(), turn?.fail()]);

    expect(order).toEqual(['publish:user', 'acquire', 'release', 'cancel']);
    expect(context.commit).not.toHaveBeenCalled();
  });
});
