import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';
import {
  exceedsVoiceLeakageMargin,
  resolveVoiceBargeInMarginDb,
  wireSpeechReaction,
} from '../../src/sensory/speech-reaction.js';
import {
  _resetVoiceActivityForTests,
  endSpeaking,
} from '../../src/sensory/voice-activity.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function emitPerception(kind: string, payload: Record<string, unknown>): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'conv2-adaptive-test',
    metadata: { modality: 'audio', kind, payload },
  });
}

function speechStart(payload: Record<string, unknown>): void {
  emitPerception('speech_start', payload);
}

function transcriptFinal(text: string): void {
  emitPerception('transcript_final', {
    text,
    audioMs: 700,
    aecActive: true,
    turnDetector: 'smart-turn-v3.2',
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2_000, interval: 5 });
}

describe('CONV2 — adaptive leakage reference', () => {
  let previousBargeIn: string | undefined;
  let previousMargin: string | undefined;

  beforeEach(() => {
    previousBargeIn = process.env.CODEBUDDY_SENSORY_BARGE_IN;
    previousMargin = process.env.CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB;
    process.env.CODEBUDDY_SENSORY_BARGE_IN = 'true';
    process.env.CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB = '6';
    _resetVoiceActivityForTests();
  });

  afterEach(() => {
    if (previousBargeIn === undefined) delete process.env.CODEBUDDY_SENSORY_BARGE_IN;
    else process.env.CODEBUDDY_SENSORY_BARGE_IN = previousBargeIn;
    if (previousMargin === undefined) delete process.env.CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB;
    else process.env.CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB = previousMargin;
    _resetVoiceActivityForTests();
  });

  it('keeps simulated leakage below 6 dB and cuts on speech above the adaptive reference', async () => {
    const root = process.cwd();
    let stoppedAt = 0;
    let playbackStartedAt = 0;
    let handlerStarted = false;
    let release!: () => void;
    const streamSpeak = Object.assign(
      async (_text: string, options?: { signal?: AbortSignal }): Promise<boolean> => {
        playbackStartedAt = Date.now();
        await new Promise<void>((resolve) => {
          release = resolve;
          options?.signal?.addEventListener('abort', () => {
            stoppedAt = performance.now();
            resolve();
          }, { once: true });
        });
        return false;
      },
      { prefetch: vi.fn() },
    );
    const voiceReply = makeVoiceReply({
      streamFn: async function* () {
        yield 'Réponse avec plusieurs phrases. Suite utile.';
      },
      streamSpeak,
      avatarEnabled: false,
    });
    const unwire = wireSpeechReaction({
      cwd: root,
      debounceMs: 0,
      env: process.env,
      onHeard: async (text, context) => {
        handlerStarted = true;
        await voiceReply(text, context);
      },
      onBargeInStart: (_payload, turnId) => voiceReply.interrupt(turnId),
    });
    try {
      transcriptFinal('Lisa, réponds-moi');
      await waitFor(() => expect(handlerStarted).toBe(true));
      await waitFor(() => expect(playbackStartedAt).toBeGreaterThan(0));

      speechStart({
        startedAtMs: playbackStartedAt + 100,
        rms: 0.015,
        noiseFloorRms: 0.01,
        aecActive: true,
      });
      speechStart({ startedAtMs: playbackStartedAt + 400, rms: 0.015, aecActive: true });
      await vi.waitFor(() => expect(stoppedAt).toBe(0), { timeout: 50, interval: 5 });

      speechStart({ startedAtMs: playbackStartedAt + 500, rms: 0.035, aecActive: true });
      await waitFor(() => expect(stoppedAt).toBeGreaterThan(0));
      expect(exceedsVoiceLeakageMargin(0.015, 0.01, 6)).toBe(false);
      expect(exceedsVoiceLeakageMargin(0.035, 0.01, 6)).toBe(true);
      expect(exceedsVoiceLeakageMargin(0.025, 0.015, 6)).toBe(false);
      expect(resolveVoiceBargeInMarginDb({ CODEBUDDY_SENSORY_BARGE_IN_MARGIN_DB: '9' })).toBe(9);
    } finally {
      release?.();
      unwire();
      endSpeaking(Date.now());
    }
  });

  it('cuts a high-energy speech_start immediately when the calibrated VAD floor is available', async () => {
    let playbackStartedAt = 0;
    let stoppedAt = 0;
    let handlerStarted = false;
    let release!: () => void;
    const streamSpeak = async (_text: string, options?: { signal?: AbortSignal }): Promise<boolean> => {
      playbackStartedAt = Date.now();
      await new Promise<void>((resolve) => {
        release = resolve;
        options?.signal?.addEventListener('abort', () => {
          stoppedAt = performance.now();
          resolve();
        }, { once: true });
      });
      return false;
    };
    const voiceReply = makeVoiceReply({
      streamFn: async function* () {
        yield 'Réponse en cours.';
      },
      streamSpeak,
      avatarEnabled: false,
    });
    const unwire = wireSpeechReaction({
      cwd: process.cwd(),
      debounceMs: 0,
      env: process.env,
      onHeard: async (text, context) => {
        handlerStarted = true;
        await voiceReply(text, context);
      },
      onBargeInStart: (_payload, turnId) => voiceReply.interrupt(turnId),
    });
    try {
      transcriptFinal('Lisa, je parle vraiment');
      await waitFor(() => expect(handlerStarted).toBe(true));
      await waitFor(() => expect(playbackStartedAt).toBeGreaterThan(0));
      speechStart({
        startedAtMs: playbackStartedAt + 100,
        rms: 0.03,
        noiseFloorRms: 0.01,
        aecActive: true,
      });
      await waitFor(() => expect(stoppedAt).toBeGreaterThan(0));
    } finally {
      release?.();
      unwire();
      endSpeaking(Date.now());
    }
  });
});
