import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  makeVoiceReply,
  defaultStreamReply,
  immediateThinkingAcknowledgement,
  type VoiceReplyTiming,
  type VoiceStepOptions,
} from '../../src/sensory/voice-loop.js';
import {
  streamToSpeech,
  SentenceAssembler,
  safeCommitLength,
} from '../../src/sensory/voice-stream.js';
import {
  classifyRecentVoiceEcho,
  isSpeaking,
  _resetVoiceActivityForTests,
} from '../../src/sensory/voice-activity.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Streaming voice pipeline (Lot 3): the reply is spoken sentence-by-sentence as the LLM
 * streams, so time-to-first-audio collapses from LLM(all)+Piper(all) to LLM(s1)+Piper(s1).
 *
 * No mocks: the stream / synth / play boundaries are injected fakes, and the interrupt test
 * spawns a REAL blocking play so the barge-in SIGKILL path is exercised end-to-end.
 */

const passthroughGuard = (fn: () => Promise<void>): Promise<void> => fn();
const noUnlink = async (): Promise<void> => {};

describe('SentenceAssembler — sentence cutting', () => {
  it('cuts on sentence boundaries, in order', () => {
    const a = new SentenceAssembler();
    const out: string[] = [];
    for (const d of ['Bon', 'jour. ', 'Comment ', 'ça va ? ', 'Très bien.']) {
      out.push(...a.push(d));
    }
    out.push(...a.flush());
    expect(out).toEqual(['Bonjour.', 'Comment ça va ?', 'Très bien.']);
  });

  it('never emits until a terminator is followed by whitespace or the stream ends', () => {
    const a = new SentenceAssembler();
    // "3.14" must not split on the inner dot.
    expect(a.push('La valeur est 3.14 ')).toEqual([]);
    expect(a.push('exactement. ')).toEqual(['La valeur est 3.14 exactement.']);
  });

  it('force-cuts a punctuation-less run at the safety cap', () => {
    const a = new SentenceAssembler(200);
    const out: string[] = [];
    for (const s of a.push('a'.repeat(500))) out.push(s);
    for (const s of a.flush()) out.push(s);
    expect(out).toHaveLength(3);
    expect(out.every((s) => s.length <= 200)).toBe(true);
    expect(out.join('').length).toBe(500);
  });

  it('cuts a sufficiently long clause at a comma for lower TTS latency', () => {
    const a = new SentenceAssembler();
    expect(a.push('Je vérifie maintenant cette première partie, puis je continue. ')).toEqual([
      'Je vérifie maintenant cette première partie,',
      'puis je continue.',
    ]);
    expect(a.flush()).toEqual([]);
  });
});

describe('safeCommitLength — never commit across a straddling artifact', () => {
  it('holds back an unclosed <think> block from its opening token', () => {
    const buf = 'Bonjour. <think>ne dis';
    expect(safeCommitLength(buf)).toBe('Bonjour. '.length);
  });

  it('holds back a partial marker prefix at the tail', () => {
    expect(safeCommitLength('Salut.<thi')).toBe('Salut.'.length);
    expect(safeCommitLength('Salut <')).toBe('Salut '.length);
  });

  it('commits fully once the block is closed', () => {
    const buf = 'Bonjour. <think>secret</think> Ça va ?';
    expect(safeCommitLength(buf)).toBe(buf.length);
  });
});

describe('streamToSpeech — pipeline (time-to-first-audio)', () => {
  it('plays sentence 1 BEFORE the stream has finished, and keeps strict order', async () => {
    const playOrder: string[] = [];
    let streamEnded = false;
    let streamEndedAtFirstPlay: boolean | null = null;
    let resolveFirstPlayed!: () => void;
    const firstPlayed = new Promise<void>((r) => (resolveFirstPlayed = r));

    // The stream parks before its LAST chunk until sentence 1 has actually been PLAYED. If the
    // pipeline waited for the whole reply before speaking, this would deadlock.
    const chunks = ['Bon', 'jour. ', 'Comment ', 'ça va ? ', 'Très bien.'];
    async function* stream(): AsyncGenerator<string> {
      for (let i = 0; i < chunks.length; i++) {
        if (i === chunks.length - 1) await firstPlayed;
        yield chunks[i] as string;
      }
      streamEnded = true;
    }

    const result = await streamToSpeech({
      stream: stream(),
      synth: async (t) => `wav:${t}`,
      play: async (wav) => {
        playOrder.push(wav);
        if (streamEndedAtFirstPlay === null) {
          streamEndedAtFirstPlay = streamEnded;
          resolveFirstPlayed();
        }
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    // Proof of pipelining: play(1) happened while the stream was still going.
    expect(streamEndedAtFirstPlay).toBe(false);
    expect(playOrder).toEqual(['wav:Bonjour.', 'wav:Comment ça va ?', 'wav:Très bien.']);
    expect(result.played).toBe(true);
    expect(result.sentences).toEqual(['Bonjour.', 'Comment ça va ?', 'Très bien.']);
    expect(result.aborted).toBe(false);
  });

  it('uses a native synth+play stream without creating temporary WAV files', async () => {
    const spoken: string[] = [];
    const synth = vi.fn(async () => 'unused.wav');
    const play = vi.fn(async () => undefined);
    async function* stream(): AsyncGenerator<string> {
      yield 'Première phrase. Deuxième phrase.';
    }

    const result = await streamToSpeech({
      stream: stream(),
      synth,
      play,
      streamSpeak: async (text) => {
        spoken.push(text);
        return true;
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    expect(spoken).toEqual(['Première phrase.', 'Deuxième phrase.']);
    expect(synth).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(result).toMatchObject({ played: true, aborted: false });
  });

  it('falls back per segment after native streaming fails without losing the LLM reply', async () => {
    const nativeSpeak = vi.fn(async () => false);
    const synthesized: string[] = [];
    const played: string[] = [];
    async function* stream(): AsyncGenerator<string> {
      yield 'Première phrase. Deuxième phrase.';
    }

    const result = await streamToSpeech({
      stream: stream(),
      streamSpeak: nativeSpeak,
      synth: async (text) => {
        synthesized.push(text);
        return `wav:${text}`;
      },
      play: async (wav) => {
        played.push(wav);
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    // One failed startup is enough: the rest of this turn stays on the reliable
    // fallback instead of retrying Pocket or regenerating the answer.
    expect(nativeSpeak).toHaveBeenCalledTimes(1);
    expect(synthesized).toEqual(['Première phrase.', 'Deuxième phrase.']);
    expect(played).toEqual(['wav:Première phrase.', 'wav:Deuxième phrase.']);
    expect(result).toMatchObject({
      played: true,
      spoken: 'Première phrase. Deuxième phrase.',
      fallbackSegments: 2,
    });
  });

  it('recovers from a thrown native stream error and keeps later segments in order', async () => {
    const nativeSpeak = vi.fn(async () => {
      throw new Error('Pocket pipe closed');
    });
    const played: string[] = [];
    async function* stream(): AsyncGenerator<string> {
      yield 'Un. Deux.';
    }

    const result = await streamToSpeech({
      stream: stream(),
      streamSpeak: nativeSpeak,
      synth: async (text) => `wav:${text}`,
      play: async (wav) => {
        played.push(wav);
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    expect(nativeSpeak).toHaveBeenCalledTimes(1);
    expect(played).toEqual(['wav:Un.', 'wav:Deux.']);
    expect(result.sentences).toEqual(['Un.', 'Deux.']);
    expect(result.fallbackSegments).toBe(2);
  });

  it('releases a partial cloud prebuffer on timeout instead of waiting indefinitely', async () => {
    let firstPlayed!: () => void;
    const played = new Promise<void>((resolve) => {
      firstPlayed = resolve;
    });
    async function* stream(): AsyncGenerator<string> {
      yield 'Phrase disponible. ';
      await played;
    }

    const result = await streamToSpeech({
      stream: stream(),
      synth: async (text) => `wav:${text}`,
      play: async () => {
        firstPlayed();
      },
      audioPrebufferMs: () => 10,
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    expect(result).toMatchObject({
      played: true,
      spoken: 'Phrase disponible.',
      aborted: false,
    });
  });

  it('never throws when audio prebuffer configuration fails', async () => {
    async function* stream(): AsyncGenerator<string> {
      yield 'Phrase intacte.';
    }

    await expect(streamToSpeech({
      stream: stream(),
      synth: async (text) => `wav:${text}`,
      play: async () => undefined,
      audioPrebufferMs: () => {
        throw new Error('configuration indisponible');
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    })).resolves.toMatchObject({ played: true, spoken: 'Phrase intacte.' });
  });
});

describe('streamToSpeech — per-sentence sanitize across deltas', () => {
  it('never synthesizes or plays a <think> artifact split over two deltas', async () => {
    const synthArgs: string[] = [];
    const playArgs: string[] = [];
    // "<think>ne dis pas ça</think>" is split across two deltas and glued to the surrounding text.
    const chunks = ['Bonjour. ', 'Je vais bien. ', '<think>ne dis', ' pas ça</think>', 'Et toi ? '];
    async function* stream(): AsyncGenerator<string> {
      for (const c of chunks) yield c;
    }

    const result = await streamToSpeech({
      stream: stream(),
      synth: async (t) => {
        synthArgs.push(t);
        return `wav:${t}`;
      },
      play: async (w) => {
        playArgs.push(w);
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });

    expect(result.sentences).toEqual(['Bonjour.', 'Je vais bien.', 'Et toi ?']);
    // The artifact was never handed to synthesis or playback.
    expect(synthArgs.some((t) => t.includes('<think>') || t.includes('ne dis'))).toBe(false);
    expect(playArgs.some((w) => w.includes('<think>') || w.includes('ne dis'))).toBe(false);
  });
});

describe('streamToSpeech — never-throws', () => {
  it('skips a sentence whose synth throws and keeps speaking the rest', async () => {
    const played: string[] = [];
    async function* stream(): AsyncGenerator<string> {
      yield 'Un. Deux. Trois.';
    }
    const result = await streamToSpeech({
      stream: stream(),
      synth: async (t) => {
        if (t === 'Deux.') throw new Error('piper hiccup');
        return `wav:${t}`;
      },
      play: async (w) => {
        played.push(w);
      },
      guard: passthroughGuard,
      unlink: noUnlink,
    });
    expect(played).toEqual(['wav:Un.', 'wav:Trois.']);
    expect(result.played).toBe(true);
  });

  it('returns played=false (fallback signal) on an empty stream', async () => {
    async function* stream(): AsyncGenerator<string> {
      /* yields nothing */
    }
    const result = await streamToSpeech({
      stream: stream(),
      synth: async (t) => `wav:${t}`,
      play: async () => {},
      guard: passthroughGuard,
      unlink: noUnlink,
    });
    expect(result.played).toBe(false);
    expect(result.spoken).toBe('');
  });
});

describe('makeVoiceReply — streaming integration', () => {
  beforeEach(() => _resetVoiceActivityForTests());

  it('retains the complete streamed turn for merged STT echo detection', async () => {
    const segments = [
      'La mémoire conserve les détails essentiels de chaque conversation.',
      'Le contexte relie ensuite ces souvenirs aux questions présentes.',
      'Cette continuité permet enfin une réponse cohérente et naturelle.',
    ];
    const onHeard = makeVoiceReply({
      streamFn: async function* () {
        yield segments.join(' ');
      },
      streamSpeak: async (_text, options) => {
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      avatarEnabled: false,
    });

    await onHeard('Comment gardes-tu le fil de notre conversation ?');

    expect(
      classifyRecentVoiceEcho(
        'La mémoire conserve les détails essentiels de la conversation. ' +
          'Le contexte relie ces souvenirs aux questions présentes. ' +
          'Cette continuité permet une réponse cohérente et naturelle.',
      ),
    ).toBe('echo');
  });

  it('speaks a deterministic backchannel before the guarded model answer finishes', async () => {
    let releaseModel!: () => void;
    let modelPaused!: () => void;
    const paused = new Promise<void>((resolve) => (modelPaused = resolve));
    const release = new Promise<void>((resolve) => (releaseModel = resolve));
    const spoken: string[] = [];
    async function* stream(): AsyncGenerator<string> {
      yield 'Alors… ';
      modelPaused();
      await release;
      yield "Tu n'as besoin que de moi.";
    }
    const onHeard = makeVoiceReply({
      streamFn: stream,
      streamSpeak: async (text, options) => {
        spoken.push(text);
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      avatarEnabled: false,
    });

    const turn = onHeard('explique-moi cela');
    await paused;
    await vi.waitFor(() => expect(spoken).toEqual(['Alors…']));

    releaseModel();
    await turn;
    expect(spoken.join(' ')).not.toContain("Tu n'as besoin que de moi");
    expect(spoken.join(' ')).toContain('sans remplacer les personnes');
  });

  it('interrupt() while the safety gate is buffering drops the incomplete answer silently', async () => {
    let markStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => (markStreamStarted = resolve));
    const playOrder: string[] = [];

    // Protected companion output is held until the complete response passes
    // policy. Barge-in before completion therefore has nothing to kill or say.
    async function* stream(_heard: string, opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
      yield 'Bonjour. ';
      markStreamStarted();
      await new Promise<void>((resolve) => {
        if (opts?.signal?.aborted) return resolve();
        opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      yield 'Ne dis pas ça.';
    }

    const onHeard = makeVoiceReply({
      streamFn: stream,
      synth: async (t) => `wav:${t}`,
      play: async (wav) => {
        playOrder.push(wav);
      },
    });

    const turn = onHeard('raconte-moi');
    await streamStarted;
    expect(isSpeaking()).toBe(false);
    onHeard.interrupt();
    await turn;

    expect(playOrder).toEqual([]);
    expect(isSpeaking()).toBe(false);
  });

  it('keeps a fully played sentence in continuity when barge-in interrupts the next one', async () => {
    let secondPlaybackStarted!: () => void;
    const secondPlayback = new Promise<void>((resolve) => {
      secondPlaybackStarted = resolve;
    });
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    async function* stream(): AsyncGenerator<string> {
      yield 'Première phrase. Deuxième phrase.';
    }
    const onHeard = makeVoiceReply({
      streamFn: stream,
      synth: async (text) => `wav:${text}`,
      play: async (wav, options) => {
        if (!wav.includes('Deuxième')) return;
        secondPlaybackStarted();
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) return resolve();
          options?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      onConversationTurn: (turn) => turns.push(turn),
    });

    const turn = onHeard('Continue ton explication.');
    await secondPlayback;
    onHeard.interrupt();
    await turn;

    expect(turns).toEqual([
      { role: 'user', content: 'Continue ton explication.' },
      { role: 'assistant', content: 'Première phrase.' },
    ]);
  });

  it('falls back to the blocking replyFn when the stream errors (behavior unchanged)', async () => {
    const calls: string[] = [];
    let spoke = '';
    // eslint-disable-next-line require-yield -- models a provider that throws when streaming starts
    async function* stream(): AsyncGenerator<string> {
      throw new Error('provider has no stream');
    }
    const onHeard = makeVoiceReply({
      streamFn: stream,
      replyFn: async (heard) => {
        calls.push(`reply:${heard}`);
        return 'Réponse bloquante.';
      },
      synth: async (t) => {
        calls.push(`synth:${t}`);
        return '/tmp/x.wav';
      },
      play: async (w) => {
        calls.push(`play:${w}`);
      },
      onSpoke: (t) => {
        spoke = t;
      },
    });

    await onHeard('une vraie question');

    expect(calls).toEqual([
      'reply:une vraie question',
      'synth:Réponse bloquante.',
      'play:/tmp/x.wav',
    ]);
    expect(spoke).toBe('Réponse bloquante.');
  });

  it('falls back to the blocking replyFn when the stream is empty', async () => {
    let spoke = '';
    async function* stream(): AsyncGenerator<string> {
      /* empty */
    }
    const onHeard = makeVoiceReply({
      streamFn: stream,
      replyFn: async () => 'Réponse de secours.',
      synth: async () => '/tmp/x.wav',
      play: async () => {},
      onSpoke: (t) => {
        spoke = t;
      },
    });
    await onHeard('salut');
    expect(spoke).toBe('Réponse de secours.');
  });

  it('never throws when the stream and the blocking fallback both fail', async () => {
    // eslint-disable-next-line require-yield -- models a provider that throws when streaming starts
    async function* stream(): AsyncGenerator<string> {
      throw new Error('stream down');
    }
    const onHeard = makeVoiceReply({
      streamFn: stream,
      replyFn: async () => {
        throw new Error('ollama down');
      },
      synth: async () => '/tmp/x.wav',
      play: async () => {},
    });
    await expect(onHeard('hello')).resolves.toBeUndefined();
  });

  it('automatically uses the stream attached to the hybrid reply', async () => {
    const calls: string[] = [];
    let timing: VoiceReplyTiming | undefined;
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      chitchat: async () => {
        calls.push('blocking');
        return 'Réponse bloquante.';
      },
      chitchatStream: async function* () {
        calls.push('stream');
        yield 'Première phrase. ';
        yield 'Deuxième phrase.';
      },
      agentReply: async () => 'agent',
      classify: () => false,
    });
    const onHeard = makeVoiceReply({
      replyFn: hybrid,
      synth: async (text) => `wav:${text}`,
      play: async (wav) => {
        calls.push(`play:${wav}`);
      },
      onTiming: (value) => {
        timing = value;
      },
    });

    await onHeard('parle-moi');

    expect(calls).toEqual([
      'stream',
      'play:wav:Première phrase.',
      'play:wav:Deuxième phrase.',
    ]);
    expect(timing).toMatchObject({ mode: 'streamed', spoke: true });
    expect(timing?.firstTextMs).toEqual(expect.any(Number));
    expect(timing?.firstSegmentMs).toEqual(expect.any(Number));
    expect(timing?.firstAudioMs).toEqual(expect.any(Number));
  });

  it('synthesizes the first substantive agent sentence before the third arrives', async () => {
    const savedSemanticGate = process.env.CODEBUDDY_SEMANTIC_GATE;
    process.env.CODEBUDDY_SEMANTIC_GATE = 'false';
    let releaseThird!: () => void;
    const firstSynthesized = new Promise<void>((resolve) => {
      releaseThird = resolve;
    });
    let thirdArrived = false;
    let thirdArrivedAtFirstSynth = true;
    const blockingAgent = vi.fn(async () => 'fallback bloquant');
    const agentReply = Object.assign(blockingAgent, {
      stream: async function* (): AsyncGenerator<string> {
        yield 'Première phrase vérifiée. ';
        yield 'Deuxième phrase vérifiée. ';
        await firstSynthesized;
        thirdArrived = true;
        yield 'Troisième phrase vérifiée.';
      },
    });
    const synthesized: string[] = [];
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => null,
      jokes: () => null,
      chitchat: async () => 'unused',
      chitchatStream: async function* () {
        yield 'unused';
      },
      agentReply,
      classify: () => true,
    });
    const onHeard = makeVoiceReply({
      replyFn: hybrid,
      synth: async (text) => {
        synthesized.push(text);
        if (synthesized.length === 1) {
          thirdArrivedAtFirstSynth = thirdArrived;
          releaseThird();
        }
        return `wav:${text}`;
      },
      play: async () => undefined,
      avatarEnabled: false,
    });

    try {
      await onHeard('Vérifie le statut du service.');

      expect(thirdArrivedAtFirstSynth).toBe(false);
      expect(synthesized).toEqual([
        'Première phrase vérifiée.',
        'Deuxième phrase vérifiée.',
        'Troisième phrase vérifiée.',
      ]);
      expect(blockingAgent).not.toHaveBeenCalled();
    } finally {
      if (savedSemanticGate === undefined) delete process.env.CODEBUDDY_SEMANTIC_GATE;
      else process.env.CODEBUDDY_SEMANTIC_GATE = savedSemanticGate;
    }
  });

  it('prebuffers cloud audio until a second segment is ready', async () => {
    const savedPrebuffer = process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS;
    process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS = '1000';
    let releaseThird!: () => void;
    const thirdGate = new Promise<void>((resolve) => {
      releaseThird = resolve;
    });
    let firstSynthesized!: () => void;
    const firstSynth = new Promise<void>((resolve) => {
      firstSynthesized = resolve;
    });
    const events: string[] = [];
    const onHeard = makeVoiceReply({
      streamFn: async function* (_heard, options) {
        options?.onProviderResolved?.({
          model: 'cloud-agent',
          apiKey: 'cloud-key',
          baseURL: 'https://voice.example/v1',
        });
        yield 'Première phrase distante. ';
        yield 'Deuxième phrase distante. ';
        await thirdGate;
        yield 'Troisième phrase distante.';
      },
      replyFn: async () => 'fallback',
      synth: async (text) => {
        events.push(`synth:${text}`);
        if (text.startsWith('Première')) firstSynthesized();
        return `wav:${text}`;
      },
      play: async (wav) => {
        events.push(`play:${wav.slice(4)}`);
      },
      avatarEnabled: false,
    });

    try {
      const turn = onHeard('Question distante.');
      await firstSynth;
      await Promise.resolve();
      expect(events).toEqual(['synth:Première phrase distante.']);
      releaseThird();
      await turn;

      const firstPlay = events.indexOf('play:Première phrase distante.');
      const secondSynth = events.indexOf('synth:Deuxième phrase distante.');
      expect(secondSynth).toBeGreaterThanOrEqual(0);
      expect(firstPlay).toBeGreaterThan(secondSynth);
      expect(events.filter((event) => event.startsWith('play:'))).toEqual([
        'play:Première phrase distante.',
        'play:Deuxième phrase distante.',
        'play:Troisième phrase distante.',
      ]);
    } finally {
      if (savedPrebuffer === undefined) delete process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS;
      else process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS = savedPrebuffer;
    }
  });

  it('starts local playback immediately without cloud prebuffer', async () => {
    const savedPrebuffer = process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS;
    process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS = '1000';
    let releaseThird!: () => void;
    const thirdGate = new Promise<void>((resolve) => {
      releaseThird = resolve;
    });
    let firstPlayed!: () => void;
    const firstPlay = new Promise<void>((resolve) => {
      firstPlayed = resolve;
    });
    const played: string[] = [];
    const onHeard = makeVoiceReply({
      streamFn: async function* (_heard, options) {
        options?.onProviderResolved?.({
          model: 'local-agent',
          apiKey: 'ollama',
          baseURL: 'http://127.0.0.1:11434/v1',
        });
        yield 'Première phrase locale. ';
        yield 'Deuxième phrase locale. ';
        await thirdGate;
        yield 'Troisième phrase locale.';
      },
      replyFn: async () => 'fallback',
      synth: async (text) => `wav:${text}`,
      play: async (wav) => {
        played.push(wav.slice(4));
        if (played.length === 1) firstPlayed();
      },
      avatarEnabled: false,
    });

    try {
      const turn = onHeard('Question locale.');
      await firstPlay;
      expect(played).toEqual(['Première phrase locale.']);
      releaseThird();
      await turn;
      expect(played).toEqual([
        'Première phrase locale.',
        'Deuxième phrase locale.',
        'Troisième phrase locale.',
      ]);
    } finally {
      if (savedPrebuffer === undefined) delete process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS;
      else process.env.CODEBUDDY_VOICE_AUDIO_PREBUFFER_MS = savedPrebuffer;
    }
  });

  it('records provider, review, relationship-release and content-audio phases independently', async () => {
    let clock = 1_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let timing: VoiceReplyTiming | undefined;
    try {
      const onHeard = makeVoiceReply({
        streamFn: async function* (_heard, options) {
          clock = 1_010;
          options?.onReplyTimingPhase?.('prompt_ready');
          clock = 1_020;
          options?.onReplyTimingPhase?.('provider_first_delta');
          yield 'Première phrase utile.';
          clock = 1_030;
          options?.onReplyTimingPhase?.('generation_complete');
          clock = 1_040;
          options?.onReplyTimingPhase?.('semantic_review_complete');
        },
        streamSpeak: async (_text, options) => {
          clock = 1_050;
          options?.onFirstAudio?.();
          return true;
        },
        synth: async () => '',
        play: async () => undefined,
        avatarEnabled: false,
        onTiming: (value) => {
          timing = value;
        },
      });

      await onHeard('Donne une réponse argumentée.');

      expect(timing).toMatchObject({
        mode: 'streamed',
        promptReadyMs: 10,
        providerFirstDeltaMs: 20,
        firstTextMs: 20,
        generationCompleteMs: 30,
        semanticReviewCompleteMs: 40,
        firstSafeReleaseMs: 40,
        firstContentAudioMs: 50,
        spoke: true,
      });
    } finally {
      now.mockRestore();
    }
  });

  it('keeps spoken-prefix and continuation phases separate and reports only raw-free causes', async () => {
    let clock = 2_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const logs: string[] = [];
    const info = vi.spyOn(logger, 'info').mockImplementation((message) => {
      logs.push(String(message));
    });
    let timing: VoiceReplyTiming | undefined;
    const secretCandidate = 'Proposition privée de test.';
    try {
      const blocking = vi.fn(async () => 'unused');
      const replyFn = Object.assign(blocking, {
        spokenPrefix: async (_heard: string, options?: VoiceStepOptions) => {
          clock = 2_010;
          options?.onReplyTimingPhase?.('prefix_prompt_ready');
          clock = 2_020;
          options?.onReplyTimingPhase?.('prefix_generation_complete');
          options?.onSpokenPrefixTelemetry?.('accepted');
          return secretCandidate;
        },
        stream: async function* (_heard: string, options?: VoiceStepOptions) {
          clock = 2_030;
          options?.onReplyTimingPhase?.('continuation_prompt_ready');
          clock = 2_040;
          options?.onReplyTimingPhase?.('continuation_provider_first_delta');
          yield 'Continuation validée.';
          clock = 2_050;
          options?.onReplyTimingPhase?.('continuation_generation_complete');
        },
      });
      const onHeard = makeVoiceReply({
        replyFn,
        streamSpeak: async (_text, options) => {
          clock = 2_060;
          options?.onFirstAudio?.();
          return true;
        },
        synth: async () => '',
        play: async () => undefined,
        avatarEnabled: false,
        onTiming: (value) => {
          timing = value;
        },
      });

      await onHeard('Question privée de test.');

      expect(timing).toMatchObject({
        spokenPrefix: {
          outcome: 'accepted',
          causes: ['accepted'],
          promptReadyMs: 10,
          generationCompleteMs: 20,
        },
        continuation: {
          promptReadyMs: 30,
          providerFirstDeltaMs: 40,
          generationCompleteMs: 50,
        },
      });
      expect(timing?.providerFirstDeltaMs).toBeUndefined();
      expect(timing?.generationCompleteMs).toBeUndefined();
      const pilotLog = logs.find((line) => line.includes('spoken-prefix pilot')) ?? '';
      expect(pilotLog).toContain('outcome=accepted');
      expect(pilotLog).not.toContain(secretCandidate);
      expect(pilotLog).not.toContain('Question privée');
    } finally {
      info.mockRestore();
      now.mockRestore();
    }
  });

  it('sends a prefetched shortcut through the progressive audio path', async () => {
    const calls: string[] = [];
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let timing: VoiceReplyTiming | undefined;
    const hybrid = makeHybridReply({
      fastReply: () => null,
      prefetch: () => 'Première actualité. Deuxième actualité.',
      jokes: () => null,
      chitchat: async () => {
        throw new Error('blocking chitchat must not run');
      },
      // eslint-disable-next-line require-yield -- this path must remain unreachable
      chitchatStream: async function* () {
        throw new Error('LLM stream must not run');
      },
      agentReply: async () => {
        throw new Error('agent must not run');
      },
      classify: () => true,
    });
    const onHeard = makeVoiceReply({
      replyFn: hybrid,
      streamSpeak: async (text, options) => {
        calls.push(text);
        options?.onFirstAudio?.();
        return true;
      },
      synth: async () => '',
      play: async () => undefined,
      avatarEnabled: false,
      onConversationTurn: (turn) => {
        turns.push(turn);
      },
      onTiming: (value) => {
        timing = value;
      },
    });

    await onHeard("quelles sont les actualités aujourd'hui ?");

    expect(calls).toEqual(['Première actualité.', 'Deuxième actualité.']);
    expect(turns).toEqual([
      { role: 'user', content: "quelles sont les actualités aujourd'hui ?" },
      { role: 'assistant', content: 'Première actualité. Deuxième actualité.' },
    ]);
    expect(timing).toMatchObject({
      mode: 'streamed',
      spoke: true,
      firstTextMs: expect.any(Number),
      firstSegmentMs: expect.any(Number),
      firstAudioMs: expect.any(Number),
    });
  });
});

describe('makeVoiceReply — validated spoken prefix continuity', () => {
  it('speaks prefix then continuation and mirrors one canonical assistant turn', async () => {
    const blocking = vi.fn(async () => 'MUST_NOT_FALL_BACK');
    const seenPrefix: Array<string | undefined> = [];
    const replyFn = Object.assign(blocking, {
      spokenPrefix: async () => 'Une IA peut manifester un attachement fonctionnel.',
      stream: async function* (_heard: string, opts?: { spokenPrefix?: string }) {
        seenPrefix.push(opts?.spokenPrefix);
        yield "Cela ne prouve toutefois pas qu'elle possède une expérience subjective.";
      },
    });
    const played: string[] = [];
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    let timing: VoiceReplyTiming | undefined;
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async (text) => `wav:${text}`,
      play: async (wav) => {
        played.push(wav.slice(4));
      },
      onConversationTurn: (turn) => turns.push(turn),
      onTiming: (value) => {
        timing = value;
      },
    });

    await onHeard("Penses-tu qu'une IA peut aimer ?");

    expect(seenPrefix).toEqual(['Une IA peut manifester un attachement fonctionnel.']);
    expect(played).toEqual([
      'Une IA peut manifester un attachement fonctionnel.',
      "Cela ne prouve toutefois pas qu'elle possède une expérience subjective.",
    ]);
    expect(blocking).not.toHaveBeenCalled();
    expect(timing).toMatchObject({
      mode: 'streamed',
      firstSafeReleaseMs: expect.any(Number),
      firstContentAudioMs: expect.any(Number),
    });
    expect(turns).toEqual([
      { role: 'user', content: "Penses-tu qu'une IA peut aimer ?" },
      {
        role: 'assistant',
        content:
          "Une IA peut manifester un attachement fonctionnel. Cela ne prouve toutefois pas qu'elle possède une expérience subjective.",
      },
    ]);
  });

  it('mirrors only a fully played prefix when barge-in interrupts the continuation', async () => {
    let continuationStarted!: () => void;
    const continuationPlaying = new Promise<void>((resolve) => {
      continuationStarted = resolve;
    });
    const blocking = vi.fn(async () => 'MUST_NOT_FALL_BACK');
    const replyFn = Object.assign(blocking, {
      spokenPrefix: async () => 'La liberté suppose au moins une capacité de choisir.',
      stream: async function* () {
        yield 'Cette capacité reste pourtant contrainte par notre histoire.';
      },
    });
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async (text) => `wav:${text}`,
      play: async (wav, opts) => {
        if (!wav.includes('Cette capacité')) return;
        continuationStarted();
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) return resolve();
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      onConversationTurn: (turn) => turns.push(turn),
    });

    const turn = onHeard('La conscience fonde-t-elle notre liberté ?');
    await continuationPlaying;
    onHeard.interrupt();
    await turn;

    expect(blocking).not.toHaveBeenCalled();
    expect(turns).toEqual([
      { role: 'user', content: 'La conscience fonde-t-elle notre liberté ?' },
      { role: 'assistant', content: 'La liberté suppose au moins une capacité de choisir.' },
    ]);
  });

  it('does not mirror a prefix interrupted before playback completes', async () => {
    let prefixStarted!: () => void;
    const prefixPlaying = new Promise<void>((resolve) => {
      prefixStarted = resolve;
    });
    const blocking = vi.fn(async () => 'MUST_NOT_FALL_BACK');
    const replyFn = Object.assign(blocking, {
      spokenPrefix: async () => 'Une relation utile exige de préserver la liberté de chacun.',
      stream: async function* () {
        yield 'La suite ne doit pas être considérée comme entendue.';
      },
    });
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async (text) => `wav:${text}`,
      play: async (wav, opts) => {
        if (!wav.includes('Une relation utile')) return;
        prefixStarted();
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) return resolve();
          opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      onConversationTurn: (turn) => turns.push(turn),
    });

    const turn = onHeard('Que rend une relation réellement saine ?');
    await prefixPlaying;
    onHeard.interrupt();
    await turn;

    expect(blocking).not.toHaveBeenCalled();
    expect(turns).toEqual([
      { role: 'user', content: 'Que rend une relation réellement saine ?' },
    ]);
  });

  it('never falls back to the blocking answer after a prefix was played', async () => {
    const blocking = vi.fn(async () => 'DUPLICATE_BLOCKING_ANSWER');
    const replyFn = Object.assign(blocking, {
      spokenPrefix: async () => 'Une première conclusion prudente reste déjà utile.',
      // eslint-disable-next-line require-yield -- models a continuation transport failure
      stream: async function* () {
        throw new Error('continuation unavailable');
      },
    });
    const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async (text) => `wav:${text}`,
      play: async () => undefined,
      onConversationTurn: (turn) => turns.push(turn),
    });

    await onHeard('Développe cette idée.');

    expect(blocking).not.toHaveBeenCalled();
    expect(turns.at(-1)).toEqual({
      role: 'assistant',
      content: 'Une première conclusion prudente reste déjà utile.',
    });
  });
});

describe('defaultStreamReply — instant prefixes and phatic fallback', () => {
  it('yields nothing for a phatic utterance (blocking path answers it instead)', async () => {
    const chunks: string[] = [];
    for await (const c of defaultStreamReply('bonjour')) chunks.push(c);
    expect(chunks).toEqual([]);
  });

  it('yields an emotional acknowledgement before starting the model continuation', async () => {
    const stream = defaultStreamReply(
      "ce soir j'ai le moral vraiment bas et j'aimerais un peu de compagnie"
    );
    const first = await stream.next();
    expect(first).toMatchObject({ done: false, value: 'Je suis là avec toi. ' });
    await stream.return();
  });

  it('yields a prewarmable thinking backchannel before an ordinary question', async () => {
    const previous = process.env.CODEBUDDY_VOICE_BACKCHANNEL;
    process.env.CODEBUDDY_VOICE_BACKCHANNEL = 'true';
    try {
      const stream = defaultStreamReply('Pourquoi le ciel est bleu ?');
      const first = await stream.next();
      expect(['Alors… ', 'Voyons ça. ']).toContain(first.value);
      await stream.return();
    } finally {
      if (previous === undefined) delete process.env.CODEBUDDY_VOICE_BACKCHANNEL;
      else process.env.CODEBUDDY_VOICE_BACKCHANNEL = previous;
    }
  });

  it('skips generic filler by default on the fast local lane', () => {
    expect(immediateThinkingAcknowledgement('Pourquoi le ciel est bleu ?', {})).toBeNull();
    expect(immediateThinkingAcknowledgement('Pourquoi le ciel est bleu ?', {
      CODEBUDDY_VOICE_BACKCHANNEL: 'true',
    })).toEqual(expect.any(String));
  });

  it('a phatic reply through the default stream falls back to the blocking canned reply', async () => {
    _resetVoiceActivityForTests();
    const synthTexts: string[] = [];
    let spoke = '';
    const onHeard = makeVoiceReply({
      // Default LLM stream (phatic → yields nothing) + a blocking replyFn standing in for the
      // instant canned reply. Proves phatic is answered whole, not sentence-streamed.
      streamFn: defaultStreamReply,
      replyFn: async () => "Bonjour ! Je t'écoute.",
      synth: async (t) => {
        synthTexts.push(t);
        return '/tmp/x.wav';
      },
      play: async () => {},
      onSpoke: (t) => {
        spoke = t;
      },
    });
    await onHeard('bonjour');
    expect(spoke).toBe("Bonjour ! Je t'écoute.");
    expect(synthTexts).toEqual(["Bonjour ! Je t'écoute."]); // one synth of the whole line, not per-sentence
  });
});
