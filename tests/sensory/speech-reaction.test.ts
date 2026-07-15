import { describe, it, expect, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  DEFAULT_SPEECH_DEBOUNCE_MS,
  SPEECH_KEEP_WAV_ENV,
  isBargeInTranscript,
  resolveSpeechDebounceMs,
  normalizeSpeechTranscript,
  resolveFasterWhisperOptions,
  shouldSuppressPlaybackCapture,
  wireSpeechReaction,
  type Transcriber,
} from '../../src/sensory/speech-reaction.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import {
  _resetVoiceActivityForTests,
  beginSpeaking,
  endSpeaking,
  interruptSpeaking,
  noteSpokenText,
} from '../../src/sensory/voice-activity.js';

function speechEnd(wav?: string, payload: Record<string, unknown> = {}): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'speech_end', payload: wav ? { wav, ...payload } : payload },
  });
}

/** The live-mic path: buddy-sense's `live-audio` sense decoded the utterance and
 *  ships the text in the payload (no WAV). */
function transcriptFinal(text: string, payload: Record<string, unknown> = {}): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'transcript_final', payload: { text, ...payload } },
  });
}

function transcriptPartial(text: string, payload: Record<string, unknown> = {}): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'transcript_partial', payload: { text, ...payload } },
  });
}

function speechStart(payload: Record<string, unknown> = {}): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'speech_start', payload },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

describe('speech reaction — speech_end → STT → percept', () => {
  it('fails closed for non-explicit captures during playback', () => {
    expect(shouldSuppressPlaybackCapture('during_playback', 'echo', true)).toBe(true);
    expect(shouldSuppressPlaybackCapture('during_playback', 'distinct', false)).toBe(true);
    expect(shouldSuppressPlaybackCapture('during_playback', 'unknown', false)).toBe(true);
    expect(shouldSuppressPlaybackCapture('during_playback', 'distinct', true)).toBe(false);
    expect(shouldSuppressPlaybackCapture('during_playback', 'unknown', true)).toBe(false);
    expect(shouldSuppressPlaybackCapture('echo_tail', 'echo', true)).toBe(true);
    expect(shouldSuppressPlaybackCapture('echo_tail', 'unknown', true)).toBe(true);
    expect(shouldSuppressPlaybackCapture('echo_tail', 'distinct', false)).toBe(false);
  });

  it('uses a partial transcript only for preparation and waits for the final before cognition', async () => {
    const partials: Array<{ text: string; audioMs?: number; decodeMs?: number }> = [];
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      onSpeechPartial: async (partial) => {
        partials.push(partial);
      },
      onHeard: async (text) => {
        heard.push(text);
      },
    });
    try {
      speechStart({ rms: 0.08 });
      transcriptPartial('cherche les actualités', { audioMs: 1200, decodeMs: 95 });
      await tick();
      expect(partials).toEqual([{
        text: 'cherche les actualités',
        audioMs: 1200,
        decodeMs: 95,
      }]);
      expect(heard).toEqual([]);

      transcriptFinal('cherche les actualités françaises');
      await tick();
      expect(heard).toEqual(['cherche les actualités françaises']);
    } finally {
      unwire();
    }
  });

  it('starts predictive preparation on VAD open without hearing or responding', async () => {
    const starts: Array<Record<string, unknown>> = [];
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      onSpeechStart: async (payload) => {
        starts.push(payload);
      },
      onHeard: async (text) => {
        heard.push(text);
      },
    });
    try {
      speechStart({ rms: 0.08, rmsOn: 0.04, adaptiveVad: true });
      await tick();
      expect(starts).toEqual([{ rms: 0.08, rmsOn: 0.04, adaptiveVad: true }]);
      expect(heard).toEqual([]);
    } finally {
      unwire();
    }
  });

  it('starts the correlated background lane before the spoken turn releases its mouth lock', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-background-lane-'));
    let releaseMouth!: () => void;
    const mouthGate = new Promise<void>((resolve) => (releaseMouth = resolve));
    const phases: string[] = [];
    let recognized:
      | { turnId: string; text: string; context: { turnId?: string } }
      | undefined;
    let heardTurnId: string | undefined;
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      shouldRespond: async () => {
        phases.push('gate');
        return { respond: true, reason: 'addressed' };
      },
      onRecognizedTurn: async (turn) => {
        phases.push('recognized');
        recognized = turn;
      },
      onHeard: async (_text, context) => {
        phases.push('heard');
        heardTurnId = context?.turnId;
        await mouthGate;
      },
    });
    try {
      transcriptFinal('Lisa, réfléchissons en parallèle');
      await tick();
      expect(recognized).toMatchObject({ text: 'Lisa, réfléchissons en parallèle' });
      expect(recognized?.turnId).toMatch(/^voice_/);
      expect(recognized?.context.turnId).toBe(recognized?.turnId);
      expect(heardTurnId).toBe(recognized?.turnId);
      expect(phases).toEqual(['gate', 'recognized', 'heard']);
      // onHeard is still deliberately blocked, representing generation/TTS.
      // The semantic background ingress has nevertheless already completed.
    } finally {
      releaseMouth();
      await tick();
      unwire();
    }
  });

  it.each(['ambient', 'no-cue', 'ambient-long'])(
    'keeps a raw %s percept without publishing a semantic turn',
    async (reason) => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-ambient-boundary-'));
      const recognized: string[] = [];
      const heard: string[] = [];
      const unwire = wireSpeechReaction({
        debounceMs: 0,
        cwd: tmp,
        shouldRespond: async () => ({ respond: false, reason }),
        onRecognizedTurn: ({ text }) => {
          recognized.push(text);
        },
        onHeard: (text) => {
          heard.push(text);
        },
      });
      try {
        transcriptFinal(`bruit ambiant ${reason}`);
        await tick();
        expect(recognized).toEqual([]);
        expect(heard).toEqual([]);
        const journal = await readFile(
          path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
          'utf8',
        );
        const percept = JSON.parse(journal.trim()) as {
          payload: { text: string; responded: boolean; decisionReason: string };
        };
        expect(percept.payload).toMatchObject({
          text: `bruit ambiant ${reason}`,
          responded: false,
          decisionReason: reason,
        });
      } finally {
        unwire();
      }
    },
  );

  it('isolates a failing background lane from the canonical voice turn', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-background-failure-'));
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      onRecognizedTurn: async () => {
        throw new Error('background unavailable');
      },
      onHeard: async (text) => {
        heard.push(text);
      },
    });
    try {
      transcriptFinal('Lisa, continue malgré la panne');
      await tick();
      expect(heard).toEqual(['Lisa, continue malgré la panne']);
    } finally {
      unwire();
    }
  });

  it('recognizes explicit, echo-safe barge-in phrases', () => {
    expect(isBargeInTranscript('Lisa, attends, nouvelle question')).toBe(true);
    expect(isBargeInTranscript('Arrête de parler')).toBe(true);
    expect(isBargeInTranscript('une seconde')).toBe(true);
    expect(isBargeInTranscript('le ciel est bleu')).toBe(false);
  });

  it('interrupts an in-flight turn and queues the explicit replacement transcript', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-barge-in-'));
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const heard: string[] = [];
    const barged: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      onHeard: async (text) => {
        heard.push(text);
        if (heard.length === 1) await firstHeld;
      },
      onBargeIn: (text) => {
        barged.push(text);
        releaseFirst();
      },
    });
    try {
      transcriptFinal('Lisa, raconte-moi quelque chose');
      await tick();
      transcriptFinal('Lisa, attends, nouvelle question');
      await tick();
      await tick();
      expect(barged).toEqual(['Lisa, attends, nouvelle question']);
      expect(heard).toEqual([
        'Lisa, raconte-moi quelque chose',
        'Lisa, attends, nouvelle question',
      ]);
    } finally {
      releaseFirst();
      unwire();
    }
  });

  it('joins a short VAD split when the first final ends on an unfinished phrase', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-turn-join-'));
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      incompleteTurnHoldMs: 100,
      cwd: tmp,
      onHeard: async (text) => {
        heard.push(text);
      },
    });
    try {
      transcriptFinal('Lisa, je voulais te dire que');
      await tick();
      expect(heard).toEqual([]);
      transcriptFinal('le test est terminé.');
      await tick();
      expect(heard).toEqual(['Lisa, je voulais te dire que le test est terminé.']);
    } finally {
      unwire();
    }
  });

  it('trusts the audio-native Smart Turn decision instead of applying the text fallback twice', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-smart-turn-'));
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      incompleteTurnHoldMs: 500,
      cwd: tmp,
      onHeard: async (text) => {
        heard.push(text);
      },
    });
    try {
      transcriptFinal('Lisa, vérifie ce que', {
        turnDetector: 'smart-turn-v3.2',
        turnProbability: 0.82,
        turnDetectionMs: 60,
      });
      await tick();
      expect(heard).toEqual(['Lisa, vérifie ce que']);
    } finally {
      unwire();
    }
  });

  it('uses a short, validated debounce so follow-up turns are not blocked for seconds', () => {
    expect(DEFAULT_SPEECH_DEBOUNCE_MS).toBe(800);
    expect(resolveSpeechDebounceMs({})).toBe(800);
    expect(resolveSpeechDebounceMs({ CODEBUDDY_SPEECH_DEBOUNCE_MS: '250' })).toBe(250);
    expect(resolveSpeechDebounceMs({ CODEBUDDY_SPEECH_DEBOUNCE_MS: '0' })).toBe(0);
    expect(resolveSpeechDebounceMs({ CODEBUDDY_SPEECH_DEBOUNCE_MS: 'invalid' })).toBe(800);
  });

  it('defaults faster-whisper to French assistant comprehension settings', () => {
    const previous = {
      lang: process.env.CODEBUDDY_SPEECH_LANG,
      companionLang: process.env.CODEBUDDY_COMPANION_LANGUAGE,
      beam: process.env.CODEBUDDY_SPEECH_BEAM_SIZE,
      vad: process.env.CODEBUDDY_SPEECH_VAD_FILTER,
      previousText: process.env.CODEBUDDY_SPEECH_CONDITION_PREVIOUS_TEXT,
      prompt: process.env.CODEBUDDY_SPEECH_INITIAL_PROMPT,
      hotwords: process.env.CODEBUDDY_SPEECH_HOTWORDS,
      hotwordsFile: process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE,
    };
    delete process.env.CODEBUDDY_SPEECH_LANG;
    delete process.env.CODEBUDDY_COMPANION_LANGUAGE;
    delete process.env.CODEBUDDY_SPEECH_BEAM_SIZE;
    delete process.env.CODEBUDDY_SPEECH_VAD_FILTER;
    delete process.env.CODEBUDDY_SPEECH_CONDITION_PREVIOUS_TEXT;
    delete process.env.CODEBUDDY_SPEECH_INITIAL_PROMPT;
    delete process.env.CODEBUDDY_SPEECH_HOTWORDS;
    delete process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE;

    try {
      expect(resolveFasterWhisperOptions()).toMatchObject({
        language: 'fr',
        beamSize: 1,
        vadFilter: true,
        conditionOnPreviousText: false,
      });
      expect(resolveFasterWhisperOptions().initialPrompt).toContain('Ne complète pas les silences');
      expect(resolveFasterWhisperOptions().hotwords).toContain('Lisa');
      expect(resolveFasterWhisperOptions().hotwords).toContain('Buddy');
      expect(resolveFasterWhisperOptions().hotwords).toContain('Code Buddy');
    } finally {
      if (previous.lang === undefined) delete process.env.CODEBUDDY_SPEECH_LANG;
      else process.env.CODEBUDDY_SPEECH_LANG = previous.lang;
      if (previous.companionLang === undefined) delete process.env.CODEBUDDY_COMPANION_LANGUAGE;
      else process.env.CODEBUDDY_COMPANION_LANGUAGE = previous.companionLang;
      if (previous.beam === undefined) delete process.env.CODEBUDDY_SPEECH_BEAM_SIZE;
      else process.env.CODEBUDDY_SPEECH_BEAM_SIZE = previous.beam;
      if (previous.vad === undefined) delete process.env.CODEBUDDY_SPEECH_VAD_FILTER;
      else process.env.CODEBUDDY_SPEECH_VAD_FILTER = previous.vad;
      if (previous.previousText === undefined) delete process.env.CODEBUDDY_SPEECH_CONDITION_PREVIOUS_TEXT;
      else process.env.CODEBUDDY_SPEECH_CONDITION_PREVIOUS_TEXT = previous.previousText;
      if (previous.prompt === undefined) delete process.env.CODEBUDDY_SPEECH_INITIAL_PROMPT;
      else process.env.CODEBUDDY_SPEECH_INITIAL_PROMPT = previous.prompt;
      if (previous.hotwords === undefined) delete process.env.CODEBUDDY_SPEECH_HOTWORDS;
      else process.env.CODEBUDDY_SPEECH_HOTWORDS = previous.hotwords;
      if (previous.hotwordsFile === undefined) delete process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE;
      else process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE = previous.hotwordsFile;
    }
  });

  it('loads configurable STT hotwords from env and a dictionary file', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-hotwords-'));
    const dictionary = path.join(tmp, 'hotwords.txt');
    await writeFile(dictionary, 'Murmure\nYOLOv8\nLisa\n');
    const previous = {
      hotwords: process.env.CODEBUDDY_SPEECH_HOTWORDS,
      hotwordsFile: process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE,
    };
    process.env.CODEBUDDY_SPEECH_HOTWORDS = 'Telos, council; Code Buddy';
    process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE = dictionary;

    try {
      const hotwords = resolveFasterWhisperOptions().hotwords || '';
      expect(hotwords).toContain('Telos');
      expect(hotwords).toContain('council');
      expect(hotwords).toContain('Murmure');
      expect(hotwords).toContain('YOLOv8');
      expect((hotwords.match(/Lisa/g) || []).length).toBe(1);
    } finally {
      if (previous.hotwords === undefined) delete process.env.CODEBUDDY_SPEECH_HOTWORDS;
      else process.env.CODEBUDDY_SPEECH_HOTWORDS = previous.hotwords;
      if (previous.hotwordsFile === undefined) delete process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE;
      else process.env.CODEBUDDY_SPEECH_HOTWORDS_FILE = previous.hotwordsFile;
    }
  });

  it('filters known Whisper subtitle hallucinations before the voice loop responds', () => {
    expect(normalizeSpeechTranscript("Sous-titres réalisés par la communauté d'Amara.org")).toEqual({
      text: '',
      filteredReason: 'subtitle_hallucination',
    });
    expect(normalizeSpeechTranscript('Sous-titrage Société Radio-Canada')).toEqual({
      text: '',
      filteredReason: 'subtitle_hallucination',
    });
    expect(normalizeSpeechTranscript('Buddy, ouvre le diagnostic audio')).toEqual({
      text: 'Buddy, ouvre le diagnostic audio',
    });
  });

  it('filters non-speech, repetitive noise, and prompt leakage hallucinations', () => {
    expect(normalizeSpeechTranscript('...')).toEqual({
      text: '',
      filteredReason: 'non_speech',
    });
    expect(normalizeSpeechTranscript('MMMMMMMMMMMMMMMMMMMM')).toEqual({
      text: '',
      filteredReason: 'repetitive_noise',
    });
    expect(normalizeSpeechTranscript('Fascination en français avec Lisa, Patrice, Code Buddy')).toEqual({
      text: '',
      filteredReason: 'prompt_leakage',
    });
    expect(normalizeSpeechTranscript('Mm.')).toEqual({
      text: '',
      filteredReason: 'filler_noise',
    });
  });

  it('transcribes the utterance once, records a hearing percept, fires onHeard', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let calls = 0;
    const transcriber: Transcriber = async () => {
      calls += 1;
      return 'Bonjour Patrice';
    };
    let heard = '';
    let clock = 1000;
    const unwire = wireSpeechReaction({
      transcriber,
      debounceMs: 3000,
      cwd: tmp,
      now: () => clock,
      onHeard: (t) => {
        heard = t;
      },
    });
    try {
      speechEnd('/tmp/x.wav');
      await tick();
      expect(calls).toBe(1);
      expect(heard).toBe('Bonjour Patrice');

      speechEnd('/tmp/x.wav');
      await tick();
      expect(calls).toBe(1); // within debounce → one transcription per utterance

      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      expect(percepts).toContain('Bonjour Patrice');
      expect(percepts).toContain('sensory_speech_reaction');
    } finally {
      unwire();
    }
  });

  it('hands acoustic timing to the voice handler and journals only the raw-free delivery profile', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-entrainment-'));
    let context: Record<string, unknown> | undefined;
    const delivery = {
      pace: 'slow' as const,
      pauseStyle: 'reflective' as const,
      responseShape: 'balanced' as const,
      confidence: 'high' as const,
      targetWpm: 118,
      humanWordCount: 8,
      humanAudioMs: 4_000,
      humanWpm: 120,
    };
    const unwire = wireSpeechReaction({
      transcriber: async () => 'Lisa prends le temps de bien expliquer cette idée',
      debounceMs: 0,
      cwd: tmp,
      onHeard: async (_text, nextContext) => {
        context = nextContext;
      },
      getResponseTiming: () => ({
        mode: 'blocking',
        totalMs: 500,
        spoke: true,
        delivery,
      }),
    });
    try {
      speechEnd('/tmp/entrainment.wav', {
        audioMs: 4_000,
        ms: 4_200,
        startedAtMs: 10_000,
        endedAtMs: 14_200,
      });
      await tick();

      expect(context).toMatchObject({
        audioMs: 4_000,
        captureMs: 4_200,
        speechStartedAtMs: 10_000,
        speechEndedAtMs: 14_200,
      });
      expect(context?.turnId).toMatch(/^voice_/);
      const percepts = await readFile(
        path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
        'utf8',
      );
      const recorded = JSON.parse(percepts.trim().split('\n').at(-1)!) as {
        payload: { delivery: Record<string, unknown> };
      };
      expect(recorded.payload.delivery).toEqual(delivery);
      expect(JSON.stringify(recorded.payload.delivery)).not.toContain('Lisa prends le temps');
    } finally {
      unwire();
    }
  });

  it('records the percept but stays silent when shouldRespond vetoes', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let heard = 0;
    let clock = 1000;
    const unwire = wireSpeechReaction({
      transcriber: async () => 'il fait beau aujourd’hui',
      debounceMs: 3000,
      cwd: tmp,
      now: () => clock,
      shouldRespond: async () => ({ respond: false, reason: 'ambient' }),
      onHeard: () => {
        heard += 1;
      },
    });
    try {
      speechEnd('/tmp/x.wav');
      await tick();
      expect(heard).toBe(0); // vetoed → did not speak
      // …but it still observed + remembered.
      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      expect(percepts).toContain('il fait beau');
    } finally {
      unwire();
    }
  });

  it('a silent (vetoed) turn does NOT extend the debounce — a real address right after is still heard', async () => {
    // Echo-guard regression: the end-of-cycle re-stamp must fire ONLY when the robot spoke.
    // Here turn 1 is vetoed (no speech, so no echo) but its STT burns 2s of clock. If the
    // re-stamp ran unconditionally it would push lastAt to 3000, and the real address at
    // t=4500 (3500ms after the utterance began — past the 3000ms debounce) would be wrongly
    // swallowed (4500-3000=1500 < 3000). With the fix, lastAt stays at the job-start 1000.
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let clock = 1000;
    let sttCalls = 0;
    const heard: string[] = [];
    const unwire = wireSpeechReaction({
      transcriber: async () => {
        sttCalls += 1;
        clock += 2000; // STT consumes 2s of the injected clock
        return sttCalls === 1 ? 'il fait beau aujourd’hui' : 'Buddy, quelle heure ?';
      },
      debounceMs: 3000,
      cwd: tmp,
      now: () => clock,
      shouldRespond: async (text) =>
        text.startsWith('Buddy') ? { respond: true, reason: 'addressed' } : { respond: false, reason: 'ambient' },
      onHeard: (t) => {
        heard.push(t);
      },
    });
    try {
      speechEnd('/tmp/silent.wav'); // turn 1: vetoed, STT advances clock 1000 → 3000
      await tick();
      expect(heard).toEqual([]); // stayed silent

      clock = 4500; // a real address arrives 3500ms after turn 1 began (past the 3000ms debounce)
      speechEnd('/tmp/real.wav'); // turn 2: addressed
      await tick();
      expect(heard).toEqual(['Buddy, quelle heure ?']); // NOT swallowed by a stale echo re-stamp
    } finally {
      unwire();
    }
  });

  it('fires onHeard when shouldRespond approves', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let heard = '';
    let clock = 1000;
    const unwire = wireSpeechReaction({
      transcriber: async () => 'Buddy, quelle heure ?',
      debounceMs: 3000,
      cwd: tmp,
      now: () => clock,
      shouldRespond: async () => ({ respond: true, reason: 'addressed' }),
      onHeard: (t) => {
        heard = t;
      },
    });
    try {
      speechEnd('/tmp/x.wav');
      await tick();
      expect(heard).toBe('Buddy, quelle heure ?');
    } finally {
      unwire();
    }
  });

  it('queues the latest speech_end while STT is already in flight', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const heard: string[] = [];
    const transcriber: Transcriber = async (wav) => {
      calls.push(wav);
      if (wav.endsWith('first.wav')) {
        await firstDone;
        return 'premiere phrase';
      }
      return 'deuxieme phrase';
    };
    const unwire = wireSpeechReaction({
      transcriber,
      debounceMs: 3000,
      cwd: tmp,
      onHeard: (text) => {
        heard.push(text);
      },
    });
    try {
      speechEnd('/tmp/first.wav');
      await tick();
      speechEnd('/tmp/second.wav');
      await tick();

      expect(calls).toEqual(['/tmp/first.wav']);
      releaseFirst?.();
      await tick();
      await tick();

      expect(calls).toEqual(['/tmp/first.wav', '/tmp/second.wav']);
      expect(heard).toEqual(['premiere phrase', 'deuxieme phrase']);
    } finally {
      unwire();
    }
  });

  it('records acquisition and loop latency metrics with hearing percepts', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let clock = 10_000;
    const unwire = wireSpeechReaction({
      transcriber: async () => {
        clock += 120;
        return 'Buddy, lance un diagnostic';
      },
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
      shouldRespond: async () => {
        clock += 30;
        return { respond: true, reason: 'addressed' };
      },
      onHeard: async () => {
        clock += 250;
      },
      getResponseTiming: () => ({
        mode: 'streamed',
        promptReadyMs: 2,
        providerFirstDeltaMs: 4,
        generationCompleteMs: 24,
        semanticReviewCompleteMs: 30,
        spokenPrefix: {
          outcome: 'accepted',
          causes: ['accepted'],
          promptReadyMs: 1,
          generationCompleteMs: 18,
        },
        continuation: {
          promptReadyMs: 20,
          providerFirstDeltaMs: 22,
          generationCompleteMs: 28,
        },
        firstSafeReleaseMs: 32,
        firstTextMs: 5,
        firstSegmentMs: 35,
        firstAudioMs: 80,
        firstContentAudioMs: 140,
        streamFallbackSegments: 2,
        totalMs: 250,
        spoke: true,
      }),
    });
    try {
      speechEnd('/tmp/x.wav', {
        device: 'plughw:CARD=BRIO,DEV=0',
        startedAtMs: 9000,
        endedAtMs: 9800,
        peakRms: 0.08,
        avgRms: 0.035,
        rmsOn: 0.02,
        rmsOff: 0.012,
        writeMs: 7,
        ms: 820,
        endpointMs: 420,
        turnDetector: 'smart-turn-v3.2',
        turnProbability: 0.91,
        turnDetectionMs: 65,
        turnForcedAfterHold: false,
        decodeMs: 75,
        sampleRate: 16000,
      });
      await tick();

      const raw = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      const percept = JSON.parse(raw.trim()) as { payload: { responded: boolean; latency: Record<string, unknown>; capture: Record<string, unknown> } };
      expect(percept.payload.responded).toBe(true);
      expect(percept.payload.latency.sttMs).toBe(120);
      expect(percept.payload.latency.endpointMs).toBe(420);
      expect(percept.payload.latency.turnDetectionMs).toBe(65);
      expect(percept.payload.latency.decodeMs).toBe(75);
      expect(percept.payload.latency.inputReadyMs).toBe(680);
      expect(percept.payload.latency.decisionMs).toBe(30);
      expect(percept.payload.latency.actionMs).toBe(250);
      expect(percept.payload.latency.totalMs).toBe(400);
      expect(percept.payload.latency.promptReadyMs).toBe(2);
      expect(percept.payload.latency.providerFirstDeltaMs).toBe(4);
      expect(percept.payload.latency.generationCompleteMs).toBe(24);
      expect(percept.payload.latency.semanticReviewCompleteMs).toBe(30);
      expect(percept.payload.latency.spokenPrefix).toEqual({
        outcome: 'accepted',
        causes: ['accepted'],
        promptReadyMs: 1,
        generationCompleteMs: 18,
      });
      expect(percept.payload.latency.continuation).toEqual({
        promptReadyMs: 20,
        providerFirstDeltaMs: 22,
        generationCompleteMs: 28,
      });
      expect(percept.payload.latency.firstSafeReleaseMs).toBe(32);
      expect(percept.payload.latency.firstTextMs).toBe(5);
      expect(percept.payload.latency.firstSegmentMs).toBe(35);
      expect(percept.payload.latency.firstAudioMs).toBe(80);
      expect(percept.payload.latency.firstContentAudioMs).toBe(140);
      expect(percept.payload.latency.perceivedResponseMs).toBe(790);
      expect(percept.payload.latency.perceivedContentResponseMs).toBe(850);
      expect(percept.payload.latency.streamFallbackSegments).toBe(2);
      expect(percept.payload.latency.voiceTotalMs).toBe(250);
      expect(percept.payload.capture.device).toBe('plughw:CARD=BRIO,DEV=0');
      expect(percept.payload.capture.peakRms).toBe(0.08);
      expect(percept.payload.capture.avgRms).toBe(0.035);
      expect(percept.payload.capture.rmsOn).toBe(0.02);
      expect(percept.payload.capture.writeMs).toBe(7);
      expect(percept.payload.capture.endpointMs).toBe(420);
      expect(percept.payload.capture.decodeMs).toBe(75);
      expect(percept.payload.capture.turnDetector).toBe('smart-turn-v3.2');
      expect(percept.payload.capture.turnProbability).toBe(0.91);
    } finally {
      unwire();
    }
  });

  it('accepts a distinct human reply that starts inside the acoustic echo tail', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-quick-resume-'));
    const heard: string[] = [];
    _resetVoiceActivityForTests();
    beginSpeaking(1_000);
    noteSpokenText('La conscience dépend aussi de la mémoire.', 1_100);
    endSpeaking(2_000);
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      now: () => 2_400,
      onHeard: async text => {
        heard.push(text);
      },
      getResponseTiming: () => ({
        mode: 'silent',
        totalMs: 0,
        spoke: false,
      }),
    });
    try {
      transcriptFinal('Et la réciprocité alors ?', { startedAtMs: 2_400 });
      await tick();

      expect(heard).toEqual(['Et la réciprocité alors ?']);
      const raw = await readFile(
        path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
        'utf8',
      );
      const percept = JSON.parse(raw.trim()) as {
        payload: { playbackEcho?: boolean; turnTaking?: Record<string, unknown> };
      };
      expect(percept.payload.playbackEcho).toBeUndefined();
      expect(percept.payload.turnTaking).toMatchObject({
        kind: 'echo_tail',
        resumeAfterPlaybackMs: 400,
        earReadyInMs: 800,
      });
    } finally {
      unwire();
      _resetVoiceActivityForTests();
    }
  });

  it('suppresses a matching loudspeaker echo during the same tail without storing it', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-echo-tail-'));
    const heard: string[] = [];
    _resetVoiceActivityForTests();
    beginSpeaking(3_000);
    noteSpokenText('Voici la réponse que Lisa vient de prononcer.', 3_100);
    endSpeaking(4_000);
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      now: () => 4_250,
      onHeard: async text => {
        heard.push(text);
      },
    });
    try {
      transcriptFinal('Voici la réponse que Lisa vient de prononcer.', { startedAtMs: 4_250 });
      await tick();

      expect(heard).toEqual([]);
      const raw = await readFile(
        path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
        'utf8',
      );
      expect(raw).not.toContain('Voici la réponse que Lisa vient de prononcer.');
      const percept = JSON.parse(raw.trim()) as {
        summary: string;
        payload: Record<string, unknown>;
      };
      expect(percept.summary).toBe('Likely loudspeaker echo suppressed');
      expect(percept.payload).toMatchObject({
        playbackEcho: true,
        echoClassification: 'echo',
        turnTaking: {
          kind: 'echo_tail',
          resumeAfterPlaybackMs: 250,
        },
      });
    } finally {
      unwire();
      _resetVoiceActivityForTests();
    }
  });

  it('suppresses a queued transcript captured during playback after the tail expires', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-delayed-playback-echo-'));
    let clock = 1_000;
    let releaseFirst!: () => void;
    const firstTurnHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const heard: string[] = [];
    const recognized: string[] = [];
    const decisions: string[] = [];
    _resetVoiceActivityForTests();
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
      shouldRespond: async (text) => {
        decisions.push(text);
        return { respond: true, reason: 'addressed' };
      },
      onRecognizedTurn: ({ text }) => {
        recognized.push(text);
      },
      onHeard: async (text) => {
        heard.push(text);
        if (heard.length === 1) await firstTurnHeld;
      },
      getResponseTiming: () => ({ mode: 'test', totalMs: 0, spoke: false }),
    });
    try {
      transcriptFinal('Lisa, explique le filtre anti-écho.', { startedAtMs: 1_000 });
      await vi.waitFor(() => expect(heard).toHaveLength(1));

      clock = 1_100;
      beginSpeaking(clock);
      noteSpokenText('La réponse prononcée par le haut-parleur.', 1_150);
      transcriptFinal('La réponse prononcée par le haut-parleur.', { startedAtMs: 1_250 });
      await tick();

      clock = 2_000;
      endSpeaking(clock);
      // Reproduce the production race: the queued final is only processed
      // after generation/housekeeping, once the acoustic tail has expired.
      clock = 3_500;
      releaseFirst();
      await vi.waitFor(async () => {
        const raw = await readFile(
          path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
          'utf8',
        );
        expect(raw).toContain('during_playback_echo');
      });

      expect(heard).toEqual(['Lisa, explique le filtre anti-écho.']);
      expect(recognized).toEqual(['Lisa, explique le filtre anti-écho.']);
      expect(decisions).toEqual(['Lisa, explique le filtre anti-écho.']);
      const raw = await readFile(
        path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'),
        'utf8',
      );
      expect(raw).not.toContain('La réponse prononcée par le haut-parleur.');
    } finally {
      releaseFirst();
      unwire();
      _resetVoiceActivityForTests();
    }
  });

  it('keeps an explicit distinct human barge-in captured during playback', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-explicit-playback-barge-in-'));
    let clock = 5_000;
    let releaseFirst!: () => void;
    const firstTurnHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const heard: string[] = [];
    const bargeIns: string[] = [];
    _resetVoiceActivityForTests();
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
      onBargeIn: (text) => {
        bargeIns.push(text);
        interruptSpeaking(clock);
        releaseFirst();
      },
      onHeard: async (text) => {
        heard.push(text);
        if (heard.length === 1) await firstTurnHeld;
      },
      getResponseTiming: () => ({ mode: 'test', totalMs: 0, spoke: false }),
    });
    try {
      transcriptFinal('Lisa, commence une longue explication.', { startedAtMs: 5_000 });
      await vi.waitFor(() => expect(heard).toHaveLength(1));

      clock = 5_100;
      beginSpeaking(clock);
      noteSpokenText('Voici une longue explication technique.', 5_150);
      clock = 5_300;
      transcriptFinal('Lisa, stop maintenant.', { startedAtMs: 5_250 });

      await vi.waitFor(() => expect(heard).toHaveLength(2));
      expect(bargeIns).toEqual(['Lisa, stop maintenant.']);
      expect(heard).toEqual([
        'Lisa, commence une longue explication.',
        'Lisa, stop maintenant.',
      ]);
    } finally {
      releaseFirst();
      unwire();
      _resetVoiceActivityForTests();
    }
  });

  it('integration smoke: the REAL decider gates the REAL speech-reaction (synthetic events)', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let clock = 1000;
    // chime-in off (default) → addressed-only.
    const decider = createResponseDecider({ robotName: 'Buddy', now: () => clock, recentContext: async () => [] });
    const spoken: string[] = [];
    let transcript = 'Buddy, quelle heure est-il ?';
    const unwire = wireSpeechReaction({
      transcriber: async () => transcript,
      debounceMs: 0,
      cwd: tmp,
      now: () => clock,
      shouldRespond: (t) => decider.decide(t),
      onHeard: async (t) => {
        spoken.push(t);
        decider.markEngaged();
      },
    });
    try {
      // 1) Addressed by name → speaks.
      speechEnd('/tmp/x.wav');
      await tick();
      // 2) In-window follow-up without the name → speaks (continuity).
      clock += 5000;
      transcript = 'et demain ?';
      speechEnd('/tmp/x.wav');
      await tick();
      // 3) Much later, ambient human-human chatter → silent.
      clock += 60_000;
      transcript = 'il fait beau aujourd’hui';
      speechEnd('/tmp/x.wav');
      await tick();

      expect(spoken).toEqual(['Buddy, quelle heure est-il ?', 'et demain ?']);
    } finally {
      unwire();
    }
  });

  it('ignores speech_end with no wav, and non-speech events', async () => {
    let calls = 0;
    const transcriber: Transcriber = async () => {
      calls += 1;
      return 'x';
    };
    const unwire = wireSpeechReaction({ transcriber, debounceMs: 0 });
    try {
      speechEnd(); // no wav → can't transcribe
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'audio', kind: 'speech_start', payload: { wav: '/tmp/x.wav' } } });
      getGlobalEventBus().emit('sensory:perception', { source: 'test', metadata: { modality: 'vital', kind: 'heartbeat', payload: { beat: 1 } } });
      await tick();
      expect(calls).toBe(0);
    } finally {
      unwire();
    }
  });

  it.each([
    ['successful STT', async () => 'Bonjour Patrice'],
    ['empty STT', async () => ''],
    ['failed STT', async () => { throw new Error('decoder failed'); }],
  ])('removes a managed fallback WAV after %s', async (_label, transcriber) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-wav-cleanup-'));
    const companionDir = path.join(tmp, 'companion');
    const wav = path.join(companionDir, `utt-${Date.now()}.wav`);
    await mkdir(companionDir, { recursive: true });
    await writeFile(wav, 'temporary audio');
    const previousDir = process.env.BUDDY_EAR_WAV_DIR;
    const previousKeep = process.env[SPEECH_KEEP_WAV_ENV];
    process.env.BUDDY_EAR_WAV_DIR = companionDir;
    delete process.env[SPEECH_KEEP_WAV_ENV];
    const unwire = wireSpeechReaction({ transcriber, debounceMs: 0, cwd: tmp });
    try {
      speechEnd(wav);
      await tick();
      expect(await fileExists(wav)).toBe(false);
    } finally {
      unwire();
      if (previousDir === undefined) delete process.env.BUDDY_EAR_WAV_DIR;
      else process.env.BUDDY_EAR_WAV_DIR = previousDir;
      if (previousKeep === undefined) delete process.env[SPEECH_KEEP_WAV_ENV];
      else process.env[SPEECH_KEEP_WAV_ENV] = previousKeep;
    }
  });

  it('removes the active managed WAV when teardown happens during STT', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-wav-abort-'));
    const companionDir = path.join(tmp, 'companion');
    const wav = path.join(companionDir, `utt-${Date.now()}.wav`);
    await mkdir(companionDir, { recursive: true });
    await writeFile(wav, 'temporary audio');
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const previousDir = process.env.BUDDY_EAR_WAV_DIR;
    const previousKeep = process.env[SPEECH_KEEP_WAV_ENV];
    process.env.BUDDY_EAR_WAV_DIR = companionDir;
    delete process.env[SPEECH_KEEP_WAV_ENV];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      transcriber: async () => {
        await blocked;
        throw new Error('aborted');
      },
    });
    try {
      speechEnd(wav);
      await tick();
      unwire();
      release();
      await tick();
      expect(await fileExists(wav)).toBe(false);
    } finally {
      release();
      unwire();
      if (previousDir === undefined) delete process.env.BUDDY_EAR_WAV_DIR;
      else process.env.BUDDY_EAR_WAV_DIR = previousDir;
      if (previousKeep === undefined) delete process.env[SPEECH_KEEP_WAV_ENV];
      else process.env[SPEECH_KEEP_WAV_ENV] = previousKeep;
    }
  });

  it('removes a superseded pending WAV without touching the latest queued one', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-wav-pending-'));
    const companionDir = path.join(tmp, 'companion');
    const wavs = [1, 2, 3].map(index => path.join(companionDir, `utt-${Date.now() + index}.wav`));
    await mkdir(companionDir, { recursive: true });
    await Promise.all(wavs.map(wav => writeFile(wav, 'temporary audio')));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const previousDir = process.env.BUDDY_EAR_WAV_DIR;
    const previousKeep = process.env[SPEECH_KEEP_WAV_ENV];
    process.env.BUDDY_EAR_WAV_DIR = companionDir;
    delete process.env[SPEECH_KEEP_WAV_ENV];
    const calls: string[] = [];
    const unwire = wireSpeechReaction({
      debounceMs: 0,
      cwd: tmp,
      transcriber: async (wav) => {
        calls.push(wav);
        if (wav === wavs[0]) await blocked;
        return 'texte';
      },
    });
    try {
      speechEnd(wavs[0]);
      await tick();
      speechEnd(wavs[1]);
      speechEnd(wavs[2]);
      await tick();
      expect(await fileExists(wavs[1]!)).toBe(false);
      expect(await fileExists(wavs[2]!)).toBe(true);
      release();
      await tick();
      await tick();
      expect(calls).toEqual([wavs[0], wavs[2]]);
      expect(await fileExists(wavs[0]!)).toBe(false);
      expect(await fileExists(wavs[2]!)).toBe(false);
    } finally {
      release();
      unwire();
      if (previousDir === undefined) delete process.env.BUDDY_EAR_WAV_DIR;
      else process.env.BUDDY_EAR_WAV_DIR = previousDir;
      if (previousKeep === undefined) delete process.env[SPEECH_KEEP_WAV_ENV];
      else process.env[SPEECH_KEEP_WAV_ENV] = previousKeep;
    }
  });

  it('never deletes arbitrary paths and honours the debug retention switch', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-wav-guard-'));
    const companionDir = path.join(tmp, 'companion');
    const outsideDir = path.join(tmp, 'outside');
    const wrongName = path.join(companionDir, 'recording.wav');
    const outside = path.join(outsideDir, `utt-${Date.now()}.wav`);
    const retained = path.join(companionDir, `utt-${Date.now() + 1}.wav`);
    await mkdir(companionDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await Promise.all([
      writeFile(wrongName, 'keep'),
      writeFile(outside, 'keep'),
      writeFile(retained, 'keep'),
    ]);
    const previousDir = process.env.BUDDY_EAR_WAV_DIR;
    const previousKeep = process.env[SPEECH_KEEP_WAV_ENV];
    process.env.BUDDY_EAR_WAV_DIR = companionDir;
    delete process.env[SPEECH_KEEP_WAV_ENV];
    const unwire = wireSpeechReaction({ transcriber: async () => 'texte', debounceMs: 0, cwd: tmp });
    try {
      speechEnd(wrongName);
      await tick();
      speechEnd(outside);
      await tick();
      process.env[SPEECH_KEEP_WAV_ENV] = 'true';
      speechEnd(retained);
      await tick();
      expect(await fileExists(wrongName)).toBe(true);
      expect(await fileExists(outside)).toBe(true);
      expect(await fileExists(retained)).toBe(true);
    } finally {
      unwire();
      if (previousDir === undefined) delete process.env.BUDDY_EAR_WAV_DIR;
      else process.env.BUDDY_EAR_WAV_DIR = previousDir;
      if (previousKeep === undefined) delete process.env[SPEECH_KEEP_WAV_ENV];
      else process.env[SPEECH_KEEP_WAV_ENV] = previousKeep;
    }
  });
});

describe('speech reaction — live transcript_final (buddy-sense live-audio)', () => {
  it('drives cognition from the payload text WITHOUT calling the transcriber', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-live-'));
    let sttCalls = 0;
    const transcriber: Transcriber = async () => {
      sttCalls += 1; // must NEVER fire on the live path
      return 'should-not-run';
    };
    let heard = '';
    const unwire = wireSpeechReaction({
      transcriber,
      debounceMs: 3000,
      cwd: tmp,
      now: () => 1000,
      onHeard: (t) => {
        heard = t;
      },
    });
    try {
      transcriptFinal('Bonjour Lisa', { ms: 1200 });
      await tick();
      expect(sttCalls).toBe(0); // text already decoded in buddy-sense → no STT here
      expect(heard).toBe('Bonjour Lisa');

      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      expect(percepts).toContain('Bonjour Lisa');
      expect(percepts).toContain('"live":true'); // recorded as the live-mic path, no fake wav
    } finally {
      unwire();
    }
  });

  it('honours the shouldRespond gate on the live path too', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-live-'));
    let heard = 0;
    const unwire = wireSpeechReaction({
      transcriber: async () => 'unused',
      debounceMs: 0,
      cwd: tmp,
      now: () => 1000,
      shouldRespond: async () => ({ respond: false, reason: 'ambient' }),
      onHeard: () => {
        heard += 1;
      },
    });
    try {
      transcriptFinal('il fait beau');
      await tick();
      expect(heard).toBe(0); // vetoed → silent, but still observed
      const percepts = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      expect(percepts).toContain('il fait beau');
    } finally {
      unwire();
    }
  });

  it('ignores an empty live transcript', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-live-'));
    let heard = 0;
    const unwire = wireSpeechReaction({
      transcriber: async () => 'unused',
      debounceMs: 0,
      cwd: tmp,
      now: () => 1000,
      onHeard: () => {
        heard += 1;
      },
    });
    try {
      transcriptFinal('   '); // whitespace only → dropped before any job
      await tick();
      expect(heard).toBe(0);
    } finally {
      unwire();
    }
  });
});
