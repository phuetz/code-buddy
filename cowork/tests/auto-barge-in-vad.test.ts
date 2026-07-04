/**
 * Auto barge-in VAD (Part A) — the energy detector fires interruptSpeech('barge_in')
 * on a speech onset that clears the threshold WHILE the assistant is speaking,
 * stays silent below the threshold, and cleans up its audio graph on dispose.
 *
 * Runs in the node vitest env with a hand-built Web Audio double + an injected
 * `sampleBytes` sampler, so no real microphone / AudioContext is needed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AutoBargeInDetector,
  computeRms,
  DEFAULT_BARGE_IN_CONFIG,
} from '../src/renderer/utils/auto-barge-in';

/** Constant time-domain frame at `value` (128 = silence). */
function frame(value: number, len = 128): Uint8Array {
  return new Uint8Array(len).fill(value);
}
/** Loud alternating frame → high RMS. */
function loudFrame(len = 128): Uint8Array {
  const a = new Uint8Array(len);
  for (let i = 0; i < len; i++) a[i] = i % 2 === 0 ? 228 : 28;
  return a;
}

function makeAudioContext() {
  const close = vi.fn(async () => undefined);
  const analyserDisconnect = vi.fn();
  const sourceDisconnect = vi.fn();
  const ctx = {
    state: 'running',
    close,
    createAnalyser: () => ({
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteTimeDomainData: (_arr: Uint8Array) => undefined,
      disconnect: analyserDisconnect,
    }),
    createMediaStreamSource: (_s: MediaStream) => ({
      connect: vi.fn(),
      disconnect: sourceDisconnect,
    }),
  };
  return { ctx, close, analyserDisconnect, sourceDisconnect };
}

const fakeStream = {} as unknown as MediaStream;

describe('computeRms', () => {
  it('is ~0 for a silent (centred) frame', () => {
    expect(computeRms(frame(128))).toBeCloseTo(0, 5);
  });
  it('is high for a loud frame and exceeds the default threshold', () => {
    const rms = computeRms(loudFrame());
    expect(rms).toBeGreaterThan(0.5);
    expect(rms).toBeGreaterThan(DEFAULT_BARGE_IN_CONFIG.rmsThreshold);
  });
  it('handles empty input without throwing', () => {
    expect(computeRms(new Uint8Array(0))).toBe(0);
  });
});

describe('AutoBargeInDetector', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires onBargeIn after the debounce when loud AND the assistant is speaking', () => {
    const { ctx } = makeAudioContext();
    const onBargeIn = vi.fn();
    const detector = new AutoBargeInDetector({
      audioContext: ctx,
      mediaStream: fakeStream,
      isSpeaking: () => true,
      onBargeIn,
      config: { onsetFrames: 3 },
      sampleBytes: () => loudFrame(),
    });
    // Below onsetFrames → not yet.
    detector.tick();
    detector.tick();
    expect(onBargeIn).not.toHaveBeenCalled();
    // Third consecutive loud frame → onset.
    detector.tick();
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    // Refractory: keeps firing at most once until silence resets it.
    detector.tick();
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    detector.dispose();
  });

  it('does NOT fire below the energy threshold (silence)', () => {
    const { ctx } = makeAudioContext();
    const onBargeIn = vi.fn();
    const detector = new AutoBargeInDetector({
      audioContext: ctx,
      mediaStream: fakeStream,
      isSpeaking: () => true,
      onBargeIn,
      sampleBytes: () => frame(128),
    });
    for (let i = 0; i < 10; i++) detector.tick();
    expect(onBargeIn).not.toHaveBeenCalled();
    detector.dispose();
  });

  it('does NOT fire when the assistant is not speaking (barge-in only during TTS)', () => {
    const { ctx } = makeAudioContext();
    const onBargeIn = vi.fn();
    const detector = new AutoBargeInDetector({
      audioContext: ctx,
      mediaStream: fakeStream,
      isSpeaking: () => false,
      onBargeIn,
      config: { onsetFrames: 3 },
      sampleBytes: () => loudFrame(),
    });
    for (let i = 0; i < 10; i++) detector.tick();
    expect(onBargeIn).not.toHaveBeenCalled();
    detector.dispose();
  });

  it('re-arms after a silence gap so a second utterance can barge in', () => {
    const { ctx } = makeAudioContext();
    const onBargeIn = vi.fn();
    let loud = true;
    const detector = new AutoBargeInDetector({
      audioContext: ctx,
      mediaStream: fakeStream,
      isSpeaking: () => true,
      onBargeIn,
      config: { onsetFrames: 2 },
      sampleBytes: () => (loud ? loudFrame() : frame(128)),
    });
    detector.tick();
    detector.tick();
    expect(onBargeIn).toHaveBeenCalledTimes(1);
    loud = false; // silence resets the latch
    detector.tick();
    loud = true; // new utterance
    detector.tick();
    detector.tick();
    expect(onBargeIn).toHaveBeenCalledTimes(2);
    detector.dispose();
  });

  it('calls interruptSpeech("barge_in") when wired as the callback', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      speechSynthesis: { speaking: true, pending: false, cancel: vi.fn() },
      dispatchEvent,
      electronAPI: { voice: { recordInterruption: vi.fn(async () => ({ ok: true })) } },
    });
    // Import after stubbing window so module-level `window` refs resolve.
    return import('../src/renderer/components/VoiceOutputToggle').then(({ interruptSpeech }) => {
      const { ctx } = makeAudioContext();
      const detector = new AutoBargeInDetector({
        audioContext: ctx,
        mediaStream: fakeStream,
        isSpeaking: () => true,
        onBargeIn: () => void interruptSpeech('barge_in'),
        config: { onsetFrames: 1 },
        sampleBytes: () => loudFrame(),
      });
      detector.tick();
      const bargeInDispatched = dispatchEvent.mock.calls.some(
        ([ev]) =>
          ev?.type === 'cowork:voice-interrupted' && ev?.detail?.reason === 'barge_in',
      );
      expect(bargeInDispatched).toBe(true);
      detector.dispose();
      vi.unstubAllGlobals();
    });
  });

  it('releases the audio graph and closes the context on dispose (cleanup)', () => {
    const { ctx, close, analyserDisconnect, sourceDisconnect } = makeAudioContext();
    const detector = new AutoBargeInDetector({
      audioContext: ctx,
      mediaStream: fakeStream,
      isSpeaking: () => true,
      onBargeIn: vi.fn(),
      sampleBytes: () => frame(128),
    });
    detector.start();
    detector.dispose();
    expect(sourceDisconnect).toHaveBeenCalled();
    expect(analyserDisconnect).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    // Idempotent + inert after dispose.
    expect(() => detector.dispose()).not.toThrow();
    expect(() => detector.tick()).not.toThrow();
  });
});
