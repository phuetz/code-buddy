import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKCHANNEL_GAIN_DB,
  BACKCHANNEL_START_DELAY_MS,
  createConversationCueController,
  type ConversationCueRequest,
} from '../../src/sensory/conversation-cues.js';

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
});
