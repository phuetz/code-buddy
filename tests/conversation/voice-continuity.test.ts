import { describe, expect, it, vi } from 'vitest';

import {
  CrossChannelConversationBridge,
  type CrossChannelBridgeConfig,
} from '../../src/conversation/cross-channel-bridge.js';
import {
  createCanonicalVoiceReplySpeaker,
  recordDeliveredChannelInitiative,
  speakCanonicalVoiceInitiative,
} from '../../src/conversation/voice-continuity.js';

function config(): CrossChannelBridgeConfig {
  return {
    enabled: true,
    companionName: 'Lisa',
    conversationId: 'voice-continuity-test',
    target: { channel: 'telegram', channelId: '42' },
    mirrorVoice: true,
    coworkEnabled: true,
    mirrorCowork: true,
    coworkHistoryTurns: 24,
    persist: false,
    historyPath: '/tmp/codebuddy-voice-continuity-test.jsonl',
    maxEvents: 20,
  };
}

describe('canonical voice continuity helpers', () => {
  it('records one user turn and every deterministic spoken reply', async () => {
    const deliver = vi.fn(async () => true);
    const speak = vi.fn(async () => undefined);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });
    const reply = createCanonicalVoiceReplySpeaker('Crée un rappel.', speak, bridge);

    await reply("C'est noté.");
    await reply('Tu pourras dire annule pour le retirer.');
    await bridge.flush();

    expect(bridge.history()).toEqual([
      { role: 'user', content: 'Crée un rappel.' },
      { role: 'assistant', content: "C'est noté." },
      { role: 'assistant', content: 'Tu pourras dire annule pour le retirer.' },
    ]);
    expect(speak.mock.calls).toEqual([
      ["C'est noté."],
      ['Tu pourras dire annule pour le retirer.'],
    ]);
    expect(deliver).toHaveBeenCalledTimes(3);
  });

  it('records a local initiative as one mirrored assistant turn', async () => {
    const deliver = vi.fn(async () => true);
    const speak = vi.fn(async () => undefined);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    await speakCanonicalVoiceInitiative('Bonjour, contente de te revoir.', speak, bridge);
    await bridge.flush();

    expect(bridge.snapshot()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        origin: 'voice',
        content: 'Bonjour, contente de te revoir.',
      }),
    ]);
    expect(speak).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('sanitizes canonical speech before speaking, mirroring, and journaling it', async () => {
    const deliver = vi.fn(async () => true);
    const speak = vi.fn(async () => undefined);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    await speakCanonicalVoiceInitiative(
      '<think>secret</think> Bonjour​ Patrice.',
      speak,
      bridge,
    );
    await bridge.flush();

    expect(speak).toHaveBeenCalledWith('Bonjour Patrice.');
    expect(bridge.history()).toEqual([
      { role: 'assistant', content: 'Bonjour Patrice.' },
    ]);
    expect(String(deliver.mock.calls[0]?.[1])).toContain('Bonjour Patrice.');
    expect(String(deliver.mock.calls[0]?.[1])).not.toContain('secret');
  });

  it('does not journal a local initiative when the speaker reports failure (jumeau D8)', async () => {
    const deliver = vi.fn(async () => true);
    const speak = vi.fn(async () => false);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    await speakCanonicalVoiceInitiative('Bonjour, contente de te revoir.', speak, bridge);
    await bridge.flush();

    expect(speak).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();
    expect(bridge.history()).toEqual([]);
  });

  it('stays silent when a canonical initiative contains no speakable content', async () => {
    const deliver = vi.fn(async () => true);
    const speak = vi.fn(async () => undefined);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    await speakCanonicalVoiceInitiative('<think>secret</think>', speak, bridge);

    expect(speak).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(bridge.history()).toEqual([]);
  });

  it('does not hold the local mouth while Telegram delivery is slow', async () => {
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => (releaseDelivery = resolve));
    let deliveryStarted = false;
    const deliver = vi.fn(async () => {
      deliveryStarted = true;
      await deliveryGate;
      return true;
    });
    const speak = vi.fn(async () => undefined);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });
    const reply = createCanonicalVoiceReplySpeaker('Crée un rappel.', speak, bridge);

    await reply("C'est noté.");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(speak).toHaveBeenCalledOnce();
    expect(deliveryStarted).toBe(true);

    releaseDelivery();
    await bridge.flush();
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('appends an already-delivered remote initiative without echo', async () => {
    const deliver = vi.fn(async () => true);
    const bridge = new CrossChannelConversationBridge(config(), { deliver });

    expect(
      await recordDeliveredChannelInitiative(
        'Je pensais à notre discussion.',
        'remote-proactive-1',
        bridge,
      ),
    ).toBe(true);

    expect(bridge.snapshot()).toEqual([
      expect.objectContaining({
        role: 'assistant',
        origin: 'channel',
        content: 'Je pensais à notre discussion.',
        externalId: 'remote-proactive-1',
      }),
    ]);
    expect(deliver).not.toHaveBeenCalled();
  });
});
