/**
 * VoiceChatOverlay — Lisa-derived consolidated voice composer.
 *
 * Big push-to-talk modal triggered from the Titlebar that gives a
 * hands-free vocal flow:
 *
 *  1. Click the big mic → faster-whisper records (60 s cap, hard timer).
 *  2. Click again to stop → transcribe → edit-in-place → Send.
 *  3. The active session (or a new one) receives the message via
 *     `useIPC.continueSession` / `startSession`.
 *  4. If "lecture auto" is on, the next assistant final message is
 *     read aloud through Piper (re-using `speakText` from
 *     `VoiceOutputToggle`).
 *  5. ESC / outside-click closes; Cmd/Ctrl+Enter sends.
 *
 * Differs from the corner `MicButton` (also in ChatView): that one is
 * compact and works inside the existing composer; this overlay is for
 * pure voice-first interaction with bigger affordances.
 *
 * @module renderer/components/VoiceChatOverlay
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  Mic,
  MicOff,
  Send,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import { interruptSpeech, isTtsEnabled, speakText } from './VoiceOutputToggle';
import { isAutoBargeInEnabled, setAutoBargeInEnabled } from '../hooks/useAutoBargeIn';
import type { VoiceConversationEvent } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type RecState = 'idle' | 'recording' | 'transcribing' | 'error';

const TTS_RATE_KEY = 'cowork.voice.ttsRate';
const TTS_AUTO_KEY = 'cowork.voice.tts.enabled'; // shared with VoiceOutputToggle

function recordVoiceEvent(payload: VoiceConversationEvent) {
  void window.electronAPI?.voice?.recordConversationEvent?.(payload).catch(() => undefined);
}

export const VoiceChatOverlay: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const { startSession, continueSession } = useIPC();

  const [text, setText] = useState('');
  const [rec, setRec] = useState<RecState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [bargeInNotice, setBargeInNotice] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TTS_AUTO_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [ttsRate, setTtsRate] = useState<number>(() => {
    try {
      const v = parseFloat(localStorage.getItem(TTS_RATE_KEY) ?? '1');
      return Number.isFinite(v) && v > 0 ? v : 1;
    } catch {
      return 1;
    }
  });
  const [sending, setSending] = useState(false);
  const [autoBargeIn, setAutoBargeIn] = useState<boolean>(() => isAutoBargeInEnabled());

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ESC to close (when not recording — stop recording first).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (rec === 'recording') {
          stopRecording();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, rec, onClose]);

  // Reset state on open.
  useEffect(() => {
    if (isOpen) {
      setText('');
      setRec('idle');
      setErrorMsg(null);
      setBargeInNotice(null);
      setElapsedSec(0);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stopAllStreams();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopAllStreams = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
  }, []);

  const startRecording = async () => {
    if (rec !== 'idle' && rec !== 'error') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRec('error');
      setErrorMsg(t('voiceOverlay.unsupported', 'mediaDevices indisponible'));
      return;
    }
    const interrupted = interruptSpeech('barge_in');
    setBargeInNotice(interrupted
      ? t('voiceOverlay.bargeIn', 'Réponse interrompue. Je vous écoute.')
      : null);
    recordVoiceEvent({ type: 'listening_started' });
    setRec('recording');
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stopAllStreams();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        if (blob.size === 0) {
          setRec('idle');
          return;
        }
        await transcribe(blob);
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      stopTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 60000);
    } catch (err) {
      setRec('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      stopAllStreams();
    }
  };

  const stopRecording = useCallback(() => {
    if (rec !== 'recording') return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recordVoiceEvent({ type: 'listening_stopped' });
      recorder.stop();
      setRec('transcribing');
    } else {
      setRec('idle');
    }
  }, [rec]);

  const transcribe = async (blob: Blob) => {
    try {
      setRec('transcribing');
      const arrayBuf = await blob.arrayBuffer();
      const api = window.electronAPI?.voice;
      if (!api?.transcribe) {
        setRec('error');
        setErrorMsg(t('voiceOverlay.bridgeUnavailable', 'voice bridge indisponible'));
        return;
      }
      const result = await api.transcribe(arrayBuf, { language: 'fr' });
      if (result.ok && result.text) {
        // Append to existing typed text (so user can dictate fragments).
        setText((prev) => (prev ? `${prev} ${result.text}` : result.text!));
        setRec('idle');
      } else {
        setRec('error');
        setErrorMsg(result.error ?? 'transcription failed');
      }
    } catch (err) {
      setRec('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSend = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      if (activeSessionId) {
        await continueSession(activeSessionId, message);
      } else {
        await startSession('Voix', message);
      }
      recordVoiceEvent({ type: 'user_message_sent', transcript: message });
      setText('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const toggleAutoSpeak = () => {
    const next = !autoSpeak;
    setAutoSpeak(next);
    try {
      localStorage.setItem(TTS_AUTO_KEY, next ? '1' : '0');
    } catch {
      /* ignore quota */
    }
  };

  const toggleAutoBargeIn = () => {
    const next = !autoBargeIn;
    setAutoBargeIn(next);
    setAutoBargeInEnabled(next);
  };

  const handleRateChange = (v: number) => {
    setTtsRate(v);
    try {
      localStorage.setItem(TTS_RATE_KEY, String(v));
    } catch {
      /* ignore */
    }
  };

  const playSampleTts = () => {
    void speakText(
      t(
        'voiceOverlay.sample',
        'Bonjour Patrice. Voici un échantillon de la voix sélectionnée.',
      ),
    );
  };

  if (!isOpen) return null;

  const isRecording = rec === 'recording';
  const isTranscribing = rec === 'transcribing';
  const canSend = text.trim().length > 0 && !sending && !isTranscribing;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[640px] max-w-[94vw] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Mic size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-zinc-200">
              {t('voiceOverlay.title', 'Voix → Cowork')}
            </h2>
            {isRecording && (
              <span className="flex items-center gap-1 text-[11px] text-error tabular-nums">
                <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
                {elapsedSec}s
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`p-1.5 rounded ${
                showSettings ? 'bg-accent/15 text-accent' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={t('voiceOverlay.settings', 'Paramètres voix')}
            >
              <Settings2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-500 hover:text-zinc-300"
              aria-label={t('common.close', 'Close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Settings drawer */}
        {showSettings && (
          <div className="px-5 py-3 border-b border-zinc-800 space-y-3 text-xs bg-zinc-900/60">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-zinc-400">
                  {t('voiceOverlay.rate', 'Vitesse Piper TTS')}
                </label>
                <span className="text-zinc-200 tabular-nums">
                  {(1 / ttsRate).toFixed(1)}×
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={ttsRate}
                onChange={(e) => handleRateChange(parseFloat(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="text-[10px] text-zinc-500 mt-0.5">
                {t(
                  'voiceOverlay.rateHint',
                  'Piper utilise length_scale ; >1 ralentit, <1 accélère.',
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">
                {t('voiceOverlay.autoSpeak', 'Lire la réponse de l\'agent à voix haute')}
              </span>
              <button
                onClick={toggleAutoSpeak}
                className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                  autoSpeak
                    ? 'bg-success/15 text-success'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {autoSpeak ? t('common.on', 'Activé') : t('common.off', 'Désactivé')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">
                {t(
                  'voiceOverlay.autoBargeIn',
                  'Barge-in automatique (couper l\'agent dès que vous parlez)',
                )}
              </span>
              <button
                onClick={toggleAutoBargeIn}
                className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                  autoBargeIn
                    ? 'bg-success/15 text-success'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
                data-testid="voice-overlay-auto-barge-in"
              >
                {autoBargeIn ? t('common.on', 'Activé') : t('common.off', 'Désactivé')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">
                {t('voiceOverlay.testVoice', 'Tester la voix')}
              </span>
              <button
                onClick={playSampleTts}
                className="px-3 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
              >
                <Volume2 size={11} className="inline mr-1" />
                {t('voiceOverlay.play', 'Échantillon')}
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center gap-4">
          {errorMsg && (
            <div className="w-full p-2 rounded bg-error/10 border border-error/30 text-error text-xs">
              {errorMsg}
            </div>
          )}
          {bargeInNotice && (
            <div className="w-full p-2 rounded bg-accent/10 border border-accent/30 text-accent text-xs">
              {bargeInNotice}
            </div>
          )}

          {/* Big mic button */}
          <button
            type="button"
            onClick={() => (isRecording ? stopRecording() : void startRecording())}
            disabled={isTranscribing}
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? 'bg-error/20 ring-4 ring-error/40 animate-pulse'
                : isTranscribing
                  ? 'bg-zinc-800 ring-2 ring-zinc-700'
                  : 'bg-accent/15 ring-2 ring-accent/40 hover:ring-accent hover:bg-accent/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label={isRecording ? 'Arrêter' : 'Dicter'}
            data-testid="voice-overlay-mic"
          >
            {isTranscribing ? (
              <Loader2 className="w-10 h-10 text-zinc-400 animate-spin" />
            ) : isRecording ? (
              <MicOff className="w-10 h-10 text-error" />
            ) : (
              <Mic className="w-10 h-10 text-accent" />
            )}
          </button>

          <div className="text-[11px] text-zinc-500 text-center">
            {isRecording
              ? t('voiceOverlay.listening', 'Écoute en cours… cliquez à nouveau pour arrêter')
              : isTranscribing
                ? t('voiceOverlay.transcribing', 'Transcription via faster-whisper…')
                : t('voiceOverlay.tap', 'Cliquez pour dicter (FR, 60 s max)')}
          </div>

          {/* Editable transcript */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t(
              'voiceOverlay.placeholder',
              'La transcription apparaît ici. Vous pouvez modifier avant d\'envoyer.',
            )}
            rows={4}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-accent resize-none"
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-between shrink-0">
          <div className="text-[10px] text-zinc-500">
            {isTtsEnabled() ? (
              <span className="inline-flex items-center gap-1">
                <Volume2 size={10} className="text-success" />
                {t('voiceOverlay.autoSpeakOn', 'Réponse vocale active')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 opacity-60">
                <VolumeX size={10} />
                {t('voiceOverlay.autoSpeakOff', 'Réponse vocale inactive')}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Send size={12} />
            )}
            {t('voiceOverlay.send', 'Envoyer')}
            <kbd className="text-[9px] opacity-70 ml-1">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
