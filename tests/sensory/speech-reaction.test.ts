import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { wireSpeechReaction, type Transcriber } from '../../src/sensory/speech-reaction.js';
import { createResponseDecider } from '../../src/sensory/respond-decider.js';
import { getGlobalEventBus } from '../../src/events/event-bus.js';

function speechEnd(wav?: string): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: { modality: 'audio', kind: 'speech_end', payload: wav ? { wav } : {} },
  });
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

describe('speech reaction — speech_end → STT → percept', () => {
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

  it('integration smoke: the REAL decider gates the REAL speech-reaction (synthetic events)', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'speech-'));
    let clock = 1000;
    // chime-in off (default) → addressed-only.
    const decider = createResponseDecider({ now: () => clock, recentContext: async () => [] });
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
