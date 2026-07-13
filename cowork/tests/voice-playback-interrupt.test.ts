import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasVoiceOutputSupport,
  interruptSpeech,
  queueStreamingSpeech,
  speakTextAndWait,
} from '../src/renderer/components/VoiceOutputToggle';

describe('voice playback interruption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels browser speech and records barge-in interruptions', () => {
    const cancel = vi.fn();
    const dispatchEvent = vi.fn();
    const recordInterruption = vi.fn(async () => ({ ok: true }));

    vi.stubGlobal('window', {
      speechSynthesis: {
        speaking: true,
        pending: false,
        cancel,
      },
      dispatchEvent,
      electronAPI: {
        voice: { recordInterruption },
      },
    });

    const interrupted = interruptSpeech('barge_in');

    expect(interrupted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cowork:voice-interrupted',
    }));
    expect(recordInterruption).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'barge_in',
      hadPlayback: true,
    }));
  });

  it('does not audit a new-speech cleanup when nothing was playing', () => {
    const cancel = vi.fn();
    const dispatchEvent = vi.fn();
    const recordInterruption = vi.fn(async () => ({ ok: true }));

    vi.stubGlobal('window', {
      speechSynthesis: {
        speaking: false,
        pending: false,
        cancel,
      },
      dispatchEvent,
      electronAPI: {
        voice: { recordInterruption },
      },
    });

    const interrupted = interruptSpeech('new_speech');

    expect(interrupted).toBe(false);
    expect(cancel).toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalled();
    expect(recordInterruption).not.toHaveBeenCalled();
  });

  it('treats the local TTS IPC bridge as voice output support without browser speechSynthesis', () => {
    vi.stubGlobal('window', {
      electronAPI: {
        voice: { speak: vi.fn() },
      },
    });

    expect(hasVoiceOutputSupport()).toBe(true);
  });

  it('queues streamed sentences in order and applies the saved local voice rate', async () => {
    const speak = vi.fn(async () => ({
      ok: true,
      audio: new ArrayBuffer(44),
    }));

    class FakeAudio {
      paused = false;
      ended = false;
      src = '';
      private listeners = new Map<string, Array<() => void>>();

      addEventListener(name: string, listener: () => void) {
        const listeners = this.listeners.get(name) ?? [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
      }

      async play() {
        queueMicrotask(() => {
          this.ended = true;
          for (const listener of this.listeners.get('ended') ?? []) listener();
        });
      }

      pause() {
        this.paused = true;
      }
    }

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => {
        if (key === 'cowork.voice.tts.enabled') return '1';
        if (key === 'cowork.voice.ttsRate') return '0.8';
        return null;
      },
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      electronAPI: { voice: { speak } },
    });

    queueStreamingSpeech('turn-1', 'Première phrase.');
    queueStreamingSpeech('turn-1', 'Deuxième phrase.');

    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls.map(([text]) => text)).toEqual([
      'Première phrase.',
      'Deuxième phrase.',
    ]);
    expect(speak).toHaveBeenNthCalledWith(1, 'Première phrase.', { lengthScale: 0.8 });
    expect(speak).toHaveBeenNthCalledWith(2, 'Deuxième phrase.', { lengthScale: 0.8 });
  });

  it('waits for acknowledgement playback before a caller can reopen the microphone', async () => {
    const speak = vi.fn(async () => ({ ok: true, audio: new ArrayBuffer(44) }));
    let finishPlayback: (() => void) | null = null;

    class FakeAudio {
      paused = false;
      ended = false;
      private listeners = new Map<string, Array<() => void>>();

      addEventListener(name: string, listener: () => void) {
        const listeners = this.listeners.get(name) ?? [];
        listeners.push(listener);
        this.listeners.set(name, listeners);
      }

      async play() {
        finishPlayback = () => {
          this.ended = true;
          for (const listener of this.listeners.get('ended') ?? []) listener();
        };
      }

      pause() {
        this.paused = true;
      }
    }

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'cowork.voice.tts.enabled' ? '1' : null),
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      electronAPI: { voice: { speak } },
    });

    let resolved = false;
    const acknowledgement = speakTextAndWait('Mission lancée.').then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect(resolved).toBe(false);

    finishPlayback?.();
    await acknowledgement;
    expect(resolved).toBe(true);
  });

  it('releases an acknowledgement wait when local playback is interrupted', async () => {
    const speak = vi.fn(async () => ({ ok: true, audio: new ArrayBuffer(44) }));
    const pause = vi.fn();

    class FakeAudio {
      paused = false;
      ended = false;
      src = '';

      addEventListener() {
        // Intentionally never emits `ended` or `error`: browsers do not
        // guarantee either event after pause()/src reset.
      }

      async play() {}

      pause() {
        this.paused = true;
        pause();
      }
    }

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'cowork.voice.tts.enabled' ? '1' : null),
    });
    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
      electronAPI: { voice: { speak } },
    });

    let resolved = false;
    const acknowledgement = speakTextAndWait('Mission lancée.').then(() => {
      resolved = true;
    });
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    expect(resolved).toBe(false);

    interruptSpeech('manual');
    await acknowledgement;

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });
});
