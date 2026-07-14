import { describe, expect, it, vi } from 'vitest';
import {
  InProcessCoworkCognition,
  resolveCoworkModelEgress,
} from '../src/main/companion/cognitive-context';

describe('Cowork cognitive context adapter', () => {
  it('acquires after the user publication and commits only after the delivered result', async () => {
    const order: string[] = [];
    const context = {
      leaseId: 'lease-1',
      turnContext: 'Tentative hypothesis',
      evidence: 'Deterministic evidence',
      itemIds: ['workspace_1'],
      commit: vi.fn(async () => {
        order.push('commit');
      }),
      release: vi.fn(async () => {
        order.push('release');
      }),
    };
    const port = {
      publish: vi.fn(async (draft: Record<string, unknown>) => {
        const payload = draft.payload as { role?: string };
        order.push(`publish:${payload.role}`);
        return { replayed: false, revision: order.length };
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
    const adapter = new InProcessCoworkCognition(() => port);

    const turn = await adapter.begin({
      sessionId: 'lisa-session',
      messageId: 'message-1',
      query: 'Que vois-tu ?',
      egress: 'cloud',
    });
    expect(turn).not.toBeNull();
    expect(port.acquireContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrivacy: 'cloud-ok',
      })
    );
    expect(order).toEqual(['publish:user', 'acquire']);

    order.push('saved');
    await turn?.complete('Je vois une tasse rouge.');
    expect(order).toEqual(['publish:user', 'acquire', 'saved', 'publish:assistant', 'commit']);
    expect(context.release).not.toHaveBeenCalled();
  });

  it('releases and cancels exactly once when a turn fails or is interrupted', async () => {
    const context = {
      leaseId: 'lease-2',
      turnContext: '',
      evidence: '',
      itemIds: [],
      commit: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const port = {
      publish: vi.fn(async () => ({ replayed: false, revision: 1 })),
      acquireContext: vi.fn(async () => context),
      cancel: vi.fn(async () => true),
    };
    const adapter = new InProcessCoworkCognition(() => port);
    const turn = await adapter.begin({
      sessionId: 'lisa-session',
      messageId: 'message-2',
      query: 'Continue.',
      egress: 'local',
    });

    await Promise.all([turn?.fail(), turn?.cancel(), turn?.fail()]);

    expect(context.release).toHaveBeenCalledTimes(1);
    expect(context.commit).not.toHaveBeenCalled();
    expect(port.cancel).toHaveBeenCalledTimes(1);
    expect(port.acquireContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPrivacy: 'local-only',
      })
    );
  });

  it('fails closed for unknown and subscription-CLI destinations', () => {
    expect(resolveCoworkModelEgress(undefined, 'local://gemini-cli')).toBe('cloud');
    expect(resolveCoworkModelEgress('cloud', 'http://127.0.0.1:9999')).toBe('cloud');
    expect(resolveCoworkModelEgress(undefined, 'http://127.0.0.1:11434')).toBe('local');
    expect(resolveCoworkModelEgress(undefined, 'http://darkstar.local:11434')).toBe('cloud');
  });

  it('is fail-soft when no central cognitive authority is running', async () => {
    const adapter = new InProcessCoworkCognition(() => null);
    await expect(
      adapter.begin({
        sessionId: 'session',
        messageId: 'message',
        query: 'Bonjour',
        egress: 'cloud',
      })
    ).resolves.toBeNull();
  });
});
