import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildVoiceInterruptionGuidance,
  makeVoiceReply,
} from '../../src/sensory/voice-loop.js';
import { wireSpeechReaction } from '../../src/sensory/speech-reaction.js';
import {
  _resetVoiceActivityForTests,
  beginSpeaking,
  endSpeaking,
} from '../../src/sensory/voice-activity.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function emitPerception(kind: string, payload: Record<string, unknown>): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'conv2-resume-test',
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

describe('CONV2 — interrupted-turn continuation', () => {
  let previousBargeIn: string | undefined;

  beforeEach(() => {
    previousBargeIn = process.env.CODEBUDDY_SENSORY_BARGE_IN;
    process.env.CODEBUDDY_SENSORY_BARGE_IN = 'true';
    _resetVoiceActivityForTests();
  });

  afterEach(() => {
    if (previousBargeIn === undefined) delete process.env.CODEBUDDY_SENSORY_BARGE_IN;
    else process.env.CODEBUDDY_SENSORY_BARGE_IN = previousBargeIn;
    _resetVoiceActivityForTests();
  });

  it('passes the interrupted phrase context to the next turn and acknowledges only a continuation', async () => {
    const seen: Array<{ signal?: AbortSignal; interruption?: { phraseNumber: number; spokenText: string } }> = [];
    let streamStarted!: () => void;
    const started = new Promise<void>((resolve) => { streamStarted = resolve; });
    let streamSpeakCalls = 0;
    const streamSpeak = async (_text: string, options?: { signal?: AbortSignal }): Promise<boolean> => {
      streamSpeakCalls += 1;
      if (streamSpeakCalls === 2) {
        streamStarted();
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener('abort', resolve, { once: true });
        });
      }
      return true;
    };
    const voiceReply = makeVoiceReply({
      streamFn: async function* (_heard, options) {
        seen.push(options ?? {});
        yield 'Première phrase. Deuxième phrase.';
      },
      streamSpeak,
      avatarEnabled: false,
    });

    const firstTurn = voiceReply('Lisa, réponds à ma question.', { turnId: 'conv2-first' });
    await started;
    voiceReply.interrupt('conv2-first');
    await firstTurn;
    await voiceReply('continue, sans répéter.', { turnId: 'conv2-second' });

    const interruption = seen[1]?.interruption;
    expect(interruption?.phraseNumber).toBe(2);
    expect(interruption?.spokenText).toBe('Première phrase.');
    const context = {
      interruptedTurnId: 'conv2-first',
      phraseNumber: 2,
      spokenText: 'La première phrase déjà entendue.',
    };
    expect(buildVoiceInterruptionGuidance('continue, sans répéter.', context)).toContain(
      "Tu m'as coupée, je disais",
    );
    expect(buildVoiceInterruptionGuidance('Quel temps fera-t-il demain ?', context)).not.toContain(
      "Tu m'as coupée, je disais",
    );
    expect(buildVoiceInterruptionGuidance('Quel temps fera-t-il demain ?', context)).toContain(
      'Ne répète pas les phrases déjà entendues',
    );
  });

  it('leaves the engagement window untouched while speech_start only interrupts playback', async () => {
    const root = process.cwd();
    const heard: string[] = [];
    const clock = 1_000;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const { createResponseDecider } = await import('../../src/sensory/respond-decider.js');
    const decider = createResponseDecider({
      robotName: 'Lisa',
      now: () => clock,
      recentContext: async () => [],
    });
    const unwire = wireSpeechReaction({
      cwd: root,
      debounceMs: 0,
      env: process.env,
      shouldRespond: (text) => decider.decide(text),
      onHeard: async (text) => {
        heard.push(text);
        if (heard.length === 1) await firstHeld;
      },
      onBargeInStart: vi.fn(),
    });
    try {
      transcriptFinal('Lisa, ouvre la conversation.');
      await waitFor(() => expect(heard).toEqual(['Lisa, ouvre la conversation.']));
      beginSpeaking(clock);
      speechStart({ startedAtMs: clock + 100, rms: 0.01 });
      speechStart({ startedAtMs: clock + 400, rms: 0.04 });
      transcriptFinal('continue sans répéter.', { startedAtMs: clock + 450 });
      releaseFirst();
      await waitFor(() => expect(heard).toHaveLength(2));
      expect(heard[1]).toBe('continue sans répéter.');
    } finally {
      releaseFirst();
      unwire();
      endSpeaking(Date.now());
    }
  });
});
