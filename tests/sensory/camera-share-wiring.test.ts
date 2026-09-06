import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cameraShare = vi.hoisted(() => ({
  maybeHandleCameraShareRequest: vi.fn(),
}));

vi.mock('../../src/companion/camera-share.js', () => cameraShare);
vi.mock('../../src/companion/lisa-selfie.js', () => ({
  maybeHandleLisaSelfieRequest: vi.fn(async () => null),
}));

import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { defaultReply } from '../../src/sensory/voice-loop.js';

describe('camera-share default wiring', () => {
  const previousSelfie = process.env.CODEBUDDY_LISA_SELFIE;

  beforeEach(() => {
    process.env.CODEBUDDY_LISA_SELFIE = 'false';
    cameraShare.maybeHandleCameraShareRequest.mockReset();
    cameraShare.maybeHandleCameraShareRequest.mockResolvedValue({
      success: true,
      telegramSent: false,
      spokenReply: 'Un bureau avec un écran allumé.',
      description: 'Un bureau avec un écran allumé.',
    });
  });

  afterEach(() => {
    if (previousSelfie === undefined) delete process.env.CODEBUDDY_LISA_SELFIE;
    else process.env.CODEBUDDY_LISA_SELFIE = previousSelfie;
  });

  it('defaultReply uses maybeHandleCameraShareRequest without an injected hook', async () => {
    const spoken = await defaultReply("qu'est-ce que tu vois ?");
    expect(cameraShare.maybeHandleCameraShareRequest).toHaveBeenCalledOnce();
    expect(cameraShare.maybeHandleCameraShareRequest.mock.calls[0]?.[1]).toMatchObject({
      surface: 'voice',
    });
    expect(spoken).toBe('Un bureau avec un écran allumé.');
  });

  it('makeHybridReply uses maybeHandleCameraShareRequest without an injected hook', async () => {
    const reply = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      classify: () => false,
      chitchat: async () => 'chitchat must not run',
      agentReply: async () => 'agent must not run',
    });
    const spoken = await reply("qu'est-ce que tu vois ?");
    expect(cameraShare.maybeHandleCameraShareRequest).toHaveBeenCalledOnce();
    expect(cameraShare.maybeHandleCameraShareRequest.mock.calls[0]?.[1]).toMatchObject({
      surface: 'voice',
    });
    expect(spoken).toBe('Un bureau avec un écran allumé.');
  });
});
