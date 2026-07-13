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
 *     read aloud through Pocket TTS (Piper fallback), re-using `speakText` from
 *     `VoiceOutputToggle`).
 *  5. ESC / outside-click closes; Cmd/Ctrl+Enter sends.
 *
 * Differs from the corner `MicButton` (also in ChatView): that one is
 * compact and works inside the existing composer; this overlay is for
 * pure voice-first interaction with bigger affordances.
 *
 * @module renderer/components/VoiceChatOverlay
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import { useIPC } from '../hooks/useIPC';
import {
  interruptSpeech,
  isTtsEnabled,
  speakText,
  speakTextAndWait,
} from './VoiceOutputToggle';
import { isAutoBargeInEnabled, setAutoBargeInEnabled } from '../hooks/useAutoBargeIn';
import type { VoiceConversationEvent, VoiceConversationSnapshot } from '../types';
import {
  assessVoiceMissionIntent,
  toVoiceMissionListItem,
  type VoiceMissionDisplayStatus,
  type VoiceMissionListItem,
} from '../../shared/voice-background-mission';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type RecState = 'idle' | 'recording' | 'transcribing' | 'error';
type VoiceDispatchMode = 'chat' | 'mission';

const TTS_RATE_KEY = 'cowork.voice.ttsRate';
const TTS_AUTO_KEY = 'cowork.voice.tts.enabled'; // shared with VoiceOutputToggle

function recordVoiceEvent(payload: VoiceConversationEvent) {
  void window.electronAPI?.voice?.recordConversationEvent?.(payload).catch(() => undefined);
}

const VOICE_MISSION_STATUS: Record<
  VoiceMissionDisplayStatus,
  { label: string; className: string }
> = {
  queued: { label: 'En attente', className: 'text-warning bg-warning/10' },
  running: { label: 'En cours', className: 'text-accent bg-accent/10' },
  completed: { label: 'Terminée', className: 'text-success bg-success/10' },
  failed: { label: 'Échec', className: 'text-error bg-error/10' },
};

export const VoiceChatOverlay: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSession = useAppStore((s) =>
    s.sessions.find((session) => session.id === s.activeSessionId),
  );
  const workingDir = useAppStore((s) => s.workingDir);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const missionRuntime = useAppStore((s) => s.missionRuntime);
  const upsertMissionRuntime = useAppStore((s) => s.upsertMissionRuntime);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setPrimaryView = useAppStore((s) => s.setPrimaryView);
  const latencyBudgetMs = useAppStore((s) => s.sessions.find((session) => session.id === s.activeSessionId)?.intelligence?.latencyBudgetMs ?? 700);
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
  const [dispatchMode, setDispatchMode] = useState<VoiceDispatchMode>('chat');
  const [missionNotice, setMissionNotice] = useState<string | null>(null);
  const [showVoiceMissions, setShowVoiceMissions] = useState(true);
  const [cancellingMissionId, setCancellingMissionId] = useState<string | null>(null);
  const [autoBargeIn, setAutoBargeIn] = useState<boolean>(() => isAutoBargeInEnabled());
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceConversationSnapshot | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStateRef = useRef<RecState>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isOpenRef = useRef(isOpen);
  const overlayGenerationRef = useRef(0);

  const missionAssessment = useMemo(() => assessVoiceMissionIntent(text), [text]);
  const voiceMissions = useMemo(
    () =>
      Object.values(missionRuntime)
        .map((mission) => toVoiceMissionListItem(mission))
        .filter((mission): mission is VoiceMissionListItem => mission !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [missionRuntime],
  );
  const activeVoiceMissionCount = voiceMissions.filter(
    (mission) => mission.status === 'queued' || mission.status === 'running',
  ).length;

  useEffect(() => {
    isOpenRef.current = isOpen;
    overlayGenerationRef.current += 1;
  }, [isOpen]);

  useEffect(() => {
    recStateRef.current = rec;
  }, [rec]);

  // Reset state on open.
  useEffect(() => {
    if (isOpen) {
      setText('');
      setRec('idle');
      setErrorMsg(null);
      setBargeInNotice(null);
      setMissionNotice(null);
      setDispatchMode('chat');
      setElapsedSec(0);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // MissionStore is the durable source. Hydrate it whenever the voice surface
  // opens so missions created before an app restart immediately reappear.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void window.electronAPI?.missions
      ?.list()
      .then((result) => {
        if (cancelled || !result.ok) return;
        for (const mission of result.missions) upsertMissionRuntime(mission);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isOpen, upsertMissionRuntime]);

  const stopAllStreams = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    stopTimerRef.current = null;
    tickRef.current = null;
  }, []);

  // Cleanup on unmount.
  useEffect(() => stopAllStreams, [stopAllStreams]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const refresh = () => {
      void window.electronAPI?.voice?.conversationStatus?.().then((snapshot) => {
        if (!cancelled) setVoiceSnapshot(snapshot);
      }).catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, 250);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen]);

  const startRecording = async () => {
    if (
      (recStateRef.current !== 'idle' && recStateRef.current !== 'error')
      || streamRef.current
      || recorderRef.current?.state === 'recording'
    ) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      recStateRef.current = 'error';
      setRec('error');
      setErrorMsg(t('voiceOverlay.unsupported', 'mediaDevices indisponible'));
      return;
    }
    const interrupted = interruptSpeech('barge_in');
    setBargeInNotice(interrupted
      ? t('voiceOverlay.bargeIn', 'Réponse interrompue. Je vous écoute.')
      : null);
    recordVoiceEvent({ type: 'listening_started' });
    recStateRef.current = 'recording';
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
        if (recorderRef.current === recorder) recorderRef.current = null;
        stopAllStreams();
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        if (blob.size === 0) {
          recStateRef.current = 'idle';
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
      recStateRef.current = 'error';
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
      recStateRef.current = 'transcribing';
      setRec('transcribing');
    } else {
      recStateRef.current = 'idle';
      setRec('idle');
    }
  }, [rec]);

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
  }, [isOpen, onClose, rec, stopRecording]);

  const transcribe = async (blob: Blob) => {
    try {
      recStateRef.current = 'transcribing';
      setRec('transcribing');
      const arrayBuf = await blob.arrayBuffer();
      const api = window.electronAPI?.voice;
      if (!api?.transcribe) {
        recStateRef.current = 'error';
        setRec('error');
        setErrorMsg(t('voiceOverlay.bridgeUnavailable', 'voice bridge indisponible'));
        return;
      }
      const result = await api.transcribe(arrayBuf, { language: 'fr' });
      if (result.ok && result.text) {
        // Append to existing typed text (so user can dictate fragments).
        setText((prev) => (prev ? `${prev} ${result.text}` : result.text!));
        recStateRef.current = 'idle';
        setRec('idle');
      } else {
        recStateRef.current = 'error';
        setRec('error');
        setErrorMsg(result.error ?? 'transcription failed');
      }
    } catch (err) {
      recStateRef.current = 'error';
      setRec('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSend = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      if (dispatchMode === 'mission') {
        const api = window.electronAPI?.missions;
        if (!api?.createVoice) {
          throw new Error(
            t('voiceOverlay.missionUnavailable', 'Le pont des missions vocales est indisponible.'),
          );
        }
        const missionCwd = activeSession?.cwd || workingDir || undefined;
        const missionProjectId = activeSession?.projectId || activeProjectId || undefined;
        const result = await api.createVoice({
          prompt: message,
          ...(missionCwd ? { cwd: missionCwd } : {}),
          ...(missionProjectId ? { projectId: missionProjectId } : {}),
        });
        if (!result.ok || !result.mission) {
          throw new Error(result.error ?? 'Mission creation failed');
        }
        upsertMissionRuntime(result.mission);
        recordVoiceEvent({ type: 'user_message_sent', transcript: message });
        setText('');
        setDispatchMode('chat');
        const acknowledgement = t(
          'voiceOverlay.missionQueuedAck',
          'Mission lancée en arrière-plan. Je continue de vous écouter.',
        );
        setMissionNotice(acknowledgement);
        setSending(false);
        const acknowledgementGeneration = overlayGenerationRef.current;

        // Do not await this from the click handler: the mission acknowledgement
        // is already visible and persisted. Wait for speech to finish before
        // reopening the mic so Pocket TTS is not transcribed as user speech.
        void (async () => {
          await speakTextAndWait(acknowledgement);
          if (
            isOpenRef.current
            && overlayGenerationRef.current === acknowledgementGeneration
            && recStateRef.current === 'idle'
          ) {
            await startRecording();
          }
        })();
        return;
      }
      if (activeSessionId) {
        // A voice/companion turn gets its own guarded action posture. It must
        // not inherit a coding tab's collaboration `plan` state, nor mutate it.
        await continueSession(activeSessionId, message, {
          permissionModeOverride: 'default',
          conversationMode: 'companion',
        });
      } else {
        await startSession('Voix', message, undefined, undefined, true, {
          conversationMode: 'companion',
        });
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

  const cancelVoiceMission = async (missionId: string) => {
    const api = window.electronAPI?.missions;
    if (!api?.cancel || cancellingMissionId) return;
    setCancellingMissionId(missionId);
    setErrorMsg(null);
    try {
      const result = await api.cancel(missionId);
      if (!result.ok || !result.mission) {
        throw new Error(result.error ?? 'Mission cancellation failed');
      }
      upsertMissionRuntime(result.mission);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setCancellingMissionId(null);
    }
  };

  const openVoiceMissionResult = (mission: VoiceMissionListItem) => {
    if (!mission.sessionId) return;
    setActiveSession(mission.sessionId);
    setPrimaryView('chat');
    onClose();
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
        className="flex max-h-[94vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Mic size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-secondary">
              {t('voiceOverlay.title', 'Voix → Cowork')}
            </h2>
            {activeVoiceMissionCount > 0 && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent"
                data-testid="voice-mission-badge"
                onClick={() => setShowVoiceMissions(true)}
                title={t(
                  'voiceOverlay.activeMissions',
                  '{{count}} mission(s) active(s)',
                  { count: activeVoiceMissionCount },
                )}
              >
                <BriefcaseBusiness size={10} />
                {activeVoiceMissionCount}
              </button>
            )}
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
                showSettings ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-secondary'
              }`}
              title={t('voiceOverlay.settings', 'Paramètres voix')}
            >
              <Settings2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-secondary"
              aria-label={t('common.close', 'Close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Settings drawer */}
        {showSettings && (
          <div className="px-5 py-3 border-b border-border space-y-3 text-xs bg-zinc-900/60">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-muted-foreground">
                  {t('voiceOverlay.rate', 'Vitesse de la voix')}
                </label>
                <span className="text-secondary tabular-nums">
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
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {t(
                  'voiceOverlay.rateHint',
                  'La vitesse est appliquée au moteur local ; >1 ralentit, <1 accélère.',
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {t('voiceOverlay.autoSpeak', 'Lire la réponse de l\'agent à voix haute')}
              </span>
              <button
                onClick={toggleAutoSpeak}
                className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                  autoSpeak
                    ? 'bg-success/15 text-success'
                    : 'bg-surface text-muted-foreground hover:bg-surface-hover'
                }`}
              >
                {autoSpeak ? t('common.on', 'Activé') : t('common.off', 'Désactivé')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
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
                    : 'bg-surface text-muted-foreground hover:bg-surface-hover'
                }`}
                data-testid="voice-overlay-auto-barge-in"
              >
                {autoBargeIn ? t('common.on', 'Activé') : t('common.off', 'Désactivé')}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {t('voiceOverlay.testVoice', 'Tester la voix')}
              </span>
              <button
                onClick={playSampleTts}
                className="px-3 py-1 rounded text-[11px] bg-surface text-secondary hover:bg-surface-hover"
              >
                <Volume2 size={11} className="inline mr-1" />
                {t('voiceOverlay.play', 'Échantillon')}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-px border-b border-border bg-border" data-testid="voice-realtime-hud">
          {[
            ['Phase', voiceSnapshot?.phase ?? rec],
            ['STT', voiceSnapshot?.lastSttMs === undefined ? '—' : `${Math.round(voiceSnapshot.lastSttMs)} ms`],
            ['Réponse', voiceSnapshot?.lastResponseMs === undefined ? '—' : `${Math.round(voiceSnapshot.lastResponseMs)} ms`],
            ['Budget', `${latencyBudgetMs} ms`],
          ].map(([label, value]) => (
            <div key={label} className="bg-background px-3 py-2 text-center">
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className={`mt-0.5 text-[11px] font-semibold tabular-nums ${label === 'Réponse' && voiceSnapshot?.lastResponseMs && voiceSnapshot.lastResponseMs > latencyBudgetMs ? 'text-warning' : 'text-secondary'}`}>{value}</div>
            </div>
          ))}
        </div>

        {voiceMissions.length > 0 && (
          <section className="border-b border-border bg-surface/35" data-testid="voice-mission-list">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-5 py-2 text-left"
              data-testid="voice-mission-list-toggle"
              onClick={() => setShowVoiceMissions((value) => !value)}
            >
              <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-secondary">
                <BriefcaseBusiness size={13} className="shrink-0 text-accent" />
                {t('voiceOverlay.backgroundMissions', 'Missions vocales en arrière-plan')}
                <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {voiceMissions.length}
                </span>
              </span>
              <ChevronDown
                size={13}
                className={`shrink-0 text-muted-foreground transition-transform ${
                  showVoiceMissions ? 'rotate-180' : ''
                }`}
              />
            </button>
            {showVoiceMissions && (
              <div className="max-h-52 space-y-2 overflow-y-auto px-5 pb-3">
                {voiceMissions.map((mission) => {
                  const status = VOICE_MISSION_STATUS[mission.status];
                  const canCancel = mission.status === 'queued' || mission.status === 'running';
                  const canOpen =
                    Boolean(mission.sessionId) &&
                    (mission.status === 'completed' || mission.status === 'failed');
                  return (
                    <article
                      key={mission.id}
                      className="rounded-lg border border-border bg-background px-3 py-2"
                      data-testid={`voice-mission-row-${mission.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${status.className}`}
                              data-testid={`voice-mission-status-${mission.id}`}
                            >
                              {mission.status === 'running' ? (
                                <Loader2 size={9} className="mr-1 inline animate-spin" />
                              ) : mission.status === 'completed' ? (
                                <CheckCircle2 size={9} className="mr-1 inline" />
                              ) : null}
                              {status.label}
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {mission.progress}%
                            </span>
                          </div>
                          <h3 className="mt-1 truncate text-xs font-medium text-secondary">
                            {mission.title}
                          </h3>
                          {mission.resultPreview && (
                            <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                              {mission.resultPreview}
                            </p>
                          )}
                          {mission.error && (
                            <p className="mt-1 line-clamp-2 text-[10px] text-error">
                              {mission.error}
                            </p>
                          )}
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-hover">
                            <div
                              className={`h-full rounded-full transition-[width] ${
                                mission.status === 'failed' ? 'bg-error' : 'bg-accent'
                              }`}
                              style={{ width: `${mission.progress}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {canOpen && (
                            <button
                              type="button"
                              className="rounded p-1.5 text-accent hover:bg-accent/10"
                              data-testid={`voice-mission-open-${mission.id}`}
                              onClick={() => openVoiceMissionResult(mission)}
                              title={t('voiceOverlay.openMissionResult', 'Ouvrir le résultat')}
                            >
                              <ExternalLink size={12} />
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              className="rounded p-1.5 text-error hover:bg-error/10 disabled:opacity-40"
                              data-testid={`voice-mission-cancel-${mission.id}`}
                              disabled={cancellingMissionId === mission.id}
                              onClick={() => void cancelVoiceMission(mission.id)}
                              title={t('voiceOverlay.cancelMission', 'Annuler explicitement cette mission')}
                            >
                              {cancellingMissionId === mission.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Square size={11} />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-col items-center gap-4 overflow-y-auto px-6 py-5">
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
          {missionNotice && (
            <div
              className="w-full rounded border border-success/30 bg-success/10 p-2 text-xs text-success"
              data-testid="voice-mission-ack"
            >
              {missionNotice}
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
                  ? 'bg-surface ring-2 ring-zinc-700'
                  : 'bg-accent/15 ring-2 ring-accent/40 hover:ring-accent hover:bg-accent/25'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label={isRecording ? 'Arrêter' : 'Dicter'}
            data-testid="voice-overlay-mic"
          >
            {isTranscribing ? (
              <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
            ) : isRecording ? (
              <MicOff className="w-10 h-10 text-error" />
            ) : (
              <Mic className="w-10 h-10 text-accent" />
            )}
          </button>

          <div className="text-[11px] text-muted-foreground text-center">
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
            className="w-full bg-surface border border-border rounded-lg p-3 text-sm text-secondary placeholder:text-muted-foreground focus:outline-none focus:border-accent resize-none"
          />

          <div className="w-full space-y-2" data-testid="voice-dispatch-mode">
            {missionAssessment.recommended && text.trim() && (
              <div
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-secondary"
                data-testid="voice-mission-recommendation"
              >
                <div className="flex items-center gap-2 font-medium text-accent">
                  <BriefcaseBusiness size={12} />
                  {t(
                    'voiceOverlay.missionRecommended',
                    'Cette demande semble assez longue pour une mission en arrière-plan.',
                  )}
                </div>
                {missionAssessment.reasons.length > 0 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {missionAssessment.reasons.join(' · ')}
                  </p>
                )}
              </div>
            )}
            {missionAssessment.externalActionDetected && dispatchMode === 'mission' && (
              <p
                className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[10px] text-warning"
                data-testid="voice-mission-external-warning"
              >
                {t(
                  'voiceOverlay.externalConfirmation',
                  'Toute publication, communication, réservation, achat ou mutation externe restera bloquée jusqu’à votre confirmation explicite.',
                )}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  dispatchMode === 'chat'
                    ? 'border-accent bg-accent/10 text-secondary'
                    : 'border-border bg-surface text-muted-foreground hover:text-secondary'
                }`}
                data-testid="voice-mission-mode-chat"
                onClick={() => setDispatchMode('chat')}
              >
                <MessageCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="block text-xs font-medium">
                    {t('voiceOverlay.directChat', 'Conversation directe')}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-75">
                    {t('voiceOverlay.directChatHint', 'Répondre dans la session active')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  dispatchMode === 'mission'
                    ? 'border-accent bg-accent/10 text-secondary'
                    : 'border-border bg-surface text-muted-foreground hover:text-secondary'
                }`}
                data-testid="voice-mission-mode-background"
                onClick={() => setDispatchMode('mission')}
              >
                <BriefcaseBusiness size={14} className="mt-0.5 shrink-0" />
                <span>
                  <span className="flex items-center gap-1 text-xs font-medium">
                    {t('voiceOverlay.backgroundMission', 'Mission en arrière-plan')}
                    {missionAssessment.recommended && (
                      <span className="rounded bg-accent/15 px-1 py-0.5 text-[8px] uppercase text-accent">
                        {t('voiceOverlay.recommended', 'Recommandé')}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-75">
                    {t('voiceOverlay.backgroundMissionHint', 'Continuer à parler pendant le travail')}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <div className="text-[10px] text-muted-foreground">
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
            data-testid="voice-overlay-send"
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-accent text-background hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : dispatchMode === 'mission' ? (
              <BriefcaseBusiness size={12} />
            ) : (
              <Send size={12} />
            )}
            {dispatchMode === 'mission'
              ? t('voiceOverlay.delegateMission', 'Déléguer')
              : t('voiceOverlay.send', 'Envoyer')}
            <kbd className="text-[9px] opacity-70 ml-1">⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
};
