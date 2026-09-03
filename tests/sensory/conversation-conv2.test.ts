import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { makeVoiceReply } from '../../src/sensory/voice-loop.js';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import {
  _resetVoiceActivityForTests,
  beginSpeaking,
  endSpeaking,
} from '../../src/sensory/voice-activity.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function emitPerception(kind: string, payload: Record<string, unknown>): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'conv2-test',
    metadata: { modality: 'audio', kind, payload },
  });
}

function speechStart(payload: Record<string, unknown>): void {
  emitPerception('speech_start', payload);
}

function transcriptFinal(text: string, payload: Record<string, unknown> = {}): void {
  emitPerception('transcript_final', {
    text,
    audioMs: 700,
    aecActive: true,
    turnDetector: 'smart-turn-v3.2',
    ...payload,
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2_000, interval: 5 });
}

describe('CONV2 — speech_start barge-in', () => {
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

  it('stops a fake streamed player within 150ms on a sustained speech_start', async () => {
    const root = process.cwd();
    let firstAudioAt = 0;
    let stoppedAt = 0;
    let playbackStartedAt = 0;
    let handlerStarted = 0;
    let streamCalled = 0;
    let prefetchCancelled = false;
    const streamSpeak = Object.assign(
      async (_text: string, options?: { signal?: AbortSignal }): Promise<boolean> => {
        firstAudioAt = performance.now();
        playbackStartedAt = Date.now();
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', () => {
            stoppedAt = performance.now();
            resolve();
          }, { once: true });
        });
        return false;
      },
      {
        prefetch: (_text: string, options?: { signal?: AbortSignal }): void => {
          options?.signal?.addEventListener('abort', () => {
            prefetchCancelled = true;
          }, { once: true });
        },
      },
    );
    const voiceReply = makeVoiceReply({
      streamFn: async function* () {
        streamCalled += 1;
        yield 'Première phrase. Deuxième phrase.';
      },
      streamSpeak,
      synth: async () => 'unused.wav',
      play: async () => undefined,
      cameraShare: async () => null,
      visualGrounding: async () => ({ status: 'unavailable', response: '' }),
      avatarEnabled: false,
    });
    const unwire = wireSpeechReaction({
      cwd: root,
      debounceMs: 0,
      env: process.env,
      onHeard: async (text, context) => {
        handlerStarted += 1;
        await voiceReply(text, context);
      },
      onBargeInStart: (_payload, turnId) => voiceReply.interrupt(turnId),
    });
    try {
      transcriptFinal('Lisa, parle-moi');
      await waitFor(() => expect(handlerStarted).toBe(1));
      await waitFor(() => expect(streamCalled).toBe(1));
      await waitFor(() => expect(firstAudioAt).toBeGreaterThan(0));

      const speechStartAt = performance.now();
      speechStart({
        startedAtMs: playbackStartedAt + 400,
        durationMs: 300,
        rms: 0.04,
        noiseFloorRms: 0.01,
        aecActive: true,
      });

      await waitFor(() => expect(stoppedAt).toBeGreaterThan(0));
      expect(stoppedAt - speechStartAt).toBeLessThan(150);
      expect(prefetchCancelled).toBe(true);
    } finally {
      unwire();
      endSpeaking(Date.now());
    }
  });

  it('does not install the speech_start interrupt path without the opt-in', async () => {
    delete process.env.CODEBUDDY_SENSORY_BARGE_IN;
    const interrupted = vi.fn();
    const root = process.cwd();
    let release!: () => void;
    let heardStarted = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const unwire = wireSpeechReaction({
      cwd: root,
      debounceMs: 0,
      env: process.env,
      onHeard: async () => {
        heardStarted = true;
        await held;
      },
      onBargeInStart: interrupted,
    });
    try {
      transcriptFinal('Lisa, écoute-moi.');
      await waitFor(() => expect(heardStarted).toBe(true));
      const start = Date.now();
      beginSpeaking(start);
      speechStart({ startedAtMs: start + 400, rms: 1 });
      expect(interrupted).not.toHaveBeenCalled();
    } finally {
      release();
      unwire();
      endSpeaking(Date.now());
    }
  });

});
