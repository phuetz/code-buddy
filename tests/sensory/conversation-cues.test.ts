import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  BACKCHANNEL_GAIN_DB,
  BACKCHANNEL_START_DELAY_MS,
  REPAIR_PROMPT,
  createConversationCueController,
  type ConversationCueRequest,
} from '../../src/sensory/conversation-cues.js';
import { normalizePcm16Wav, probePcm16Wav } from '../../src/voice/tts-volume.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('conversation cues — sensory backchannel', () => {
  it('starts a local attenuated cue before 200 ms and never on adjacent addressed turns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const played: Array<ConversationCueRequest & { atMs: number }> = [];
    const controller = createConversationCueController({
      env: { CODEBUDDY_SENSORY_BACKCHANNEL: 'true' },
      now: () => Date.now(),
      player: async (cue) => {
        played.push({ ...cue, atMs: Date.now() });
        return true;
      },
    });

    controller.armBackchannel('turn-1');
    await vi.advanceTimersByTimeAsync(BACKCHANNEL_START_DELAY_MS);
    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({
      kind: 'backchannel',
      cue: 'mhm',
      gainDb: BACKCHANNEL_GAIN_DB,
      atMs: BACKCHANNEL_START_DELAY_MS,
    });
    expect(played[0]!.assetPath).toMatch(/assets\/voice\/conversation\/mhm\.wav$/);
    expect(played[0]!.atMs).toBeLessThan(200);

    controller.armBackchannel('turn-2');
    await vi.advanceTimersByTimeAsync(200);
    expect(played).toHaveLength(1);

    controller.armBackchannel('turn-3');
    await vi.advanceTimersByTimeAsync(BACKCHANNEL_START_DELAY_MS);
    expect(played).toHaveLength(2);
    expect(played[1]).toMatchObject({ cue: 'oui', turnId: 'turn-3' });
  });

  it('cancels the pending cue when response audio arrives first', async () => {
    vi.useFakeTimers();
    const player = vi.fn(async () => true);
    const controller = createConversationCueController({
      env: { CODEBUDDY_SENSORY_BACKCHANNEL: 'true' },
      player,
    });

    const pending = controller.armBackchannel('turn-fast');
    await vi.advanceTimersByTimeAsync(50);
    pending?.cancel();
    await vi.advanceTimersByTimeAsync(200);

    expect(player).not.toHaveBeenCalled();
  });

  it('is inert without the opt-in variable', async () => {
    vi.useFakeTimers();
    const player = vi.fn(async () => true);
    const controller = createConversationCueController({ env: {}, player });

    expect(controller.armBackchannel('turn-off')).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(player).not.toHaveBeenCalled();
  });

  it('plays the local repair prompt immediately and at most once per turn', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const played: Array<ConversationCueRequest & { atMs: number }> = [];
    const controller = createConversationCueController({
      env: { CODEBUDDY_SENSORY_REPAIR: 'true' },
      player: async (cue) => {
        played.push({ ...cue, atMs: Date.now() });
        return true;
      },
    });

    await controller.playRepair('turn-repair');
    await controller.playRepair('turn-repair');

    expect(played).toHaveLength(1);
    expect(played[0]).toMatchObject({
      kind: 'repair',
      cue: 'repair',
      turnId: 'turn-repair',
      text: REPAIR_PROMPT,
      atMs: 1_000,
    });
    expect(played[0]!.assetPath).toMatch(/assets\/voice\/conversation\/repair\.wav$/);
  });

  it('ships canonical PCM16 assets and can attenuate backchannels by 12 dB', async () => {
    const asset = (file: string): string => fileURLToPath(
      new URL(`../../assets/voice/conversation/${file}`, import.meta.url),
    );
    const [mhm, oui, repair] = await Promise.all([
      readFile(asset('mhm.wav')),
      readFile(asset('oui.wav')),
      readFile(asset('repair.wav')),
    ]);

    for (const wav of [mhm, oui, repair]) {
      expect(probePcm16Wav(wav).status).toBe('ready');
    }
    const attenuated = normalizePcm16Wav(mhm, {}, 10 ** (BACKCHANNEL_GAIN_DB / 20));
    expect(attenuated.equals(mhm)).toBe(false);
  });
});
