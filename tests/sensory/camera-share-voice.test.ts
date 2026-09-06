import { describe, expect, it, vi } from 'vitest';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';
import type { CameraShareResult } from '../../src/companion/camera-share.js';

function share(overrides: Partial<CameraShareResult> = {}): CameraShareResult {
  return {
    success: true,
    telegramSent: false,
    spokenReply: 'Un bureau avec un écran allumé.',
    description: 'Un bureau avec un écran allumé.',
    ...overrides,
  };
}

describe('voix — « qu’est-ce que tu vois ? » (caméra à la demande)', () => {
  it('décrit localement sans envoyer de photo ni passer par le grounding d’objet', async () => {
    const cameraShare = vi.fn(async () => share());
    const visualGrounding = vi.fn();
    const replyFn = vi.fn(async () => 'mauvaise branche');
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      cameraShare,
      visualGrounding,
      streamFn: async function* () {
        yield 'mauvaise branche';
      },
      replyFn,
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/camera-share-voice.wav';
      },
      play: async () => {},
    });

    await onHeard("qu'est-ce que tu vois ?");

    expect(cameraShare).toHaveBeenCalledOnce();
    expect(cameraShare.mock.calls[0]?.[0]).toMatch(/vois/i);
    expect(cameraShare.mock.calls[0]?.[1]).toMatchObject({ surface: 'voice' });
    expect(visualGrounding).not.toHaveBeenCalled();
    expect(replyFn).not.toHaveBeenCalled();
    expect(spoken).toEqual(['Un bureau avec un écran allumé.']);
  });

  it('traite « regarde » comme un regard de scène, pas une demande de confirmation', async () => {
    const cameraShare = vi.fn(async () => share({ spokenReply: 'La pièce est calme.' }));
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      cameraShare,
      visualGrounding: async () => {
        throw new Error('visual grounding must not run');
      },
      replyFn: async () => 'mauvaise branche',
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/camera-share-regarde.wav';
      },
      play: async () => {},
    });

    await onHeard('regarde');

    expect(cameraShare).toHaveBeenCalledOnce();
    expect(spoken[0]).toBe('La pièce est calme.');
    expect(spoken[0]).not.toContain("Tu veux que j'ouvre la caméra");
  });

  it('n’envoie la photo que si la voix le demande explicitement', async () => {
    const cameraShare = vi.fn(async (heard: string) => {
      const send = /telegram/i.test(heard);
      return share({
        telegramSent: send,
        spokenReply: send ? "La cuisine. Je te l'envoie sur Telegram." : 'La cuisine.',
      });
    });
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      cameraShare,
      replyFn: async () => 'mauvaise branche',
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/camera-share-send.wav';
      },
      play: async () => {},
    });

    await onHeard('montre-moi la caméra');
    await onHeard('regarde et envoie-la sur Telegram');

    expect(cameraShare).toHaveBeenCalledTimes(2);
    expect(spoken[0]).toBe('La cuisine.');
    expect(spoken[1]).toContain('Telegram');
  });

  it('laisse le hamburger et le tournevis au grounding visuel existant', async () => {
    const cameraShare = vi.fn(async () => null);
    const visualGrounding = vi.fn(async (heard: string) => ({
      matched: true as const,
      status: 'analyzed' as const,
      response: `vu:${heard}`,
    }));
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      cameraShare,
      visualGrounding,
      streamFn: async function* () {
        yield 'mauvaise branche';
      },
      replyFn: async () => 'mauvaise branche',
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/camera-share-leave.wav';
      },
      play: async () => {},
    });

    await onHeard("tu vois le hamburger que j'ai préparé");
    expect(visualGrounding).toHaveBeenCalledOnce();
    expect(spoken[0]).toContain('hamburger');

    await onHeard('regarde mon tournevis');
    expect(spoken[1]).toContain("Tu veux que j'ouvre la caméra");
    expect(visualGrounding).toHaveBeenCalledOnce();
  });

  it('dit honnêtement quand la caméra factice n’a pas d’image', async () => {
    const spoken: string[] = [];
    const onHeard = makeVoiceReply({
      cameraShare: async () =>
        share({
          success: false,
          spokenReply: "Je n'ai pas d'image en ce moment.",
        }),
      replyFn: async () => 'mauvaise branche',
      synth: async (text) => {
        spoken.push(text);
        return '/tmp/camera-share-none.wav';
      },
      play: async () => {},
    });

    await onHeard("qu'est-ce que tu vois ?");
    expect(spoken[0]?.toLowerCase()).toContain("je n'ai pas d'image en ce moment");
  });
});
