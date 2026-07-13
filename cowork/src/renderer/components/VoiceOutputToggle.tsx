/**
 * VoiceOutputToggle — text-to-speech for assistant responses.
 *
 * The renderer first asks the main process to synthesize through resident
 * Pocket TTS. Piper remains the legacy local fallback, then browser
 * SpeechSynthesis is used only if neither local engine is available.
 *
 * State persisted to localStorage so the preference survives reloads.
 *
 * @module renderer/components/VoiceOutputToggle
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import type { VoiceConversationEvent } from '../types';
import { cleanForSpeech, condenseForSpeech } from '../utils/speech-text';

const STORAGE_KEY = 'cowork.voice.tts.enabled';
const TTS_RATE_KEY = 'cowork.voice.ttsRate';

export function isTtsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function hasVoiceOutputSupport(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.speechSynthesis || window.electronAPI?.voice?.speak);
}

/** Currently-playing local TTS audio so subsequent speech can interrupt it. */
let activeAudio: HTMLAudioElement | null = null;
/** Resolves the promise waiting for the current local/browser playback. */
let activePlaybackCompletion: (() => void) | null = null;
let speechQueue: Promise<void> = Promise.resolve();
let speechQueueGeneration = 0;
let activeSpeechStreamKey: string | null = null;

export type VoiceInterruptionReason = 'barge_in' | 'manual' | 'new_speech' | 'stop';

interface VoiceInterruptedEventDetail {
  reason: VoiceInterruptionReason;
  hadPlayback: boolean;
  timestamp: number;
}

interface AssistantSpeakingEventDetail {
  speaking: boolean;
}

declare global {
  interface WindowEventMap {
    'cowork:voice-interrupted': CustomEvent<VoiceInterruptedEventDetail>;
    'cowork:assistant-speaking': CustomEvent<AssistantSpeakingEventDetail>;
  }
}

/**
 * True while the assistant's TTS is audibly playing (Piper `<audio>` or browser
 * SpeechSynthesis). Read-only; the auto-barge-in VAD uses this to gate itself so
 * it only interrupts while the agent is speaking. never-throws.
 */
export function isAssistantSpeaking(): boolean {
  try {
    if (activeAudio && !activeAudio.paused && !activeAudio.ended) return true;
    if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Broadcast a speaking-state transition so listeners (auto-barge-in) can react. */
function emitSpeakingState(speaking: boolean): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(
      new CustomEvent('cowork:assistant-speaking', { detail: { speaking } }),
    );
  } catch {
    /* ignore — CustomEvent may be unavailable in some test envs */
  }
}

function recordVoiceEvent(payload: VoiceConversationEvent) {
  void window.electronAPI?.voice?.recordConversationEvent?.(payload).catch(() => undefined);
}

function cancelActivePlayback(): boolean {
  let hadPlayback = false;
  const completePlayback = activePlaybackCompletion;
  if (activeAudio) {
    try {
      hadPlayback = hadPlayback || !activeAudio.paused;
      activeAudio.pause();
      activeAudio.src = '';
    } catch {
      /* ignore */
    }
    activeAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      hadPlayback = hadPlayback || window.speechSynthesis.speaking || window.speechSynthesis.pending;
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  // `pause()` and SpeechSynthesis.cancel() are not required to emit an
  // `ended`/`error` event. Resolve an awaiting acknowledgement explicitly so
  // an interrupted voice mission can always reopen the microphone.
  completePlayback?.();
  // Playback stopped — tell the auto-barge-in VAD to close the mic.
  emitSpeakingState(false);
  return hadPlayback;
}

function invalidateSpeechQueue(): void {
  speechQueueGeneration += 1;
  speechQueue = Promise.resolve();
  activeSpeechStreamKey = null;
}

function getTtsLengthScale(): number {
  try {
    const value = Number.parseFloat(localStorage.getItem(TTS_RATE_KEY) ?? '1');
    return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 1;
  } catch {
    return 1;
  }
}

/**
 * Stop any currently playing assistant voice. This is intentionally renderer-side:
 * browsers own playback handles, so barge-in can happen immediately without an IPC round-trip.
 */
export function interruptSpeech(reason: VoiceInterruptionReason = 'manual'): boolean {
  invalidateSpeechQueue();
  const hadPlayback = cancelActivePlayback();
  const timestamp = Date.now();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cowork:voice-interrupted', {
      detail: {
        reason,
        hadPlayback,
        timestamp,
      },
    }));
    if (hadPlayback || reason === 'barge_in' || reason === 'stop') {
      void window.electronAPI?.voice?.recordInterruption?.({
        reason,
        hadPlayback,
        timestamp,
      }).catch(() => undefined);
    }
  }
  return hadPlayback;
}

interface LocalSpeakOptions {
  interruptExisting?: boolean;
  waitForEnd?: boolean;
  generation?: number;
}

async function speakViaLocalTts(
  text: string,
  options: LocalSpeakOptions = {}
): Promise<boolean> {
  const api = window.electronAPI?.voice;
  if (!api?.speak) return false;
  try {
    if (options.interruptExisting !== false) interruptSpeech('new_speech');
    const result = await api.speak(text, { lengthScale: getTtsLengthScale() });
    if (
      options.generation !== undefined &&
      options.generation !== speechQueueGeneration
    ) {
      return false;
    }
    if (!result.ok || !result.audio) {
      if (result.error) {
        console.warn('[VoiceOutputToggle] local TTS unavailable:', result.error);
      }
      return false;
    }
    const blob = new Blob([result.audio], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    // The main process already applies CODEBUDDY_TTS_VOLUME to the PCM. Keep
    // Chromium's final playback stage at unity so it cannot attenuate Lisa a
    // second time (the default is 1, set explicitly as a regression guard).
    audio.volume = 1;
    activeAudio = audio;
    recordVoiceEvent({ type: 'assistant_speech_started' });
    emitSpeakingState(true);
    let finished = false;
    let resolvePlayback: (() => void) | null = null;
    const playbackFinished = new Promise<void>((resolve) => {
      resolvePlayback = resolve;
    });
    const finishSpeech = () => {
      if (finished) return;
      finished = true;
      recordVoiceEvent({ type: 'assistant_speech_finished' });
      emitSpeakingState(false);
      resolvePlayback?.();
    };
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
      if (activePlaybackCompletion === completePlayback) {
        activePlaybackCompletion = null;
      }
    };
    const completePlayback = () => {
      finishSpeech();
      cleanup();
    };
    activePlaybackCompletion = completePlayback;
    audio.addEventListener('ended', () => {
      completePlayback();
    });
    audio.addEventListener('error', () => {
      completePlayback();
    });
    try {
      await audio.play();
      if (options.waitForEnd) await playbackFinished;
    } catch (err) {
      completePlayback();
      throw err;
    }
    return true;
  } catch (err) {
    console.warn('[VoiceOutputToggle] local TTS synth failed:', err);
    return false;
  }
}

async function speakViaBrowser(
  text: string,
  waitForEnd = false,
  interruptExisting = true
): Promise<void> {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  await new Promise<void>((resolve) => {
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1 / getTtsLengthScale();
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.lang = 'fr-FR';
      if (interruptExisting) interruptSpeech('new_speech');
      recordVoiceEvent({ type: 'assistant_speech_started' });
      emitSpeakingState(true);
      let finished = false;
      const completePlayback = () => {
        if (finished) return;
        finished = true;
        recordVoiceEvent({ type: 'assistant_speech_finished' });
        emitSpeakingState(false);
        if (activePlaybackCompletion === completePlayback) {
          activePlaybackCompletion = null;
        }
        resolve();
      };
      activePlaybackCompletion = completePlayback;
      utterance.onend = completePlayback;
      utterance.onerror = completePlayback;
      window.speechSynthesis.speak(utterance);
      if (!waitForEnd) resolve();
    } catch (err) {
      console.warn('[VoiceOutputToggle] browser tts failed:', err);
      resolve();
    }
  });
}

/**
 * Speak `text` if TTS is enabled. Tries Pocket/Piper through the local bridge,
 * then falls back to browser SpeechSynthesis.
 * Awaitable — resolves once playback has started (not finished), so
 * callers don't block the UI while audio plays.
 */
export async function speakText(text: string): Promise<void> {
  if (!isTtsEnabled()) return;
  // Condense to a spoken-length digest — reading a full markdown answer aloud is unusable.
  const clean = condenseForSpeech(text);
  if (!clean) return;
  const localTtsOk = await speakViaLocalTts(clean);
  if (localTtsOk) return;
  await speakViaBrowser(clean);
}

/**
 * Speak a short acknowledgement and resolve only after playback finishes.
 * VoiceChatOverlay uses this before reopening the microphone, preventing the
 * assistant from transcribing its own acknowledgement as the next request.
 */
export async function speakTextAndWait(text: string): Promise<void> {
  if (!isTtsEnabled()) return;
  const clean = condenseForSpeech(text);
  if (!clean) return;
  const localTtsOk = await speakViaLocalTts(clean, { waitForEnd: true });
  if (localTtsOk) return;
  await speakViaBrowser(clean, true);
}

/**
 * Queue a completed sentence from the live LLM stream. The first sentence
 * interrupts stale playback; subsequent sentences wait for the previous clip.
 * A barge-in invalidates the generation so already queued clips never resume.
 */
export function queueStreamingSpeech(streamKey: string, text: string): void {
  if (!isTtsEnabled()) return;
  const clean = cleanForSpeech(text).replace(/\s+/g, ' ').trim();
  if (!streamKey || !clean) return;

  if (activeSpeechStreamKey !== streamKey) {
    interruptSpeech('new_speech');
    activeSpeechStreamKey = streamKey;
  }
  const generation = speechQueueGeneration;
  speechQueue = speechQueue
    .catch(() => undefined)
    .then(async () => {
      if (generation !== speechQueueGeneration) return;
      const localTtsOk = await speakViaLocalTts(clean, {
        interruptExisting: false,
        waitForEnd: true,
        generation,
      });
      if (!localTtsOk && generation === speechQueueGeneration) {
        await speakViaBrowser(clean, true, false);
      }
    });
}

export const VoiceOutputToggle: React.FC = () => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean>(false);
  const [supported, setSupported] = useState<boolean>(true);

  useEffect(() => {
    setSupported(hasVoiceOutputSupport());
    setEnabled(isTtsEnabled());
  }, []);

  const handleToggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore quota errors */
      }
      if (!next) interruptSpeech('manual');
      return next;
    });
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        enabled
          ? 'bg-accent/15 text-accent'
          : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
      }`}
      title={enabled ? t('voice.ttsOn') : t('voice.ttsOff')}
    >
      {enabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
      <span className="text-[10px] font-medium">
        {enabled ? t('voice.ttsLabelOn') : t('voice.ttsLabelOff')}
      </span>
    </button>
  );
};
