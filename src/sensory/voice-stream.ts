/**
 * Streaming voice pipeline — speak from the FIRST sentence instead of blocking on the
 * whole reply.
 *
 * The classic voice loop is fully serial: `LLM(all) → Piper(all) → play(all)`. The
 * time-to-first-audio is therefore the WHOLE generation plus the WHOLE synthesis. This
 * module turns it into a three-stage pipeline:
 *
 *   producer  : consume the LLM token deltas, cut them into sentences as they arrive
 *   synth     : synthesize each ready sentence to a WAV (runs AHEAD of playback)
 *   play      : play the WAVs strictly in order, under a single half-duplex guard
 *
 * so playback of sentence 1 starts while the LLM is still streaming sentence 2+ and
 * Piper is synthesizing ahead. Time-to-first-audio collapses to `LLM(s1) + Piper(s1)`.
 *
 * Correctness of the per-sentence sanitize is the load-bearing subtlety: a leaked model
 * control token (`<think>…</think>`, `<|im_start|>`, `[INST]…`) can straddle two deltas.
 * `SentenceAssembler` never commits a sentence across an unterminated marker (see
 * `safeCommitLength`), so `prepareSpeech` always sees a complete artifact and strips it —
 * the speaker never plays half a `<think>` block.
 *
 * Everything I/O is INJECTABLE (synth / play / guard / unlink) so the pipeline is
 * deterministically testable with no model, no Piper, no audio device. Never-throws: a
 * failure of one sentence is skipped, a stream error ends the pipeline (the caller then
 * falls back to the blocking path). No `Date.now()` / `Math.random()` here — the ordering
 * is a FIFO, not a clock.
 *
 * @module sensory/voice-stream
 */

import { logger } from '../utils/logger.js';
import { prepareSpeech } from './speech-sanitizer.js';
import { withSpeakingGuard } from './voice-activity.js';
import type { SynthFn, PlayFn } from './voice-loop.js';

/** Default safety cap: force a sentence break after this many chars with no punctuation. */
export const DEFAULT_SENTENCE_CAP = 200;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Sentence assembly (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Paired block markers whose OPEN token without its CLOSE means "an artifact is still
 * being streamed" — everything from the open onward must be held until the close arrives,
 * so a sentence is never committed mid-block.
 */
const BLOCK_PAIRS: ReadonlyArray<readonly [open: string, close: string]> = [
  ['<think>', '</think>'],
  ['<reasoning>', '</reasoning>'],
  ['<<SYS>>', '<</SYS>>'],
  ['[INST]', '[/INST]'],
];

/** Marker tokens whose PARTIAL prefix at the buffer tail must be held (it may still grow). */
const MARKER_TOKENS: readonly string[] = [
  '<think>',
  '</think>',
  '<reasoning>',
  '</reasoning>',
  '<<SYS>>',
  '<</SYS>>',
  '[INST]',
  '[/INST]',
];

/**
 * Longest prefix of `buffer` that is SAFE to sanitize and emit — i.e. that cannot contain
 * a leaked-token artifact which a later delta would complete. Holds back:
 *   1. any unclosed paired block (`<think>…` with no `</think>` yet) from its opening token;
 *   2. an unterminated ChatML/control token at the tail (`<|…` with no `|>`, full-width GLM5);
 *   3. a trailing fragment that is a prefix of a known marker (`<thi`, `[/IN`, a lone `<`).
 * On a full flush the caller passes the whole buffer to `prepareSpeech`, which strips any
 * still-unterminated block by itself, so nothing leaks at end-of-stream either.
 */
export function safeCommitLength(buffer: string): number {
  let limit = buffer.length;

  // 1) Unclosed paired block → hold from the opening token.
  for (const [open, close] of BLOCK_PAIRS) {
    let searchFrom = 0;
    while (true) {
      const o = buffer.indexOf(open, searchFrom);
      if (o < 0) break;
      const c = buffer.indexOf(close, o + open.length);
      if (c < 0) {
        limit = Math.min(limit, o);
        break;
      }
      searchFrom = c + close.length;
    }
  }

  // 2) Unterminated ChatML/control token at the tail: `<|…` with no closing `|>`.
  const openPipe = buffer.lastIndexOf('<|');
  if (openPipe >= 0 && buffer.indexOf('|>', openPipe + 2) < 0) {
    limit = Math.min(limit, openPipe);
  }
  // 2b) Full-width GLM5 open `＜｜…` with no closing `｜＞`.
  const openFw = buffer.lastIndexOf('＜｜');
  if (openFw >= 0 && buffer.indexOf('｜＞', openFw + 2) < 0) {
    limit = Math.min(limit, openFw);
  }

  // 3) Trailing partial marker prefix — hold it back (it might complete on the next delta).
  for (const m of MARKER_TOKENS) {
    const maxK = Math.min(m.length - 1, buffer.length);
    for (let k = maxK; k >= 1; k--) {
      if (buffer.endsWith(m.slice(0, k))) {
        limit = Math.min(limit, buffer.length - k);
        break;
      }
    }
  }

  return Math.max(0, limit);
}

/** Terminator run (`.` `!` `?` `…`, repeated) plus any trailing closing quote/bracket. */
function findBoundary(working: string, from: number, flush: boolean): number {
  const re = /[.!?…]+[)\]"'”»’]*/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(working)) !== null) {
    const after = m.index + m[0].length;
    if (after >= working.length) {
      // Terminator at the very end: a real boundary only once we know whitespace/EOS follows.
      return flush ? after : -1;
    }
    const next = working[after];
    if (next !== undefined && /\s/.test(next)) return after;
    // Terminator not followed by whitespace (e.g. "3.14", "M.Dupont") — keep scanning.
  }
  return flush ? working.length : -1;
}

/** Pick a cut point for the safety cap — prefer the last whitespace in the window, else hard-cut. */
function chooseCut(working: string, from: number, cap: number): number {
  const hardEnd = from + cap;
  const minCut = from + Math.floor(cap / 2);
  for (let i = hardEnd - 1; i >= minCut; i--) {
    const ch = working[i];
    if (ch !== undefined && /\s/.test(ch)) return i;
  }
  return hardEnd;
}

/** Extract complete sentences from `working`, returning them and how much was consumed. */
function pull(
  working: string,
  cap: number,
  flush: boolean,
): { sentences: string[]; consumed: number } {
  const sentences: string[] = [];
  let pos = 0;
  const skipWs = (from: number): number => {
    let np = from;
    while (np < working.length) {
      const ch = working[np];
      if (ch !== undefined && /\s/.test(ch)) np++;
      else break;
    }
    return np;
  };
  while (pos < working.length) {
    const b = findBoundary(working, pos, flush);
    if (b >= 0 && b - pos <= cap) {
      const s = working.slice(pos, b).trim();
      if (s) sentences.push(s);
      pos = skipWs(b);
      continue;
    }
    if (working.length - pos >= cap) {
      const cut = chooseCut(working, pos, cap);
      const s = working.slice(pos, cut).trim();
      if (s) sentences.push(s);
      pos = skipWs(cut);
      continue;
    }
    break;
  }
  return { sentences, consumed: pos };
}

/**
 * Accumulates streamed token deltas and emits RAW sentences (pre-sanitize) as soon as a
 * sentence boundary — or the safety cap — is reached, never committing across an
 * unterminated leaked-token artifact. Stateful; feed it with `push()`, drain the tail with
 * `flush()` at end-of-stream.
 */
export class SentenceAssembler {
  private buffer = '';

  constructor(private readonly cap: number = DEFAULT_SENTENCE_CAP) {}

  /** Feed one delta; returns zero or more RAW sentences ready to sanitize. */
  push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;
    const safeLen = safeCommitLength(this.buffer);
    if (safeLen <= 0) return [];
    const safe = this.buffer.slice(0, safeLen);
    const { sentences, consumed } = pull(safe, this.cap, false);
    if (consumed > 0) this.buffer = this.buffer.slice(consumed);
    return sentences;
  }

  /** End-of-stream: emit whatever remains (sanitizer strips any dangling artifact). */
  flush(): string[] {
    const { sentences, consumed } = pull(this.buffer, this.cap, true);
    this.buffer = consumed >= this.buffer.length ? '' : this.buffer.slice(consumed);
    return sentences;
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Minimal FIFO with async `shift()` that also wakes on `close()`. Single-threaded safe. */
class AsyncQueue<T> {
  private items: T[] = [];
  private closed = false;
  private waiters: Array<() => void> = [];

  push(item: T): void {
    this.items.push(item);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  /** Return the next item, or `null` once the queue is closed & empty or `stop()` is true. */
  async shift(stop: () => boolean): Promise<T | null> {
    while (true) {
      if (stop()) return null;
      const item = this.items.shift();
      if (item !== undefined) return item;
      if (this.closed) return null;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  /** Take everything left (for cleanup of unplayed items after an interrupt). */
  drainRemaining(): T[] {
    const rest = this.items;
    this.items = [];
    return rest;
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
}

export interface StreamToSpeechParams {
  /** The token-delta stream (already started, e.g. `client.chatStream(...)`-backed). */
  stream: AsyncIterable<string>;
  /** Synthesize one sentence to a playable WAV path. */
  synth: SynthFn;
  /** Play one WAV (blocking until done); receives the barge-in signal. */
  play: PlayFn;
  /** Barge-in / cancellation. Aborting empties the queues and kills the current play. */
  signal?: AbortSignal;
  /** Per-sentence sanitizer. Default: `prepareSpeech` (strips leaked tokens, foreign script). */
  sanitize?: (raw: string) => string | null;
  /** Safety cap for a punctuation-less run. Default: `DEFAULT_SENTENCE_CAP`. */
  cap?: number;
  /** Half-duplex guard wrapper. Default: `withSpeakingGuard`. */
  guard?: (play: () => Promise<void>) => Promise<void>;
  /** WAV cleanup. Default: best-effort `fs/promises` unlink. */
  unlink?: (path: string) => Promise<void>;
}

export interface StreamToSpeechResult {
  /** True once at least one sentence was actually synthesized AND played. */
  played: boolean;
  /** The spoken sentences joined back together (for `onSpoke` / logging). */
  spoken: string;
  /** True when the turn was interrupted mid-way. */
  aborted: boolean;
  /** Each sentence that was spoken, in order. */
  sentences: string[];
}

/**
 * Run the streaming voice pipeline to completion. Speaks sentence-by-sentence, in strict
 * order, with synthesis running ahead of playback. Interruptible and never-throws.
 *
 * Returns `{ played: false }` when nothing speakable came through (empty stream, stream
 * error before any audio, or every chunk sanitized away) so the caller can fall back to
 * the blocking path — and `{ aborted: true }` when a barge-in cut the turn.
 */
export async function streamToSpeech(params: StreamToSpeechParams): Promise<StreamToSpeechResult> {
  const sanitize = params.sanitize ?? prepareSpeech;
  const cap = params.cap ?? DEFAULT_SENTENCE_CAP;
  const guard = params.guard ?? withSpeakingGuard;
  const unlink =
    params.unlink ??
    (async (p: string): Promise<void> => {
      try {
        const { unlink: rm } = await import('fs/promises');
        await rm(p);
      } catch {
        /* throwaway output — leave it if cleanup fails */
      }
    });
  const signal = params.signal;
  const stop = (): boolean => !!signal?.aborted;

  const sentenceQ = new AsyncQueue<string>();
  const wavQ = new AsyncQueue<{ text: string; wav: string }>();
  const spoken: string[] = [];
  let played = false;

  // On barge-in, wake every parked worker so they re-check `stop()` and unwind.
  const onAbort = (): void => {
    sentenceQ.close();
    wavQ.close();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  // Stage 1 — read the LLM stream, cut it into sentences, sanitize each, enqueue.
  const producer = (async (): Promise<void> => {
    const assembler = new SentenceAssembler(cap);
    const enqueue = (raw: string): void => {
      const clean = sanitize(raw);
      if (clean) sentenceQ.push(clean);
    };
    try {
      for await (const delta of params.stream) {
        if (stop()) break;
        if (typeof delta === 'string' && delta.length > 0) {
          for (const raw of assembler.push(delta)) enqueue(raw);
        }
      }
      if (!stop()) {
        for (const raw of assembler.flush()) enqueue(raw);
      }
    } catch (err) {
      logger.warn(`[voice] stream pipeline read error: ${errMsg(err)}`);
    } finally {
      sentenceQ.close();
    }
  })();

  // Stage 2 — synthesize each ready sentence to a WAV, AHEAD of playback (buffered in wavQ).
  const synthWorker = (async (): Promise<void> => {
    try {
      while (true) {
        const text = await sentenceQ.shift(stop);
        if (text === null) break;
        let wav: string;
        try {
          wav = await params.synth(text);
        } catch (err) {
          logger.warn(`[voice] stream synth failed (skipping sentence): ${errMsg(err)}`);
          continue;
        }
        if (stop()) {
          await unlink(wav);
          break;
        }
        if (wav) wavQ.push({ text, wav });
      }
    } finally {
      wavQ.close();
    }
  })();

  // Stage 3 — play the WAVs strictly in order, under ONE half-duplex guard for the whole
  // utterance (so the ear stays muted across sentences and no other spoken output interleaves).
  const playWorker = (async (): Promise<void> => {
    const first = await wavQ.shift(stop);
    if (!first) return; // nothing to play → never raise the guard (no spurious echo tail)
    await guard(async () => {
      let item: { text: string; wav: string } | null = first;
      while (item) {
        if (stop()) {
          await unlink(item.wav);
          break;
        }
        try {
          await params.play(item.wav, signal ? { signal } : {});
        } catch (err) {
          logger.warn(`[voice] stream play failed: ${errMsg(err)}`);
        }
        await unlink(item.wav);
        if (stop()) break;
        played = true;
        spoken.push(item.text);
        item = await wavQ.shift(stop);
      }
    });
  })();

  await Promise.all([producer, synthWorker, playWorker]);

  // Clean up any synthesized-but-unplayed WAVs left by an interrupt.
  for (const { wav } of wavQ.drainRemaining()) {
    await unlink(wav);
  }

  return { played, spoken: spoken.join(' '), aborted: stop(), sentences: [...spoken] };
}
