import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginSpeaking,
  endSpeaking,
  isSpeaking,
  classifyRecentVoiceEcho,
  measureVoiceResumeTiming,
  noteSpokenText,
  interruptSpeaking,
  withSpeakingGuard,
  _resetVoiceActivityForTests,
} from '../../src/sensory/voice-activity.js';

/**
 * Half-duplex guard: the companion must ignore its own microphone while it is
 * speaking (greeting/reply) — otherwise the ear transcribes the speaker output and
 * the robot answers itself in a loop while dropping the human's real speech.
 */
describe('voice-activity — half-duplex speaking guard', () => {
  beforeEach(() => _resetVoiceActivityForTests());

  it('is not speaking by default', () => {
    expect(isSpeaking(1000)).toBe(false);
  });

  it('is speaking during a play, and through the echo tail afterwards', async () => {
    let speakingInside = false;
    await withSpeakingGuard(async () => {
      speakingInside = isSpeaking();
    });
    const end = Date.now();
    expect(speakingInside).toBe(true); // speaking while the play runs
    expect(isSpeaking(end + 100)).toBe(true); // within the echo tail
    expect(isSpeaking(end + 60_000)).toBe(false); // well past the tail
  });

  it('stays speaking until the LAST concurrent play ends, then arms the tail', () => {
    beginSpeaking();
    beginSpeaking();
    expect(isSpeaking(1000)).toBe(true);
    endSpeaking(1000);
    expect(isSpeaking(1000)).toBe(true); // one play still active
    endSpeaking(1000);
    expect(isSpeaking(1100)).toBe(true); // within tail after the last
    expect(isSpeaking(1000 + 60_000)).toBe(false); // past tail
  });

  it('serializes concurrent spoken output — the mouth never plays over itself', async () => {
    const order: string[] = [];
    let releaseA!: () => void;
    const aBlocked = new Promise<void>((r) => {
      releaseA = r;
    });
    // Two independent callers (e.g. a reminder + an arrival greeting) speak at once.
    const pA = withSpeakingGuard(async () => {
      order.push('A-start');
      await aBlocked; // hold the mouth
      order.push('A-end');
    });
    const pB = withSpeakingGuard(async () => {
      order.push('B-start');
    });
    // A is playing; B must be QUEUED behind it, not overlapping.
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['A-start']);
    releaseA();
    await Promise.all([pA, pB]);
    expect(order).toEqual(['A-start', 'A-end', 'B-start']); // B started only after A finished
  });

  it('measures a quick human reply inside the echo tail without persisting text', () => {
    beginSpeaking(1_000);
    noteSpokenText('La conscience dépend aussi de la mémoire.', 1_100);
    endSpeaking(2_000);

    expect(measureVoiceResumeTiming(2_400)).toEqual({
      kind: 'echo_tail',
      afterPlaybackStartMs: 1_400,
      resumeAfterPlaybackMs: 400,
      earReadyInMs: 800,
      playbackInterrupted: false,
      tailBypassed: false,
    });
    expect(classifyRecentVoiceEcho('la conscience dépend aussi de la mémoire', 2_400))
      .toBe('echo');
    expect(classifyRecentVoiceEcho('Et la réciprocité alors ?', 2_400)).toBe('distinct');

    expect(measureVoiceResumeTiming(3_400)).toMatchObject({
      kind: 'after_playback',
      resumeAfterPlaybackMs: 1_400,
    });
  });

  it('normalizes accents and matches 60% of a spoken phrase for 90 seconds', () => {
    noteSpokenText('Écoute bien cette phrase réellement prononcée.', 1_000);

    expect(classifyRecentVoiceEcho('ecoute cette phrase prononcee', 90_999)).toBe('echo');
    expect(classifyRecentVoiceEcho('une question humaine distincte', 90_999)).toBe('distinct');
    expect(classifyRecentVoiceEcho('ecoute cette phrase prononcee', 91_001)).toBe('unknown');
  });

  it('classifies barge-in during playback and never re-arms a tail after interruption', () => {
    beginSpeaking(5_000);
    expect(measureVoiceResumeTiming(5_300)).toMatchObject({
      kind: 'during_playback',
      afterPlaybackStartMs: 300,
    });

    interruptSpeaking(5_300);
    endSpeaking(5_400); // late finally from the cancelled player

    expect(isSpeaking(5_400)).toBe(false);
    expect(measureVoiceResumeTiming(5_300)).toMatchObject({
      kind: 'during_playback',
      playbackInterrupted: true,
      tailBypassed: true,
    });
  });
});
