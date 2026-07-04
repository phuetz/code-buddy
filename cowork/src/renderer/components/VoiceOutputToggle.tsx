/**
 * VoiceOutputToggle — text-to-speech for assistant responses.
 *
 * Originally browser-only via SpeechSynthesis API. As of the voice
 * upgrade (2026-05), the renderer first asks the main process to
 * synthesise via Piper (offline, French-native voice ~22 kHz mono PCM).
 * Browser SpeechSynthesis stays as a fallback for environments where
 * the Piper binary is missing.
 *
 * State persisted to localStorage so the preference survives reloads.
 *
 * @module renderer/components/VoiceOutputToggle
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import type { VoiceConversationEvent } from '../types';
import { condenseForSpeech } from '../utils/speech-text';

const STORAGE_KEY = 'cowork.voice.tts.enabled';

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

/** Currently-playing audio element so subsequent speak() can interrupt. */
let activeAudio: HTMLAudioElement | null = null;

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
  // Playback stopped — tell the auto-barge-in VAD to close the mic.
  emitSpeakingState(false);
  return hadPlayback;
}

/**
 * Stop any currently playing assistant voice. This is intentionally renderer-side:
 * browsers own playback handles, so barge-in can happen immediately without an IPC round-trip.
 */
export function interruptSpeech(reason: VoiceInterruptionReason = 'manual'): boolean {
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

async function speakViaPiper(text: string): Promise<boolean> {
  const api = window.electronAPI?.voice;
  if (!api?.speak) return false;
  try {
    interruptSpeech('new_speech');
    const result = await api.speak(text);
    if (!result.ok || !result.audio) {
      if (result.error) {
        console.warn('[VoiceOutputToggle] piper unavailable:', result.error);
      }
      return false;
    }
    const blob = new Blob([result.audio], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    recordVoiceEvent({ type: 'assistant_speech_started' });
    emitSpeakingState(true);
    let finished = false;
    const finishSpeech = () => {
      if (finished) return;
      finished = true;
      recordVoiceEvent({ type: 'assistant_speech_finished' });
      emitSpeakingState(false);
    };
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
    };
    audio.addEventListener('ended', () => {
      finishSpeech();
      cleanup();
    });
    audio.addEventListener('error', () => {
      finishSpeech();
      cleanup();
    });
    try {
      await audio.play();
    } catch (err) {
      finishSpeech();
      cleanup();
      throw err;
    }
    return true;
  } catch (err) {
    console.warn('[VoiceOutputToggle] piper synth failed:', err);
    return false;
  }
}

function speakViaBrowser(text: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'fr-FR';
    interruptSpeech('new_speech');
    recordVoiceEvent({ type: 'assistant_speech_started' });
    emitSpeakingState(true);
    utterance.onend = () => {
      recordVoiceEvent({ type: 'assistant_speech_finished' });
      emitSpeakingState(false);
    };
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[VoiceOutputToggle] browser tts failed:', err);
  }
}

/**
 * Speak `text` if TTS is enabled. Tries the local Piper bridge first,
 * falls back to browser SpeechSynthesis if Piper isn't available.
 * Awaitable — resolves once playback has started (not finished), so
 * callers don't block the UI while audio plays.
 */
export async function speakText(text: string): Promise<void> {
  if (!isTtsEnabled()) return;
  // Condense to a spoken-length digest — reading a full markdown answer aloud is unusable.
  const clean = condenseForSpeech(text);
  if (!clean) return;
  const piperOk = await speakViaPiper(clean);
  if (piperOk) return;
  speakViaBrowser(clean);
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
