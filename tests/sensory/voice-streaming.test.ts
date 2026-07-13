import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  makeVoiceReply,
  defaultStreamReply,
  immediateThinkingAcknowledgement,
  type PlayFn,
  type VoiceReplyTiming,
} from '../../src/sensory/voice-loop.js';
import {
  streamToSpeech,
  SentenceAssembler,
  safeCommitLength,
} from '../../src/sensory/voice-stream.js';
import { isSpeaking, _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';
import { makeHybridReply } from '../../src/sensory/hybrid-reply.js';

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

  it('interrupt() mid-playback kills the audio, drops later sentences, resets the guard', async () => {
    let killCount = 0;
    let markPlaying!: () => void;
    const playing = new Promise<void>((r) => (markPlaying = r));
    const playOrder: string[] = [];

    // Real blocking play: hangs until the barge-in signal SIGKILLs it (like production).
    const play: PlayFn = (wav, opts) =>
      new Promise<void>((resolve) => {
        playOrder.push(wav);
        markPlaying();
        if (opts?.signal?.aborted) return resolve();
        opts?.signal?.addEventListener(
          'abort',
          () => {
            killCount += 1;
            resolve();
          },
          { once: true },
        );
      });

    // Stream yields sentence 1, then parks on the signal, then (post-abort) a sentence that
    // must NEVER be played.
    async function* stream(_heard: string, opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
      yield 'Bonjour. ';
      await new Promise<void>((resolve) => {
        if (opts?.signal?.aborted) return resolve();
        opts?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      yield 'Ne dis pas ça.';
    }

    const onHeard = makeVoiceReply({
      streamFn: stream,
      synth: async (t) => `wav:${t}`,
      play,
    });

    const turn = onHeard('raconte-moi');
    await playing; // sentence 1 is in the speaker
    expect(isSpeaking()).toBe(true); // half-duplex guard up
    onHeard.interrupt(); // barge-in
    await turn;

    expect(killCount).toBe(1); // the audio child was killed on demand
    expect(playOrder).toEqual(['wav:Bonjour.']); // only sentence 1 ever played
    expect(isSpeaking()).toBe(false); // guard hard-reset → the ear re-opens now
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
