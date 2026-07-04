/**
 * useAutoBargeIn — wires the energy-VAD detector to Cowork's voice loop so the
 * user can interrupt the agent hands-free (automatic barge-in / FastRTC
 * "ReplyOnPause").
 *
 * The microphone is opened ONLY while the assistant's TTS is actually playing
 * (driven by the `cowork:assistant-speaking` events emitted by
 * `VoiceOutputToggle`), which keeps this privacy-friendly: no always-on mic.
 * While playing, `AutoBargeInDetector` watches the mic energy and, on a speech
 * onset, calls `interruptSpeech('barge_in')` — which cuts the TTS and (via the
 * `useBargeInTurnCancel` listener) cancels the running agent turn.
 *
 * Echo safety: the mic is opened with browser echoCancellation/noiseSuppression/
 * autoGainControl, so Chromium/Electron removes the speaker's own TTS and the
 * VAD does not trigger on the agent's voice.
 *
 * Opt-in (default OFF, persisted to localStorage). never-throws — any failure to
 * open the mic / AudioContext degrades silently to the existing manual
 * push-to-talk barge-in.
 *
 * @module renderer/hooks/useAutoBargeIn
 */

import { useEffect, useRef } from 'react';
import { AutoBargeInDetector } from '../utils/auto-barge-in';
import {
  interruptSpeech,
  isAssistantSpeaking,
  isTtsEnabled,
} from '../components/VoiceOutputToggle';

const AUTO_BARGE_IN_KEY = 'cowork.voice.autoBargeIn';

/** Whether automatic (VAD) barge-in is enabled. Default OFF (opt-in). */
export function isAutoBargeInEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_BARGE_IN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the automatic barge-in preference. never-throws. */
export function setAutoBargeInEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_BARGE_IN_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore quota */
  }
}

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Mount once (e.g. in App) to enable automatic barge-in whenever it is toggled
 * on and TTS output is active. Returns nothing — it's a lifecycle-only hook.
 */
export function useAutoBargeIn(): void {
  const detectorRef = useRef<AutoBargeInDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Guards against a start/stop race when speaking toggles rapidly.
  const startingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const stopVad = () => {
      startingRef.current = false;
      try {
        detectorRef.current?.dispose();
      } catch {
        /* ignore */
      }
      detectorRef.current = null;
      try {
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
      } catch {
        /* ignore */
      }
      streamRef.current = null;
    };

    const startVad = async () => {
      // Re-read the toggle live so it takes effect on the next utterance.
      if (!isAutoBargeInEnabled() || !isTtsEnabled()) return;
      if (detectorRef.current || startingRef.current) return;
      if (!navigator?.mediaDevices?.getUserMedia) return;
      const Ctor = resolveAudioContextCtor();
      if (!Ctor) return;
      startingRef.current = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        // Playback may have finished while getUserMedia was resolving.
        if (!startingRef.current) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const audioContext = new Ctor();
        const detector = new AutoBargeInDetector({
          audioContext: audioContext as unknown as ConstructorParameters<
            typeof AutoBargeInDetector
          >[0]['audioContext'],
          mediaStream: stream,
          isSpeaking: isAssistantSpeaking,
          onBargeIn: () => {
            interruptSpeech('barge_in');
          },
        });
        detector.start();
        detectorRef.current = detector;
      } catch {
        // Permission denied / no device → stay on manual push-to-talk.
        stopVad();
      } finally {
        startingRef.current = false;
      }
    };

    const onSpeaking = (e: Event) => {
      const detail = (e as CustomEvent<{ speaking: boolean }>).detail;
      if (detail?.speaking) {
        void startVad();
      } else {
        stopVad();
      }
    };

    window.addEventListener('cowork:assistant-speaking', onSpeaking as EventListener);
    return () => {
      window.removeEventListener('cowork:assistant-speaking', onSpeaking as EventListener);
      stopVad();
    };
  }, []);
}
