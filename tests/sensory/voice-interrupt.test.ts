import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import {
  makeVoiceReply,
  sayNow,
  type ReplyFn,
  type PlayFn,
} from '../../src/sensory/voice-loop.js';
import { makeAgentReply } from '../../src/sensory/agent-reply.js';
import { isSpeaking, _resetVoiceActivityForTests } from '../../src/sensory/voice-activity.js';

/**
 * Barge-in foundation (Lot 1): `makeVoiceReply().interrupt()` must cancel the in-flight
 * spoken turn — abort the LLM/agent think step, kill the TTS playback, reset the
 * half-duplex guard — WITHOUT changing the tour-par-tour behavior when it is never called.
 *
 * No mocks: the "think"/"play" boundaries are injected, and the play test spawns (and kills)
 * a REAL child process so the SIGKILL path is exercised, not stubbed.
 */

/** A think step that reports the signal it received and hangs until aborted (or resolves fast). */
function makeControllableReply(): {
  replyFn: ReplyFn;
  started: Promise<void>;
  seenSignal: () => AbortSignal | undefined;
} {
  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  let seen: AbortSignal | undefined;
  const replyFn: ReplyFn = (_heard, opts) =>
    new Promise<string>((resolve) => {
      seen = opts?.signal;
      markStarted();
      if (opts?.signal) {
        opts.signal.addEventListener('abort', () => resolve('réponse trop tardive'), { once: true });
      }
      // If never aborted, this promise stays pending — the "without interrupt" test uses a
      // fast replyFn instead, so a hang here only ever happens under an interrupt.
    });
  return { replyFn, started, seenSignal: () => seen };
}

describe('voice interrupt — barge-in capability', () => {
  beforeEach(() => _resetVoiceActivityForTests());

  it('WITHOUT interrupt: the turn completes normally and no abort is observed (byte-identical)', async () => {
    const calls: string[] = [];
    let replySignal: AbortSignal | undefined;
    let playSignal: AbortSignal | undefined;
    let spoke = '';
    const onHeard = makeVoiceReply({
      replyFn: async (heard, opts) => {
        replySignal = opts?.signal;
        calls.push(`reply:${heard}`);
        return 'Salut Patrice, on progresse.';
      },
      synth: async (text) => {
        calls.push(`synth:${text}`);
        return '/tmp/reply.wav';
      },
      play: async (wav, opts) => {
        playSignal = opts?.signal;
        calls.push(`play:${wav}`);
      },
      onSpoke: (t) => {
        spoke = t;
      },
    });

    await onHeard('Bonjour, où en est le robot ?');

    // Same order/behavior as before the interrupt capability existed.
    expect(calls).toEqual([
      'reply:Bonjour, où en est le robot ?',
      'synth:Salut Patrice, on progresse.',
      'play:/tmp/reply.wav',
    ]);
    expect(spoke).toBe('Salut Patrice, on progresse.');
    // The signal is threaded but never aborted when interrupt() is not called.
    expect(replySignal?.aborted).toBe(false);
    expect(playSignal?.aborted).toBe(false);
  });

  it('interrupt() during the think step aborts the reply and never synthesizes or plays', async () => {
    const { replyFn, started, seenSignal } = makeControllableReply();
    let synthCalls = 0;
    let playCalls = 0;
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async () => {
        synthCalls += 1;
        return '/tmp/x.wav';
      },
      play: async () => {
        playCalls += 1;
      },
    });

    const turn = onHeard('cherche les erreurs dans les logs');
    await started; // the think step is in flight
    onHeard.interrupt(); // barge-in
    await turn; // resolves once the abort unwinds

    expect(seenSignal()?.aborted).toBe(true); // the LLM call saw an aborted signal
    expect(synthCalls).toBe(0); // reply abandoned → nothing synthesized
    expect(playCalls).toBe(0); // and nothing played
    expect(isSpeaking()).toBe(false); // guard reset → the ear is open again
  });

  it('interrupt() during playback SIGKILLs the audio child and resets the guard', async () => {
    let killCount = 0;
    let markPlaying!: () => void;
    const playing = new Promise<void>((r) => (markPlaying = r));

    // Real child process: `interrupt()` must actually kill it, not just flip a flag.
    const play: PlayFn = (_wav, opts) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
        markPlaying();
        opts?.signal?.addEventListener(
          'abort',
          () => {
            try {
              child.kill('SIGKILL');
            } catch {
              /* already gone */
            }
            killCount += 1;
          },
          { once: true },
        );
        child.on('close', () => resolve());
        child.on('error', () => resolve());
      });

    const onHeard = makeVoiceReply({
      replyFn: async () => 'Je lance le diagnostic.',
      synth: async () => '/tmp/diag.wav',
      play,
    });

    const turn = onHeard('lance le diagnostic complet');
    await playing; // playback child is alive
    expect(isSpeaking()).toBe(true); // half-duplex guard is up while speaking
    onHeard.interrupt(); // barge-in
    await turn;

    expect(killCount).toBe(1); // the audio child was SIGKILLed on demand
    expect(isSpeaking()).toBe(false); // guard hard-reset (no echo tail) → ear re-opens now
  });

  it('interrupt() during the ACT acknowledgement SIGKILLs its audio child', async () => {
    let abortKillCount = 0;
    let markAckPlaying!: () => void;
    const ackPlaying = new Promise<void>((resolve) => (markAckPlaying = resolve));

    const ackPlay: PlayFn = (_wav, opts) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
          stdio: 'ignore',
        });
        const failSafe = setTimeout(() => child.kill('SIGKILL'), 1_000);
        failSafe.unref();
        opts?.signal?.addEventListener(
          'abort',
          () => {
            try {
              child.kill('SIGKILL');
            } catch {
              /* already gone */
            }
            abortKillCount += 1;
          },
          { once: true }
        );
        child.on('close', () => {
          clearTimeout(failSafe);
          resolve();
        });
        child.on('error', () => {
          clearTimeout(failSafe);
          resolve();
        });
        markAckPlaying();
      });

    const agentReply = makeAgentReply({
      ack: async (_heard, opts) =>
        sayNow("D'accord, je regarde ça.", {
          signal: opts?.signal,
          synth: async () => '/tmp/ack.wav',
          play: ackPlay,
        }),
      agentRunner: async () => 'Terminé.',
      summarize: async () => 'unused',
    });
    const onHeard = makeVoiceReply({
      replyFn: agentReply,
      synth: async () => '/tmp/reply.wav',
      play: async () => {},
    });

    const turn = onHeard('lance le diagnostic complet');
    await ackPlaying;
    expect(isSpeaking()).toBe(true);
    onHeard.interrupt();
    await turn;

    expect(abortKillCount).toBe(1);
    expect(isSpeaking()).toBe(false);
  });

  it('never-throws: interrupt() with nothing in flight is a clean no-op, and is idempotent', async () => {
    const onHeard = makeVoiceReply({
      replyFn: async () => 'ok',
      synth: async () => '/tmp/x.wav',
      play: async () => {},
    });

    // Before any turn.
    expect(() => onHeard.interrupt()).not.toThrow();

    // A normal turn, then interrupt after it finished (currentAbort cleared).
    await onHeard('bonjour');
    expect(() => onHeard.interrupt()).not.toThrow();
    expect(() => onHeard.interrupt()).not.toThrow(); // idempotent
  });

  it('never-throws when the play child is already dead before the interrupt fires', async () => {
    let markPlaying!: () => void;
    const playing = new Promise<void>((r) => (markPlaying = r));
    // The child exits immediately; the abort listener then kills an already-dead pid.
    const play: PlayFn = (_wav, opts) =>
      new Promise<void>((resolve) => {
        const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
        opts?.signal?.addEventListener(
          'abort',
          () => {
            // Killing an exited child must not throw the turn.
            child.kill('SIGKILL');
          },
          { once: true },
        );
        child.on('close', () => {
          markPlaying();
          resolve();
        });
        child.on('error', () => resolve());
      });

    const onHeard = makeVoiceReply({
      replyFn: async () => 'ok',
      synth: async () => '/tmp/x.wav',
      play,
    });
    const turn = onHeard('salut');
    await playing;
    // The play already resolved; interrupt is a no-op on a finished turn.
    await expect(turn).resolves.toBeUndefined();
    expect(() => onHeard.interrupt()).not.toThrow();
  });

  it('can drive a fresh turn after an interrupt (no blocked state left behind)', async () => {
    const { replyFn, started } = makeControllableReply();
    let spoke = '';
    const onHeard = makeVoiceReply({
      replyFn,
      synth: async () => '/tmp/x.wav',
      play: async () => {},
      onSpoke: (t) => {
        spoke = t;
      },
    });

    // First turn: interrupted mid-think.
    const t1 = onHeard('première demande');
    await started;
    onHeard.interrupt();
    await t1;
    expect(isSpeaking()).toBe(false);

    // Second turn on the SAME handler completes normally (a fresh controller each turn).
    const onHeard2 = makeVoiceReply({
      replyFn: async () => 'Deuxième réponse.',
      synth: async () => '/tmp/y.wav',
      play: async () => {},
      onSpoke: (t) => {
        spoke = t;
      },
    });
    await onHeard2('deuxième demande');
    expect(spoke).toBe('Deuxième réponse.');
  });
});
