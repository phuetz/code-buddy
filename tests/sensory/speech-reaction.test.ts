import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  normalizeSpeechTranscript,
  isBargeInTranscript,
  resolveFasterWhisperOptions,
  wireSpeechReaction,
  type Transcriber,
} from '../../src/sensory/speech-reaction.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

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

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('speech reaction — speech_end → STT → percept', () => {
  it('recognizes only explicit spoken stop commands as barge-in', () => {
    expect(isBargeInTranscript('Lisa, arrête !')).toBe(true);
    expect(isBargeInTranscript('Stop maintenant')).toBe(true);
    expect(isBargeInTranscript('Lisa stop le serveur')).toBe(false);
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
        sampleRate: 16000,
      });
      await tick();

      const raw = await readFile(path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl'), 'utf8');
      const percept = JSON.parse(raw.trim()) as { payload: { responded: boolean; latency: Record<string, number>; capture: Record<string, unknown> } };
      expect(percept.payload.responded).toBe(true);
      expect(percept.payload.latency.sttMs).toBe(120);
      expect(percept.payload.latency.decisionMs).toBe(30);
      expect(percept.payload.latency.actionMs).toBe(250);
      expect(percept.payload.latency.totalMs).toBe(400);
      expect(percept.payload.capture.device).toBe('plughw:CARD=BRIO,DEV=0');
      expect(percept.payload.capture.peakRms).toBe(0.08);
      expect(percept.payload.capture.avgRms).toBe(0.035);
      expect(percept.payload.capture.rmsOn).toBe(0.02);
      expect(percept.payload.capture.writeMs).toBe(7);
    } finally {
      unwire();
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
