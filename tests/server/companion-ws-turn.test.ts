/**
 * The mobile PWA companion turn must be the SAME path as the channels one.
 *
 * Observed on the phone (2026-09-06): the selfie arrived, then « Encore une ? »
 * answered « Oui, je suis là. Comment puis-je t'aider aujourd'hui ? » — the
 * voice loop's fastest-model reply, with no history and an assistant tone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'CODEBUDDY_COMPANION_PERSONA',
  'CODEBUDDY_CHANNEL_PROFILE',
  'CODEBUDDY_LISA_SELFIE',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe('produceCompanionReply — single companion path', () => {
  it('goes through runCompanionTurn, never through the voice defaultReply', async () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const { produceCompanionReply } = await import('../../src/server/websocket/handler.js');
    const companionTurn = await import('../../src/companion/companion-turn.js');
    const voice = await import('../../src/sensory/voice-loop.js');
    const turnSpy = vi
      .spyOn(companionTurn, 'runCompanionTurn')
      .mockResolvedValue({ text: 'Coucou toi.', kind: 'text' });
    const voiceSpy = vi.spyOn(voice, 'defaultReply').mockResolvedValue('voice path');

    const reply = await produceCompanionReply('Coucou');

    expect(voiceSpy).not.toHaveBeenCalled();
    expect(turnSpy).toHaveBeenCalledTimes(1);
    expect(turnSpy.mock.calls[0]?.[0]).toBe('Coucou');
    expect(turnSpy.mock.calls[0]?.[1]).toMatchObject({ surface: 'mobile', includeImageBytes: true });
    expect(reply).toBe('Coucou toi.');
  });

  it('forwards a served selfie with its image bytes', async () => {
    process.env.CODEBUDDY_COMPANION_PERSONA = 'copine';
    const { produceCompanionReply } = await import('../../src/server/websocket/handler.js');
    const companionTurn = await import('../../src/companion/companion-turn.js');
    vi.spyOn(companionTurn, 'runCompanionTurn').mockResolvedValue({
      text: 'Hop. Photo de moi.',
      kind: 'selfie',
      image: { mimeType: 'image/png', data: 'AAAA' },
    });

    const reply = await produceCompanionReply('envoie-moi une photo de toi');

    expect(reply).toEqual({
      text: 'Hop. Photo de moi.',
      image: { mimeType: 'image/png', data: 'AAAA' },
      kind: 'selfie',
    });
  });
});
